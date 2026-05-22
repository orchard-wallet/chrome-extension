# pufETH Convert Widget Implementation Plan (v1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a popup portal widget that converts ETH into pufETH on Ethereum Mainnet in one guided flow (amount → Clear Signing preview → passkey sign → done).

**Architecture:** A new `PufETHWidget` in the popup runs a deposit through the `@pufferfinance/puffer-sdk`. The SDK's `PufferClient` is given a viem `WalletClient` built on a custom account whose `signTransaction` runs the wallet's existing passkey-PRF → `tcx-wasm` signing path. Conversion rate and APY come from the imToken-hackathon read API.

**Tech Stack:** React 19, TypeScript, Vite, viem, `@pufferfinance/puffer-sdk`, `@consenlabs/tcx-wasm`, react-i18next.

**Spec:** `docs/superpowers/specs/2026-05-22-pufeth-widget-design.md`

**Note on testing:** this project has no test runner (`package.json` scripts are `dev`/`build`/`preview`). Per-task verification is `npx tsc --noEmit` and, where stated, a browser check via the `/browse` skill. `npm run build` is the full gate.

**Resolved risk:** `tcx-wasm`'s `EthTxInputJson` struct includes a `data` field (confirmed from the WASM binary's struct field list: `…to value data txType maxFeePerGas…`, "struct EthTxInputJson with 11 elements"). Signing a contract call is supported; the current code simply never passes `data`.

---

## File Structure

```
src/core/tcx.ts            MOD  add signEthereumTransaction (carries `data`); signEthereumTransfer delegates to it
src/core/puffer.ts          NEW  PufferClient factory + read API client + constants
src/core/tcxViemAccount.ts   NEW  viem custom account backed by passkey/tcx signing
src/core/clearSigning.ts     MOD  buildPufferDepositPreview + PufferDepositPreview type
src/i18n/locales/**          MOD  popup:pufeth.* and common:clearSigning.puffer.* keys, 4 locales
src/popup/App.tsx            MOD  PufETHWidget component, widget registry entry, convert flow
src/lib/storage.ts           MOD  add "pufeth" to DEFAULT_WALLET_UI_SETTINGS widget lists
package.json                 MOD  add @pufferfinance/puffer-sdk
```

---

## Task 1: Extend tcx.ts to sign contract calls

**Files:**
- Modify: `src/core/tcx.ts`

- [ ] **Step 1: Add `signEthereumTransaction`**

Add this export to `src/core/tcx.ts` (after `signEthereumTransfer`). It signs any
EIP-1559 transaction, including a contract call with `data`:

```ts
import type { Address, Hex } from "viem";

export interface EthereumTxRequest {
  nonce: number | bigint;
  gasLimit: bigint;
  to: Address;
  value: bigint;
  data?: Hex;
  chainId: number;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export async function signEthereumTransaction(input: {
  keystoreJson: string;
  key: string;
  derivationPath: string;
  tx: EthereumTxRequest;
}): Promise<EthereumSignResult> {
  await initTcx();

  const result = JSON.parse(
    sign_tx(
      JSON.stringify({
        keystoreJson: input.keystoreJson,
        key: input.key,
        derivationPath: input.derivationPath,
        input: {
          nonce: input.tx.nonce.toString(),
          gasLimit: input.tx.gasLimit.toString(),
          to: input.tx.to,
          value: input.tx.value.toString(),
          data: input.tx.data ?? "0x",
          chainId: input.tx.chainId.toString(),
          txType: "02",
          maxFeePerGas: input.tx.maxFeePerGas.toString(),
          maxPriorityFeePerGas: input.tx.maxPriorityFeePerGas.toString(),
          accessList: []
        }
      })
    )
  ) as EthereumSignResult;

  if (!result.signature || !result.txHash) {
    throw new Error("tcx-wasm did not return an Ethereum signature and transaction hash.");
  }

  return {
    ...result,
    serializedTransaction: normalizeSerializedTransaction(result.signature)
  };
}
```

