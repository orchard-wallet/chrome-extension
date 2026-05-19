# Orchard Wallet UI Implementation Plan

## Goal

Rebuild the current Chrome extension wallet UI around the Orchard Wallet design system: calm Apple-like surfaces, widget-first dashboard, progressive disclosure, and human-readable security flows.

This plan maps the provided `orchard_wallet_design_system` artifacts to the current codebase:

- `src/popup/App.tsx`: current single-screen wallet, portfolio, receive, WalletConnect, send, and clear-signing flows.
- `src/settings/SettingsApp.tsx`: current network settings and WalletConnect project ID settings.
- `src/background.ts`: current WalletConnect pairing/session handling and portfolio refresh alarm.
- `src/core/*`: wallet, assets, portfolio, ENS, RPC, signing, clear-signing, network data.
- `src/styles.css`: current global styles, to be replaced by Orchard tokens and component classes.

## Design Inputs

- `design.md`: product principles, IA, screen specs, writing system, accessibility, security rules.
- `tokens.css`: CSS variables and base Orchard utility classes.
- `tokens.json`: source design tokens.
- `component-tokens.json`: sizing and content requirements for core widgets.

## Phase 1: Design System Foundation

### Tasks

- [ ] Add Orchard tokens into the app stylesheet:
  - Import or copy `tokens.css` into `src/styles.css` or `src/styles/orchard-tokens.css`.
  - Map existing colors/radii/shadows to `--ow-*` tokens.
  - Remove the current warm brown palette where it conflicts with Orchard.
- [ ] Create reusable UI primitives:
  - `Surface`
  - `Widget`
  - `HeroWidget`
  - `IconButton`
  - `PrimaryButton`
  - `GradientButton`
  - `StatusBadge`
  - `TokenIcon`
  - `ChainIcon`
- [ ] Add layout primitives:
  - compact extension shell
  - expanded desktop/sidebar shell
  - widget grid
  - modal/sheet container
- [ ] Add accessibility baseline:
  - accessible labels for icon buttons
  - visible focus states
  - reduced-motion CSS
  - status text paired with status color

### Acceptance Criteria

- Existing wallet UI still builds.
- All new surfaces use Orchard token variables.
- No horizontal overflow at popup width.

## Phase 2: App Shell and Navigation

### Tasks

- [ ] Introduce a route/view state model for popup:
  - `home`
  - `assets`
  - `activity`
  - `send`
  - `receive`
  - `networks`
  - `connected-sessions`
  - `security`
  - `settings`
- [ ] Replace current long single-column popup with Orchard navigation:
  - compact icon navigation for popup
  - optional sidebar layout for expanded/options page
- [ ] Keep current Settings page available, but align it with the new navigation and visual system.
- [ ] Add shared header patterns:
  - wallet identity
  - back button
  - help button
  - active account selector placeholder

### Acceptance Criteria

- User can move between Home, Send, Receive, Networks, Connected Sessions, and Settings without losing wallet state.
- Existing send and WalletConnect flows remain reachable.

## Phase 3: Home Widget Dashboard

### Tasks

- [ ] Implement `BalanceHeroWidget` from `PortfolioSnapshot`:
  - total balance
  - change placeholder
  - mini sparkline placeholder
  - private balance mode hook
- [ ] Implement `ActionWidget` grid:
  - Send
  - Receive
  - Swap placeholder
  - Activity placeholder
- [ ] Implement top asset widgets from `AssetStore`:
  - token/native asset symbol
  - balance
  - fiat value when price is available
  - chain/network label
- [ ] Implement `NetworkStatusWidget`:
  - enabled network count
  - failed/stale RPC count
  - refresh action
- [ ] Implement `SessionWidget` summary:
  - active WalletConnect session count
  - most recent connected dapp
- [ ] Add widget state handling:
  - loading
  - empty
  - error
  - disabled

### Required Data Work

- [ ] Extend portfolio snapshot with:
  - `staleAt`
  - `failedNetworkIds`
  - `lastUpdatedAt`
- [ ] Add simple sparkline placeholder data until historical prices are available.
- [ ] Add privacy mode setting.

### Acceptance Criteria

- Home screen uses widget dashboard instead of the current balance panel plus stacked forms.
- Total balance and enabled networks use current `refreshPortfolio` data.

## Phase 4: Send Flow Redesign

