# Multi-language (i18n) Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-selectable multi-language support to the Passkey Wallet extension, extract all hardcoded UI strings into translation catalogs, and ship complete translations for English, Simplified Chinese, Traditional Chinese, and Japanese.

**Architecture:** Use `i18next` + `react-i18next`. Translation catalogs are bundled JSON (no network — extension constraint), split into three namespaces (`common`, `popup`, `settings`). The active language is persisted in the existing `WalletUiSettings` storage record and applied at bootstrap before React renders, so there is no untranslated flash. A language selector in the settings page switches language at runtime.

**Tech Stack:** React 19, TypeScript, Vite, `i18next`, `react-i18next`.

**Locale codes (as requested):** `en`, `zh-cn`, `zh-tw`, `ja-jp`. `fallbackLng` is `en`.

---

## File Structure

**Created:**
- `src/i18n/config.ts` — language list, types, browser-language resolver.
- `src/i18n/index.ts` — i18next init, bootstrap, runtime language switch.
- `src/i18n/locales/{en,zh-cn,zh-tw,ja-jp}/{common,popup,settings}.json` — 12 catalog files.

**Modified:**
- `src/lib/storage.ts` — add `language` field to `WalletUiSettings`.
- `src/popup/main.tsx`, `src/settings/main.tsx` — bootstrap i18n before render.
- `src/popup/App.tsx` — extract strings → `popup` + `common` namespaces.
- `src/settings/SettingsApp.tsx` — extract strings → `settings` + `common` namespaces; add language selector.
- `src/popup/orchardPrimitives.tsx` — no strings, skipped (verified: shells/icons only).
- `src/core/clearSigning.ts` — translate preview `title`/`message` strings via the standalone `i18n` instance.
- `README.md` — document language support.

**Namespace ownership rule:** `App.tsx` owns `popup.*` keys. `SettingsApp.tsx` owns `settings.*`. Generic words reused across both surfaces (Cancel, Close, Confirm, Back, Loading, Copy, Copied, network/asset error strings, Clear Signing labels) live in `common.*`. App.tsx and SettingsApp.tsx must NOT add keys to each other's namespace.

---

## Task 1: i18n config + init scaffolding

**Files:**
- Create: `src/i18n/config.ts`
- Create: `src/i18n/index.ts`
- Create: `src/i18n/locales/en/common.json` (seed), `popup.json` `{}`, `settings.json` `{}`
- Create: same three files under `zh-cn/`, `zh-tw/`, `ja-jp/` (copies of the `en` seed for now)

- [ ] **Step 1: Install dependencies**

```bash
npm install i18next@^25 react-i18next@^16
```

- [ ] **Step 2: Write `src/i18n/config.ts`**

```ts
export type AppLanguage = "en" | "zh-cn" | "zh-tw" | "ja-jp";

export const DEFAULT_LANGUAGE: AppLanguage = "en";

export const I18N_NAMESPACES = ["common", "popup", "settings"] as const;
export type I18nNamespace = (typeof I18N_NAMESPACES)[number];

export interface LanguageOption {
  code: AppLanguage;
  label: string;
  englishLabel: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "en", label: "English", englishLabel: "English" },
  { code: "zh-cn", label: "简体中文", englishLabel: "Simplified Chinese" },
  { code: "zh-tw", label: "繁體中文", englishLabel: "Traditional Chinese" },
  { code: "ja-jp", label: "日本語", englishLabel: "Japanese" }
];

export function isAppLanguage(value: unknown): value is AppLanguage {
  return SUPPORTED_LANGUAGES.some((entry) => entry.code === value);
}

export function resolveBrowserLanguage(): AppLanguage {
  const nav = typeof navigator !== "undefined" ? navigator.language.toLowerCase() : "";
  if (nav.startsWith("zh")) {
    return /tw|hk|mo|hant/.test(nav) ? "zh-tw" : "zh-cn";
  }
  if (nav.startsWith("ja")) return "ja-jp";
  return "en";
}
```

- [ ] **Step 3: Write `src/i18n/index.ts`**

