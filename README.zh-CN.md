# Orchard Wallet

一款自我托管的多链加密货币钱包 Chrome 扩展程序 — 通过 WebAuthn passkey
解锁，围绕 Clear Signing 设计，追求极简。

无助记词，无密码。Passkey 就是你的钥匙。

**语言：** [English](README.md) · [繁體中文](README.zh-TW.md) · 简体中文

---

## 界面预览

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/screenshots/send.png" alt="发送页面，支持 ENS 解析与手续费预估" />
      <p align="center"><sub>发送：ENS 名称解析、实时手续费预估</sub></p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/screenshots/clear-sign.png" alt="Clear Signing 交易预览" />
      <p align="center"><sub>Clear Signing 预览：自动标记安全范围与到期倒计时</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/screenshots/customize-portal.png" alt="可自定义的 Portal 仪表板，支持拖拽排序" />
      <p align="center"><sub>可拖拽排序的 Portal 仪表板，附实时预览</sub></p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/screenshots/address-book.png" alt="支持 ENS 与可信联系人的地址簿" />
      <p align="center"><sub>地址簿：ENS、可信联系人、近期收款方</sub></p>
    </td>
  </tr>
  <tr>
    <td colspan="2" valign="top">
      <img src="docs/screenshots/walletconnect-v2.png" alt="WalletConnect v2 会话管理" />
      <p align="center"><sub>WalletConnect v2 — 管理活跃 dApp 会话、账户与权限</sub></p>
    </td>
  </tr>
</table>

## 核心特色

### 无密码设计

钱包没有助记词、没有密码。WebAuthn passkey（PRF 扩展）派生对称密钥，
用于解锁本地 `tcx-wasm` keystore。每次签名都需要重新进行 passkey
assertion — 天生抗钓鱼，也不会被剪贴板或内存扫描攻击截取"存储的
密码"（因为根本不存在）。

### Clear Signing，不是盲签

任何签名前，你都会看到人类可读的内容：收款方、金额、网络、手续费。
钱包会自动识别纯 ETH 转账并标记为**安全范围**（"未检测到代币授权、
兑换或合约交互"）。复杂的 calldata 折叠在可展开的面板中。倒计时
避免你对过期的预览签名导致 gas 估算失准。

### 可自定义的 Portal 仪表板

Popup 不是固定布局。你可以选择要显示哪些小部件 — 余额、资产、发送、
接收、兑换、活动、投资组合 — 并拖拽排序。设置页有实时预览，保存前
就能看到完整效果。

### 一个钱包，多链支持

EVM 系列（Ethereum、Arbitrum、Base、Polygon、Hyperliquid…）、Bitcoin、
TRON，全部在同一个 keystore 之下。可以在设置中添加自定义 RPC。

### 原生 ENS 名称解析

输入 `vitalik.eth` 不用敲 `0xd8dA...`。解析使用 viem ENS actions、
Universal Resolver 与 CCIP Read gateway — 已为 ENS v2 做好准备。发送
流程会在你确认前显示解析后的地址，ENS 联系人也可以存进地址簿作为
可信联系人。

### 两种方式连接 dApp

- **桌面 dApp** — 扩展程序会把 EIP-1193 / EIP-6963 标准的 Ethereum
  provider 注入到每个网页。现代 dApp 会自动检测。
- **移动端 dApp** — 通过 WalletConnect v2 扫 QR 码配对。专属的会话
  管理页显示活跃的 dApp、连接的账户、允许的链、授予的权限，可以
  随时断开。

### 内置 DeFi 小部件

- **Swap（设置 → Swap）** — 通过 0x API 在精选代币列表中获取指示性
  价格与 AllowanceHolder firm quote。
- **pufETH 一键兑换** — 通过 Puffer Finance 一键将 ETH 转为 pufETH
  流动性再质押，附 Clear Signing 预览。

### 多语言 UI

English、繁體中文、简体中文、日本語 — 在设置中实时切换，选择会存进
`chrome.storage.local`。

---

## 安全模型