The existing `import type { Hex } from "viem";` line must also import `Address`:
change it to `import type { Address, Hex } from "viem";`.

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: passes, zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/tcx.ts
git commit -m "feat(tcx): add signEthereumTransaction with calldata support"
```

---

## Task 2: Puffer core module

**Files:**
- Modify: `package.json` (dependency)
- Create: `src/core/puffer.ts`

- [ ] **Step 1: Install the SDK**

```bash
npm install @pufferfinance/puffer-sdk
```

- [ ] **Step 2: Create `src/core/puffer.ts`**

```ts
import { Chain, PufferClient } from "@pufferfinance/puffer-sdk";
import type { PublicClient, WalletClient } from "viem";

export const PUFFER_API_BASE = "https://api-v2.puffer.fi/imtoken-hackathon";

// PufferVault on Ethereum Mainnet (the pufETH token itself).
export const PUFFER_VAULT_MAINNET = "0xD9A442856C234a39a81a089C06451EBAa4306a72";

// The widget only deposits on Ethereum Mainnet in v1.
export const PUFFER_DEPOSIT_NETWORK_ID = "ethereum-mainnet";

export function createPufferClient(
  walletClient: WalletClient | undefined,
  publicClient: PublicClient
): PufferClient {
  return new PufferClient(Chain.Mainnet, walletClient, publicClient);
}

export interface PufETHRate {
  pufEthPerEth: string;
  ethPerPufEth: string;
}

// Read-only analytics API. Never blocks the convert flow: callers treat null
// as "rate unavailable" and fall back to the vault's on-chain behaviour.
export async function fetchPufETHRate(): Promise<PufETHRate | null> {
  try {
    const response = await fetch(`${PUFFER_API_BASE}/pufeth/rate`);
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as Partial<PufETHRate>;
    if (!data.pufEthPerEth || !data.ethPerPufEth) {
      return null;
    }
    return { pufEthPerEth: data.pufEthPerEth, ethPerPufEth: data.ethPerPufEth };
  } catch {
    return null;
  }
}