```ts
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import {
  DEFAULT_LANGUAGE,
  I18N_NAMESPACES,
  isAppLanguage,
  resolveBrowserLanguage,
  type AppLanguage
} from "./config";
import { readWalletUiSettings, writeWalletUiSettings } from "../lib/storage";

import enCommon from "./locales/en/common.json";
import enPopup from "./locales/en/popup.json";
import enSettings from "./locales/en/settings.json";
import zhCnCommon from "./locales/zh-cn/common.json";
import zhCnPopup from "./locales/zh-cn/popup.json";
import zhCnSettings from "./locales/zh-cn/settings.json";
import zhTwCommon from "./locales/zh-tw/common.json";
import zhTwPopup from "./locales/zh-tw/popup.json";
import zhTwSettings from "./locales/zh-tw/settings.json";
import jaJpCommon from "./locales/ja-jp/common.json";
import jaJpPopup from "./locales/ja-jp/popup.json";
import jaJpSettings from "./locales/ja-jp/settings.json";

const resources = {
  en: { common: enCommon, popup: enPopup, settings: enSettings },
  "zh-cn": { common: zhCnCommon, popup: zhCnPopup, settings: zhCnSettings },
  "zh-tw": { common: zhTwCommon, popup: zhTwPopup, settings: zhTwSettings },
  "ja-jp": { common: jaJpCommon, popup: jaJpPopup, settings: jaJpSettings }
} as const;

let initialized = false;

export function initI18n(language: AppLanguage = DEFAULT_LANGUAGE): typeof i18next {
  if (!initialized) {
    void i18next.use(initReactI18next).init({
      resources,
      lng: language,
      fallbackLng: DEFAULT_LANGUAGE,
      ns: [...I18N_NAMESPACES],
      defaultNS: "common",
      interpolation: { escapeValue: false },
      returnNull: false
    });
    initialized = true;
  } else if (i18next.language !== language) {
    void i18next.changeLanguage(language);
  }
  return i18next;
}

export async function bootstrapI18n(): Promise<typeof i18next> {
  let language: AppLanguage = DEFAULT_LANGUAGE;
  try {
    const settings = await readWalletUiSettings();
    language = isAppLanguage(settings.language) ? settings.language : resolveBrowserLanguage();
  } catch {
    language = resolveBrowserLanguage();
  }
  return initI18n(language);
}

export async function changeAppLanguage(language: AppLanguage): Promise<void> {
  await i18next.changeLanguage(language);
  try {
    const settings = await readWalletUiSettings();
    await writeWalletUiSettings({ ...settings, language });
  } catch {
    /* settings persistence is best-effort */
  }
}

export default i18next;
```

- [ ] **Step 4: Create the 12 catalog files**

`src/i18n/locales/en/common.json` seeds the shared catalog:

```json
{
  "actions": {
    "cancel": "Cancel",
    "close": "Close",
    "confirm": "Confirm",
    "back": "Back",
    "save": "Save",
    "copy": "Copy",
    "copied": "Copied",
    "retry": "Retry",
    "refresh": "Refresh",
    "done": "Done"
  },
  "status": {
    "loading": "Loading…",
    "ready": "Ready",
    "error": "Error"
  }
}
```

`en/popup.json` and `en/settings.json` are `{}` for now (filled in Tasks 5/6).
Create `zh-cn/`, `zh-tw/`, `ja-jp/` versions of all three files as exact copies of the `en` files (real translations land in Tasks 8–10).

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: build succeeds. JSON modules resolve (`resolveJsonModule` already enabled).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/i18n
git commit -m "feat(i18n): add i18next scaffolding and locale catalogs"
```

---

## Task 2: Persist language in storage + bootstrap both entry points

**Files:**
- Modify: `src/lib/storage.ts:22` (interface), `:84` (default), `:153` (normalize)
- Modify: `src/popup/main.tsx`
- Modify: `src/settings/main.tsx`

- [ ] **Step 1: Add `language` to `WalletUiSettings`**

In the `WalletUiSettings` interface add: `language: string;`
In `DEFAULT_WALLET_UI_SETTINGS` add: `language: "en"`.
In `normalizeWalletUiSettings` return object add:
`language: typeof settings?.language === "string" ? settings.language : DEFAULT_WALLET_UI_SETTINGS.language`

(Typed as `string` to keep `storage.ts` decoupled from the i18n module; `i18n/index.ts` validates with `isAppLanguage`.)

- [ ] **Step 2: Bootstrap i18n in `src/popup/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { bootstrapI18n } from "../i18n";
import "../styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element was not found.");
}

void bootstrapI18n().then(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});
```

- [ ] **Step 3: Bootstrap i18n in `src/settings/main.tsx`** (same pattern, `SettingsApp` instead of `App`).

- [ ] **Step 4: Verify build**

Run: `npm run build` — Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage.ts src/popup/main.tsx src/settings/main.tsx
git commit -m "feat(i18n): persist language and bootstrap before render"
```

---

## Task 3: Language selector in settings

