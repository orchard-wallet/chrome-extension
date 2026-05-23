# Orchard Wallet

一款自我託管的多鏈加密貨幣錢包 Chrome 擴充功能 — 以 WebAuthn passkey
解鎖，圍繞 Clear Signing 設計，追求極簡。

無助記詞，無密碼。Passkey 就是你的鑰匙。

**語言：** [English](README.md) · 繁體中文 · [简体中文](README.zh-CN.md)

---

## 畫面預覽

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/screenshots/send.png" alt="發送頁面，支援 ENS 解析與手續費預估" />
      <p align="center"><sub>發送：ENS 名稱解析、即時手續費預估</sub></p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/screenshots/clear-sign.png" alt="Clear Signing 交易預覽" />
      <p align="center"><sub>Clear Signing 預覽：自動標記安全範圍與到期倒數</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/screenshots/customize-portal.png" alt="可自訂的 Portal 儀表板，支援拖曳排序" />
      <p align="center"><sub>可拖曳排序的 Portal 儀表板，附即時預覽</sub></p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/screenshots/address-book.png" alt="支援 ENS 與可信聯絡人的地址簿" />
      <p align="center"><sub>地址簿：ENS、可信聯絡人、近期收款方</sub></p>
    </td>
  </tr>
  <tr>
    <td colspan="2" valign="top">
      <img src="docs/screenshots/walletconnect-v2.png" alt="WalletConnect v2 連線管理" />
      <p align="center"><sub>WalletConnect v2 — 管理連線中的 dApp、帳戶與權限</sub></p>
    </td>
  </tr>
</table>

## 核心特色

### 無密碼設計

錢包沒有助記詞、沒有密碼。WebAuthn passkey（PRF 擴充）衍生對稱金鑰，
用以解鎖本地 `tcx-wasm` keystore。每次簽名都需要重新進行 passkey
assertion — 天生防釣魚，也不會被剪貼簿或記憶體掃描攻擊截取「儲存的
密碼」（因為根本沒有）。

### Clear Signing，不是盲簽

任何簽名前，你都會看到人類可讀的內容：收款方、金額、網路、手續費。
錢包會自動辨識純 ETH 轉帳並標記為**安全範圍**（「未檢測到代幣授權、
兌換或合約交互」）。複雜的 calldata 折疊在可展開的面板裡。倒數計時
避免你對過期的預覽簽名導致 gas 估算失準。

### 可自訂的 Portal 儀表板

Popup 不是固定排版。你可以選擇要顯示哪些小部件 — 餘額、資產、發送、
接收、兌換、活動、投資組合 — 並拖曳排序。設置頁有即時預覽，存檔前
就能看到完整效果。

### 一個錢包，多鏈支援

EVM 系列（Ethereum、Arbitrum、Base、Polygon、Hyperliquid…）、Bitcoin、
TRON，全部在同一個 keystore 之下。可以在設置中新增自訂 RPC。

### 原生 ENS 名稱解析

打 `vitalik.eth` 不需打 `0xd8dA...`。解析使用 viem ENS actions、
Universal Resolver 與 CCIP Read gateway — 已為 ENS v2 做好準備。發送
流程會在你確認前顯示解析後的地址，ENS 聯絡人也可以存進地址簿作為
可信聯絡人。

### 兩種方式連接 dApp

- **桌面 dApp** — 擴充功能會把 EIP-1193 / EIP-6963 標準的 Ethereum
  provider 注入到每個網頁。現代 dApp 會自動偵測。
- **行動 dApp** — 透過 WalletConnect v2 掃 QR Code 配對。專屬的會話
  管理頁顯示連線中的 dApp、連接的帳戶、允許的鏈、授予的權限，可以
  隨時斷開。

### 內建 DeFi 小部件

- **Swap（設置 → Swap）** — 透過 0x API 在精選代幣清單中取得指示性
  價格與 AllowanceHolder firm quote。
- **pufETH 一鍵兌換** — 透過 Puffer Finance 一鍵將 ETH 轉為 pufETH
  流動性再質押，附 Clear Signing 預覽。

### 多語系 UI

English、繁體中文、简体中文、日本語 — 在設置中即時切換，選擇會存進
`chrome.storage.local`。

---

## 安全模型

