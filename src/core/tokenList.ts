// Token metadata source layer.
//
// Tokens come from two places:
//   1. CURATED_ERC20_TOKENS — hand-maintained in this file. Used for tokens
//      that need extra metadata the upstream list doesn't carry (e.g. a
//      Coingecko/0x price key), or that we want pinned to a specific
//      ordering at the top of the Swap selector.
//   2. GENERATED_ERC20_TOKENS — produced by `npm run sync:tokens` from the
//      ethereum-lists/tokens upstream (MIT License). Auto-overwritten.
//
// `getKnownErc20Tokens(networkId)` merges both layers and deduplicates by
// lowercase contract address — curated entries always win.

import type { Address } from "viem";
import { GENERATED_ERC20_TOKENS } from "./generatedTokenList";

export interface GeneratedErc20Token {
  symbol: string;
  name: string;
  decimals: number;
  contractAddress: string;
  priceKey?: string;
  groupKey: string;
}

export interface KnownErc20Token {
  symbol: string;
  name: string;
  decimals: number;
  contractAddress: Address;
  priceKey?: string;
  groupKey: string;
}

// Curated tokens take precedence over the generated list and define the
// display ordering. Keep this list small — anything that fits the upstream
// schema cleanly should live in generatedTokenList.ts instead.
const CURATED_ERC20_TOKENS: Record<string, KnownErc20Token[]> = {
  "ethereum-mainnet": [
    {
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      priceKey: "ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      groupKey: "stablecoin:usdc"
    },
    {
      symbol: "USDT",
      name: "Tether USD",
      decimals: 6,
      contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      priceKey: "ethereum:0xdac17f958d2ee523a2206206994597c13d831ec7",
      groupKey: "stablecoin:usdt"
    },
    {
      symbol: "WBTC",
      name: "Wrapped BTC",
      decimals: 8,
      contractAddress: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      priceKey: "ethereum:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
      groupKey: "erc20:wbtc"
    }
  ],
  "arbitrum-one": [
    {
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      contractAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      priceKey: "arbitrum:0xaf88d065e77c8cc2239327c5edb3a432268e5831",
      groupKey: "stablecoin:usdc"
    }
  ],
  "polygon-mainnet": [
    {
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      contractAddress: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
      priceKey: "polygon:0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
      groupKey: "stablecoin:usdc"
    }
  ]
};

function normalizeGenerated(token: GeneratedErc20Token): KnownErc20Token {
  return {
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    contractAddress: token.contractAddress as Address,
    priceKey: token.priceKey,
    groupKey: token.groupKey
  };
}

export function getKnownErc20Tokens(networkId: string): KnownErc20Token[] {
  const curated = CURATED_ERC20_TOKENS[networkId] ?? [];
  const generated = (GENERATED_ERC20_TOKENS[networkId] ?? []).map(normalizeGenerated);
  const seen = new Set(curated.map((token) => token.contractAddress.toLowerCase()));
  const merged: KnownErc20Token[] = [...curated];

  for (const token of generated) {
    const key = token.contractAddress.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(token);
  }

  return merged;
}
