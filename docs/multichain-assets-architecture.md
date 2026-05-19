# Multichain Asset Architecture

## Goals

The wallet should show a portfolio-level total across enabled chains, periodically refresh assets in the background, and allow the user to drill into a single chain to inspect native coins and tokens.

This design covers the enabled network families currently supported by settings:

- Ethereum / Arbitrum / Hyperliquid / Polygon as EVM-compatible chains
- Tron as a JSON-RPC compatible account chain with Tron-specific address and token standards
- Bitcoin as a UTXO chain

## Product Surfaces

### Portfolio Overview

The popup home should replace the single-chain ETH balance with:

- Total portfolio value in the user's display currency
- Last refresh time and refresh status
- Enabled chain cards with per-chain value
- Top assets across chains
- Explicit stale/error state per chain

### Chain Detail

Clicking a chain opens a chain detail view:

- Native asset balance
- Token balances
- Per-asset fiat value
- Last indexed block or timestamp
- RPC/indexer health
- Manual refresh action

### Asset Detail

Later, a specific asset can open:

- Contract / asset ID
- Balance by chain
- Price source
- Recent transfer activity

## Data Model

Use normalized storage. Do not store UI-ready cards as the source of truth.

```ts
type NetworkId = string;
type AccountId = string;
type AssetId = `${NetworkId}:${string}`;

interface AssetDefinition {
  assetId: AssetId;
  networkId: NetworkId;
  type: "native" | "erc20" | "trc20" | "bitcoin";
  symbol: string;
  name: string;
  decimals: number;
  contractAddress?: string;
  iconUrl?: string;
  verified?: boolean;
}

interface AssetBalance {
  assetId: AssetId;
  accountId: AccountId;
  networkId: NetworkId;
  rawBalance: string;
  decimalBalance: string;
  blockNumber?: string;
  fetchedAt: number;
  source: "rpc" | "indexer" | "cache";
}

interface AssetPrice {
  assetId: AssetId;
  currency: "USD";
  price: string;
  fetchedAt: number;
  source: "coingecko" | "defillama" | "manual" | "none";
}

interface ChainAssetSnapshot {
  networkId: NetworkId;
  accountId: AccountId;
  totalValueUsd: string;
  assetIds: AssetId[];
  status: "idle" | "refreshing" | "ready" | "stale" | "error";
  error?: string;
  refreshedAt?: number;
}

interface PortfolioSnapshot {
  accountId: AccountId;
  totalValueUsd: string;
  chainIds: NetworkId[];
  status: "ready" | "partial" | "error";
  refreshedAt: number;
}
```

Storage keys:

- `assetDefinitions`
- `assetBalances`
- `assetPrices`
- `chainAssetSnapshots`
- `portfolioSnapshot`
- `assetRefreshState`

Chrome storage is fine for the prototype. Move to IndexedDB when token lists, transfer history, or NFT data become large.

## Service Boundaries

```text
settings/network config
        |
        v
AssetRefreshScheduler  -- chrome.alarms
        |
        v
AssetRefreshService
        |
        +-- EvmAssetAdapter
        +-- TronAssetAdapter
        +-- BitcoinAssetAdapter
        +-- PriceAdapter
        |
        v
AssetRepository
        |
        v
PortfolioAggregator
        |
        v
Popup UI / Chain Detail UI
```

### AssetRepository

Single read/write boundary over storage.

Responsibilities:

- Read enabled networks
- Read wallet accounts
- Store asset definitions
- Store balances
- Store prices
- Store snapshots
- Expose subscription-friendly read APIs for popup

### AssetRefreshScheduler

Runs from the MV3 background service worker.

Use `chrome.alarms`:

- `portfolio-refresh-fast`: every 1 minute while popup is active or soon after transaction broadcast
- `portfolio-refresh-normal`: every 10 minutes
- `portfolio-refresh-slow`: every 60 minutes for chains that repeatedly fail

Rules:

- Never refresh all chains in parallel without limits.
- Use one active refresh per wallet account.
- Debounce manual refresh.
- Store `refreshInProgress` with timestamp to recover from terminated service workers.

### AssetRefreshService

Refreshes one enabled chain at a time:

1. Load network setting and selected RPC.
2. Resolve account address for that network family.
3. Fetch native balance.
4. Fetch token balances.
5. Fetch prices.
6. Write `AssetBalance` and `ChainAssetSnapshot`.
7. Recompute `PortfolioSnapshot`.

Partial failure is acceptable. A failed Tron refresh should not block Ethereum or Bitcoin portfolio values.

