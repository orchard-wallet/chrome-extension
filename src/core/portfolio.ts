import type { Address } from "viem";
import { readAssetStore, readNetworkSettings, writeAssetStore } from "../lib/storage";
import type { AssetStore, ChainAssetSnapshot } from "./assets";
import { balanceKey, emptyAssetStore, isEnabledUnsupportedNetwork, isEvmAssetNetwork } from "./assets";
import { balanceStorageKey, createFailedSnapshot, createUnsupportedSnapshot, fetchEvmNativeBalance } from "./evmAssets";
import { getBuiltInNetworkSettings, type WalletNetworkSetting } from "./networks";
import { fetchNativeUsdPrices } from "./prices";

export interface PortfolioRefreshResult {
  store: AssetStore;
  refreshedNetworks: number;
  failedNetworks: number;
}

function mergeStores(current: AssetStore | null | undefined): AssetStore {
  return {
    ...emptyAssetStore(),
    ...(current ?? {}),
    assetDefinitions: current?.assetDefinitions ?? {},
    assetBalances: current?.assetBalances ?? {},
    assetPrices: current?.assetPrices ?? {},
    chainAssetSnapshots: current?.chainAssetSnapshots ?? {},
    portfolioSnapshot: current?.portfolioSnapshot ?? null
  };
}

function clearAccountSnapshots(store: AssetStore, accountId: Address, networks: WalletNetworkSetting[]): AssetStore {
  const next = mergeStores(store);

  for (const network of networks) {
    delete next.chainAssetSnapshots[network.networkId];
  }

  for (const key of Object.keys(next.assetBalances)) {
    if (key.startsWith(`${accountId.toLowerCase()}:`)) {
      delete next.assetBalances[key];
    }
  }

  return next;
}

function applyUsdValues(store: AssetStore, snapshots: ChainAssetSnapshot[]): ChainAssetSnapshot[] {
  return snapshots.map((snapshot) => {
    if (!snapshot.nativeAssetId || snapshot.nativeBalance === undefined) {
      return snapshot;
    }

    const price = store.assetPrices[snapshot.nativeAssetId];

    if (!price) {
      return snapshot;
    }

    const value = Number(snapshot.nativeBalance) * Number(price.value);

    return {
      ...snapshot,
      totalValueUsd: Number.isFinite(value) ? value.toFixed(2) : null
    };
  });
}

function aggregatePortfolio(accountId: Address, snapshots: ChainAssetSnapshot[]): AssetStore["portfolioSnapshot"] {
  const total = snapshots.reduce((sum, snapshot) => {
    const value = snapshot.totalValueUsd === null ? null : Number(snapshot.totalValueUsd);
    return value !== null && Number.isFinite(value) ? sum + value : sum;
  }, 0);
  const hasMissingValue = snapshots.some((snapshot) => snapshot.totalValueUsd === null);
  const hasError = snapshots.some((snapshot) => snapshot.status === "error");
  const hasReady = snapshots.some((snapshot) => snapshot.status === "ready");

  return {
    accountId,
    totalValueUsd: hasReady ? total.toFixed(2) : null,
    chainIds: snapshots.map((snapshot) => snapshot.networkId),
    status: hasError || hasMissingValue ? "partial" : "ready",
    refreshedAt: new Date().toISOString()
  };
}

export async function refreshPortfolio(accountId: Address): Promise<PortfolioRefreshResult> {
  const savedSettings = await readNetworkSettings();
  const networks = getBuiltInNetworkSettings(savedSettings).filter((network) => network.enabled);
  const evmNetworks = networks.filter(isEvmAssetNetwork);
  const unsupportedNetworks = networks.filter(isEnabledUnsupportedNetwork);
  const currentStore = await readAssetStore();
  const store = clearAccountSnapshots(currentStore, accountId, networks);

  const evmResults = await Promise.allSettled(
    evmNetworks.map(async (network) => ({
      network,
      result: await fetchEvmNativeBalance(network, accountId)
    }))
  );
  const snapshots: ChainAssetSnapshot[] = unsupportedNetworks.map((network) => createUnsupportedSnapshot(network, accountId));
  let failedNetworks = 0;

  for (const settled of evmResults) {
    if (settled.status === "fulfilled") {
      const { network, result } = settled.value;
      store.assetDefinitions[result.definition.assetId] = result.definition;
      store.assetBalances[balanceStorageKey(accountId, result.definition.assetId)] = result.balance;
      snapshots.push(result.snapshot);

      if (!network.enabled) {
        delete store.chainAssetSnapshots[network.networkId];
      }
    } else {
      failedNetworks += 1;
      const network = evmNetworks[evmResults.indexOf(settled)];
      snapshots.push(createFailedSnapshot(network, accountId, settled.reason instanceof Error ? settled.reason.message : "Unable to refresh balance."));
    }
  }

  try {
    const prices = await fetchNativeUsdPrices(Object.values(store.assetDefinitions));
    store.assetPrices = {
      ...store.assetPrices,
      ...prices
    };
  } catch {
    // The portfolio remains usable without price data; totals are marked partial below.
  }

  const valuedSnapshots = applyUsdValues(store, snapshots).sort((a, b) => a.networkName.localeCompare(b.networkName));

  for (const snapshot of valuedSnapshots) {
    store.chainAssetSnapshots[snapshot.networkId] = snapshot;

    for (const assetId of snapshot.assetIds) {
      const key = balanceKey(accountId, assetId);
      const balance = store.assetBalances[key];

      if (balance) {
        store.assetBalances[key] = {
          ...balance,
          refreshedAt: snapshot.refreshedAt ?? balance.refreshedAt
        };
      }
    }
  }

  store.portfolioSnapshot = aggregatePortfolio(accountId, valuedSnapshots);
  await writeAssetStore(store);

  return {
    store,
    refreshedNetworks: evmNetworks.length,
    failedNetworks
  };
}

export async function readPortfolioStore(): Promise<AssetStore> {
  return mergeStores(await readAssetStore());
}
