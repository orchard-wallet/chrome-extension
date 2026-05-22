# Receive Request Portal Widget — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the receive payment-request into a first-class Portal widget — a tappable card showing the receive address + requested amount that copies the EIP-681 request URI — managed from the Portal layout editor.

**Architecture:** A new `ReceiveRequestWidget` component renders in the popup portal's action grid, registered in the widget system exactly like the existing `pufeth` widget. The settings page's existing `ReceiveRequestWidgetPreview` stays as the layout-editor preview.

**Tech Stack:** React 19, TypeScript, Vite, react-i18next, `qrcode.react`, viem.

**Spec:** `docs/superpowers/specs/2026-05-23-receive-request-widget-design.md`

**Note on testing:** no test runner in this project; verification is `npx tsc --noEmit` / `npm run build`, the i18n parity script, and a browser check.

**Scope note:** investigation found the receive settings panel, `eip681.ts`, the `receiveRequest*` settings, and the popup `ReceiveView` are already implemented in the WIP and already free of any token selector / safety note. The only remaining work is making the receive-request a registered Portal widget (+ its i18n). No popup `ReceiveView` change is needed.

---

## Task 0 (prerequisite): commit the existing Receive WIP

The main checkout has uncommitted Receive WIP that the worktree must branch from. Before creating the feature worktree, commit it to `main`:

- [ ] **Step 1: Commit the WIP**

```bash
cd /Users/randylien/Documents/my-passkey-wallet
git add src/core/eip681.ts src/core/rpc.ts src/lib/storage.ts \
  src/popup/App.tsx src/settings/SettingsApp.tsx src/styles.css \
  src/i18n/locales
git commit -m "feat: add receive request settings (WIP baseline)"
```

Do NOT stage `.env`, `.agents/`, `skills-lock.json`, `test_unlink_file` (pre-existing, unrelated).

- [ ] **Step 2:** Create the feature worktree from this commit, link `node_modules`, confirm `npm run build` passes as the baseline.

---

## Task 1: ReceiveRequestWidget component

**Files:**
- Create: `src/popup/receive-request-widget.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState } from "react";
import { Check, QrCode } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WalletRecord } from "../lib/storage";
import type { WalletNetworkSetting } from "../core/networks";
import { buildNativeReceiveRequestUri } from "../core/eip681";

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// Portal widget: a tappable receive-request card. Tapping copies the EIP-681
// request URI (ethereum:<address>@<chainId>?value=<wei>) to the clipboard.
export function ReceiveRequestWidget({
  wallet,
  network,
  amount,
  label
}: {
  wallet: WalletRecord | null;
  network: WalletNetworkSetting | null;
  amount: string;
  label: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  function requestUri(): string | null {
    if (!wallet) {
      return null;
    }
    try {
      return buildNativeReceiveRequestUri({ address: wallet.address, chainId: network?.chainId, amount }).uri;
    } catch {
      return buildNativeReceiveRequestUri({ address: wallet.address, chainId: network?.chainId }).uri;
    }
  }

  async function handleCopy() {
    const uri = requestUri();
    if (!uri) {
      return;
    }
    try {
      await navigator.clipboard.writeText(uri);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — leave state unchanged */
    }
  }

  const networkName = network?.name.replace(/\s+(Mainnet|network)$/i, "") ?? "Ethereum";
  const symbol = network?.nativeCurrencySymbol ?? "ETH";

  return (
    <button
      type="button"
      className="receive-request-widget"
      onClick={() => void handleCopy()}
      disabled={!wallet}
      aria-label={t("popup:receiveRequest.copyAria")}
    >
      <span className="receive-request-widget-icon" aria-hidden="true">
        {copied ? <Check size={18} /> : <QrCode size={18} />}
      </span>
      <div className="receive-request-widget-title">
        <strong>{label.trim() || t("popup:receiveRequest.title")}</strong>
        <small>{networkName}</small>
      </div>
      <p className="receive-request-widget-address">
        {wallet ? shortenAddress(wallet.address) : t("popup:header.noWallet")}
      </p>
      <em className="receive-request-widget-amount">
        {copied ? t("popup:receiveRequest.copied") : `${amount.trim() || "0.00"} ${symbol}`}
      </em>
    </button>
  );
}
```

- [ ] **Step 2: Verify** `npx tsc --noEmit` passes.
- [ ] **Step 3: Commit** `git commit -m "feat(receive): add receive-request portal widget component"`

---

## Task 2: Register the widget in the portal + layout editor

