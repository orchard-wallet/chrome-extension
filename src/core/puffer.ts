import { Chain, CONTRACT_ADDRESSES } from "@pufferfinance/puffer-sdk";
import type { Address } from "viem";

export const PUFFER_API_BASE = "https://api-v2.puffer.fi/imtoken-hackathon";

// PufferVault (the pufETH token itself) on Ethereum Mainnet, taken from the
// Puffer SDK's canonical address book.
const mainnetAddresses = CONTRACT_ADDRESSES[Chain.Mainnet as number] as { PufferVault: string };
export const PUFFER_VAULT_MAINNET = mainnetAddresses.PufferVault as Address;

// The widget only deposits on Ethereum Mainnet in v1.
export const PUFFER_DEPOSIT_NETWORK_ID = "ethereum-mainnet";

// Minimal ABI for the payable ETH deposit on the Puffer vault. The Puffer SDK
// hard-codes a string `account` into its own `transact()` call, which forces
// viem down the JSON-RPC `eth_sendTransaction` path — incompatible with this
// wallet's passkey/tcx signing. So the transaction is built from this ABI and
// signed through the wallet's own pipeline instead.
export const PUFFER_DEPOSIT_ABI = [
  {
    type: "function",
    name: "depositETH",
    stateMutability: "payable",
    inputs: [{ name: "recipient", type: "address" }],
    outputs: [{ name: "shares", type: "uint256" }]
  }
] as const;

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
