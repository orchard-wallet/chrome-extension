import type { Address } from "viem";
import { readAssetStore, readNetworkSettings, writeAssetStore } from "../lib/storage";
import type { AssetStore, ChainAssetSnapshot } from "./assets";
import { balanceKey, emptyAssetStore, isEnabledUnsupportedNetwork, isEvmAssetNetwork } from "./assets";
import { bitcoinBalanceStorageKey, fetchBitcoinNativeBalance } from "./bitcoinAssets";
import { balanceStorageKey, createFailedSnapshot, createUnsupportedSnapshot, fetchEvmNativeBalance } from "./evmAssets";
import { getBuiltInNetworkSettings, type WalletNetworkSetting } from "./networks";
import { fetchNativeUsdPrices } from "./prices";
import { fetchTronNativeBalance, tronBalanceStorageKey } from "./tronAssets";

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

function applyUsdValues(store: AssetStore, accountId: string, snapshots: ChainAssetSnapshot[]): ChainAssetSnapshot[] {
  return snapshots.map((snapshot) => {
    let totalValueUsd = 0;
    let hasValuedAsset = false;

    for (const assetId of snapshot.assetIds) {
      const price = store.assetPrices[assetId];
      const balance = store.assetBalances[balanceKey(accountId, assetId)];

      if (!price || !balance) {
        continue;
      }

      const value = Number(balance.decimalAmount) * Number(price.value);

      if (Number.isFinite(value)) {
        totalValueUsd += value;
        hasValuedAsset = true;
      }
    }

    return {
      ...snapshot,
      totalValueUsd: hasValuedAsset ? totalValueUsd.toFixed(2) : null
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
  const refreshedAt = new Date().toISOString();
  const staleAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  return {
    accountId,
    totalValueUsd: hasReady ? total.toFixed(2) : null,
    chainIds: snapshots.map((snapshot) => snapshot.networkId),
    failedNetworkIds: snapshots.filter((snapshot) => snapshot.status === "error").map((snapshot) => snapshot.networkId),
    status: hasError || hasMissingValue ? "partial" : "ready",
    refreshedAt,
    lastUpdatedAt: refreshedAt,
    staleAt
  };
}

export async function refreshPortfolio(
  accountId: Address,
  chainAccounts?: {
    ethereum?: string;
    tron?: string;
    bitcoin?: string;
  }
): Promise<PortfolioRefreshResult> {
  const savedSettings = await readNetworkSettings();
  const networks = getBuiltInNetworkSettings(savedSettings).filter((network) => network.enabled);
  const evmNetworks = networks.filter(isEvmAssetNetwork);
  const tronNetworks = networks.filter((network) => network.family === "tron");
  const bitcoinNetworks = networks.filter((network) => network.family === "bitcoin");
  const unsupportedNetworks = networks.filter(
    (network) => isEnabledUnsupportedNetwork(network) && network.family !== "tron" && network.family !== "bitcoin"
  );
  const currentStore = await readAssetStore();
  const store = clearAccountSnapshots(currentStore, accountId, networks);

  const evmResults = await Promise.allSettled(
    evmNetworks.map(async (network) => ({
      network,
      result: await fetchEvmNativeBalance(network, accountId)
    }))
  );
  const tronResults = await Promise.allSettled(
    tronNetworks.map(async (network) => ({
      network,
      result: await fetchTronNativeBalance(network, accountId, chainAccounts?.tron)
    }))
  );
  const bitcoinResults = await Promise.allSettled(
    bitcoinNetworks.map(async (network) => ({
      network,
      result: await fetchBitcoinNativeBalance(network, accountId, chainAccounts?.bitcoin)
    }))
  );
  const snapshots: ChainAssetSnapshot[] = unsupportedNetworks.map((network) => createUnsupportedSnapshot(network, accountId));
  let failedNetworks = 0;

  for (const settled of evmResults) {
    if (settled.status === "fulfilled") {
      const { network, result } = settled.value;
      store.assetDefinitions[result.definition.assetId] = result.definition;
      for (const tokenDefinition of result.tokenDefinitions ?? []) {
        store.assetDefinitions[tokenDefinition.assetId] = tokenDefinition;
      }
      store.assetBalances[balanceStorageKey(accountId, result.definition.assetId)] = result.balance;
      for (const tokenBalance of result.tokenBalances ?? []) {
        store.assetBalances[balanceStorageKey(accountId, tokenBalance.assetId)] = tokenBalance;
      }
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

  for (const settled of tronResults) {
    if (settled.status === "fulfilled") {
      const { result } = settled.value;
      store.assetDefinitions[result.definition.assetId] = result.definition;
      if (result.balance) {
        store.assetBalances[tronBalanceStorageKey(accountId, result.definition.assetId)] = result.balance;
      }
      snapshots.push(result.snapshot);
    } else {
      failedNetworks += 1;
      const network = tronNetworks[tronResults.indexOf(settled)];
      snapshots.push(createFailedSnapshot(network, accountId, settled.reason instanceof Error ? settled.reason.message : "Unable to refresh Tron balance."));
    }
  }

  for (const settled of bitcoinResults) {
    if (settled.status === "fulfilled") {
      const { result } = settled.value;
      store.assetDefinitions[result.definition.assetId] = result.definition;
      if (result.balance) {
        store.assetBalances[bitcoinBalanceStorageKey(accountId, result.definition.assetId)] = result.balance;
      }
      snapshots.push(result.snapshot);
    } else {
      failedNetworks += 1;
      const network = bitcoinNetworks[bitcoinResults.indexOf(settled)];
      snapshots.push(createFailedSnapshot(network, accountId, settled.reason instanceof Error ? settled.reason.message : "Unable to refresh Bitcoin balance."));
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

  const valuedSnapshots = applyUsdValues(store, accountId, snapshots).sort((a, b) => a.networkName.localeCompare(b.networkName));

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
