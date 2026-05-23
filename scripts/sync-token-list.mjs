#!/usr/bin/env node
// Sync curated token metadata from ethereum-lists/tokens (MIT) into
// src/core/generatedTokenList.ts.
//
// Usage: npm run sync:tokens
//
// The seed list below is a curated subset of well-known ERC-20 tokens for the
// chains this wallet supports. Each address must exist as a JSON file under
// `tokens/<chain>/<checksumAddress>.json` in the upstream repository
// (https://github.com/ethereum-lists/tokens). Addresses are case-sensitive
// (EIP-55 checksum) because the upstream filenames are.
//
// To add a new token: append its checksummed address to the relevant array,
// re-run this script, and commit the regenerated TypeScript file.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_PATH = resolve(__dirname, "..", "src", "core", "generatedTokenList.ts");
const UPSTREAM_RAW = "https://raw.githubusercontent.com/ethereum-lists/tokens/master/tokens";

// Map our internal networkId → ethereum-lists chain directory name. Only
// chains with meaningful upstream coverage are listed; for chains the
// upstream does not maintain (e.g. arb, matic — only a handful of files
// exist), we rely on the curated layer in src/core/tokenList.ts instead.
const NETWORK_TO_CHAIN_DIR = {
  "ethereum-mainnet": "eth"
};

// Curated seed of popular ERC-20 tokens. Addresses are EIP-55 checksummed
// to match upstream filenames exactly. The script fails fast on 404s — if
// upstream changes a filename's casing, we want to know immediately.
const SEED = {
  "ethereum-mainnet": [
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
    "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT
    "0x6B175474E89094C44Da98b954EedeAC495271d0F", // DAI
    "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", // WBTC
    "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
    "0x514910771AF9Ca656af840dff83E8264EcF986CA", // LINK
    "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", // UNI
    "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", // AAVE
    "0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2", // MKR
    "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE" // SHIB
  ]
};

// Co-located price keys for tokens we already track via Coingecko/0x.
// Sourced from the existing curated table in tokenList.ts.
const PRICE_KEYS = {
  "ethereum-mainnet": {
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    "0xdac17f958d2ee523a2206206994597c13d831ec7": "ethereum:0xdac17f958d2ee523a2206206994597c13d831ec7",
    "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": "ethereum:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599"
  }
};

async function fetchToken(chainDir, address) {
  const url = `${UPSTREAM_RAW}/${chainDir}/${address}.json`;
  const res = await fetch(url, { headers: { "User-Agent": "orchard-wallet-sync" } });

  if (res.status === 404) {
    throw new Error(`Not found: ${url}. Verify the EIP-55 checksum.`);
  }

  if (!res.ok) {
    throw new Error(`Fetch failed (${res.status}): ${url}`);
  }

  return res.json();
}

function pickGroupKey(symbol) {
  const lower = symbol.split(/\s/)[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  if (lower === "usdc" || lower === "usdt" || lower === "dai") {
    return `stablecoin:${lower}`;
  }
  return `erc20:${lower}`;
}

async function syncNetwork(networkId, addresses) {
  const chainDir = NETWORK_TO_CHAIN_DIR[networkId];

  if (!chainDir) {
    throw new Error(`No chain directory mapping for networkId: ${networkId}`);
  }

  const tokens = [];

  for (const address of addresses) {
    process.stdout.write(`  ${networkId} ${address} … `);
    try {
      const raw = await fetchToken(chainDir, address);
      const priceKey = PRICE_KEYS[networkId]?.[address.toLowerCase()];
      tokens.push({
        symbol: raw.symbol,
        name: raw.name,
        decimals: raw.decimals,
        contractAddress: raw.address,
        priceKey,
        groupKey: pickGroupKey(raw.symbol)
      });
      process.stdout.write(`${raw.symbol}\n`);
    } catch (err) {
      process.stdout.write(`FAIL — ${err.message}\n`);
      throw err;
    }
  }

  return tokens;
}

function formatTokenLiteral(token, indent) {
  const lines = [`${indent}{`];
  lines.push(`${indent}  symbol: ${JSON.stringify(token.symbol)},`);
  lines.push(`${indent}  name: ${JSON.stringify(token.name)},`);
  lines.push(`${indent}  decimals: ${token.decimals},`);
  lines.push(`${indent}  contractAddress: ${JSON.stringify(token.contractAddress)},`);
  if (token.priceKey) {
    lines.push(`${indent}  priceKey: ${JSON.stringify(token.priceKey)},`);
  }
  lines.push(`${indent}  groupKey: ${JSON.stringify(token.groupKey)}`);
  lines.push(`${indent}}`);
  return lines.join("\n");
}

function buildOutput(byNetwork) {
  const generatedAt = new Date().toISOString();
  const header = `// GENERATED FILE — DO NOT EDIT BY HAND.
// Regenerate with: npm run sync:tokens
//
// Source: https://github.com/ethereum-lists/tokens (MIT License)
// Each entry is fetched from tokens/<chain>/<checksumAddress>.json on master.
//
// Generated at: ${generatedAt}

import type { GeneratedErc20Token } from "./tokenList";

export const GENERATED_ERC20_TOKENS: Record<string, GeneratedErc20Token[]> = {`;

  const sections = Object.entries(byNetwork).map(([networkId, tokens]) => {
    const tokenLiterals = tokens.map((t) => formatTokenLiteral(t, "    ")).join(",\n");
    return `  ${JSON.stringify(networkId)}: [\n${tokenLiterals}\n  ]`;
  });

  return `${header}\n${sections.join(",\n")}\n};\n`;
}

async function main() {
  console.log(`Syncing token metadata from ${UPSTREAM_RAW}`);
  const byNetwork = {};

  for (const [networkId, addresses] of Object.entries(SEED)) {
    console.log(`\n[${networkId}] ${addresses.length} tokens`);
    byNetwork[networkId] = await syncNetwork(networkId, addresses);
  }

  const output = buildOutput(byNetwork);
  await writeFile(OUTPUT_PATH, output, "utf8");
  const total = Object.values(byNetwork).reduce((acc, arr) => acc + arr.length, 0);
  console.log(`\nWrote ${total} tokens → ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(`\nsync failed: ${err.message}`);
  process.exit(1);
});
