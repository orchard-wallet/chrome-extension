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

- [x] Add Orchard tokens into the app stylesheet:
  - Import or copy `tokens.css` into `src/styles.css` or `src/styles/orchard-tokens.css`.
  - Map existing colors/radii/shadows to `--ow-*` tokens.
  - Remove the current warm brown palette where it conflicts with Orchard.
- [x] Create reusable UI primitives:
  - `Surface`
  - `Widget`
  - `HeroWidget`
  - `IconButton`
  - `PrimaryButton`
  - `GradientButton`
  - `StatusBadge`
  - `TokenIcon`
  - `ChainIcon`
- [x] Add layout primitives:
  - compact extension shell
  - expanded desktop/sidebar shell
  - widget grid
  - modal/sheet container
- [x] Add accessibility baseline:
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

- [x] Introduce a route/view state model for popup:
  - `home`
  - `assets`
  - `activity`
  - `send`
  - `receive`
  - `networks`
  - `connected-sessions`
  - `security`
  - `settings`
- [x] Replace current long single-column popup with Orchard navigation:
  - compact icon navigation for popup
  - optional sidebar layout for expanded/options page
- [x] Keep current Settings page available, but align it with the new navigation and visual system.
- [x] Add shared header patterns:
  - wallet identity
  - back button
  - help button
  - active account selector placeholder

### Acceptance Criteria

- User can move between Home, Send, Receive, Networks, Connected Sessions, and Settings without losing wallet state.
- Existing send and WalletConnect flows remain reachable.

## Phase 3: Home Widget Dashboard

### Tasks

- [x] Implement `BalanceHeroWidget` from `PortfolioSnapshot`:
  - total balance
  - change placeholder
  - mini sparkline placeholder
  - private balance mode hook
- [x] Implement `ActionWidget` grid:
  - Send
  - Receive
  - Swap placeholder
  - Activity placeholder
- [x] Implement top asset widgets from `AssetStore`:
  - token/native asset symbol
  - balance
  - fiat value when price is available
  - chain/network label
- [x] Implement `NetworkStatusWidget`:
  - enabled network count
  - failed/stale RPC count
  - refresh action
- [x] Implement `SessionWidget` summary:
  - active WalletConnect session count
  - most recent connected dapp
- [x] Add widget state handling:
  - loading
  - empty
  - error
  - disabled

### Required Data Work

- [x] Extend portfolio snapshot with:
  - `staleAt`
  - `failedNetworkIds`
  - `lastUpdatedAt`
- [x] Add simple sparkline placeholder data until historical prices are available.
- [x] Add privacy mode setting.

### Acceptance Criteria

- Home screen uses widget dashboard instead of the current balance panel plus stacked forms.
- Total balance and enabled networks use current `refreshPortfolio` data.

## Phase 4: Send Flow Redesign

### Tasks

- [x] Replace inline send section with dedicated `Send` view.
- [x] Implement `SendFormWidget`:
  - from account widget
  - token selector widget
  - recipient address / ENS input
  - address book placeholder
  - QR scan placeholder
  - network selector
  - amount input with `MAX`
  - estimated fee widget
  - review transfer CTA
- [x] Implement `TokenPickerSheet`:
  - search tokens
  - current native assets from `AssetStore`
  - selected state
  - manage tokens placeholder
- [x] Keep EVM-only transfer enforcement:
  - Ethereum, Arbitrum, HyperEVM, Polygon, custom EVM
  - Tron/Bitcoin hidden until chain-specific transfer adapters exist.
- [x] Add recent recipients store:
  - address
  - ENS label if available
  - last used timestamp
  - chain/network

### Required Functional Work

- [x] Generalize current native transfer model from ETH-only naming to `native token transfer`.
- [x] Add token selection state:
  - native assets first
  - ERC-20 later
- [x] Add chain-aware explorer links for more supported networks.
- [x] Add validation for network mismatch between selected token and selected network.

### Acceptance Criteria

- User can choose a supported EVM network before reviewing a transfer.
- Review CTA opens the redesigned Clear Signing preview.
- Existing `tcx-wasm sign_tx` path still receives the selected chain ID.

## Phase 5: Clear Signing Preview Redesign

### Tasks

- [x] Convert current `ClearSigningPreviewCard` into a dedicated preview screen/sheet.
- [x] Implement Orchard hierarchy:
  - action header with expiration timer
  - send/receive or send-only gradient summary
  - human-readable detail rows
  - safety scope widget
  - advanced data collapsed row
  - reject / sign and continue actions
- [x] Add preview variants:
  - native send
  - WalletConnect transaction approval
  - sign message
  - token approval
  - swap, later
- [x] Keep raw calldata hidden under advanced data.
- [x] Enforce parser failure behavior:
  - never fallback to direct signing
  - show risk state
  - disable primary CTA unless explicitly supported

### Required Functional Work

- [x] Expand `src/core/clearSigning.ts` from native transfer preview to a typed parser layer:
  - `NativeTransferPreview`
  - `ContractCallPreview`
  - `MessageSignaturePreview`
  - `ApprovalPreview`
- [x] Add approval scope detection for ERC-20 approvals:
  - exact approval
  - unlimited approval
- [x] Add expiration timer for approval UI requests.

### Acceptance Criteria

- Send transfer approval uses the new Clear Signing preview layout.
- Unsupported WalletConnect signing requests show a readable risk state rather than raw JSON.

## Phase 6: WalletConnect Approval and Session Management

### Tasks