| 层级 | 保护机制 |
|---|---|
| 身份验证 | WebAuthn passkey（PRF 扩展），由操作系统／浏览器的安全芯片管理 |
| Keystore 加密 | 用 passkey PRF 输出派生的对称密钥（从不写入磁盘） |
| 密钥素材 | `@consenlabs/tcx-wasm` — 私钥仅在签名瞬间存在于 WASM 内存 |
| 数据存储 | 仅 `chrome.storage.local` — 不云端同步、不远程备份 |
| 对外请求 | 仅限[隐私政策](docs/privacy-policy.md)所列端点 — 无分析、无 telemetry |

私钥永不离开你的设备。完整的对外端点清单与传送内容请见
[隐私政策](docs/privacy-policy.md)。

## 支持的网络

Ethereum Mainnet · Arbitrum One · Base · Polygon · Hyperliquid ·
Bitcoin（mainnet、testnet、signet）· TRON（mainnet、Shasta、Nile）·
Sepolia 与其他测试网 · 加上任何 EVM 链的**自定义 RPC**。

---

## 安装

### 从源码构建

Build-time 环境变量（写在 `.env`）：

```bash
VITE_WALLETCONNECT_PROJECT_ID=your_walletconnect_project_id
VITE_ZERO_EX_API_KEY=your_0x_api_key
```

两个都是可选。没有 key 时 WalletConnect 与 Swap 会优雅降级。

```bash
npm install
npm run build
```

然后在 Chrome：

1. 打开 `chrome://extensions`。
2. 开启**开发者模式**。
3. 点击**加载已解压的扩展程序**，选择 `dist/` 目录。

### 纯 UI 开发模式

修改 popup / settings UI 不需要重新构建扩展：

```bash
npm run dev -- --port 5173
```

然后打开 `http://127.0.0.1:5173/src/popup/index.html` 或
`.../src/settings/index.html`。`chrome.*` API 会被 stub 掉，存储自动
回退到 `localStorage`。

## 打包上架 Chrome Web Store

```bash
npm run package
```

会构建并把 `dist/` 打包成 `orchard-wallet.zip`（`manifest.json` 在
压缩包根目录）。每次上架前记得在 `public/manifest.json` 更新 `version`。

## 多语言

UI 自带四个语系 — `en`、`zh-cn`、`zh-tw`、`ja-jp`。在**设置 → 设置**
切换，选择会存进 `chrome.storage.local`。首次安装时根据浏览器语言自动
选择，默认为英文。

翻译文件是 `src/i18n/locales/<locale>/` 下的 JSON catalog，分成
`common`、`popup`、`settings` 三个 namespace。要添加或修改字符串：先改
`en`，再把 key 复制到其他三个语系，然后运行
`node scripts/check-i18n-parity.mjs` 确认 key 对齐。

## 架构

```text
src/popup/App.tsx                     Popup 流程与 UI state
src/settings/SettingsApp.tsx          设置、网络、Swap、Portal 布局
src/background.ts                     MV3 service worker（RPC、WalletConnect、alarms）
src/content/providerBridge.ts         网页 <-> background 的 CustomEvent 桥接
src/inpage/ethereumProvider.ts        注入网页的 EIP-1193 / EIP-6963 provider
src/core/webauthn.ts                  WebAuthn PRF 凭证创建与解锁
src/core/tcx.ts                       tcx-wasm 初始化、keystore 创建、账户派生
src/core/clearSigning.ts              Clear Signing 交易意图构建
src/core/ens.ts                       ENS 正向／反向解析 adapter
src/core/networks.ts                  内置网络与 RPC 设置
src/core/rpc.ts                       EVM RPC 余额、费率、gas、nonce、广播
src/core/{evm,tron,bitcoin}Assets.ts  各链余额更新器
src/core/portfolio.ts                 规范化的多链资产 store
src/core/zeroEx.ts                    0x AllowanceHolder swap quote
src/core/puffer.ts                    Puffer pufETH 汇率与 TVL
src/i18n/index.ts                     i18next 设置与实时语言切换
src/lib/storage.ts                    chrome.storage.local，含 localStorage fallback
```

进阶文档：

- [多链资产架构](docs/multichain-assets-architecture.md)
- [Orchard UI 实现计划](docs/orchard-ui-implementation-plan.md)

## 隐私

完整[隐私政策](docs/privacy-policy.md) — 每个对外端点、发送了什么、
本地存储了什么，都列得清清楚楚。