**Files:**
- Modify: `src/lib/storage.ts`, `src/popup/App.tsx`, `src/settings/SettingsApp.tsx`

Follow the existing `pufeth` widget registration as the template (it does exactly this in the same files).

- [ ] **Step 1: storage defaults** — in `src/lib/storage.ts`, add `"receive-request"` to `DEFAULT_WALLET_UI_SETTINGS.visibleWidgets` and `widgetOrder` (place it after `"receive"`).

- [ ] **Step 2: popup portal render** — in `src/popup/App.tsx`:
  - Import `ReceiveRequestWidget` from `./receive-request-widget`.
  - In `HomeDashboard`, add to the `actionWidgets` array (where the `pufeth` entry is):
    `{ id: "receive-request", node: <ReceiveRequestWidget wallet={wallet} network={selectedReceiveNetwork} amount={receiveRequestAmount} label={receiveRequestLabel} key="receive-request" /> }`.
    Thread `selectedReceiveNetwork` / `receiveRequestAmount` / `receiveRequestLabel` into `HomeDashboard` as props if not already in scope (they are App-level state).
  - Add a `receive-request` entry to the `widgetDescriptions` map: `{ title: t("popup:widgets.receiveRequest.title"), detail: t("popup:widgets.receiveRequest.detail") }`.

- [ ] **Step 3: settings layout editor** — in `src/settings/SettingsApp.tsx`, add `"receive-request"` to the `getPortalWidget` map: `{ title: t("settings:widgets.receiveRequestTitle"), detail: t("settings:widgets.receiveRequestDetail") }`. (This makes the "Receive request" row appear in the Portal layout editor with show/hide/reorder.)

- [ ] **Step 4: Verify** `npm run build` passes; the popup portal renders the widget and the layout editor lists it.
- [ ] **Step 5: Commit** `git commit -m "feat(receive): register receive-request portal widget"`

---

## Task 3: i18n strings

**Files:**
- Modify: `src/i18n/locales/{en,zh-cn,zh-tw,ja-jp}/{popup,settings}.json`

- [ ] **Step 1: en keys** — add to `en/popup.json`:
```json
"receiveRequest": { "title": "Receive request", "copied": "URI copied", "copyAria": "Copy the EIP-681 receive request URI" }
```
add to `en/popup.json` under `widgets`:
```json
"receiveRequest": { "title": "Receive request", "detail": "A shareable payment request card" }
```
add to `en/settings.json` under `widgets`:
```json
"receiveRequestTitle": "Receive request", "receiveRequestDetail": "A shareable payment request card on the Portal"
```

- [ ] **Step 2: translate** the same keys into `zh-cn`, `zh-tw`, `ja-jp` (preserve key names and any `{{placeholders}}`; match each catalog's existing terminology).
- [ ] **Step 3: Verify** `node scripts/check-i18n-parity.mjs` reports all locales match.
- [ ] **Step 4: Commit** `git commit -m "feat(i18n): add receive-request widget strings"`

---

## Task 4: Widget styling + end-to-end verification

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: CSS** — add `.receive-request-widget` rules: a single-cell portal widget styled like the other action widgets (mirror `.pufeth-widget` and `.receive-request-widget-preview` — clean, 1px border, small radius, no gradients). Internal layout: icon + title/network, address line, amount line. It must occupy a single grid cell in `.portal-action-grid` (no column span).
- [ ] **Step 2:** `npm run build` passes.
- [ ] **Step 3: browser check** — `npm run dev`; inject a test wallet; confirm the receive-request widget renders in the popup portal at single-cell size, tapping it shows the "copied" feedback; open the options settings page and confirm the "Receive request" row is in the Portal layout editor and toggling its eye hides/shows it.
- [ ] **Step 4: Commit** `git commit -m "style(receive): style the receive-request portal widget"`

---

## Self-Review

- **Spec coverage:** receive-request Portal widget (Tasks 1, 2, 4) · registered like `pufeth` incl. layout-editor row (Task 2) · tap copies EIP-681 URI (Task 1) · i18n 4 locales (Task 3) · WIP committed first (Task 0). EIP-681 amount→value and display-only label need no change (already in the WIP) — spec §3. popup `ReceiveView` needs no change — spec §2 correction.
- **Type consistency:** `ReceiveRequestWidget` props (`wallet`/`network`/`amount`/`label`) defined in Task 1 and supplied in Task 2. Widget id `"receive-request"` used consistently across storage / portal / layout editor / i18n.
- **Placeholders:** none — the widget component is given in full; registration follows the in-repo `pufeth` template; i18n keys are concrete.
