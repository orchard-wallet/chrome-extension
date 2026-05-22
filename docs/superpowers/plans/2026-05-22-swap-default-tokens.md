# Swap Default Token List Fix

**Goal:** The Swap page token dropdowns are empty until the user refreshes their
portfolio. Give Swap a curated, always-available token list (USDC, USDT, WBTC,
ETH on Ethereum Mainnet) with correct token icons.

**Root cause:** `swapAssetsForNetwork(store, network)` derives the token list
entirely from `portfolioStore.assetDefinitions`. A fresh wallet has no
`assetStore`, so both `<select>` dropdowns render zero options — nothing to
select. Verified in-browser: `row0: []`, `row1: []`, no `assetStore` in storage.

**Fix:** Source the Swap token list from a curated catalog (the existing
`EVM_TOKEN_DEFINITIONS` + native asset), independent of portfolio refresh
state. Merge in live balances and any imported tokens when a portfolio
snapshot does exist.

---

## Task 1: Curated EVM swap token catalog

**File:** `src/core/evmAssets.ts`

- [ ] Add WBTC to `EVM_TOKEN_DEFINITIONS["ethereum-mainnet"]`:
  `{ symbol: "WBTC", name: "Wrapped BTC", decimals: 8, contractAddress: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", priceKey: "ethereum:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", groupKey: "erc20:wbtc" }`
- [ ] Extract the inline native `AssetDefinition` from `fetchEvmNativeBalance`
  into `export function nativeAssetDefinition(network): AssetDefinition`, and
  call it from `fetchEvmNativeBalance` (DRY, no behavior change).
- [ ] Add `export function curatedEvmSwapAssets(network): AssetDefinition[]`
  returning `[nativeAssetDefinition(network), ...EVM_TOKEN_DEFINITIONS[network.networkId] mapped to AssetDefinition]`.
- [ ] Verify: `npx tsc --noEmit` passes.

## Task 2: Rebuild the Swap token list

**File:** `src/settings/SettingsApp.tsx` — `swapAssetsForNetwork`

- [ ] Rewrite `swapAssetsForNetwork(store, network)`:
  - Return `[]` for non-EVM networks (`!isEvmAssetNetwork(network)`) — 0x is EVM-only.
  - Base list = `curatedEvmSwapAssets(network)`.
  - Merge in portfolio `assetDefinitions` for the network not already present
    (imported tokens), keyed by `assetId`.
  - Fill each option's `balance`/`rawBalance` from `store.assetBalances` when present.
  - Keep the native-first then symbol sort.
- [ ] Import `curatedEvmSwapAssets` and `isEvmAssetNetwork`.
- [ ] Verify: `npx tsc --noEmit` passes.

## Task 3: WBTC token icon

**File:** `src/settings/SettingsApp.tsx` — `TokenGlyph`

- [ ] Add a `case "WBTC":` returning a wrapped-BTC SVG glyph (line-style,
  `currentColor`, consistent with the existing minimalist USDC/USDT glyphs).
- [ ] Verify: `npm run build` passes.

## Verification

- [ ] `npm run dev`, open `settings#swap` with NO portfolio refresh.
- [ ] Both token dropdowns list ETH, USDC, USDT, WBTC and are selectable.
- [ ] Each shows its correct icon. No console errors.
