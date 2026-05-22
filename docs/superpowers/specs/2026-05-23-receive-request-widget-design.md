# Receive Request Settings + Portal Widget — Design

**Status:** Approved (brainstorming) — ready for implementation planning.

## Goal

Finish the wallet's "receive payment request" feature: a settings-page receive
screen with network/amount/label settings that build an EIP-681 request URI,
and a dedicated **receive-request Portal widget** managed from the Portal
layout editor.

## Background — existing WIP

The main checkout has substantial **uncommitted** work that already implements
much of this:

- `src/core/eip681.ts` (untracked) — `buildNativeReceiveRequestUri` builds
  `ethereum:<address>[@<chainId>]?value=<wei>` from an optional amount.
- `src/settings/SettingsApp.tsx` — a `ReceiveSettingsPanel` (hero metrics, QR
  card, a "receive settings" panel with network/amount/label inputs, a recent-
  receipts list) and a static `ReceiveRequestWidgetPreview` component.
- `src/lib/storage.ts` — `defaultReceiveNetworkId`, `receiveRequestAmount`,
  `receiveRequestLabel` on `WalletUiSettings`.
- `src/popup/App.tsx` — the popup `ReceiveView` wired to the receive settings,
  currently still with a token/symbol picker and a safety note.
- i18n catalogs and `src/styles.css` carry matching changes.

This feature **builds on that WIP** — it is refinement, not a rewrite.

## Step 0 — commit the WIP

A worktree cannot carry uncommitted changes. Before the feature worktree is
created, the existing Receive WIP is committed to `main` as a baseline (the
same way the 0x-swap WIP was committed at the start of the session). Excludes
`.env`, `.agents/`, `skills-lock.json`, `test_unlink_file` (pre-existing,
unrelated).

## Components

### 1. Receive-request Portal widget — NEW

A rich widget for the popup portal, registered as a first-class widget exactly
like the `pufeth` widget:

- **Renders:** a QR-style icon, the receive label (or a default title), the
  recipient ENS name / shortened address, the network, and the requested
  amount (`<amount> <symbol>`, `0.00` when unset).
- **Action:** tapping it copies the EIP-681 receive URI
  (`ethereum:<address>@<chainId>?value=<wei>`) to the clipboard for sharing;
  brief "copied" feedback.
- **Registration:** added to `DEFAULT_WALLET_UI_SETTINGS.visibleWidgets` /
  `widgetOrder`; to `getPortalWidget` in `SettingsApp.tsx` (so the Portal
  layout editor shows a "Receive request" row with show/hide/reorder); to
  `widgetDescriptions` in `App.tsx`; rendered in `HomeDashboard`'s portal grid.
- The existing `ReceiveRequestWidgetPreview` in `ReceiveSettingsPanel` is the
  settings-side preview of this widget; it and the real widget share the same
  visual structure.

### 2. popup ReceiveView cleanup

Remove the token/symbol picker (`tokenPickerOpen` state and its UI) and the
safety-note block from the popup `ReceiveView`. After this the receive flow is
native-currency only, consistent with the settings page.

### 3. EIP-681 (no change to the URI format)

`buildNativeReceiveRequestUri` already emits `ethereum:<address>@<chainId>?value=<wei>`
for the amount — kept. The **label is display-only** (shown on the QR card and
in the widget), it is **not** encoded into the URI — EIP-681 has no standard
label field and strict validity is preferred. Verify: the amount input
validates (invalid amount surfaces an inline error and the URI falls back to
the bare `ethereum:<address>` form), and the QR encodes the request URI.

### 4. Settings ReceiveSettingsPanel

Already matches the target layout (hero, QR card, receive settings panel with
network/amount/label, recent receipts, widget preview). Kept as the WIP has it;
adjusted only where the new widget registration requires (e.g. the layout
editor now lists the receive-request widget).

### 5. i18n

New strings for the receive-request widget — its title/detail, the layout-
editor row, and the "copied" feedback — added to the `en` catalogs and
translated into `zh-cn`, `zh-tw`, `ja-jp`. `node scripts/check-i18n-parity.mjs`
must pass.

## Out of scope

- Encoding the label into the URI (display-only, per decision).
- ERC-20 / token receive requests (native currency only — the token selector
  is being removed).
- Changes to the receive transaction/broadcast logic.