**Files:**
- Modify: `src/settings/SettingsApp.tsx`
- Modify: `src/i18n/locales/en/settings.json`

- [ ] **Step 1: Add a language section to SettingsApp**

Find the wallet/UI preferences section. Add a "Language" control that lists `SUPPORTED_LANGUAGES` (use `entry.label`). Current value from `useTranslation()` / `i18next.language`. On change call `changeAppLanguage(code)` from `../i18n`. Use `t("settings:language.title")` / `t("settings:language.description")` for surrounding copy.

- [ ] **Step 2: Add keys to `en/settings.json`**

```json
{
  "language": {
    "title": "Language",
    "description": "Choose the display language for the wallet."
  }
}
```

- [ ] **Step 3: Verify build + render**

Run: `npm run build`, then `npm run dev` and open the settings page; confirm the selector renders and switching language updates visible text live.

- [ ] **Step 4: Commit**

```bash
git add src/settings/SettingsApp.tsx src/i18n/locales
git commit -m "feat(i18n): add language selector to settings"
```

---

## Task 4: Extract `common` strings + audit primitives

**Files:**
- Modify: `src/i18n/locales/en/common.json`
- Verify: `src/popup/orchardPrimitives.tsx` (expected: no user-facing strings — confirmed during planning, shells/icon components only)

- [ ] **Step 1:** Expand `en/common.json` with shared vocabulary discovered during planning: generic actions, statuses, network/asset error fragments, and Clear Signing labels (`common.clearSigning.*`) used by Task 7. Keep keys grouped by domain.

- [ ] **Step 2:** Verify `orchardPrimitives.tsx` needs no changes. If any literal text is found, extract it to `common.*`.

- [ ] **Step 3: Commit** `git commit -m "feat(i18n): expand shared common catalog"`

---

## Task 5: Extract popup (`App.tsx`) strings — SUBAGENT

**Files:** Modify `src/popup/App.tsx`; fill `src/i18n/locales/en/popup.json`.

Dispatch a subagent with this brief:

> Replace every user-facing hardcoded English string in `src/popup/App.tsx` with `react-i18next` `t()` calls.
> - In each component that renders text, add `const { t } = useTranslation();` (import from `react-i18next`).
> - Put surface-specific keys in the `popup` namespace: `t("popup:<group>.<key>")`. Use nested groups mirroring the component (`onboarding`, `home`, `header`, `portfolio`, `send`, `receive`, `activity`, `assets`, `walletConnect`, `errors`, …).
> - For generic words already in `src/i18n/locales/en/common.json` (Cancel, Close, Confirm, Back, Save, Copy, Copied, Retry, Refresh, Done, Loading…) use `t("common:actions.*")` / `t("common:status.*")` — do NOT duplicate them into `popup`.
> - Use interpolation for dynamic values: `t("popup:send.feeEstimate", { amount })` with `{{amount}}` placeholders. Use `count` for plurals.
> - Do NOT translate: CSS class names, `aria-hidden` values, enum/id strings, network ids, console logs, hex values.
> - `aria-label` / `title` / `placeholder` attribute text IS user-facing — translate it.
> - Write all new English values into `src/i18n/locales/en/popup.json` (valid JSON, keys sorted within groups).
> - After editing, run `npm run build` and confirm it passes. Report the final `popup.json` key count.

- [ ] **Step 1:** Dispatch the subagent.
- [ ] **Step 2:** Review the `App.tsx` diff for JSX correctness and `popup.json` for key quality.
- [ ] **Step 3:** Run `npm run build` — Expected: success.
- [ ] **Step 4: Commit** `git commit -m "feat(i18n): extract popup strings"`

---

## Task 6: Extract settings (`SettingsApp.tsx`) strings — SUBAGENT

**Files:** Modify `src/settings/SettingsApp.tsx`; fill `src/i18n/locales/en/settings.json`.

Dispatch a subagent with the same brief as Task 5, except: file is `src/settings/SettingsApp.tsx`, namespace is `settings`, key groups mirror settings sections (`networks`, `walletConnect`, `swap`, `addressBook`, `preferences`, `language`, `errors`, …). The `language` section added in Task 3 already uses `t()` — leave it. Write English values to `src/i18n/locales/en/settings.json`.

- [ ] **Step 1:** Dispatch the subagent.
- [ ] **Step 2:** Review diff + `settings.json`.
- [ ] **Step 3:** Run `npm run build` — Expected: success.
- [ ] **Step 4: Commit** `git commit -m "feat(i18n): extract settings strings"`

