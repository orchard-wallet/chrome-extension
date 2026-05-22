# Move pufETH Widget: Popup → Options Settings Page

**Goal:** Move the pufETH convert widget out of the popup and onto the extension
options page's "設定 / Wallet Settings" page (`WalletSettingsPanel`).

**Why:** declutter the popup; the convert flow belongs in the fuller options UI.

## Files

- **Create** `src/settings/pufeth-widget.tsx` — the `PufETHWidget` component,
  moved verbatim from `App.tsx` (logic unchanged), made self-contained: it
  includes its own small `PreviewRow` and `formatAddress` helpers (both already
  duplicated across the codebase) and all its imports. The `onDone?` prop stays
  optional and is simply not passed by the settings page.
- **Modify** `src/popup/App.tsx` — remove the `PufETHWidget` component, the
  `view === "pufeth"` block, the `pufeth` action-tile registry entry, `"pufeth"`
  from `PopupView`, and any imports left unused (`encodeFunctionData`,
  `signEthereumTransaction`, the `../core/puffer` imports, etc. — `tsc` flags them).
  Keep everything still used elsewhere (`PreviewRow` — 26 uses, `formatAddress`,
  `createPublicClient`/`http` if other code needs them).
- **Modify** `src/lib/storage.ts` — remove `"pufeth"` from
  `DEFAULT_WALLET_UI_SETTINGS.visibleWidgets` and `.widgetOrder` (it is no
  longer a popup portal widget).
- **Modify** `src/settings/SettingsApp.tsx` — render `<PufETHWidget>` as a
  section inside `WalletSettingsPanel` (the 設定 page), placed after the hero
  metrics and before the `錢包控制項 / wallet-controls-grid` section. Thread the
  Ethereum-Mainnet `WalletNetworkSetting` into `WalletSettingsPanel` as a new
  prop; derive the mainnet ETH balance from the `snapshots` it already receives
  (`snapshots.find(s => s.networkId === "ethereum-mainnet")?.nativeBalance`).
  For `onConverted`, pass a handler that appends an activity event (mirror
  SettingsApp's existing activity-append usage); if none exists cleanly, pass a
  no-op — the conversion still works, only the activity log entry is skipped.
- **Modify** `src/styles.css` if needed — the `.pufeth-view` rule (popup-only
  full-view wrapper) becomes unused; remove it. The `.pufeth-input` /
  `.pufeth-preview` / `.pufeth-*` widget rules stay (reused on the settings page).

## i18n

The widget keeps its existing `popup:pufeth.*` and `popup:clearSigning.*` keys
as-is. They resolve fine from the settings app (all namespaces are loaded). The
`popup:` namespace label is a minor naming wart but moving 23 keys × 4 locales
is churn with no functional gain — out of scope.

## Verification

- `npx tsc --noEmit` and `npm run build` pass.
- `node scripts/check-i18n-parity.mjs` passes.
- Browser: the popup no longer shows a "Convert to pufETH" tile/view; the
  options 設定 page shows the pufETH convert widget; entering an amount → Convert
  reaches the preview cleanly.

## Out of scope

No change to the convert logic, the signing path, or the SDK/API usage — this
is purely relocation.