- [x] Replace auto-approval in `src/background.ts` with an in-wallet approval flow:
  - receive `session_proposal`
  - persist pending proposal
  - open approval UI
  - approve/reject from UI
- [x] Implement `Connect to dApp` approval screen:
  - dapp identity gradient card
  - permission request list
  - wallet and network access widget
  - security summary widget
  - cancel / approve connection
- [x] Implement full `Connected Sessions` view:
  - active sessions summary
  - search
  - filter
  - sort
  - session rows
  - disconnect all
- [x] Implement `SessionDetail` view:
  - metadata
  - connected account
  - allowed chains
  - permissions
  - expiry
  - disconnect

### Required Functional Work

- [x] Add pending WalletConnect proposal storage.
- [x] Add runtime messages:
  - `walletconnect_pending_proposals`
  - `walletconnect_approve_proposal`
  - `walletconnect_reject_proposal`
  - `walletconnect_disconnect_all`
- [x] Track session activity:
  - last active timestamp on request
  - method history summary
  - domain from metadata URL
- [x] Add security checks:
  - metadata domain mismatch
  - unverified dapp warning
  - risky method summary
  - unsupported chain warning
- [x] Expand approved namespaces to match enabled EVM networks instead of only `eip155:1`.

### Acceptance Criteria

- WalletConnect no longer approves sessions without user confirmation.
- Connected sessions persist through extension reload and are visible in the management screen.
- User can disconnect one or all sessions.

## Phase 7: Network Management Redesign

### Tasks

- [x] Move network management into Orchard `Networks` view.
- [x] Implement `NetworkRowWidget`:
  - chain icon
  - chain name
  - native token
  - default badge
  - enabled / disabled state
  - toggle
  - chevron
- [x] Implement expanded network detail:
  - selected RPC
  - RPC status
  - explorer URL
  - gas status
  - custom RPC controls
- [x] Keep built-in network list:
  - Ethereum
  - Arbitrum
  - Hyperliquid
  - Tron
  - Bitcoin
  - Polygon
  - related testnets
- [x] Preserve manual custom network flow.

### Required Functional Work

- [x] Add network health checks:
  - latest block number
  - latency
  - failure reason
- [x] Store per-network default/explorer metadata.
- [x] Add default send network preference.

### Acceptance Criteria

- Existing settings capabilities remain available in the redesigned Networks screen.
- Network toggles update asset refresh and send network lists.

## Phase 8: Assets and Token Distribution

### Tasks

- [x] Implement `Assets` view:
  - native assets grouped by token
  - chain-specific rows
  - fiat value where price exists
- [x] Implement `TokenDistribution` view:
  - selected token hero
  - token selector tabs
  - distribution overview
  - top/lowest network summary
  - network distribution rows
- [x] Add placeholder charts:
  - sparkline
  - distribution ring
  - progress bars

### Required Functional Work

- [x] Extend asset model from native-only to token-aware:
  - ERC-20 definitions
  - token balances
  - token discovery/import
  - token grouping across chains by symbol/address mapping
- [x] Add ERC-20 balance adapter for EVM.
- [x] Add price mapping for ERC-20 tokens.
- [x] Add Tron and Bitcoin balance adapters:
  - Tron native TRX
  - Bitcoin UTXO balance
- [x] Add cache freshness and manual refresh controls per asset.

### Acceptance Criteria

- User can see total portfolio, individual chain assets, and token distribution.
- Native balances still work even when token/indexer adapters are unavailable.

## Phase 9: Activity and Security Center

### Tasks

- [x] Implement `Activity` view:
  - sent transactions
  - broadcast hashes
  - WalletConnect session events
  - failed signing attempts
- [x] Implement `Security` view:
  - passkey wallet state
  - dapp session risk summary
  - clear-signing parser coverage
  - network mismatch warnings
- [x] Add user-readable event copy based on the writing system.

### Required Functional Work

- [x] Add local activity event store.
- [x] Record:
  - wallet created/reset
  - transfer preview accepted
  - transaction signed
  - transaction broadcasted
  - WalletConnect connected/disconnected
  - session request rejected
- [x] Add severity levels:
  - info
  - success
  - warning
  - danger

### Acceptance Criteria

- User can review recent wallet actions and dapp connection events.
- Security screen reflects real wallet/session state, not static copy.

## Phase 10: Personalization

### Tasks

- [x] Implement `WidgetCustomizationList`:
  - visibility toggles
  - drag handles
  - reset
  - widget descriptions
  - recommended/default badges
- [x] Add persistent layout settings:
  - visible widgets
  - widget order
  - collapsed/expanded state
- [x] Add privacy mode:
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

## Current Implementation Notes

- WalletConnect proposal approval requires in-wallet approval from the popup.
- WalletConnect session management includes search, filter, sort, detail, disconnect-one, disconnect-all, last-active tracking, domain extraction, and method history.
- Clear Signing has a typed parser layer for native sends, WalletConnect contract calls, message signatures, and ERC-20 approvals; unsupported requests remain risk states and cannot fall through to direct signing.
- Send supports native EVM transfers with token/network selection, recent recipients, fee estimates, MAX amount, and clear-signing review.
- Asset refresh supports EVM native balances, configured ERC-20 balances, imported ERC-20 token definitions, Tron TRX balances, Bitcoin UTXO balances, token grouping, price mapping, freshness metadata, and manual refresh controls.
- Activity, Security, privacy mode, and Home widget customization persist in local extension storage.
