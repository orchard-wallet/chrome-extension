# Issue #7 — Swap 報價能力改善

## Goal
讓 Swap 報價的「提供者」由鏈 + token 資訊推導出來，而不是在 UI 層硬寫成 0x；同時讓報價每 10 秒自動刷新一次，避免使用者看到過期價格。

## Acceptance Criteria
- SettingsApp 的 swap 流程不再直接呼叫 `getZeroExSwapPrice` / `getZeroExSwapQuote`；改透過一層 `QuoteProvider` 抽象，由鏈資訊決定要打哪家報價平台。
- 目前唯一已實作的提供者是 0x（EVM 系列），其他 family（tron / bitcoin / 未支援的 chain）會回傳 `null`，UI 顯示「此鏈尚未支援 Swap」的錯誤而不是把錯誤的 chainId 塞給 0x。
- 報價會在輸入有效時每 10 秒自動 refresh 一次；輸入改變或元件 unmount 時 cancel 計時器。
- `npm run build` 通過（typecheck + bundle）。
- 既有的 EVM 0x 流程在 UI 上仍能正常運作（手動驗證）。

## Architecture
新增 `src/core/quote/` 模組：

- `quoteProvider.ts` — 定義 `QuoteProvider` 介面、`QuoteRequest` / `QuoteResult` 型別、`PRICE_REFRESH_INTERVAL_MS` 常數、`selectQuoteProvider(network)` 解析函式。`selectQuoteProvider` 依 `network.family` + 是否有有效 `chainId` 決定要回傳哪個 provider。
- `zeroExProvider.ts` — 包裝既有 `src/core/zeroEx.ts` 的兩個 entry point，把它們轉成 `QuoteProvider` 形狀。Provider 自己處理 `tokenAddressForZeroEx`、native sentinel address 等 0x 特有細節，呼叫端只看到通用介面。

`SettingsApp.tsx` 修改：

1. 把 `buildZeroExRequest` 改成 `buildQuoteRequest`（產出 provider-neutral 的 `QuoteRequest`）。
2. price effect 在拿到 `request` 後先 `selectQuoteProvider(network)`，沒 provider 就把錯誤訊息設成 `errors.swapNoProvider` 並 return。
3. price effect 啟動一個 `setInterval(10_000)` 在背景重新查 price；計時器在 cleanup 階段被清掉，所以輸入改變、unmount、cancel 都不會 leak。
4. `handleRequestSwapQuote` 改成走 provider。
5. i18n 新增 `errors.swapNoProvider` 四語系（en / zh-tw / zh-cn / ja-jp）。

## Steps

1. **新增 `src/core/quote/quoteProvider.ts`** — 介面、型別、常數、resolver。
2. **新增 `src/core/quote/zeroExProvider.ts`** — 把現有 zeroEx 呼叫包成 provider。
3. **新增 `src/core/quote/quoteProvider.test.ts`**（vitest 沒有正式安裝，但既存 `src/settings/txExplorerUrl.test.ts` 也是 vitest，跟著現有慣例放，本批不會阻擋 build）— 涵蓋：EVM 網路解析回 0x provider；缺 chainId 回 null；非 EVM family 回 null。
4. **更新 `src/settings/SettingsApp.tsx`** — `buildQuoteRequest`、price effect 改寫成 provider + 10 秒 polling、`handleRequestSwapQuote` 走 provider。
5. **更新 4 個 i18n 檔** — 新增 `errors.swapNoProvider`。
6. **執行 `npm run build`** — typecheck + vite build 都要 green。
7. Commit + push + 開 PR（draft，掛 `auto-review` label，body 帶 `Closes #7`）。

## Risks / Notes

- `[TECH DEBT]` — 10 秒輪詢不會做 tab visibility 或 throttle 偵測；若使用者打開分頁但不在前景仍會打 0x。後續 issue 可加 `document.visibilityState` gating。
- `[TECH DEBT]` — `quoteProvider.test.ts` 雖然存在但這個 repo 沒有 `npm test` script，CI 不會跑。手動跑 `npx vitest run` 才會驗證，跟同 repo 既存 test file 處境相同。
- `selectQuoteProvider` 目前只支援 EVM family；新增 family 時要在此處註冊新 provider。介面已抽好，新增成本低。
