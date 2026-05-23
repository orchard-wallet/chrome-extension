import { describe, it, expect } from "vitest";
import { PRICE_REFRESH_INTERVAL_MS, selectQuoteProvider } from "./quoteProvider.js";
import type { WalletNetworkSetting } from "../networks.js";

const evmNetwork = (overrides: Partial<WalletNetworkSetting> = {}): WalletNetworkSetting => ({
  networkId: "ethereum-mainnet",
  family: "ethereum",
  name: "Ethereum",
  chain: "ETH",
  chainId: 1,
  enabled: true,
  selectedRpcUrl: "https://rpc.example.com",
  rpcUrls: ["https://rpc.example.com"],
  nativeCurrencySymbol: "ETH",
  ...overrides,
});

describe("selectQuoteProvider", () => {
  it("returns null for null/undefined network", () => {
    expect(selectQuoteProvider(null)).toBeNull();
    expect(selectQuoteProvider(undefined)).toBeNull();
  });

  it("returns the 0x provider for ethereum mainnet", () => {
    const provider = selectQuoteProvider(evmNetwork());
    expect(provider).not.toBeNull();
    expect(provider?.id).toBe("zero-ex");
  });

  it("returns the 0x provider for arbitrum, polygon, hyperliquid families", () => {
    expect(selectQuoteProvider(evmNetwork({ family: "arbitrum", chainId: 42161 }))?.id).toBe("zero-ex");
    expect(selectQuoteProvider(evmNetwork({ family: "polygon", chainId: 137 }))?.id).toBe("zero-ex");
    expect(selectQuoteProvider(evmNetwork({ family: "hyperliquid", chainId: 998 }))?.id).toBe("zero-ex");
  });

  it("returns null for non-EVM families (tron, bitcoin)", () => {
    expect(selectQuoteProvider(evmNetwork({ family: "tron", chainId: undefined }))).toBeNull();
    expect(selectQuoteProvider(evmNetwork({ family: "bitcoin", chainId: undefined }))).toBeNull();
  });

  it("returns null when chainId is missing on an EVM family", () => {
    expect(selectQuoteProvider(evmNetwork({ chainId: undefined }))).toBeNull();
  });

  it("returns null when chainId is not a positive integer", () => {
    expect(selectQuoteProvider(evmNetwork({ chainId: 0 }))).toBeNull();
    expect(selectQuoteProvider(evmNetwork({ chainId: -1 }))).toBeNull();
  });

  it("exposes a 10-second refresh interval", () => {
    expect(PRICE_REFRESH_INTERVAL_MS).toBe(10_000);
  });
});
