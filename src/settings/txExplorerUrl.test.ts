import { describe, it, expect } from "vitest";
import { txExplorerUrl } from "./txExplorerUrl.js";
import type { WalletNetworkSetting } from "../core/networks.js";

const baseNetwork = (overrides: Partial<WalletNetworkSetting> = {}): WalletNetworkSetting => ({
  networkId: "test-net",
  family: "ethereum",
  name: "Test Net",
  chain: "ETH",
  chainId: 1,
  enabled: true,
  selectedRpcUrl: "https://rpc.example.com",
  rpcUrls: ["https://rpc.example.com"],
  nativeCurrencySymbol: "ETH",
  ...overrides,
});

const HASH = "0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1";

describe("txExplorerUrl", () => {
  it("returns null for empty hash", () => {
    expect(txExplorerUrl("", baseNetwork())).toBeNull();
  });

  it("returns null when network is null", () => {
    expect(txExplorerUrl(HASH, null)).toBeNull();
  });

  it("returns null when network is undefined", () => {
    expect(txExplorerUrl(HASH, undefined)).toBeNull();
  });

  it("returns null when network has no chainId and no explorerUrl", () => {
    expect(txExplorerUrl(HASH, baseNetwork({ chainId: undefined, explorerUrl: undefined }))).toBeNull();
  });

  describe("explorerUrl — scheme validation (XSS guard)", () => {
    it("blocks javascript: scheme", () => {
      const network = baseNetwork({ explorerUrl: "javascript:alert(1)//" });
      expect(txExplorerUrl(HASH, network)).toBeNull();
    });

    it("blocks javascript: scheme with uppercase", () => {
      const network = baseNetwork({ explorerUrl: "JAVASCRIPT:alert(1)//" });
      expect(txExplorerUrl(HASH, network)).toBeNull();
    });

    it("blocks data: scheme", () => {
      const network = baseNetwork({ explorerUrl: "data:text/html,<script>alert(1)</script>" });
      expect(txExplorerUrl(HASH, network)).toBeNull();
    });

    it("blocks vbscript: scheme", () => {
      const network = baseNetwork({ explorerUrl: "vbscript:msgbox(1)" });
      expect(txExplorerUrl(HASH, network)).toBeNull();
    });
  });

  describe("explorerUrl — valid URLs", () => {
    it("builds URL from https explorerUrl with trailing slash", () => {
      const network = baseNetwork({ explorerUrl: "https://custom.explorer.io/" });
      expect(txExplorerUrl(HASH, network)).toBe(`https://custom.explorer.io/tx/${HASH}`);
    });

    it("builds URL from https explorerUrl without trailing slash", () => {
      const network = baseNetwork({ explorerUrl: "https://custom.explorer.io" });
      expect(txExplorerUrl(HASH, network)).toBe(`https://custom.explorer.io/tx/${HASH}`);
    });

    it("builds URL from http explorerUrl", () => {
      const network = baseNetwork({ explorerUrl: "http://local.explorer" });
      expect(txExplorerUrl(HASH, network)).toBe(`http://local.explorer/tx/${HASH}`);
    });
  });

  describe("chainId fallbacks", () => {
    it("returns etherscan for chainId 1", () => {
      expect(txExplorerUrl(HASH, baseNetwork({ chainId: 1, explorerUrl: undefined }))).toBe(`https://etherscan.io/tx/${HASH}`);
    });

    it("returns sepolia etherscan for chainId 11155111", () => {
      expect(txExplorerUrl(HASH, baseNetwork({ chainId: 11155111, explorerUrl: undefined }))).toBe(`https://sepolia.etherscan.io/tx/${HASH}`);
    });

    it("returns arbiscan for chainId 42161", () => {
      expect(txExplorerUrl(HASH, baseNetwork({ chainId: 42161, explorerUrl: undefined }))).toBe(`https://arbiscan.io/tx/${HASH}`);
    });

    it("returns sepolia arbiscan for chainId 421614", () => {
      expect(txExplorerUrl(HASH, baseNetwork({ chainId: 421614, explorerUrl: undefined }))).toBe(`https://sepolia.arbiscan.io/tx/${HASH}`);
    });

    it("returns polygonscan for chainId 137", () => {
      expect(txExplorerUrl(HASH, baseNetwork({ chainId: 137, explorerUrl: undefined }))).toBe(`https://polygonscan.com/tx/${HASH}`);
    });

    it("returns amoy polygonscan for chainId 80002", () => {
      expect(txExplorerUrl(HASH, baseNetwork({ chainId: 80002, explorerUrl: undefined }))).toBe(`https://amoy.polygonscan.com/tx/${HASH}`);
    });

    it("returns null for unknown chainId", () => {
      expect(txExplorerUrl(HASH, baseNetwork({ chainId: 999999, explorerUrl: undefined }))).toBeNull();
    });
  });
});
