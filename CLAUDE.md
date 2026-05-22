# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                       # install deps
npm run build                     # tsc --noEmit (typecheck) then vite build → dist/
npm run dev -- --port 5173        # Vite dev server for popup/settings UI iteration
npm run preview                   # preview the production build
```

There is no test runner and no separate lint step. `npm run build` is the
only verification gate — it typechecks (`tsc --noEmit`) before bundling, so a
failing build means a type error somewhere.

To load the extension: `chrome://extensions` → Developer Mode → "Load
unpacked" → select `dist/`. Rebuild after every change you want to test in
Chrome.

UI-only development without rebuilding the extension: run the dev server and
open `http://127.0.0.1:5173/src/popup/index.html` (or `.../src/settings/index.html`).

## Build-time environment variables

`VITE_WALLETCONNECT_PROJECT_ID` and `VITE_ZERO_EX_API_KEY` are read at build
time from `.env` (see `src/vite-env.d.ts` for the typed contract). They are
baked into the bundle — changing them requires a rebuild. WalletConnect and
the Settings Swap (0x) features degrade gracefully when their key is absent
(`src/core/walletConnectConfig.ts` guards this pattern).

## Architecture

This is a **Manifest V3 Chrome Extension** wallet prototype. The defining
constraint is that it has **five separate execution contexts**, each a
distinct Vite rollup entry point (`vite.config.ts`) emitted to
`dist/assets/[name].js`:

| Context | Entry | Role |
|---|---|---|
| popup | `src/popup/index.html` → `App.tsx` | Main wallet UI |
| settings | `src/settings/index.html` → `SettingsApp.tsx` | Options page (networks, WalletConnect, swap) |
| background | `src/background.ts` | MV3 service worker |
| content | `src/content/providerBridge.ts` | Injected into every page |
| inpage | `src/inpage/ethereumProvider.ts` | Runs in the page's JS context |

`public/manifest.json` references the **built** filenames (`assets/background.js`,
`assets/content.js`, `assets/inpage.js`) — if you rename an entry in
`vite.config.ts`, update the manifest too.

### dApp connectivity flow

A web page's request travels through every context boundary:

```
page dApp → inpage provider (EIP-1193 + EIP-6963)
          → CustomEvent on window
          → content script (providerBridge.ts)
          → chrome.runtime.sendMessage
          → background service worker (handleDappRequest)
          → response flows back the same path
```

`background.ts` dispatches `dapp_request` messages by RPC method
(`eth_requestAccounts`, `eth_sendTransaction`, `wallet_switchEthereumChain`,
etc.) and also owns WalletConnect pairing/sessions. The inpage script cannot
use `chrome.*` APIs — it communicates only via window CustomEvents.

### Passkey → keystore → signing

The wallet has no seed phrase or password. `src/core/webauthn.ts` creates a
WebAuthn passkey with the **PRF extension**; the PRF output is the symmetric
key that unlocks the `@consenlabs/tcx-wasm` keystore (`src/core/tcx.ts`).
Every signing operation re-derives the PRF key from a fresh passkey assertion.
`tcx-wasm` is a WASM module: it is excluded from Vite `optimizeDeps`, and the
manifest CSP includes `wasm-unsafe-eval` for it.

### Storage

`src/lib/storage.ts` is the single persistence layer. Every read/write checks
`hasChromeStorage()` and falls back to `localStorage` when `chrome.storage`
is unavailable — this is what makes the Vite dev server (no extension APIs)
usable. All persisted shapes (`WalletRecord`, `WalletUiSettings`, asset store,
WalletConnect proposals) are defined and normalized here.

### Multichain assets

`src/core/assets.ts` defines a **normalized** asset store — separate maps for
`assetDefinitions`, `assetBalances`, `assetPrices`, `chainAssetSnapshots`, and
a `portfolioSnapshot`. UI-ready cards are never the source of truth.
`src/core/portfolio.ts` refreshes balances per chain family
(`evmAssets.ts`, `tronAssets.ts`, `bitcoinAssets.ts`) and is driven on a
15-minute `chrome.alarms` cycle from the background worker. See
`docs/multichain-assets-architecture.md` for the full data model.

### UI

`App.tsx` (popup) and `SettingsApp.tsx` (settings) are large single-file
React components. The Orchard design system primitives live in
`src/popup/orchardPrimitives.tsx` and tokens in `src/styles.css`; see
`docs/orchard-ui-implementation-plan.md` for the design mapping.
