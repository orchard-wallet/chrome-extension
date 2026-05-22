# pufETH One-Click Convert Widget — Design (v1)

**Status:** Approved (brainstorming) — ready for implementation planning.

## Goal

Add a popup portal widget that converts ETH into pufETH (Puffer Finance's liquid
restaking token) in one guided flow: enter an amount, see a Clear Signing
preview, confirm with a passkey, done.

## Scope

**v1 (this spec):** ETH → pufETH on Ethereum Mainnet only. One transaction
(`depositETH` to the Puffer vault). A new, dedicated popup widget.

**v2 (out of scope here, separate spec later):** any-token → pufETH. Non-ETH
sources are first swapped to ETH via the existing 0x integration, then deposited.
This adds an `approve → swap → deposit` multi-step orchestration driven by an
xState machine. v1 is built so v2 extends it rather than rewrites it.

## Background

### Puffer / pufETH

pufETH is an ERC-4626 vault token. Depositing ETH into the `PufferVault` contract
mints pufETH at the canonical NAV rate (no slippage). pufETH then accrues
restaking rewards automatically.

- `PufferVault` (= pufETH token), Ethereum Mainnet: `0xD9A442856C234a39a81a089C06451EBAa4306a72`
- Deposit method: `depositETH(address recipient)` — payable.

### Puffer SDK — `@pufferfinance/puffer-sdk`

- `Chain` enum includes `Chain.Mainnet`.
- `new PufferClient(chain, walletClient?, publicClient?)` — the constructor
  accepts caller-supplied viem `WalletClient` / `PublicClient` (it only builds
  defaults when omitted). This is the integration seam: we pass our own clients.
- `pufferClient.vault` is a `PufferVaultHandler`:
  - `depositETH(recipient: Address)` → `{ transact(value), estimate(value) }`.
    `transact` runs `contract.write.depositETH([recipient], { account, chain, value })`
    (a viem `writeContract`).
  - `getPufETHRate()` → on-chain `previewDeposit(1e18)` = pufETH minted per 1 ETH.
  - `balanceOf(address)` → pufETH balance.
- `requestAddresses()` → wallet addresses (not used; we already know the address).

### imToken-hackathon API — `https://api-v2.puffer.fi/imtoken-hackathon`

Read-only analytics. No transaction building. Endpoints used:

- `GET /pufeth/rate` → `{ pufEthPerEth, ethPerPufEth, totalAssets, totalSupply }` (strings).
- `GET /protocol/tvl` → `{ ..., apy, timestamp }` — pufETH staking APY for display.

Other endpoints (`/pufeth/metrics`, `/tokens/prices`, `/vaults/*`, `/gauges/apr`)
are not required for v1.

## Why the SDK can sign with this wallet

The SDK's documented example builds its `WalletClient` from `window.ethereum`.
This wallet has no injected provider — it signs via WebAuthn passkey PRF →
`tcx-wasm`. But `PufferClient` accepts any viem `WalletClient`, and viem can
build a `WalletClient` on a **custom local account** that exposes
`signTransaction`. We provide a thin adapter account whose `signTransaction`
runs the passkey/tcx signing path. The SDK's `vault.depositETH().transact()`
then signs through that adapter — using the SDK exactly as intended.

## Architecture

```
src/core/puffer.ts          NEW  Puffer domain layer
src/core/tcxViemAccount.ts   NEW  viem custom account backed by passkey/tcx
src/core/tcx.ts              MOD  sign_tx extended to carry `data` (contract calls)
src/core/clearSigning.ts     MOD  buildPufferDepositPreview()
src/popup/App.tsx            MOD  PufETHWidget + convert flow wiring
src/i18n/locales/**          MOD  new strings, 4 locales
package.json                 MOD  add @pufferfinance/puffer-sdk
```

### `src/core/puffer.ts`

- `PUFFER_VAULT_MAINNET` address constant.
- `createPufferClient(walletClient, publicClient)` → `PufferClient(Chain.Mainnet, …)`.
- `fetchPufETHRate()` → `GET /pufeth/rate`; returns parsed rate, used as a
  display cross-check.
- `fetchPufferApy()` → `GET /protocol/tvl`; returns the APY string for display.
- `estimatePufETHOut(ethWei, ratePufEthPerEth)` → expected pufETH out.
- The authoritative conversion estimate comes from the SDK's on-chain
  `vault.getPufETHRate()`; the API rate is a secondary display value. If the API
  is unreachable, the flow still works on the on-chain rate.

