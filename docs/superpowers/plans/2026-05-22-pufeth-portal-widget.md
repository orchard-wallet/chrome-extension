# pufETH as a Portal Widget — Implementation Plan

**Goal:** Make pufETH minting a first-class **Portal widget** in the popup,
styled per the provided design, manageable from the options page's Portal
layout editor and shown in the Portal preview.

**Context:** A prior task moved `PufETHWidget` into a standalone
`wallet-pufeth-section` card on the options 設定 page. The new design replaces
that: pufETH is a Portal widget (in the popup portal). The standalone section
is removed.

## Target design (from the reference image)

**The pufETH portal widget** — a compact card in the popup portal's action-grid
area, spanning 2 grid columns (wider than a normal action tile):
- Top row: a small circular stacked-coin icon (`Database` from lucide-react),
  then "pufETH" (bold) and "Stake ETH" (small, muted) beside it.
- Bottom row: an amount input (`0.0` placeholder) on the left, a "Max" text
  link, and a dark "Mint" button on the right.
- Tapping "Mint" → the existing preview phase → passkey sign (flow unchanged).

**Portal layout editor** (options 設定 page) — a new row "pufETH Mint /
将 ETH 质押为 pufETH 以获取质押收益" with drag-handle, up/down, and eye
(show/hide) controls, exactly like the other widget rows.

**Portal preview** (options 設定 page) — the preview mockup renders a pufETH
tile resembling the widget (icon + pufETH + Stake ETH + a static input + Max +
Mint button look). The preview is a non-interactive mockup.

## Files

| File | Change |
|---|---|
| `src/popup/pufeth-widget.tsx` | MOVE here from `src/settings/`; restyle the input phase to the compact design above |
| `src/settings/SettingsApp.tsx` | Remove the `wallet-pufeth-section`; add `pufeth` to `getPortalWidget` (layout-editor row); add a `pufeth` tile to `PortalSettingsPreview` |
| `src/popup/App.tsx` | Render `<PufETHWidget>` in `HomeDashboard`'s portal action grid as a `pufeth` widget; re-add `mainnetNetwork`/`mainnetEthBalance`; add `pufeth` to `widgetDescriptions` |
| `src/lib/storage.ts` | Add `"pufeth"` back to `DEFAULT_WALLET_UI_SETTINGS.visibleWidgets` and `widgetOrder` |
| `src/styles.css` | Compact pufETH widget styling (2-col span in `.portal-action-grid`); preview-tile styling |
| `src/i18n/locales/**` | Adjust pufETH keys (see i18n below), 4 locales |

## i18n (4 locales)

Add/adjust under `popup:pufeth`:
- `widgetTitle` = "pufETH" (the compact widget's title)
- `stakeEth` = "Stake ETH" (zh-tw 質押 ETH / zh-cn 质押 ETH / ja ETH をステーク) — the compact subtitle
- `mint` = "Mint" (zh-tw 鑄造 / zh-cn 铸造 / ja ミント) — the button label
- `layoutTitle` = "pufETH Mint" (zh-tw pufETH 鑄造 / zh-cn pufETH 铸造 / ja) — the layout-editor row title
- keep existing `subtitle` ("Stake ETH into Puffer…") as the layout-editor row detail
- keep all preview/error/estimate/apy keys as-is

The widget's preview phase keeps using its current keys.

## Tasks

1. **Move + restyle the widget.** `git mv src/settings/pufeth-widget.tsx src/popup/pufeth-widget.tsx`; fix its relative imports (`../core/*`, `../lib/*` still correct from `src/popup/`; `./orchardPrimitives` if it imports primitives). Restyle the input phase JSX to the compact design (icon + title + Stake ETH on top; input + Max + Mint button below). Keep the preview/signing/success/error phases.
2. **storage.ts** — `"pufeth"` back into both `DEFAULT_WALLET_UI_SETTINGS` arrays.
3. **App.tsx** — re-add `mainnetNetwork` / `mainnetEthBalance` memos; render `<PufETHWidget wallet network ethBalance onConverted={recordActivity} />` in `HomeDashboard` as a `pufeth` entry in the `actionWidgets` array (it is filtered by `visibleWidgetSet` + sorted by `widgetOrder` like the others); add `pufeth` to the `widgetDescriptions` map.
4. **SettingsApp.tsx** — delete the `wallet-pufeth-section` block; add `pufeth` to `getPortalWidget`'s map (`{ title: t("...layoutTitle via settings key or popup key"), detail: ... }` — use `settings:widgets.*` keys consistent with the others, add them); add a `pufeth` branch to `PortalSettingsPreview` rendering the mockup tile.
5. **styles.css** — `.portal-action-grid` pufETH widget spans 2 columns; compact widget internal layout; preview tile.
6. **i18n** — apply the key changes across 4 locales; `node scripts/check-i18n-parity.mjs` passes.
7. **Verify** — `npm run build`, parity, and browser: popup portal shows the pufETH widget per design; options 設定 page shows the "pufETH Mint" row in the layout editor + the tile in the preview; toggling the eye hides/shows it.

## Out of scope

The mint logic, signing path, SDK/API usage — unchanged from the current widget.