### Tasks

- [ ] Replace inline send section with dedicated `Send` view.
- [ ] Implement `SendFormWidget`:
  - from account widget
  - token selector widget
  - recipient address / ENS input
  - address book placeholder
  - QR scan placeholder
  - network selector
  - amount input with `MAX`
  - estimated fee widget
  - review transfer CTA
- [ ] Implement `TokenPickerSheet`:
  - search tokens
  - current native assets from `AssetStore`
  - selected state
  - manage tokens placeholder
- [ ] Keep EVM-only transfer enforcement:
  - Ethereum, Arbitrum, HyperEVM, Polygon, custom EVM
  - Tron/Bitcoin hidden until chain-specific transfer adapters exist.
- [ ] Add recent recipients store:
  - address
  - ENS label if available
  - last used timestamp
  - chain/network

### Required Functional Work

- [ ] Generalize current native transfer model from ETH-only naming to `native token transfer`.
- [ ] Add token selection state:
  - native assets first
  - ERC-20 later
- [ ] Add chain-aware explorer links for more supported networks.
- [ ] Add validation for network mismatch between selected token and selected network.

### Acceptance Criteria

- User can choose a supported EVM network before reviewing a transfer.
- Review CTA opens the redesigned Clear Signing preview.
- Existing `tcx-wasm sign_tx` path still receives the selected chain ID.

## Phase 5: Clear Signing Preview Redesign

### Tasks

- [ ] Convert current `ClearSigningPreviewCard` into a dedicated preview screen/sheet.
- [ ] Implement Orchard hierarchy:
  - action header with expiration timer
  - send/receive or send-only gradient summary
  - human-readable detail rows
  - safety scope widget
  - advanced data collapsed row
  - reject / sign and continue actions
- [ ] Add preview variants:
  - native send
  - WalletConnect transaction approval
  - sign message
  - token approval
  - swap, later
- [ ] Keep raw calldata hidden under advanced data.
- [ ] Enforce parser failure behavior:
  - never fallback to direct signing
  - show risk state
  - disable primary CTA unless explicitly supported

### Required Functional Work

- [ ] Expand `src/core/clearSigning.ts` from native transfer preview to a typed parser layer:
  - `NativeTransferPreview`
  - `ContractCallPreview`
  - `MessageSignaturePreview`
  - `ApprovalPreview`
- [ ] Add approval scope detection for ERC-20 approvals:
  - exact approval
  - unlimited approval
- [ ] Add expiration timer for approval UI requests.

### Acceptance Criteria

- Send transfer approval uses the new Clear Signing preview layout.
- Unsupported WalletConnect signing requests show a readable risk state rather than raw JSON.

## Phase 6: WalletConnect Approval and Session Management

### Tasks

- [ ] Replace auto-approval in `src/background.ts` with an in-wallet approval flow:
  - receive `session_proposal`
  - persist pending proposal
  - open approval UI
  - approve/reject from UI
- [ ] Implement `Connect to dApp` approval screen:
  - dapp identity gradient card
  - permission request list
  - wallet and network access widget
  - security summary widget
  - cancel / approve connection
- [ ] Implement full `Connected Sessions` view:
  - active sessions summary
  - search
  - filter
  - sort
  - session rows
  - disconnect all
- [ ] Implement `SessionDetail` view:
  - metadata
  - connected account
  - allowed chains
  - permissions
  - expiry
  - disconnect

### Required Functional Work

- [ ] Add pending WalletConnect proposal storage.
- [ ] Add runtime messages:
  - `walletconnect_pending_proposals`
  - `walletconnect_approve_proposal`
  - `walletconnect_reject_proposal`
  - `walletconnect_disconnect_all`
- [ ] Track session activity:
  - last active timestamp on request
  - method history summary
  - domain from metadata URL
- [ ] Add security checks:
  - metadata domain mismatch
  - unverified dapp warning
  - risky method summary
  - unsupported chain warning
- [ ] Expand approved namespaces to match enabled EVM networks instead of only `eip155:1`.

### Acceptance Criteria

- WalletConnect no longer approves sessions without user confirmation.
- Connected sessions persist through extension reload and are visible in the management screen.
- User can disconnect one or all sessions.

## Phase 7: Network Management Redesign

### Tasks