| 層級 | 保護機制 |
|---|---|
| 身份驗證 | WebAuthn passkey（PRF 擴充），由作業系統／瀏覽器的安全晶片管理 |
| Keystore 加密 | 用 passkey PRF 輸出衍生的對稱金鑰（從不寫入磁碟） |
| 金鑰素材 | `@consenlabs/tcx-wasm` — 私鑰僅在簽名瞬間存在於 WASM 記憶體 |
| 資料儲存 | 僅 `chrome.storage.local` — 不雲端同步、不遠端備份 |
| 對外請求 | 僅限[隱私權政策](docs/privacy-policy.md)所列端點 — 無分析、無 telemetry |

私鑰永不離開你的裝置。完整的對外端點清單與傳送內容請見
[隱私權政策](docs/privacy-policy.md)。

## 支援的網路

Ethereum Mainnet · Arbitrum One · Base · Polygon · Hyperliquid ·
Bitcoin（mainnet、testnet、signet）· TRON（mainnet、Shasta、Nile）·
Sepolia 與其他測試網 · 加上任何 EVM 鏈的**自訂 RPC**。

---

## 安裝

### 從原始碼建置

Build-time 環境變數（寫在 `.env`）：

```bash
VITE_WALLETCONNECT_PROJECT_ID=your_walletconnect_project_id
VITE_ZERO_EX_API_KEY=your_0x_api_key
```

兩個都是選填。沒有 key 時 WalletConnect 與 Swap 會優雅降級。

```bash
npm install
npm run build
```

接著在 Chrome：

1. 開啟 `chrome://extensions`。
2. 開啟**開發人員模式**。
3. 點選**載入未封裝項目**，選擇 `dist/` 目錄。

### 純 UI 開發模式

修改 popup / settings UI 不需要重 build 擴充功能：

```bash
npm run dev -- --port 5173
```

接著開啟 `http://127.0.0.1:5173/src/popup/index.html` 或
`.../src/settings/index.html`。`chrome.*` API 會被 stub 掉，儲存自動
退回 `localStorage`。

## 打包上架 Chrome Web Store

```bash
npm run package
```

會 build 並把 `dist/` 打包成 `orchard-wallet.zip`（`manifest.json` 在
壓縮檔根目錄）。每次上架前記得在 `public/manifest.json` 更新 `version`。

## 多語系

UI 隨附四個語系 — `en`、`zh-cn`、`zh-tw`、`ja-jp`。在**設置 → 設置**
切換，選擇會存進 `chrome.storage.local`。首次安裝時依瀏覽器語系自動
選擇，預設為英文。

翻譯檔是 `src/i18n/locales/<locale>/` 下的 JSON catalog，分成
`common`、`popup`、`settings` 三個 namespace。要新增或修改字串：先改
`en`，再把 key 複製到其他三個語系，然後跑
`node scripts/check-i18n-parity.mjs` 確認 key 都對齊。

## 架構

```text
src/popup/App.tsx                     Popup 流程與 UI state
src/settings/SettingsApp.tsx          設置、網路、Swap、Portal 排版
src/background.ts                     MV3 service worker（RPC、WalletConnect、alarms）
src/content/providerBridge.ts         網頁 <-> background 的 CustomEvent 橋接
src/inpage/ethereumProvider.ts        注入網頁的 EIP-1193 / EIP-6963 provider
src/core/webauthn.ts                  WebAuthn PRF 憑證建立與解鎖
src/core/tcx.ts                       tcx-wasm 初始化、keystore 建立、帳號衍生
src/core/clearSigning.ts              Clear Signing 交易意圖建構
src/core/ens.ts                       ENS 正向／反向解析 adapter
src/core/networks.ts                  內建網路與 RPC 設定
src/core/rpc.ts                       EVM RPC 餘額、費率、gas、nonce、廣播
src/core/{evm,tron,bitcoin}Assets.ts  各鏈餘額更新器
src/core/portfolio.ts                 正規化的多鏈資產 store
src/core/zeroEx.ts                    0x AllowanceHolder swap quote
src/core/puffer.ts                    Puffer pufETH 匯率與 TVL
src/i18n/index.ts                     i18next 設定與即時語系切換
src/lib/storage.ts                    chrome.storage.local，含 localStorage fallback
```

進階文件：

- [多鏈資產架構](docs/multichain-assets-architecture.md)
- [Orchard UI 實作計畫](docs/orchard-ui-implementation-plan.md)

## 隱私

完整[隱私權政策](docs/privacy-policy.md) — 每個對外端點、傳送了什麼、
本機儲存了什麼，都列得清清楚楚。
