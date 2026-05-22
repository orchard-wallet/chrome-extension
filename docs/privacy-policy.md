# Privacy Policy — Orchard Wallet

**Effective date:** 2026-05-23
**Extension:** Orchard Wallet (Chrome Web Store)
**Contact:** randylien@gmail.com

Orchard Wallet ("the extension", "we") is a self-custody crypto wallet
browser extension. This policy explains what data the extension handles,
what leaves your device, and what does not.

## Summary

- We **do not** collect, log, sell, or share any personal information.
- We **do not** use any analytics, tracking, advertising, or telemetry.
- All wallet data — including the encrypted keystore, settings, address
  book, and asset cache — is stored **only on your device** via
  `chrome.storage.local`.
- The extension makes outbound network requests **only** to the specific
  third-party services listed below, and only to perform the wallet
  functions you initiated.
- Your **private keys never leave your device**. Signing happens locally
  inside the extension using `@consenlabs/tcx-wasm`.

## Data stored on your device

The extension persists the following in `chrome.storage.local` (with a
fallback to `localStorage` only when `chrome.storage` is unavailable,
e.g. during development):

| Data | Purpose |
|---|---|
| Encrypted keystore (`walletRecord`) | The wallet itself — encrypted with a key derived from your WebAuthn passkey PRF output |
| Wallet settings (networks, default chain, UI preferences) | Restore your configuration across browser restarts |
| Address book / saved recipients | Convenience when sending |
| Asset cache (definitions, balances, USD prices, portfolio snapshots) | Show balances and portfolio value without re-fetching on every popup open |
| WalletConnect v2 session state and pending proposals | Resume active dApp sessions across browser restarts |

This data never leaves your device through anything controlled by us.
`chrome.storage.local` is intentionally chosen over `chrome.storage.sync`
to avoid syncing wallet state to Google's servers.

## Passkey and key material

- The extension creates a WebAuthn passkey using the PRF extension. The
  passkey itself is managed by your operating system or browser (e.g.
  iCloud Keychain, Windows Hello, a hardware security key). We do not
  control where it is stored.
- Each signing operation triggers a passkey assertion; the PRF output is
  used as the symmetric key that unlocks the local keystore. The PRF
  output never leaves the extension's memory and is not persisted.
- The private key is derived inside `tcx-wasm` only at signing time and
  is never written to disk, sent over the network, or exposed to web
  pages.

## Outbound network requests

The extension makes outbound requests **only** to the following
endpoints, and only to perform wallet functions:

| Endpoint | Purpose | What is sent |
|---|---|---|
| `coins.llama.fi` (DefiLlama) | Fetch USD prices for tokens in your portfolio | Chain identifiers and token contract addresses. No wallet address, no personal info. |
| `*.walletconnect.com`, `*.walletconnect.org` (WSS + HTTPS) | WalletConnect v2 relay — pairing with mobile dApps and exchanging signing requests | WalletConnect pairing topics, session metadata, and signing payloads you explicitly approve. WalletConnect operates the relay; see [walletconnect.com/privacy](https://walletconnect.com/privacy). |
| EVM RPC endpoints (user-configured per network, e.g. Infura, Alchemy, public RPC) | Read balances, estimate gas, broadcast transactions | Your EVM wallet address (for `eth_getBalance`, etc.) and the raw signed transactions you choose to broadcast. The specific endpoint depends on what you configure in Settings; we recommend using endpoints from providers whose own privacy policies you accept. |
| `blockstream.info`, `mempool.space` | Read Bitcoin balances | Your Bitcoin address (mainnet / testnet / signet, depending on the active network). |
| `api.trongrid.io`, `api.shasta.trongrid.io`, `nile.trongrid.io` | Read TRON balances | Your TRON address. |
| `api-v2.puffer.fi` | (Optional, only when the pufETH widget is used) Fetch pufETH conversion rate and protocol TVL | Public protocol info only — no user data. |
| `api.0x.org` | (Optional, only when the Settings → Swap feature is used) Fetch swap quotes from 0x | Token addresses, amounts, and your taker address — required by the 0x quote API to compute a swap. |

These endpoints are operated by third parties and have their own privacy
practices. We do not proxy any of this traffic through our own servers —
we operate no servers. Requests go directly from your browser to the
listed endpoints.

## Data we do **not** collect

- We do not collect personally identifiable information (name, email,
  phone number, IP address logs, etc.).
- We do not collect browsing history or page content. The extension's
  content script only injects an EIP-1193 / EIP-6963 Ethereum provider
  into pages so that dApps can request connections; it does not read
  DOM, cookies, form fields, or any page data.
- We do not use cookies for tracking.
- We do not use analytics SDKs, crash reporters, or telemetry.
- We do not advertise.

## How data is used

The extension is a tool you use to manage your own assets and connect to
dApps. Data flows are exactly what the chosen action requires: reading a
balance fetches a balance; broadcasting a transaction broadcasts that
transaction; nothing else.

## Permissions explained

The extension requests the following Chrome permissions:

- **`storage`** — persist your encrypted keystore, settings, address
  book, asset cache, and WalletConnect sessions locally on your device.
- **`alarms`** — schedule a 15-minute background refresh of balances and
  prices. Manifest V3 service workers are evicted aggressively, so
  `chrome.alarms` is the only reliable way to schedule periodic work.
- **Host permission `https://*/*`** and content script matches on
  `http://*/*` / `https://*/*` — inject an EIP-1193 / EIP-6963 provider
  into every web page so dApps can detect and call the wallet. This is
  the standard mechanism defined by the EIP-6963 open standard. The
  content script does not read page content; it only relays
  `CustomEvent` messages between the page-context provider and the
  background service worker.
- **Host permissions for `*.walletconnect.com` / `*.walletconnect.org`
  (HTTPS + WSS)** — required by the WalletConnect v2 SDK to open relay
  connections.
- **Host permission for `coins.llama.fi`** — fetch token prices from
  DefiLlama.

## Data sharing and selling

We do not sell, rent, or transfer any user data to third parties. We do
not transfer user data for purposes unrelated to the extension's single
purpose. We do not transfer user data to determine creditworthiness or
for lending purposes.

## Changes to this policy

If this policy materially changes, the new effective date will be set at
the top of this document and the change will be visible in the
extension's GitHub repository commit history.

## Contact

Questions or concerns: **randylien@gmail.com**