## Chain Adapters

All adapters implement:

```ts
interface ChainAssetAdapter {
  family: NetworkFamily;
  getNativeAsset(network: WalletNetworkSetting): AssetDefinition;
  getNativeBalance(input: {
    network: WalletNetworkSetting;
    address: string;
  }): Promise<AssetBalance>;
  getTokenBalances(input: {
    network: WalletNetworkSetting;
    address: string;
    knownAssets: AssetDefinition[];
  }): Promise<AssetBalance[]>;
}
```

### EVM Adapter

Applies to Ethereum, Arbitrum, Hyperliquid, Polygon, and custom EVM-like networks.

Native balance:

- `eth_getBalance`

Token balances:

- MVP: curated token list per network plus ERC-20 `balanceOf`
- Later: indexer provider such as Alchemy, Covalent, Zerion, or self-hosted indexer

Required contracts:

- ERC-20 `balanceOf(address)`
- ERC-20 `decimals()`
- ERC-20 `symbol()`

Avoid scanning arbitrary contracts from the extension. Use curated lists first.

### Tron Adapter

Native balance:

- Tron JSON-RPC or TronGrid-compatible endpoint

Token balances:

- MVP: curated TRC-20 token list plus contract call support
- Later: TronGrid account asset endpoint

Address note:

- Wallet derivation and display should use Tron address format, not EVM address format. This likely requires deriving a Tron account through `tcx-wasm` before Tron assets can be accurately shown.

### Bitcoin Adapter

Native balance:

- Use address or xpub indexer endpoint, depending on wallet derivation model.
- MVP can start with a single derived address and Blockstream/mempool-compatible APIs.

Token balances:

- None for MVP.

Address note:

- Bitcoin needs account discovery and gap limit handling. The portfolio layer should support multiple addresses per Bitcoin account later.

## Price Adapter

Use a price adapter separate from chain adapters.

MVP:

- Static mapping for native assets: ETH, BTC, TRX, POL, HYPE
- Fetch prices from one provider
- Cache for 5 minutes

Data policy:

- If price fails, keep balance and mark fiat value as unavailable.
- Do not hide assets because pricing failed.
- Portfolio total should be `partial` when any material asset lacks price.

## Portfolio Aggregation

Aggregation should be pure and deterministic:

```text
asset value = decimal balance * USD price
chain total = sum(asset values on same network)
portfolio total = sum(chain totals)
```

Handle these cases explicitly:

- Unknown price: exclude from total and mark partial
- Stale balance: include last known value but mark chain stale
- Failed chain: include last known value if present, mark portfolio partial
- Hidden disabled network: exclude from total

## UI State

### Home

Replace the current native-only balance panel with:

- `Total Assets`
- value
- refresh button
- status text: `Updated 2m ago`, `Refreshing`, `Partial data`
- chain list:
  - icon/family
  - chain name
  - fiat value
  - native balance
  - status marker

### Chain Detail

Route/state:

- `selectedChainId: NetworkId | null`

View:

- header with chain name and selected RPC
- native asset row
- token rows
- refresh button
- error/stale banner

## Update Triggers

Refresh portfolio when:

- Extension installed
- Wallet created
- Popup opened
- User clicks refresh
- Transaction broadcast succeeds
- Network settings change
- Alarm fires

Do not refresh when:

- No wallet exists
- No enabled networks exist
- Service worker is already refreshing recently

## Suggested Implementation Steps

1. Add asset types and storage repository.
2. Add EVM adapter for native balances across enabled EVM networks.
3. Add portfolio aggregator and replace popup ETH-only balance with total portfolio.
4. Add chain detail view for EVM native balances.
5. Add `chrome.alarms` scheduler and manual refresh.
6. Add EVM curated ERC-20 balances.
7. Add price adapter and USD aggregation.
8. Add Tron native balance after deriving/displaying Tron address.
9. Add Bitcoin native balance with address discovery plan.

## Non-Goals For First Implementation

- NFT support
- Full token discovery for every chain
- Historical PnL
- Bitcoin xpub gap-limit scan
- Cross-chain activity feed
- Automatic spam token filtering

## Risks

- MV3 service workers can terminate during long refreshes. Keep refresh tasks small and resumable.
- Public RPCs rate-limit quickly. Use selected RPC plus fallback and store per-chain error state.
- Token discovery is expensive without an indexer. Start with native balances and curated token lists.
- Tron and Bitcoin are not EVM address-compatible. Do not show EVM addresses as their account addresses.
