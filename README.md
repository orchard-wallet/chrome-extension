# Orchard Wallet

Chrome Extension wallet prototype using `@consenlabs/tcx-wasm` for local keystore creation and Ethereum account derivation.

## Current Scope

- MV3 Chrome Extension shell.
- React popup UI shaped as a compact wallet surface.
- WebAuthn PRF passkey creation flow.
- Passkey PRF key used as the `tcx-wasm` keystore unlock key.
- Ethereum Mainnet account derivation at `m/44'/60'/0'/0/0`.
- Local encrypted keystore persistence through `chrome.storage.local`.
- ENS v2-ready recipient resolver using viem ENS actions, Universal Resolver, and CCIP Read gateway URLs.
- Send ETH flow with RPC nonce/gas/EIP-1559 fee estimation and a Clear Signing preview before signing.
- Confirmed preview signing through `tcx-wasm sign_tx` after Passkey PRF unlock.
- Signed transaction broadcast through Ethereum Mainnet RPC.
- ETH balance display from Ethereum Mainnet RPC.
- Receive panel with QR code and copyable address.
- Built-in network settings for Ethereum, Arbitrum, Hyperliquid, Tron, Bitcoin, Polygon, related testnets, and manual custom RPCs.
- Settings Swap page with a curated default token list (ETH, USDC, USDT, WBTC) and 0x indicative prices and firm quotes.
- One-click ETH-to-pufETH convert widget (Puffer Finance liquid restaking) with a Clear Signing preview, using the Puffer SDK address book and the imToken-hackathon rate/APY API.
- Multi-language UI (English, Simplified Chinese, Traditional Chinese, Japanese) with a runtime language switch.

## Run

WalletConnect and 0x use build-time extension environment variables. Configure them before building:

```bash
VITE_WALLETCONNECT_PROJECT_ID=your_walletconnect_project_id
VITE_ZERO_EX_API_KEY=your_0x_api_key
```

This repository includes a local `.env` value for the current extension build. The 0x key enables indicative AllowanceHolder prices and firm swap quotes in the Settings Swap page.

```bash
npm install
npm run build
```

Load the extension from Chrome:

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Choose "Load unpacked".
4. Select this repository's `dist` directory.

For UI development:

```bash
npm run dev -- --port 5173
```

Then open:

```text
http://127.0.0.1:5173/src/popup/index.html
```

## Package

To produce an upload-ready archive for the Chrome Web Store:

```bash
npm run package
```

This builds the extension and zips the `dist/` contents (with `manifest.json`
at the archive root) into `orchard-wallet.zip`. Upload that zip in the
Chrome Web Store developer console; bump `version` in `public/manifest.json`
before each store update.

## Languages

The UI ships with four locales: English (`en`), Simplified Chinese (`zh-cn`),
Traditional Chinese (`zh-tw`), and Japanese (`ja-jp`). The language is chosen
in **Settings → Settings** and persists in `chrome.storage.local`. On first
run the wallet picks a language from the browser locale, defaulting to English.

Translations are bundled JSON catalogs under `src/i18n/locales/<locale>/`,
split into `common`, `popup`, and `settings` namespaces. To add or change a
string, edit `src/i18n/locales/en/<namespace>.json` first, mirror the key into
the other three locales, then run `node scripts/check-i18n-parity.mjs` to
confirm every locale has the same key set.

## Architecture

```text
src/popup/App.tsx       Popup workflow and UI state
src/core/webauthn.ts    WebAuthn PRF credential creation
src/core/tcx.ts         tcx-wasm init, keystore creation, account derivation
src/core/ens.ts         ENS forward/reverse recipient resolution adapter
src/core/networks.ts    Built-in network and RPC settings
src/core/clearSigning.ts Clear Signing transaction intent builder
src/core/rpc.ts         Ethereum Mainnet RPC balance, fee, gas, nonce estimation, and broadcast
src/settings/SettingsApp.tsx Network settings page
src/i18n/index.ts       i18next setup, language bootstrap and runtime switch
src/lib/storage.ts      chrome.storage.local with localStorage fallback
src/background.ts       MV3 service worker placeholder
```

Detailed multichain asset design: [`docs/multichain-assets-architecture.md`](docs/multichain-assets-architecture.md)

## Next Milestones

- End-to-end manual validation in a loaded Chrome extension with a real passkey.
- Bundle size optimization and code splitting.
