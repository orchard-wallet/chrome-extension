import type { WalletNetworkSetting } from "./networks";

export type AssetKind = "native" | "erc20" | "trc20" | "bitcoin";
export type ChainAssetStatus = "ready" | "refreshing" | "unsupported" | "error";
export type PortfolioStatus = "ready" | "partial" | "error";

export interface AssetDefinition {
  assetId: string;
  networkId: string;
  chainId?: number;
  symbol: string;
  name: string;
  decimals: number;
  kind: AssetKind;
  priceKey?: string;
  contractAddress?: string;
  groupKey?: string;
  imported?: boolean;
}

export interface AssetBalance {
  assetId: string;
  networkId: string;
  accountId: string;
  rawAmount: string;
  decimalAmount: string;
  refreshedAt: string;
}

export interface AssetPrice {
  assetId: string;
  currency: "USD";
  value: string;
  source: string;
  refreshedAt: string;
}

export interface ChainAssetSnapshot {
  networkId: string;
  networkName: string;
  family: WalletNetworkSetting["family"];
  nativeCurrencySymbol: string;
  accountId: string;
  chainId?: number;
  status: ChainAssetStatus;
  assetIds: string[];
  nativeAssetId?: string;
  nativeBalance?: string;
  tokenAssetIds?: string[];
  totalValueUsd: string | null;
  refreshedAt?: string;
  staleAt?: string;
  error?: string;
}

export interface PortfolioSnapshot {
  accountId: string;
  totalValueUsd: string | null;
  chainIds: string[];
  failedNetworkIds: string[];
  status: PortfolioStatus;
  refreshedAt: string;
  lastUpdatedAt: string;
  staleAt: string;
}

export interface AssetStore {
  assetDefinitions: Record<string, AssetDefinition>;
  assetBalances: Record<string, AssetBalance>;
  assetPrices: Record<string, AssetPrice>;
  chainAssetSnapshots: Record<string, ChainAssetSnapshot>;
  portfolioSnapshot: PortfolioSnapshot | null;
}

export const EVM_NETWORK_FAMILIES = new Set<WalletNetworkSetting["family"]>([
  "ethereum",
  "arbitrum",
  "hyperliquid",
  "polygon",
  "custom"
]);

export function emptyAssetStore(): AssetStore {
  return {
    assetDefinitions: {},
    assetBalances: {},
    assetPrices: {},
    chainAssetSnapshots: {},
    portfolioSnapshot: null
  };
}

export function nativeAssetId(network: WalletNetworkSetting): string {
  return `${network.networkId}:native`;
}

export function tokenAssetId(network: WalletNetworkSetting, contractAddress: string): string {
  return `${network.networkId}:erc20:${contractAddress.toLowerCase()}`;
}

export function balanceKey(accountId: string, assetId: string): string {
  return `${accountId.toLowerCase()}:${assetId}`;
}

export function isEvmAssetNetwork(network: WalletNetworkSetting): boolean {
  return (
    Boolean(network.enabled) &&
    EVM_NETWORK_FAMILIES.has(network.family) &&
    typeof network.chainId === "number" &&
    /^https?:\/\//i.test(network.selectedRpcUrl)
  );
}

export function isEnabledUnsupportedNetwork(network: WalletNetworkSetting): boolean {
  return Boolean(network.enabled) && !isEvmAssetNetwork(network);
}

export function formatUsd(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return "--";
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return "--";
  }

  return numeric.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: numeric >= 1 ? 2 : 4
  });
}

export function formatTokenAmount(value: string | null | undefined): string {
  if (!value) {
    return "0";
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return value;
  }

  if (numeric === 0) {
    return "0";
  }

  if (numeric < 0.0001) {
    return "<0.0001";
  }

  return numeric.toLocaleString(undefined, {
    maximumFractionDigits: 6
  });
}
