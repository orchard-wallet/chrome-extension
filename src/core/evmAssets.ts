import { createPublicClient, defineChain, formatUnits, http, type Address } from "viem";
import { readImportedErc20Tokens } from "../lib/storage";
import type { AssetBalance, AssetDefinition, ChainAssetSnapshot } from "./assets";
import { balanceKey, nativeAssetId, tokenAssetId } from "./assets";
import type { WalletNetworkSetting } from "./networks";
import { getKnownErc20Tokens, type KnownErc20Token } from "./tokenList";

export interface NativeBalanceResult {
  definition: AssetDefinition;
  tokenDefinitions?: AssetDefinition[];
  balance: AssetBalance;
  tokenBalances?: AssetBalance[];
  snapshot: ChainAssetSnapshot;
}

const ERC20_BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }]
  }
] as const;

function isKnownErc20Token(networkId: string, contractAddress: string): boolean {
  return getKnownErc20Tokens(networkId).some(
    (token) => token.contractAddress.toLowerCase() === contractAddress.toLowerCase()
  );
}

export function nativeAssetDefinition(network: WalletNetworkSetting): AssetDefinition {
  return {
    assetId: nativeAssetId(network),
    networkId: network.networkId,
    chainId: network.chainId,
    symbol: network.nativeCurrencySymbol,
    name: `${network.name} ${network.nativeCurrencySymbol}`,
    decimals: 18,
    kind: "native",
    priceKey: nativePriceKey(network),
    groupKey: `native:${network.nativeCurrencySymbol.toUpperCase()}`
  };
}

// Always-available EVM token list for the Swap selector, independent of
// portfolio-refresh state. Native asset first, then known ERC-20 tokens
// (curated overrides + ethereum-lists/tokens generated entries).
export function curatedEvmSwapAssets(network: WalletNetworkSetting): AssetDefinition[] {
  const tokens = getKnownErc20Tokens(network.networkId);
  return [
    nativeAssetDefinition(network),
    ...tokens.map<AssetDefinition>((token) => ({
      assetId: tokenAssetId(network, token.contractAddress),
      networkId: network.networkId,
      chainId: network.chainId,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      kind: "erc20",
      priceKey: token.priceKey,
      contractAddress: token.contractAddress,
      groupKey: token.groupKey
    }))
  ];
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
  const definition = nativeAssetDefinition(network);
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
    tokenAssetIds: [],
    totalValueUsd: null,
    refreshedAt,
    staleAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
  };

  const importedTokens = (await readImportedErc20Tokens()).filter((token) => token.networkId === network.networkId);
  const tokenResults = await fetchEvmTokenBalances(network, accountId, client, refreshedAt, importedTokens);
  snapshot.assetIds.push(...tokenResults.balances.map((tokenBalance) => tokenBalance.assetId));
  snapshot.tokenAssetIds = tokenResults.balances.map((tokenBalance) => tokenBalance.assetId);

  return {
    definition,
    tokenDefinitions: tokenResults.definitions,
    balance,
    tokenBalances: tokenResults.balances,
    snapshot
  };
}

async function fetchEvmTokenBalances(
  network: WalletNetworkSetting,
  accountId: Address,
  client: ReturnType<typeof createNetworkClient>,
  refreshedAt: string,
  importedTokens: Array<{
    contractAddress: string;
    symbol: string;
    name: string;
    decimals: number;
    priceKey?: string;
  }>
): Promise<{ definitions: AssetDefinition[]; balances: AssetBalance[] }> {
  const knownTokens = getKnownErc20Tokens(network.networkId);
  const importedAsKnown: KnownErc20Token[] = importedTokens.map((token) => ({
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    contractAddress: token.contractAddress as Address,
    priceKey: token.priceKey,
    groupKey: `erc20:${token.symbol.toLowerCase()}`
  }));
  // Filter out user-imported entries that duplicate a known token (by
  // contract address) to avoid double-counting in the balance list.
  const knownAddresses = new Set(knownTokens.map((t) => t.contractAddress.toLowerCase()));
  const configuredTokens: KnownErc20Token[] = [
    ...knownTokens,
    ...importedAsKnown.filter((t) => !knownAddresses.has(t.contractAddress.toLowerCase()))
  ];
  const definitions: AssetDefinition[] = [];
  const balances: AssetBalance[] = [];

  for (const token of configuredTokens) {
    const assetId = tokenAssetId(network, token.contractAddress);
    definitions.push({
      assetId,
      networkId: network.networkId,
      chainId: network.chainId,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      kind: "erc20",
      priceKey: token.priceKey,
      contractAddress: token.contractAddress,
      groupKey: token.groupKey,
      imported: !isKnownErc20Token(network.networkId, token.contractAddress)
    });

    try {
      const rawAmount = await withTimeout(
        client.readContract({
          address: token.contractAddress,
          abi: ERC20_BALANCE_ABI,
          functionName: "balanceOf",
          args: [accountId]
        }),
        12_000
      );
      balances.push({
        assetId,
        networkId: network.networkId,
        accountId,
        rawAmount: rawAmount.toString(),
        decimalAmount: formatUnits(rawAmount, token.decimals),
        refreshedAt
      });
    } catch {
      // Native balance should remain usable even when a token contract/RPC call fails.
    }
  }

  return { definitions, balances };
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
    staleAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
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
    staleAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    error: `${network.family} balance adapter is not implemented yet.`
  };
}

export function balanceStorageKey(accountId: Address, assetId: string): string {
  return balanceKey(accountId, assetId);
}