### `src/core/tcxViemAccount.ts`

- `createTcxViemAccount(walletRecord)` → a viem account object
  (`{ address, signTransaction, signMessage, signTypedData }`).
- `signTransaction(tx)` — receives a viem `TransactionSerializable` (`to`,
  `value`, `data`, `nonce`, `gas`, `maxFeePerGas`, `maxPriorityFeePerGas`,
  `chainId`, `type`). It runs `unlockPasskeyPrf(walletRecord)` (WebAuthn
  ceremony) then `tcx-wasm sign_tx`, and returns the serialized signed tx hex.
- `signMessage` / `signTypedData` throw "not supported in v1" — the deposit flow
  only signs transactions.

### `src/core/tcx.ts` (modification)

`signEthereumTransfer` currently builds the `sign_tx` input with
`nonce/gasLimit/to/value/chainId/maxFee*` and **no `data` field** — it can only
sign native transfers. Add a `data` field (calldata, default `"0x"`) so a
contract call can be signed. Expose the signing in a form
`tcxViemAccount` can call with viem's transaction shape.

### `src/core/clearSigning.ts` (modification)

Add `buildPufferDepositPreview(input)` producing a preview object for the
deposit: a known, safe contract call (not the generic "Unsupported contract
call"). It reports recipient = self, ETH paid, estimated pufETH received, the
vault contract, the fee, and an info warning to review before signing.

### `src/popup/App.tsx` (modification)

- New `PufETHWidget` rendered as a portal widget (a new `"pufeth"` widget id;
  the existing disabled `"swap"` widget is left untouched).
- Widget contents: heading, an ETH amount input with a **Max** button (Max =
  balance minus a gas buffer), a live "≈ Y pufETH" line and "APY X%" line, and a
  primary **Convert** button.
- Convert reuses the popup's existing preview → passkey-unlock → sign → broadcast
  machinery; the difference is the preview/transaction is a Puffer deposit.

## Data flow

```
PufETHWidget: user enters ETH amount (or Max)
  → on Convert:
      vault.getPufETHRate()           (on-chain, SDK)
      vault.depositETH(self).estimate(valueWei)   (gas, SDK)
      fetchPufferApy()                (display, API; non-blocking)
  → buildPufferDepositPreview(...)  → Clear Signing sheet
      shows: pay X ETH · receive ~Y pufETH · rate · APY · gas fee
  → user confirms
  → vault.depositETH(self).transact(valueWei)
      → viem writeContract → tcxViemAccount.signTransaction
          → unlockPasskeyPrf (WebAuthn) → tcx sign_tx (with data) → serialized tx
      → walletClient broadcasts → txHash
  → appendActivityEvent("pufETH converted")
  → refresh balances → success state
```

## Error handling

- **API rate/APY unreachable:** do not block. Use the SDK on-chain rate; show
  APY as "—". The analytics API never gates the core convert.
- **Wrong network:** if the wallet is not on Ethereum Mainnet, the widget shows
  a "Switch to Ethereum Mainnet" state and disables Convert (v1 is mainnet-only).
- **Insufficient balance:** amount + estimated gas exceeds ETH balance →
  inline validation error, Convert disabled.
- **Gas estimation fails:** show an error, block signing.
- **Sign/broadcast failure:** error message; `appendActivityEvent` records the
  failure; widget returns to the input state.
- **Passkey cancelled:** treat as a benign cancel, return to the preview.

## Open risks (resolve first in the plan)

1. **tcx-wasm `data` support (go/no-go).** v1 depends on `@consenlabs/tcx-wasm`'s
   `sign_tx` accepting a `data`/calldata field. The first plan task verifies
   this with a spike (sign a tx with non-empty `data`, decode the serialized
   output, confirm the calldata is present). If unsupported, v1 is blocked and
   we escalate before writing more code.
2. **SDK `transact` and the preview ordering.** The Clear Signing preview is
   shown and confirmed *before* `transact()` is called; `transact` then triggers
   the passkey ceremony inside `signTransaction`. Gas shown in the preview is a
   pre-estimate and may differ slightly from what `transact` re-estimates —
   acceptable for v1.
3. **SDK bundle size.** `@pufferfinance/puffer-sdk` adds to the settings/popup
   bundle. Acceptable for the hackathon prototype; note for later optimization.

## Out of scope for v1

- Any non-ETH source token (v2).
- stETH/wstETH deposits.
- Withdrawing / redeeming pufETH back to ETH.
- Cross-chain (L2) deposits.
