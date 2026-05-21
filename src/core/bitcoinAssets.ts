import type { AssetBalance, AssetDefinition, ChainAssetSnapshot } from "./assets";
import { balanceKey, nativeAssetId } from "./assets";
import type { WalletNetworkSetting } from "./networks";

interface BitcoinAddressStats {
  chain_stats?: {
    funded_txo_sum?: number;
    spent_txo_sum?: number;
  };
  mempool_stats?: {
    funded_txo_sum?: number;
    spent_txo_sum?: number;
  };
}

function bitcoinApiBase(network: WalletNetworkSetting): string {
  if (network.networkId === "bitcoin-testnet") {
    return "https://blockstream.info/testnet/api";
  }

  if (network.networkId === "bitcoin-signet") {
    return "https://mempool.space/signet/api";
  }

  return "https://blockstream.info/api";
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs = 12_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error("Bitcoin balance request timed out."));
    }, timeoutMs);

    operation
      .then(resolve)
      .catch(reject)
      .finally(() => globalThis.clearTimeout(timeoutId));
  });
}

export async function fetchBitcoinNativeBalance(
  network: WalletNetworkSetting,
  primaryAccountId: string,
  bitcoinAddress: string | undefined
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
    symbol: network.nativeCurrencySymbol,
    name: `${network.name} ${network.nativeCurrencySymbol}`,
    decimals: 8,
    kind: "bitcoin",
    priceKey: network.networkId === "bitcoin-mainnet" ? "coingecko:bitcoin" : undefined,
    groupKey: "native:BTC"
  };

  if (!bitcoinAddress) {
    return {
      definition,
      snapshot: {
        networkId: network.networkId,
        networkName: network.name,
        family: network.family,
        nativeCurrencySymbol: network.nativeCurrencySymbol,
        accountId: primaryAccountId,
        status: "unsupported",
        assetIds: [assetId],
        nativeAssetId: assetId,
        totalValueUsd: null,
        refreshedAt,
        staleAt,
        error: "Create a new wallet with Bitcoin address derivation before refreshing BTC."
      }
    };
  }

  const response = await withTimeout(fetch(`${bitcoinApiBase(network)}/address/${bitcoinAddress}`, { cache: "no-store" }));

  if (!response.ok) {
    throw new Error(`Bitcoin address request failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as BitcoinAddressStats;
  const confirmed = (payload.chain_stats?.funded_txo_sum ?? 0) - (payload.chain_stats?.spent_txo_sum ?? 0);
  const mempool = (payload.mempool_stats?.funded_txo_sum ?? 0) - (payload.mempool_stats?.spent_txo_sum ?? 0);
  const sats = BigInt(Math.max(0, confirmed + mempool));
  const decimalAmount = (Number(sats) / 100_000_000).toString();
  const balance: AssetBalance = {
    assetId,
    networkId: network.networkId,
    accountId: primaryAccountId,
    rawAmount: sats.toString(),
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

export function bitcoinBalanceStorageKey(accountId: string, assetId: string): string {
  return balanceKey(accountId, assetId);
}
