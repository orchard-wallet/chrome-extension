import { createPublicClient, defineChain, formatUnits, http, type Address } from "viem";
import type { AssetBalance, AssetDefinition, ChainAssetSnapshot } from "./assets";
import { balanceKey, nativeAssetId } from "./assets";
import type { WalletNetworkSetting } from "./networks";

export interface NativeBalanceResult {
  definition: AssetDefinition;
  balance: AssetBalance;
  snapshot: ChainAssetSnapshot;
}

function withTimeout<T>(operation: Promise<T>, timeoutMs = 12_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error("RPC request timed out. Check the network connection or RPC gateway."));
    }, timeoutMs);

    operation
      .then(resolve)
      .catch(reject)
      .finally(() => globalThis.clearTimeout(timeoutId));
  });
}

function createNetworkClient(network: WalletNetworkSetting) {
  if (typeof network.chainId !== "number") {
    throw new Error(`${network.name} does not have an EVM chain ID.`);
  }

  const rpcUrls = Array.from(new Set([network.selectedRpcUrl, ...network.rpcUrls].filter((url) => /^https?:\/\//i.test(url))));
  const chain = defineChain({
    id: network.chainId,
    name: network.name,
    nativeCurrency: {
      decimals: 18,
      name: network.nativeCurrencySymbol,
      symbol: network.nativeCurrencySymbol
    },
    rpcUrls: {
      default: {
        http: rpcUrls.length > 0 ? rpcUrls : [network.selectedRpcUrl]
      }
    }
  });

  return createPublicClient({
    chain,
    transport: http(network.selectedRpcUrl)
  });
}

export async function fetchEvmNativeBalance(network: WalletNetworkSetting, accountId: Address): Promise<NativeBalanceResult> {
  const assetId = nativeAssetId(network);
  const client = createNetworkClient(network);
  const wei = await withTimeout(
    client.getBalance({
      address: accountId,
      blockTag: "latest"
    })
  );
  const refreshedAt = new Date().toISOString();
  const decimalAmount = formatUnits(wei, 18);
  const definition: AssetDefinition = {
    assetId,
    networkId: network.networkId,
    chainId: network.chainId,
    symbol: network.nativeCurrencySymbol,
    name: `${network.name} ${network.nativeCurrencySymbol}`,
    decimals: 18,
    kind: "native",
    priceKey: nativePriceKey(network)
  };
  const balance: AssetBalance = {
    assetId,
    networkId: network.networkId,
    accountId,
    rawAmount: wei.toString(),
    decimalAmount,
    refreshedAt
  };
  const snapshot: ChainAssetSnapshot = {
    networkId: network.networkId,
    networkName: network.name,
    family: network.family,
    nativeCurrencySymbol: network.nativeCurrencySymbol,
    accountId,
    chainId: network.chainId,
    status: "ready",
    assetIds: [assetId],
    nativeAssetId: assetId,
    nativeBalance: decimalAmount,
    totalValueUsd: null,
    refreshedAt
  };

  return { definition, balance, snapshot };
}

export function nativePriceKey(network: WalletNetworkSetting): string | undefined {
  switch (network.nativeCurrencySymbol.toUpperCase()) {
    case "ETH":
      return "coingecko:ethereum";
    case "HYPE":
      return "coingecko:hyperliquid";
    case "POL":
      return "coingecko:polygon-ecosystem-token";
    case "MATIC":
      return "coingecko:matic-network";
    default:
      return undefined;
  }
}

export function createFailedSnapshot(network: WalletNetworkSetting, accountId: Address, error: string): ChainAssetSnapshot {
  return {
    networkId: network.networkId,
    networkName: network.name,
    family: network.family,
    nativeCurrencySymbol: network.nativeCurrencySymbol,
    accountId,
    chainId: network.chainId,
    status: "error",
    assetIds: [],
    totalValueUsd: null,
    refreshedAt: new Date().toISOString(),
    error
  };
}

export function createUnsupportedSnapshot(network: WalletNetworkSetting, accountId: Address): ChainAssetSnapshot {
  return {
    networkId: network.networkId,
    networkName: network.name,
    family: network.family,
    nativeCurrencySymbol: network.nativeCurrencySymbol,
    accountId,
    chainId: network.chainId,
    status: "unsupported",
    assetIds: [],
    totalValueUsd: null,
    refreshedAt: new Date().toISOString(),
    error: `${network.family} balance adapter is not implemented yet.`
  };
}

export function balanceStorageKey(accountId: Address, assetId: string): string {
  return balanceKey(accountId, assetId);
}