- [ ] Move network management into Orchard `Networks` view.
- [ ] Implement `NetworkRowWidget`:
  - chain icon
  - chain name
  - native token
  - default badge
  - enabled / disabled state
  - toggle
  - chevron
- [ ] Implement expanded network detail:
  - selected RPC
  - RPC status
  - explorer URL
  - gas status
  - custom RPC controls
- [ ] Keep built-in network list:
  - Ethereum
  - Arbitrum
  - Hyperliquid
  - Tron
  - Bitcoin
  - Polygon
  - related testnets
- [ ] Preserve manual custom network flow.

### Required Functional Work

- [ ] Add network health checks:
  - latest block number
  - latency
  - failure reason
- [ ] Store per-network default/explorer metadata.
- [ ] Add default send network preference.

### Acceptance Criteria

- Existing settings capabilities remain available in the redesigned Networks screen.
- Network toggles update asset refresh and send network lists.

## Phase 8: Assets and Token Distribution

### Tasks

- [ ] Implement `Assets` view:
  - native assets grouped by token
  - chain-specific rows
  - fiat value where price exists
- [ ] Implement `TokenDistribution` view:
  - selected token hero
  - token selector tabs
  - distribution overview
  - top/lowest network summary
  - network distribution rows
- [ ] Add placeholder charts:
  - sparkline
  - distribution ring
  - progress bars

### Required Functional Work

- [ ] Extend asset model from native-only to token-aware:
  - ERC-20 definitions
  - token balances
  - token discovery/import
  - token grouping across chains by symbol/address mapping
- [ ] Add ERC-20 balance adapter for EVM.
- [ ] Add price mapping for ERC-20 tokens.
- [ ] Add Tron and Bitcoin balance adapters:
  - Tron native TRX
  - Bitcoin UTXO balance
- [ ] Add cache freshness and manual refresh controls per asset.

### Acceptance Criteria

- User can see total portfolio, individual chain assets, and token distribution.
- Native balances still work even when token/indexer adapters are unavailable.

## Phase 9: Activity and Security Center

### Tasks

- [ ] Implement `Activity` view:
  - sent transactions
  - broadcast hashes
  - WalletConnect session events
  - failed signing attempts
- [ ] Implement `Security` view:
  - passkey wallet state
  - dapp session risk summary
  - clear-signing parser coverage
  - network mismatch warnings
- [ ] Add user-readable event copy based on the writing system.

### Required Functional Work

- [ ] Add local activity event store.
- [ ] Record:
  - wallet created/reset
  - transfer preview accepted
  - transaction signed
  - transaction broadcasted
  - WalletConnect connected/disconnected
  - session request rejected
- [ ] Add severity levels:
  - info
  - success
  - warning
  - danger

### Acceptance Criteria

- User can review recent wallet actions and dapp connection events.
- Security screen reflects real wallet/session state, not static copy.

## Phase 10: Personalization

### Tasks

- [ ] Implement `WidgetCustomizationList`:
  - visibility toggles
  - drag handles
  - reset
  - widget descriptions
  - recommended/default badges
- [ ] Add persistent layout settings:
  - visible widgets
  - widget order
  - collapsed/expanded state
- [ ] Add privacy mode:
  - hide balances
  - preserve layout
  - quick toggle

### Acceptance Criteria

- Home widgets can be hidden and reordered.
- Privacy mode hides amounts across Home, Assets, Send, and Receive.

## Suggested Implementation Order

1. Design tokens and reusable widget primitives.
2. Route/view state and Orchard app shell.
3. Home dashboard using existing portfolio/session/network data.
4. Send view redesign while preserving current EVM native transfer behavior.
5. Clear Signing preview screen.
6. WalletConnect approval flow and full sessions screen.
7. Network management redesign.
8. Assets and token distribution.
9. Activity and Security screens.
10. Widget customization and privacy mode.

## Current Functional Gaps to Track

- WalletConnect proposal approval is still automatic in background and must become user-confirmed.
- WalletConnect session list exists, but lacks search/filter/sort/detail/last-active tracking.
- Clear Signing only covers native EVM transfer.
- Send only supports native EVM transfers.
- Asset refresh only supports EVM native balances.
- Tron and Bitcoin are configured networks but do not yet have balance or send adapters.
- ERC-20 token discovery/balance/approval parsing is not implemented.
- No activity/event store exists.
- No privacy mode exists.
- No widget customization or layout persistence exists.