export async function fetchPufferApy(): Promise<string | null> {
  try {
    const response = await fetch(`${PUFFER_API_BASE}/protocol/tvl`);
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { apy?: string };
    return data.apy ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: passes. If the SDK's exports differ (`Chain` / `PufferClient` not found
at the package root), check `node_modules/@pufferfinance/puffer-sdk/` for the
entry point and adjust the import path; report the correction.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/core/puffer.ts
git commit -m "feat(puffer): add SDK client factory and read API client"
```

---

## Task 3: tcx-backed viem account

**Files:**
- Create: `src/core/tcxViemAccount.ts`

**Context:** `unlockPasskeyPrf(credentialId: string): Promise<string>` (from
`src/core/webauthn.ts`) runs a WebAuthn ceremony and returns the PRF key hex.
`WalletRecord` (from `src/lib/storage.ts`) has `address`, `credentialId`,
`keystoreJson`, `derivationPath`.

- [ ] **Step 1: Create `src/core/tcxViemAccount.ts`**

```ts
import { toAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { signEthereumTransaction } from "./tcx";
import { unlockPasskeyPrf } from "./webauthn";
import type { WalletRecord } from "../lib/storage";

// A viem custom account whose signTransaction runs the wallet's passkey/tcx
// signing path. Passed into a viem WalletClient so the Puffer SDK can send
// transactions through this wallet. Each signTransaction call triggers a
// WebAuthn passkey ceremony.
export function createTcxViemAccount(walletRecord: WalletRecord) {
  return toAccount({
    address: walletRecord.address as Address,
    async signTransaction(transaction) {
      if (!transaction.to) {
        throw new Error("Transaction is missing a recipient.");
      }
      if (transaction.maxFeePerGas == null || transaction.maxPriorityFeePerGas == null) {
        throw new Error("Transaction is missing EIP-1559 fee fields.");
      }
      if (transaction.gas == null || transaction.nonce == null) {
        throw new Error("Transaction is missing gas or nonce.");
      }

      const prfKey = await unlockPasskeyPrf(walletRecord.credentialId);
      const result = await signEthereumTransaction({
        keystoreJson: walletRecord.keystoreJson,
        key: prfKey,
        derivationPath: walletRecord.derivationPath,
        tx: {
          nonce: transaction.nonce,
          gasLimit: transaction.gas,
          to: transaction.to,
          value: transaction.value ?? 0n,
          data: (transaction.data ?? "0x") as Hex,
          chainId: transaction.chainId ?? 1,
          maxFeePerGas: transaction.maxFeePerGas,
          maxPriorityFeePerGas: transaction.maxPriorityFeePerGas
        }
      });

      return result.serializedTransaction;
    },
    async signMessage() {
      throw new Error("Message signing is not supported by the passkey wallet.");
    },
    async signTypedData() {
      throw new Error("Typed-data signing is not supported by the passkey wallet.");
    }
  });
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: passes. If `toAccount`'s `signTransaction` parameter type does not
expose these fields, narrow with the viem `TransactionSerializable` type and
report the adjustment.

- [ ] **Step 3: Commit**

```bash
git add src/core/tcxViemAccount.ts
git commit -m "feat(puffer): add tcx-backed viem account adapter"
```

---

## Task 4: i18n strings

**Files:**
- Modify: `src/i18n/locales/{en,zh-cn,zh-tw,ja-jp}/popup.json`
- Modify: `src/i18n/locales/{en,zh-cn,zh-tw,ja-jp}/common.json`

- [ ] **Step 1: Add the English keys**

Into `src/i18n/locales/en/popup.json`, add a `pufeth` group:

```json
"pufeth": {
  "title": "Convert to pufETH",
  "subtitle": "Stake ETH into Puffer and earn restaking yield.",
  "amountLabel": "Amount to convert",
  "amountPlaceholder": "0.0",
  "max": "Max",
  "estimate": "≈ {{amount}} pufETH",
  "apy": "{{apy}}% APY",
  "apyUnavailable": "APY unavailable",
  "convert": "Convert",
  "wrongNetwork": "Switch to Ethereum Mainnet to convert.",
  "insufficient": "Not enough ETH for this amount plus gas.",
  "previewTitle": "Convert ETH to pufETH",
  "pay": "You pay",
  "receive": "You receive",
  "networkFee": "Network fee",
  "confirm": "Confirm with passkey",
  "signing": "Signing…",
  "successTitle": "Converted to pufETH",
  "successDetail": "Your pufETH balance updates after the transaction confirms.",
  "viewTx": "View transaction",
  "errors": {
    "rate": "Could not load the pufETH rate.",
    "convert": "Could not complete the pufETH conversion."
  }
}
```

Into `src/i18n/locales/en/common.json`, add under the existing `clearSigning`
object a `puffer` group:

```json
"puffer": {
  "title": "Convert ETH to pufETH",
  "reviewNote": "Review the amount, network, and fee before signing with your passkey.",
  "estimateUnavailable": "The pufETH estimate is unavailable; you will still receive pufETH at the vault rate."
}
```

- [ ] **Step 2: Translate into the other three locales**

Add the same keys to `popup.json` and `common.json` under `zh-cn/`, `zh-tw/`,
`ja-jp/`, translated. Preserve every key name and every `{{placeholder}}` token
verbatim. Use the glossary already established in those catalogs (e.g. zh-tw:
網路/錢包/餘額; ja-jp: ネットワーク/ウォレット/残高). Keep `pufETH`, `ETH`,
`APY`, `Puffer`, `passkey`→(zh)通行金鑰/(ja)パスキー consistent with existing entries.

- [ ] **Step 3: Verify parity**

Run: `node scripts/check-i18n-parity.mjs`
Expected: `✓ all locales match en`.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales
git commit -m "feat(i18n): add pufETH widget strings"
```

---

## Task 5: Puffer deposit Clear Signing preview

**Files:**
- Modify: `src/core/clearSigning.ts`

**Context:** `clearSigning.ts` already imports `i18n` and uses
`i18n.t("common:clearSigning.…")`. It exports `PreviewSeverity` and
`PreviewWarning`.

- [ ] **Step 1: Add the preview type and builder**

Append to `src/core/clearSigning.ts`:

```ts
export interface PufferDepositPreview {
  action: "puffer-deposit";
  title: string;
  vaultAddress: Address;
  from: Address;
  ethAmount: string;
  ethAmountWei: bigint;
  estimatedPufEth: string | null;
  networkName: string;
  warnings: PreviewWarning[];
}

export function buildPufferDepositPreview(input: {
  from: Address;
  vaultAddress: Address;
  ethAmount: string;
  ethAmountWei: bigint;
  estimatedPufEth: string | null;
  networkName: string;
}): PufferDepositPreview {
  const warnings: PreviewWarning[] = [
    { severity: "info", message: i18n.t("common:clearSigning.puffer.reviewNote") }
  ];

  if (input.estimatedPufEth === null) {
    warnings.push({
      severity: "warning",
      message: i18n.t("common:clearSigning.puffer.estimateUnavailable")
    });
  }

  return {
    action: "puffer-deposit",
    title: i18n.t("common:clearSigning.puffer.title"),
    vaultAddress: input.vaultAddress,
    from: input.from,
    ethAmount: input.ethAmount,
    ethAmountWei: input.ethAmountWei,
    estimatedPufEth: input.estimatedPufEth,
    networkName: input.networkName,
    warnings
  };
}
```

`Address` is already imported from `viem` at the top of the file; if not, add it.

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/core/clearSigning.ts
git commit -m "feat(clear-signing): add pufETH deposit preview builder"
```

---

## Task 6: Register the pufETH widget

**Files:**
- Modify: `src/lib/storage.ts`
- Modify: `src/popup/App.tsx`

**Context:** `DEFAULT_WALLET_UI_SETTINGS` (`src/lib/storage.ts:84`) holds
`visibleWidgets` and `widgetOrder` string arrays. `HomeDashboard` in `App.tsx`
builds a widget list around `src/popup/App.tsx:1438-1443` as
`{ id, node }` objects, then renders them by `widgetOrder`.

- [ ] **Step 1: Add `"pufeth"` to the default widget lists**

In `src/lib/storage.ts`, in `DEFAULT_WALLET_UI_SETTINGS`:

```ts
  visibleWidgets: ["balance", "assets", "pufeth", "send", "receive", "activity", "portfolio"],
  widgetOrder: ["balance", "assets", "pufeth", "send", "receive", "swap", "activity", "portfolio"],
```

`normalizePortalWidgetIds` derives the supported set from
`DEFAULT_WALLET_UI_SETTINGS.widgetOrder`, so adding it here makes `"pufeth"` a
valid, persisted widget id.

- [ ] **Step 2: Add the widget node to the registry**

In `HomeDashboard` (`src/popup/App.tsx`), in the `{ id, node }` array near line
1438, add an entry. For Task 6 it renders the `PufETHWidget` created in Task 7;
to keep this task self-contained, add the entry referencing the component and
create a minimal placeholder so the build passes:

```tsx
{ id: "pufeth", node: <PufETHWidget wallet={wallet} network={selectedSendNetwork} ethBalance={ethBalance} onConverted={onRecordActivity} key="pufeth" /> },
```

Wire whichever props `HomeDashboard` already has in scope for the wallet record,
the current network, and the ETH balance; if a needed value is not in
`HomeDashboard`'s scope, thread it down from `App` as a prop (follow how
`wallet` / balance are already passed to sibling widgets).

- [ ] **Step 3: Add `widgetDescriptions` entry**

Find the `widgetDescriptions` map (around `src/popup/App.tsx:2867`) used by the
portal layout editor and add a `pufeth` entry mirroring the existing ones, using
`t("popup:pufeth.title")` for its label.

- [ ] **Step 4:** Build will fail until Task 7 defines `PufETHWidget` — that is
expected. Do NOT commit Task 6 alone; it is committed together with Task 7.

---

## Task 7: PufETHWidget component and convert flow

**Files:**
- Modify: `src/popup/App.tsx`

**Context:** `App.tsx` already imports `useEffect/useMemo/useState`,
`createPasskeyPrf/unlockPasskeyPrf`, `WalletRecord`, `appendActivityEvent`,
`ActivityEventInput`, and Orchard primitives (`Widget`, `PrimaryButton`,
`IconButton`). A transaction-broadcast activity event is recorded around
`src/popup/App.tsx:745` — match that `ActivityEventInput` shape.

- [ ] **Step 1: Add imports to `App.tsx`**

```tsx
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { mainnet } from "viem/chains";
import { buildPufferDepositPreview, type PufferDepositPreview } from "../core/clearSigning";
import { createPufferClient, fetchPufETHRate, fetchPufferApy, PUFFER_VAULT_MAINNET, PUFFER_DEPOSIT_NETWORK_ID } from "../core/puffer";
import { createTcxViemAccount } from "../core/tcxViemAccount";
import { parseEther, formatEther } from "viem";
```

Merge `type Address`, `parseEther`, `formatEther` into the existing `viem`
import line rather than duplicating it.

- [ ] **Step 2: Add the `PufETHWidget` component**

Add this component to `App.tsx` (near the other widget components):

```tsx
function PufETHWidget({
  wallet,
  network,
  ethBalance,
  onConverted
}: {
  wallet: WalletRecord | null;
  network: WalletNetworkSetting | null;
  ethBalance: string | null;
  onConverted: (event: ActivityEventInput) => void;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState<string | null>(null);
  const [apy, setApy] = useState<string | null>(null);
  const [phase, setPhase] = useState<"input" | "preview" | "signing" | "success" | "error">("input");
  const [preview, setPreview] = useState<PufferDepositPreview | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isMainnet = network?.networkId === PUFFER_DEPOSIT_NETWORK_ID;

  useEffect(() => {
    void fetchPufETHRate().then((value) => setRate(value?.pufEthPerEth ?? null));
    void fetchPufferApy().then(setApy);
  }, []);

  const estimatedPufEth = useMemo(() => {
    const eth = Number(amount);
    if (!rate || !Number.isFinite(eth) || eth <= 0) {
      return null;
    }
    return (eth * Number(rate)).toFixed(6);
  }, [amount, rate]);

  const insufficient = useMemo(() => {
    const eth = Number(amount);
    return Number.isFinite(eth) && eth > 0 && ethBalance != null && eth > Number(ethBalance);
  }, [amount, ethBalance]);

  function handleMax() {
    if (ethBalance == null) {
      return;
    }
    // Leave a small ETH buffer for gas.
    const max = Math.max(0, Number(ethBalance) - 0.002);
    setAmount(max > 0 ? max.toFixed(6) : "0");
  }

  function handleConvert() {
    if (!wallet || !network) {
      return;
    }
    const eth = Number(amount);
    if (!Number.isFinite(eth) || eth <= 0 || insufficient) {
      return;
    }
    setError(null);
    setPreview(
      buildPufferDepositPreview({
        from: wallet.address as Address,
        vaultAddress: PUFFER_VAULT_MAINNET as Address,
        ethAmount: amount,
        ethAmountWei: parseEther(amount),
        estimatedPufEth,
        networkName: network.name
      })
    );
    setPhase("preview");
  }

  async function handleConfirm() {
    if (!wallet || !network || !preview) {
      return;
    }
    setPhase("signing");
    setError(null);
    try {
      const transport = http(network.selectedRpcUrl);
      const account = createTcxViemAccount(wallet);
      const walletClient = createWalletClient({ account, chain: mainnet, transport });
      const publicClient = createPublicClient({ chain: mainnet, transport });
      const pufferClient = createPufferClient(walletClient, publicClient);

      const hash = await pufferClient.vault
        .depositETH(wallet.address as Address)
        .transact(preview.ethAmountWei);

      setTxHash(hash);
      setPhase("success");
      onConverted({
        category: "transaction",
        status: "completed",
        title: t("popup:pufeth.successTitle"),
        detail: t("popup:pufeth.estimate", { amount: preview.estimatedPufEth ?? "?" })
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("popup:pufeth.errors.convert"));
      setPhase("error");
    }
  }

  return (
    <Widget className="pufeth-widget">
      {/* input phase: heading, amount input + Max, estimate + APY line, Convert button */}
      {/* preview phase: PufferDepositPreview rendered like the Clear Signing sheet,
          Confirm + Cancel buttons */}
      {/* signing phase: spinner + t("popup:pufeth.signing") */}
      {/* success phase: t("popup:pufeth.successTitle") + a txHash explorer link */}
      {/* error phase: error text + retry back to input */}
    </Widget>
  );
}
```

- [ ] **Step 3: Implement the `PufETHWidget` render body**

Render each `phase` state. Reuse existing CSS classes from the Clear Signing
sheet (`clear-signing-*`) and Orchard primitives (`PrimaryButton`, `IconButton`,
`Widget`) for visual consistency. The preview phase shows: `t("popup:pufeth.pay")`
= `{amount} ETH`, `t("popup:pufeth.receive")` = `≈ {estimatedPufEth} pufETH`,
the vault address (shortened via the existing `formatAddress` helper), and the
`preview.warnings`. The `ActivityEventInput` shape must match the existing
broadcast activity call near `src/popup/App.tsx:745` — read it and mirror the
exact field names; the `category`/`status` values above are placeholders to
correct against `src/core/activity.ts`.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: passes. The `@consenlabs/tcx-wasm` exclude in `vite.config.ts` is
unchanged; if Vite fails to pre-bundle `@pufferfinance/puffer-sdk`, add it to
`optimizeDeps.exclude` and report this.

- [ ] **Step 5: Commit (Tasks 6 + 7 together)**

```bash
git add src/lib/storage.ts src/popup/App.tsx
git commit -m "feat(pufeth): add pufETH convert widget and flow"
```

---

## Task 8: End-to-end verification

- [ ] **Step 1:** Run `npm run dev -- --port 5173`. Open
`http://127.0.0.1:5173/src/popup/index.html`.

- [ ] **Step 2:** Confirm the pufETH widget renders on the portal: heading, amount
input, Max button, the `≈ pufETH` and `APY` lines populate (or degrade to
"APY unavailable" if the API is unreachable). No raw `popup:`/`common:` i18n
keys leak. No console errors from the widget.

- [ ] **Step 3:** Enter an amount → Convert → confirm the preview phase shows pay
/ receive / fee / warnings correctly. (Signing requires a real passkey + mainnet
ETH; verify up to the preview, then note signing is validated manually in the
loaded extension.)

- [ ] **Step 4:** Switch to all four languages via Settings; confirm the widget's
strings translate.

- [ ] **Step 5:** Run `npm run build` and confirm it passes.

- [ ] **Step 6: Commit** any verification fixes.

```bash
git add -A
git commit -m "test(pufeth): verification fixes"
```

---

## Self-Review

- **Spec coverage:** widget in popup portal (Task 6/7) · ETH amount + Max (Task 7) ·
  Clear Signing preview (Task 5 + Task 7) · passkey/tcx signing via SDK (Tasks 1, 3, 7) ·
  SDK `depositETH().transact()` (Task 7) · API rate + APY display, non-blocking (Tasks 2, 7) ·
  mainnet-only guard (Task 7 `isMainnet`) · insufficient-balance + error handling (Task 7) ·
  i18n in 4 locales (Task 4).
- **Type consistency:** `EthereumTxRequest`/`signEthereumTransaction` (Task 1) consumed by
  `createTcxViemAccount` (Task 3). `PufferDepositPreview`/`buildPufferDepositPreview`
  (Task 5) consumed by `PufETHWidget` (Task 7). `createPufferClient`, `fetchPufETHRate`,
  `fetchPufferApy`, `PUFFER_VAULT_MAINNET`, `PUFFER_DEPOSIT_NETWORK_ID` (Task 2) consumed in Task 7.
- **Known soft spots flagged for the implementer:** exact SDK export paths (Task 2 Step 3);
  viem `signTransaction` parameter typing (Task 3 Step 2); `ActivityEventInput` field
  names (Task 7 Step 3); Vite pre-bundling of the SDK (Task 7 Step 4). Each task step
  says to verify and report rather than assume.
- **Out of scope (v2):** any-token sources, the 0x swap-to-ETH step, the xState
  orchestration — not in this plan.
