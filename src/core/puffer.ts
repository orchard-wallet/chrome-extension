import { Chain, PufferClient } from "@pufferfinance/puffer-sdk";
import type { PublicClient, WalletClient } from "viem";

export const PUFFER_API_BASE = "https://api-v2.puffer.fi/imtoken-hackathon";

// PufferVault on Ethereum Mainnet (the pufETH token itself).
export const PUFFER_VAULT_MAINNET = "0xD9A442856C234a39a81a089C06451EBAa4306a72";

// The widget only deposits on Ethereum Mainnet in v1.
export const PUFFER_DEPOSIT_NETWORK_ID = "ethereum-mainnet";

export function createPufferClient(
  walletClient: WalletClient | undefined,
  publicClient: PublicClient
): PufferClient {
  return new PufferClient(Chain.Mainnet, walletClient, publicClient);
}

export interface PufETHRate {
  pufEthPerEth: string;
  ethPerPufEth: string;
}

// Read-only analytics API. Never blocks the convert flow: callers treat null
// as "rate unavailable" and fall back to the vault's on-chain behaviour.
export async function fetchPufETHRate(): Promise<PufETHRate | null> {
  try {
    const response = await fetch(`${PUFFER_API_BASE}/pufeth/rate`);
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as Partial<PufETHRate>;
    if (!data.pufEthPerEth || !data.ethPerPufEth) {
      return null;
    }
    return { pufEthPerEth: data.pufEthPerEth, ethPerPufEth: data.ethPerPufEth };
  } catch {
    return null;
  }
}

export async function fetchPufferApy(): Promise<string | null> {
  try {
    const response = await fetch(`${PUFFER_API_BASE}/protocol/tvl`);
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { apy?: string };
    return data.apy ?? null;
  } catch {
    return null;
  }
}
