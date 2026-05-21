import type { AssetBalance, AssetDefinition, ChainAssetSnapshot } from "./assets";
import { balanceKey, nativeAssetId } from "./assets";
import type { WalletNetworkSetting } from "./networks";

interface TronAccountResponse {
  data?: Array<{
    balance?: number;
  }>;
}

function tronApiBase(network: WalletNetworkSetting): string {
  if (network.networkId === "tron-shasta") {
    return "https://api.shasta.trongrid.io";
  }

  if (network.networkId === "tron-nile") {
    return "https://nile.trongrid.io";
  }

  return "https://api.trongrid.io";
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs = 12_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error("Tron balance request timed out."));
    }, timeoutMs);

    operation
      .then(resolve)
      .catch(reject)
      .finally(() => globalThis.clearTimeout(timeoutId));
  });
}

export async function fetchTronNativeBalance(
  network: WalletNetworkSetting,
  primaryAccountId: string,
  tronAddress: string | undefined
): Promise<{
  definition: AssetDefinition;
  balance?: AssetBalance;
  snapshot: ChainAssetSnapshot;
}> {
  const assetId = nativeAssetId(network);
  const refreshedAt = new Date().toISOString();
  const staleAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const definition: AssetDefinition = {
    assetId,
    networkId: network.networkId,
    chainId: network.chainId,
    symbol: network.nativeCurrencySymbol,
    name: `${network.name} ${network.nativeCurrencySymbol}`,
    decimals: 6,
    kind: "trc20",
    priceKey: "coingecko:tron",
    groupKey: "native:TRX"
  };

  if (!tronAddress) {
    return {
      definition,
      snapshot: {
        networkId: network.networkId,
        networkName: network.name,
        family: network.family,
        nativeCurrencySymbol: network.nativeCurrencySymbol,
        accountId: primaryAccountId,
        chainId: network.chainId,
        status: "unsupported",
        assetIds: [assetId],
        nativeAssetId: assetId,
        totalValueUsd: null,
        refreshedAt,
        staleAt,
        error: "Create a new wallet with Tron address derivation before refreshing TRX."
      }
    };
  }

  const response = await withTimeout(fetch(`${tronApiBase(network)}/v1/accounts/${tronAddress}`, { cache: "no-store" }));

  if (!response.ok) {
    throw new Error(`Tron account request failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as TronAccountResponse;
  const sun = BigInt(payload.data?.[0]?.balance ?? 0);
  const decimalAmount = (Number(sun) / 1_000_000).toString();
  const balance: AssetBalance = {
    assetId,
    networkId: network.networkId,
    accountId: primaryAccountId,
    rawAmount: sun.toString(),
    decimalAmount,
    refreshedAt
  };

  return {
    definition,
    balance,
    snapshot: {
      networkId: network.networkId,
      networkName: network.name,
      family: network.family,
      nativeCurrencySymbol: network.nativeCurrencySymbol,
      accountId: primaryAccountId,
      chainId: network.chainId,
      status: "ready",
      assetIds: [assetId],
      nativeAssetId: assetId,
      nativeBalance: decimalAmount,
      tokenAssetIds: [],
      totalValueUsd: null,
      refreshedAt,
      staleAt
    }
  };
}

export function tronBalanceStorageKey(accountId: string, assetId: string): string {
  return balanceKey(accountId, assetId);
}