---

## Task 7: Translate core Clear Signing strings

**Files:** Modify `src/core/clearSigning.ts`; ensure keys exist in `en/common.json`.

- [ ] **Step 1:** In `clearSigning.ts`, `import i18n from "../i18n";`. Replace the user-facing `title`/`message`/recipient-label literals (`"Token approval"`, `"Unlimited token approval"`, `"Unsupported contract call"`, `"Unsupported message signature"`, `"Unsupported WalletConnect request"`, `"Typed data request"`, `"Pending estimation"`, `"Ethereum address"`, `"Unknown recipient"`) with `i18n.t("common:clearSigning.<key>")`.
- [ ] **Step 2:** Add the matching keys to `src/i18n/locales/en/common.json` under `clearSigning`.
- [ ] **Step 3:** Run `npm run build` — Expected: success.
- [ ] **Step 4: Commit** `git commit -m "feat(i18n): translate clear-signing preview strings"`

---

## Task 8–10: Translate `en` catalogs → `zh-cn`, `zh-tw`, `ja-jp` — SUBAGENTS (parallel)

**Files:** For each locale `L`, overwrite `src/i18n/locales/L/{common,popup,settings}.json`.

For each of the three target locales dispatch a subagent with this brief:

> Translate the three English catalog files `src/i18n/locales/en/{common,popup,settings}.json` into `<language>` and write them to `src/i18n/locales/<L>/{common,popup,settings}.json`.
> - Preserve the JSON structure and every key EXACTLY. Translate only the values.
> - Preserve `{{interpolation}}` placeholders verbatim — never translate or reorder the token name.
> - Preserve i18next plural suffixes (`_one`, `_other`) on keys.
> - Use natural, concise wallet/finance terminology appropriate to the locale. Keep UI strings short.
> - Keep proper nouns (Ethereum, WalletConnect, Passkey, 0x, ENS, the network names) as-is unless a well-established localized form exists.
> - Output must be valid JSON.
- `zh-cn` → Simplified Chinese (mainland conventions: 网络, 钱包, 余额, 交易).
- `zh-tw` → Traditional Chinese (Taiwan conventions: 網路, 錢包, 餘額, 交易).
- `ja-jp` → Japanese (です/ます polite register for descriptions, noun phrases for buttons/labels).

- [ ] **Step 1:** Dispatch the three translation subagents in parallel.
- [ ] **Step 2:** For each locale, run the key-parity check (Task 11 script). Fix any missing/extra keys.
- [ ] **Step 3: Commit** `git commit -m "feat(i18n): add zh-cn, zh-tw, ja-jp translations"`

---

## Task 11: Verification — key parity + build + render

**Files:** Create `scripts/check-i18n-parity.mjs` (temporary verification helper; may be removed after).

- [ ] **Step 1:** Write a Node script that loads all 12 catalogs, flattens keys per namespace, and asserts every non-`en` locale has exactly the same key set as `en`. Print any diff and exit non-zero on mismatch.
- [ ] **Step 2:** Run it: `node scripts/check-i18n-parity.mjs` — Expected: "all locales match en".
- [ ] **Step 3:** Run `npm run build` — Expected: success.
- [ ] **Step 4:** Run `npm run dev`; in the browser open the popup and settings pages, switch through all four languages via the selector, and confirm: no raw `popup:`/`settings:` keys leak, layout holds, no console errors.
- [ ] **Step 5: Commit** `git commit -m "test(i18n): add locale key-parity check"`

---

## Task 12: Update README

- [ ] **Step 1:** Add a "Languages" subsection to `README.md` documenting the four supported locales and that language is chosen in Settings.
- [ ] **Step 2: Commit** `git commit -m "docs: document multi-language support"`

---

## Self-Review

- **Spec coverage:** worktree (done at setup) · string extraction (Tasks 4–7) · i18n package (Task 1) · en/zh-cn/zh-tw/ja-jp support (Tasks 1, 8–10) · translations (Tasks 8–10) · language switch UX (Tasks 2, 3) · verification (Task 11).
- **Type consistency:** `AppLanguage`, `bootstrapI18n`, `changeAppLanguage`, `initI18n`, `isAppLanguage`, `SUPPORTED_LANGUAGES` are defined in Task 1 and used consistently in Tasks 2, 3. `WalletUiSettings.language` is `string` (Task 2) validated by `isAppLanguage` (Task 1).
- **No placeholders:** infra tasks contain full code; extraction/translation tasks are mechanical and specified via precise subagent briefs.
