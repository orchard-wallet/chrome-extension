import {
  AlertTriangle,
  Check,
  Copy,
  FileCheck2,
  KeyRound,
  Loader2,
  QrCode,
  RefreshCcw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Unplug,
  Wallet
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { formatTokenAmount, formatUsd, type AssetStore, type ChainAssetSnapshot } from "../core/assets";
import { buildNativeEthTransferPreview, canSignPreview } from "../core/clearSigning";
import { resolveRecipient, type RecipientResolution } from "../core/ens";
import { getBuiltInNetworkSettings, type WalletNetworkSetting } from "../core/networks";
import { readPortfolioStore, refreshPortfolio } from "../core/portfolio";
import { broadcastSignedTransaction, estimateNativeEthTransfer, type TransactionFeeEstimate } from "../core/rpc";
import { createEthereumPasskeyWallet, signEthereumTransfer, type EthereumSignResult } from "../core/tcx";
import { createPasskeyPrf, unlockPasskeyPrf } from "../core/webauthn";
import {
  clearWalletRecord,
  readNetworkSettings,
  readWalletConnectSettings,
  readWalletRecord,
  WalletRecord,
  writeWalletRecord
} from "../lib/storage";

type Status = "idle" | "creating" | "ready" | "error";
type ResolverStatus = "idle" | "resolving";
type FeeStatus = "idle" | "estimating" | "ready" | "error";
type SigningStatus = "idle" | "signing" | "broadcasting" | "broadcasted" | "error";
type PortfolioLoadStatus = "idle" | "loading" | "ready" | "error";
type WalletConnectStatus = "idle" | "pairing" | "paired" | "error";
type WalletConnectSessionsStatus = "idle" | "loading" | "ready" | "error";

interface WalletConnectSessionSummary {
  topic: string;
  name: string;
  description: string;
  url: string;
  icons: string[];
  accounts: string[];
  chains: string[];
  methods: string[];
  expiry?: number;
}

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function openSettingsPage() {
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    window.open(chrome.runtime.getURL("src/settings/index.html"), "_blank", "noopener,noreferrer");
    return;
  }

  if (typeof chrome !== "undefined" && chrome.runtime?.openOptionsPage) {
    chrome.runtime.openOptionsPage();
    return;
  }

  window.open("/src/settings/index.html", "_blank", "noopener,noreferrer");
}

function sendRuntimeMessage<TResponse>(message: unknown): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    if (!chrome.runtime?.sendMessage) {
      reject(new Error("Chrome runtime messaging is unavailable."));
      return;
    }

    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime?.lastError;

      if (runtimeError?.message) {
        reject(new Error(runtimeError.message));
        return;
      }

      if (!response) {
        reject(new Error("WalletConnect background service did not respond. Reload the extension and try again."));
        return;
      }

      resolve(response as TResponse);
    });
  });
}

function txExplorerUrl(hash: string, network: WalletNetworkSetting | null): string | null {
  switch (network?.chainId) {
    case 1:
      return `https://etherscan.io/tx/${hash}`;
    case 11155111:
      return `https://sepolia.etherscan.io/tx/${hash}`;
    case 42161:
      return `https://arbiscan.io/tx/${hash}`;
    case 421614:
      return `https://sepolia.arbiscan.io/tx/${hash}`;
    case 137:
      return `https://polygonscan.com/tx/${hash}`;
    case 80002:
      return `https://amoy.polygonscan.com/tx/${hash}`;
    default:
      return null;
  }
}

export function App() {
  const [wallet, setWallet] = useState<WalletRecord | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [portfolioStatus, setPortfolioStatus] = useState<PortfolioLoadStatus>("idle");
  const [portfolioStore, setPortfolioStore] = useState<AssetStore | null>(null);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);
  const [selectedChainId, setSelectedChainId] = useState<string | null>(null);
  const [resolverStatus, setResolverStatus] = useState<ResolverStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [recipientInput, setRecipientInput] = useState("");
  const [recipientResolution, setRecipientResolution] = useState<RecipientResolution>({ kind: "empty", input: "" });
  const [sendNetworks, setSendNetworks] = useState<WalletNetworkSetting[]>([]);
  const [selectedSendNetworkId, setSelectedSendNetworkId] = useState<string | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [feeStatus, setFeeStatus] = useState<FeeStatus>("idle");
  const [feeEstimate, setFeeEstimate] = useState<TransactionFeeEstimate | null>(null);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [previewAccepted, setPreviewAccepted] = useState(false);
  const [signingStatus, setSigningStatus] = useState<SigningStatus>("idle");
  const [signingError, setSigningError] = useState<string | null>(null);
  const [signatureResult, setSignatureResult] = useState<EthereumSignResult | null>(null);
  const [broadcastHash, setBroadcastHash] = useState<string | null>(null);
  const [walletConnectUri, setWalletConnectUri] = useState("");
  const [walletConnectStatus, setWalletConnectStatus] = useState<WalletConnectStatus>("idle");
  const [walletConnectMessage, setWalletConnectMessage] = useState<string | null>(null);
  const [walletConnectSessionsStatus, setWalletConnectSessionsStatus] = useState<WalletConnectSessionsStatus>("idle");
  const [walletConnectSessions, setWalletConnectSessions] = useState<WalletConnectSessionSummary[]>([]);
  const [walletConnectSessionsError, setWalletConnectSessionsError] = useState<string | null>(null);
  const [disconnectingTopic, setDisconnectingTopic] = useState<string | null>(null);

  useEffect(() => {
    readWalletRecord()
      .then((record) => {
        setWallet(record);
        setStatus(record ? "ready" : "idle");
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Unable to load wallet state.");
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    let cancelled = false;

    readNetworkSettings()
      .then((settings) => {
        if (cancelled) {
          return;
        }

        const evmNetworks = getBuiltInNetworkSettings(settings).filter(
          (network) =>
            network.enabled &&
            ["ethereum", "arbitrum", "hyperliquid", "polygon", "custom"].includes(network.family) &&
            typeof network.chainId === "number" &&
            /^https?:\/\//i.test(network.selectedRpcUrl)
        );

        setSendNetworks(evmNetworks);
        setSelectedSendNetworkId((current) =>
          current && evmNetworks.some((network) => network.networkId === current) ? current : (evmNetworks[0]?.networkId ?? null)
        );
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Unable to load enabled networks.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const displayAddress = useMemo(() => (wallet ? formatAddress(wallet.address) : "No wallet yet"), [wallet]);
  const displayPortfolioTotal = useMemo(() => {
    if (!wallet) {
      return "$0.00";
    }

    if (portfolioStatus === "loading") {
      return "Loading";
    }

    return formatUsd(portfolioStore?.portfolioSnapshot?.totalValueUsd);
  }, [portfolioStatus, portfolioStore, wallet]);
  const chainSnapshots = useMemo(
    () => Object.values(portfolioStore?.chainAssetSnapshots ?? {}),
    [portfolioStore]
  );
  const selectedChain = useMemo(
    () =>
      selectedChainId
        ? (portfolioStore?.chainAssetSnapshots[selectedChainId] ?? null)
        : (chainSnapshots.find((snapshot) => snapshot.status === "ready") ?? chainSnapshots[0] ?? null),
    [chainSnapshots, portfolioStore, selectedChainId]
  );
  const selectedSendNetwork = useMemo(
    () => sendNetworks.find((network) => network.networkId === selectedSendNetworkId) ?? sendNetworks[0] ?? null,
    [selectedSendNetworkId, sendNetworks]
  );
  const broadcastExplorerUrl = useMemo(
    () => (broadcastHash ? txExplorerUrl(broadcastHash, selectedSendNetwork) : null),
    [broadcastHash, selectedSendNetwork]
  );
  const previewResult = useMemo(
    () =>
      buildNativeEthTransferPreview({
        from: wallet ? (wallet.address as Address) : null,
        recipient: recipientResolution,
        amount: amountInput,
        network: selectedSendNetwork,
        feeEstimate
      }),
    [amountInput, feeEstimate, recipientResolution, selectedSendNetwork, wallet]
  );

  const basePreviewResult = useMemo(
    () =>
      buildNativeEthTransferPreview({
        from: wallet ? (wallet.address as Address) : null,
        recipient: recipientResolution,
        amount: amountInput,
        network: selectedSendNetwork
      }),
    [amountInput, recipientResolution, selectedSendNetwork, wallet]
  );

  useEffect(() => {
    setPreviewAccepted(false);
    setSigningStatus("idle");
    setSigningError(null);
    setSignatureResult(null);
    setBroadcastHash(null);
  }, [amountInput, feeEstimate, recipientResolution, selectedSendNetworkId]);

  useEffect(() => {
    let cancelled = false;

    setPortfolioError(null);

    if (!wallet) {
      setPortfolioStore(null);
      setPortfolioStatus("idle");
      return () => {
        cancelled = true;
      };
    }

    setPortfolioStatus("loading");

    readPortfolioStore()
      .then((cachedStore) => {
        if (!cancelled) {
          setPortfolioStore(cachedStore);
        }
      })
      .catch(() => undefined);

    refreshPortfolio(wallet.address as Address)
      .then(({ store }) => {
        if (!cancelled) {
          setPortfolioStore(store);
          setPortfolioStatus("ready");
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setPortfolioError(cause instanceof Error ? cause.message : "Unable to refresh portfolio.");
          setPortfolioStatus("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [wallet]);

  useEffect(() => {
    if (!wallet) {
      setWalletConnectSessions([]);
      setWalletConnectSessionsStatus("idle");
      return;
    }

    void refreshWalletConnectSessions();
  }, [wallet]);

  useEffect(() => {
    let cancelled = false;

    setFeeEstimate(null);
    setFeeError(null);

    if (!basePreviewResult.ok) {
      setFeeStatus("idle");
      return () => {
        cancelled = true;
      };
    }

    setFeeStatus("estimating");

    estimateNativeEthTransfer({
      from: basePreviewResult.preview.from,
      to: basePreviewResult.preview.to,
      value: basePreviewResult.preview.amountWei,
      network: selectedSendNetwork ?? undefined
    })
      .then((estimate) => {
        if (!cancelled) {
          setFeeEstimate(estimate);
          setFeeStatus("ready");
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setFeeError(cause instanceof Error ? cause.message : "Unable to estimate network fee.");
          setFeeStatus("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [basePreviewResult, selectedSendNetwork]);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setResolverStatus(recipientInput.trim() ? "resolving" : "idle");

      resolveRecipient(recipientInput)
        .then((result) => {
          if (!cancelled) {
            setRecipientResolution(result);
          }
        })
        .catch((cause: unknown) => {
          if (!cancelled) {
            setRecipientResolution({
              kind: "invalid",
              input: recipientInput,
              reason: cause instanceof Error ? cause.message : "Unable to resolve recipient."
            });
          }
        })
        .finally(() => {
          if (!cancelled) {
            setResolverStatus("idle");
          }
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [recipientInput]);

  async function handleCreateWallet() {
    setStatus("creating");
    setError(null);

    try {
      const passkey = await createPasskeyPrf("Primary wallet");
      const created = await createEthereumPasskeyWallet(passkey);
      const record: WalletRecord = {
        ...passkey,
        ...created
      };

      await writeWalletRecord(record);
      setWallet(record);
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create wallet.");
      setStatus("error");
    }
  }

  async function handleCopy() {
    if (!wallet) {
      return;
    }

    await navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  async function handleReset() {
    await clearWalletRecord();
    setWallet(null);
    setStatus("idle");
    setError(null);
    setReceiveOpen(false);
    setPortfolioStore(null);
    setSelectedChainId(null);
  }

  async function handleRefreshPortfolio() {
    if (!wallet) {
      return;
    }

    setPortfolioStatus("loading");
    setPortfolioError(null);

    try {
      const { store } = await refreshPortfolio(wallet.address as Address);
      setPortfolioStore(store);
      setPortfolioStatus("ready");
    } catch (cause) {
      setPortfolioError(cause instanceof Error ? cause.message : "Unable to refresh portfolio.");
      setPortfolioStatus("error");
    }
  }

  async function handlePreviewAction() {
    if (!previewResult.ok || !wallet || !canSignPreview(previewResult.preview)) {
      return;
    }

    if (!previewAccepted) {
      setPreviewAccepted(true);
      return;
    }

    setSigningStatus("signing");
    setSigningError(null);

    try {
      const key = await unlockPasskeyPrf(wallet.credentialId);
      const result = await signEthereumTransfer({
        keystoreJson: wallet.keystoreJson,
        key,
        derivationPath: wallet.derivationPath,
        preview: previewResult.preview
      });

      setSignatureResult(result);
      setSigningStatus("broadcasting");

      const hash = await broadcastSignedTransaction(result.serializedTransaction, selectedSendNetwork ?? undefined);
      setBroadcastHash(hash);
      setSigningStatus("broadcasted");
    } catch (cause) {
      setSigningError(cause instanceof Error ? cause.message : "Unable to sign or broadcast transaction.");
      setSigningStatus("error");
    }
  }

  async function handleWalletConnectPair() {
    setWalletConnectStatus("pairing");
    setWalletConnectMessage(null);

    try {
      if (!wallet) {
        throw new Error("Create or unlock a wallet before pairing WalletConnect.");
      }

      const settings = await readWalletConnectSettings();

      if (!settings.projectId.trim()) {
        throw new Error("Set WalletConnect Project ID in Network Settings first.");
      }

      const response = await sendRuntimeMessage<{ result?: { pairings: number; sessions: number }; error?: { message: string } }>({
        type: "walletconnect_pair",
        uri: walletConnectUri.trim()
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      setWalletConnectStatus("paired");
      setWalletConnectMessage(`Pairing sent. Active pairings: ${response.result?.pairings ?? 0}`);
      await refreshWalletConnectSessions();
    } catch (cause) {
      setWalletConnectStatus("error");
      setWalletConnectMessage(cause instanceof Error ? cause.message : "Unable to pair WalletConnect URI.");
    }
  }

  async function refreshWalletConnectSessions() {
    setWalletConnectSessionsStatus("loading");
    setWalletConnectSessionsError(null);

    try {
      const response = await sendRuntimeMessage<{
        result?: { sessions: WalletConnectSessionSummary[] };
        error?: { message: string };
      }>({
        type: "walletconnect_sessions"
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      setWalletConnectSessions(response.result?.sessions ?? []);
      setWalletConnectSessionsStatus("ready");
    } catch (cause) {
      setWalletConnectSessionsError(cause instanceof Error ? cause.message : "Unable to load WalletConnect sessions.");
      setWalletConnectSessionsStatus("error");
    }
  }

  async function handleWalletConnectDisconnect(topic: string) {
    setDisconnectingTopic(topic);
    setWalletConnectSessionsError(null);

    try {
      const response = await sendRuntimeMessage<{
        result?: { sessions: WalletConnectSessionSummary[] };
        error?: { message: string };
      }>({
        type: "walletconnect_disconnect",
        topic
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      setWalletConnectSessions(response.result?.sessions ?? []);
      setWalletConnectSessionsStatus("ready");
    } catch (cause) {
      setWalletConnectSessionsError(cause instanceof Error ? cause.message : "Unable to disconnect WalletConnect session.");
      setWalletConnectSessionsStatus("error");
    } finally {
      setDisconnectingTopic(null);
    }
  }

  return (
    <main className="wallet-shell">
      <section className="topbar" aria-label="Wallet status">
        <div className="brand-mark" aria-hidden="true">
          <KeyRound size={18} />
        </div>
        <div>
          <p className="eyebrow">Passkey Wallet</p>
          <h1>Chrome Extension MVP</h1>
        </div>
        <button type="button" className="settings-icon-button" onClick={openSettingsPage} title="Network settings">
          <Settings2 size={17} />
        </button>
      </section>

      <section className="balance-panel">
        <div className="panel-header">
          <div>
            <span className="muted">Multi-chain portfolio</span>
            <h2>{displayAddress}</h2>
          </div>
          <div className={`status-pill ${wallet ? "ready" : ""}`}>
            {wallet ? <Check size={14} /> : <ShieldCheck size={14} />}
            {wallet ? "Ready" : "Locked"}
          </div>
        </div>

        <div className="balance-value">
          <span>{displayPortfolioTotal}</span>
          <small>USD</small>
        </div>

        <div className="action-row">
          <button type="button" className="icon-action" disabled={!wallet} onClick={() => setReceiveOpen((open) => !open)} title="Receive">
            <QrCode size={18} />
            <span>Receive</span>
          </button>
          <button type="button" className="icon-action" disabled={!wallet} title="Send transaction">
            <Send size={18} />
            <span>Send</span>
          </button>
        </div>

        {portfolioError ? <p className="inline-error">{portfolioError}</p> : null}
      </section>

      {wallet ? (
        <PortfolioPanel
          snapshots={chainSnapshots}
          selectedChain={selectedChain}
          loading={portfolioStatus === "loading"}
          onRefresh={handleRefreshPortfolio}
          onSelect={(networkId) => setSelectedChainId(networkId)}
        />
      ) : null}

      {wallet && receiveOpen ? (
        <section className="receive-panel" aria-label="Receive ETH">
          <div className="resolver-heading">
            <div>
              <span className="muted">Receive</span>
              <h3>Ethereum address</h3>
            </div>
            <QrCode size={16} />
          </div>

          <div className="qr-wrap">
            <QRCodeSVG value={wallet.address} size={176} marginSize={2} level="M" />
          </div>

          <div className="receive-address">
            <span>{wallet.address}</span>
            <button type="button" className="mini-copy" onClick={handleCopy}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </section>
      ) : null}

      <section className="setup-panel">
        <div className="setup-copy">
          <Wallet size={22} />
          <div>
            <h3>{wallet ? "Wallet created" : "Create your wallet"}</h3>
            <p>
              {wallet
                ? "The encrypted tcx-wasm keystore is stored locally and unlocked by the passkey PRF."
                : "Create a local HD wallet encrypted with a WebAuthn PRF key from your passkey."}
            </p>
          </div>
        </div>

        {!wallet ? (
          <button type="button" className="primary-button" disabled={status === "creating"} onClick={handleCreateWallet}>
            {status === "creating" ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />}
            {status === "creating" ? "Creating..." : "Create with Passkey"}
          </button>
        ) : (
          <button type="button" className="secondary-button" onClick={handleReset}>
            <RefreshCcw size={18} />
            Reset local wallet
          </button>
        )}
      </section>

      <section className="resolver-panel" aria-label="Recipient resolver">
        <div className="resolver-heading">
          <div>
            <span className="muted">ENS v2-ready resolver</span>
            <h3>Recipient</h3>
          </div>
          {resolverStatus === "resolving" ? <Loader2 className="spin" size={16} /> : <Search size={16} />}
        </div>

        <label className="recipient-field">
          <span>Address or ENS</span>
          <input
            type="text"
            value={recipientInput}
            onChange={(event) => setRecipientInput(event.target.value)}
            placeholder="vitalik.eth or 0x..."
            spellCheck={false}
          />
        </label>

        <ResolverResult resolution={recipientResolution} />
      </section>

      <section className="resolver-panel" aria-label="WalletConnect">
        <div className="resolver-heading">
          <div>
            <span className="muted">WalletConnect v2</span>
            <h3>Dapp Pairing</h3>
          </div>
          <Settings2 size={16} />
        </div>

        <label className="recipient-field">
          <span>Pairing URI</span>
          <input
            type="text"
            value={walletConnectUri}
            onChange={(event) => {
              setWalletConnectUri(event.target.value);
              setWalletConnectStatus("idle");
              setWalletConnectMessage(null);
            }}
            placeholder="wc:..."
            spellCheck={false}
          />
        </label>

        <button
          type="button"
          className="secondary-button"
          disabled={!walletConnectUri.trim() || walletConnectStatus === "pairing"}
          onClick={handleWalletConnectPair}
        >
          {walletConnectStatus === "pairing" ? <Loader2 className="spin" size={17} /> : <Settings2 size={17} />}
          {walletConnectStatus === "pairing" ? "Pairing..." : "Pair WalletConnect"}
        </button>

        {walletConnectMessage ? (
          <p className={walletConnectStatus === "error" ? "resolver-result invalid" : "resolver-result valid"}>
            {walletConnectMessage}
          </p>
        ) : null}

        <WalletConnectSessionsPanel
          sessions={walletConnectSessions}
          status={walletConnectSessionsStatus}
          error={walletConnectSessionsError}
          disconnectingTopic={disconnectingTopic}
          onRefresh={refreshWalletConnectSessions}
          onDisconnect={handleWalletConnectDisconnect}
        />
      </section>

      <section className="send-panel" aria-label="Send native token">
        <div className="resolver-heading">
          <div>
            <span className="muted">Clear Signing</span>
            <h3>Send {selectedSendNetwork?.nativeCurrencySymbol ?? "Token"}</h3>
          </div>
          <FileCheck2 size={16} />
        </div>

        <label className="recipient-field">
          <span>Network</span>
          <select
            className="network-select"
            value={selectedSendNetwork?.networkId ?? ""}
            onChange={(event) => setSelectedSendNetworkId(event.target.value || null)}
          >
            {sendNetworks.length > 0 ? (
              sendNetworks.map((network) => (
                <option value={network.networkId} key={network.networkId}>
                  {network.name} - {network.nativeCurrencySymbol}
                </option>
              ))
            ) : (
              <option value="">No enabled EVM networks</option>
            )}
          </select>
        </label>

        <label className="recipient-field">
          <span>Amount</span>
          <div className="amount-input">
            <input
              type="text"
              inputMode="decimal"
              value={amountInput}
              onChange={(event) => setAmountInput(event.target.value)}
              placeholder="0.05"
              spellCheck={false}
            />
            <strong>{selectedSendNetwork?.nativeCurrencySymbol ?? "TOKEN"}</strong>
          </div>
        </label>

        <ClearSigningPreviewCard result={previewResult} feeStatus={feeStatus} feeError={feeError} />

        <button
          type="button"
          className="primary-button"
          disabled={
            !previewResult.ok ||
            !canSignPreview(previewResult.preview) ||
            signingStatus === "signing" ||
            signingStatus === "broadcasting" ||
            signingStatus === "broadcasted"
          }
          onClick={handlePreviewAction}
        >
          {signingStatus === "signing" || signingStatus === "broadcasting" ? (
            <Loader2 className="spin" size={18} />
          ) : signingStatus === "broadcasted" ? (
            <Check size={18} />
          ) : previewAccepted ? (
            <KeyRound size={18} />
          ) : (
            <ShieldCheck size={18} />
          )}
          {signingStatus === "signing"
            ? "Signing..."
            : signingStatus === "broadcasting"
              ? "Broadcasting..."
              : signingStatus === "broadcasted"
                ? "Transaction broadcast"
              : previewAccepted
                ? "Unlock passkey, sign & broadcast"
                : "Confirm preview"}
        </button>

        {signatureResult ? (
          <div className="signature-box">
            <span>Signed transaction hash</span>
            <strong>{signatureResult.txHash}</strong>
          </div>
        ) : null}

        {broadcastHash ? (
          <div className="signature-box broadcasted">
            <span>Broadcast hash</span>
            <strong>{broadcastHash}</strong>
            {broadcastExplorerUrl ? (
              <a href={broadcastExplorerUrl} target="_blank" rel="noreferrer">
                View on explorer
              </a>
            ) : null}
          </div>
        ) : null}

        {signingError ? <p className="resolver-result invalid">{signingError}</p> : null}
      </section>

      {error ? <p className="error-box">{error}</p> : null}
    </main>
  );
}

function PortfolioPanel({
  snapshots,
  selectedChain,
  loading,
  onRefresh,
  onSelect
}: {
  snapshots: ChainAssetSnapshot[];
  selectedChain: ChainAssetSnapshot | null;
  loading: boolean;
  onRefresh: () => void;
  onSelect: (networkId: string) => void;
}) {
  return (
    <section className="portfolio-panel" aria-label="Multi-chain assets">
      <div className="resolver-heading">
        <div>
          <span className="muted">Assets</span>
          <h3>Enabled networks</h3>
        </div>
        <button type="button" className="mini-icon-button" disabled={loading} onClick={onRefresh} title="Refresh assets">
          <RefreshCcw className={loading ? "spin" : undefined} size={15} />
        </button>
      </div>

      {snapshots.length > 0 ? (
        <div className="chain-list">
          {snapshots.map((snapshot) => (
            <button
              type="button"
              className={`chain-row ${selectedChain?.networkId === snapshot.networkId ? "selected" : ""}`}
              key={snapshot.networkId}
              onClick={() => onSelect(snapshot.networkId)}
            >
              <div>
                <strong>{snapshot.networkName}</strong>
                <span>{chainStatusLabel(snapshot)}</span>
              </div>
              <div>
                <strong>{formatUsd(snapshot.totalValueUsd)}</strong>
                <span>
                  {snapshot.nativeBalance ? formatTokenAmount(snapshot.nativeBalance) : "--"} {snapshot.nativeCurrencySymbol}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <p className="resolver-hint">Enable networks in Settings, then refresh assets.</p>
      )}

      {selectedChain ? <ChainAssetDetail snapshot={selectedChain} /> : null}
    </section>
  );
}

function ChainAssetDetail({ snapshot }: { snapshot: ChainAssetSnapshot }) {
  return (
    <div className="chain-detail">
      <div className="preview-row">
        <span>Network</span>
        <div>
          <strong>{snapshot.networkName}</strong>
          <small>{snapshot.chainId ? `Chain ID ${snapshot.chainId}` : snapshot.family}</small>
        </div>
      </div>
      <div className="preview-row">
        <span>Native asset</span>
        <div>
          <strong>
            {snapshot.nativeBalance ? formatTokenAmount(snapshot.nativeBalance) : "--"} {snapshot.nativeCurrencySymbol}
          </strong>
          <small>{formatUsd(snapshot.totalValueUsd)}</small>
        </div>
      </div>
      <div className="preview-row">
        <span>Status</span>
        <div>
          <strong>{chainStatusLabel(snapshot)}</strong>
          {snapshot.error ? <small>{snapshot.error}</small> : null}
        </div>
      </div>
    </div>
  );
}

function chainStatusLabel(snapshot: ChainAssetSnapshot): string {
  if (snapshot.status === "ready" && snapshot.totalValueUsd === null) {
    return "Balance ready, price unavailable";
  }

  if (snapshot.status === "ready") {
    return "Ready";
  }

  if (snapshot.status === "unsupported") {
    return "Adapter pending";
  }

  return snapshot.status === "error" ? "Refresh failed" : "Refreshing";
}

function WalletConnectSessionsPanel({
  sessions,
  status,
  error,
  disconnectingTopic,
  onRefresh,
  onDisconnect
}: {
  sessions: WalletConnectSessionSummary[];
  status: WalletConnectSessionsStatus;
  error: string | null;
  disconnectingTopic: string | null;
  onRefresh: () => void;
  onDisconnect: (topic: string) => void;
}) {
  return (
    <div className="wc-session-panel">
      <div className="wc-session-heading">
        <div>
          <span>Connected dapps</span>
          <strong>{sessions.length}</strong>
        </div>
        <button type="button" className="mini-icon-button" disabled={status === "loading"} onClick={onRefresh} title="Refresh sessions">
          <RefreshCcw className={status === "loading" ? "spin" : undefined} size={15} />
        </button>
      </div>

      {sessions.length > 0 ? (
        <div className="wc-session-list">
          {sessions.map((session) => (
            <div className="wc-session-row" key={session.topic}>
              <div className="wc-session-icon" aria-hidden="true">
                {session.icons[0] ? <img src={session.icons[0]} alt="" /> : <Settings2 size={16} />}
              </div>
              <div className="wc-session-main">
                <strong>{session.name}</strong>
                <span>{session.url || "No origin provided"}</span>
                <small>{walletConnectSessionMeta(session)}</small>
              </div>
              <button
                type="button"
                className="wc-disconnect"
                disabled={disconnectingTopic === session.topic}
                onClick={() => onDisconnect(session.topic)}
                title="Disconnect dapp"
              >
                {disconnectingTopic === session.topic ? <Loader2 className="spin" size={15} /> : <Unplug size={15} />}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="resolver-hint">
          {status === "loading" ? "Loading connected dapps." : "No active WalletConnect sessions."}
        </p>
      )}

      {error ? <p className="resolver-result invalid">{error}</p> : null}
    </div>
  );
}

function walletConnectSessionMeta(session: WalletConnectSessionSummary): string {
  const chainLabel = session.chains.length > 0 ? session.chains.join(", ") : "No chains";
  const accountLabel = session.accounts.length === 1 ? "1 account" : `${session.accounts.length} accounts`;
  const expiry = session.expiry ? new Date(session.expiry * 1000).toLocaleDateString() : null;

  return expiry ? `${chainLabel} - ${accountLabel} - expires ${expiry}` : `${chainLabel} - ${accountLabel}`;
}

function ResolverResult({ resolution }: { resolution: RecipientResolution }) {
  if (resolution.kind === "empty") {
    return <p className="resolver-hint">Universal Resolver with CCIP Read gateway support.</p>;
  }

  if (resolution.kind === "invalid") {
    return <p className="resolver-result invalid">{resolution.reason}</p>;
  }

  const title = resolution.kind === "ens" ? resolution.normalizedName : (resolution.primaryName ?? "Ethereum address");

  return (
    <div className="resolver-result valid">
      <div>
        <span>{title}</span>
        <strong>{formatAddress(resolution.address)}</strong>
      </div>
      <Check size={16} />
    </div>
  );
}

function ClearSigningPreviewCard({
  result,
  feeStatus,
  feeError
}: {
  result: ReturnType<typeof buildNativeEthTransferPreview>;
  feeStatus: FeeStatus;
  feeError: string | null;
}) {
  if (!result.ok) {
    return <p className="resolver-hint">{result.reason}</p>;
  }

  const preview = result.preview;

  return (
    <div className="preview-card">
      <div className="preview-hero">
        <span>{preview.title}</span>
        <strong>
          {preview.amount} {preview.asset}
        </strong>
      </div>

      <PreviewRow label="Recipient" value={preview.recipientLabel} detail={formatAddress(preview.to)} />
      <PreviewRow label="From" value={formatAddress(preview.from)} />
      <PreviewRow label="Network" value={preview.networkName} detail={`Chain ID ${preview.chainId}`} />
      <PreviewRow label="Contract data" value={preview.data} detail="Native ETH transfer" />
      <PreviewRow label="Network fee" value={preview.estimatedNetworkFee} />
      <PreviewRow
        label="Gas"
        value={preview.gasLimit ? preview.gasLimit.toString() : feeStatus === "estimating" ? "Estimating" : "Pending"}
        detail={preview.nonce !== null ? `Nonce ${preview.nonce.toString()}` : undefined}
      />

      <div className="warning-list">
        {feeError ? (
          <div className="warning-item danger">
            <AlertTriangle size={14} />
            <span>{feeError}</span>
          </div>
        ) : null}
        {preview.warnings.map((warning) => (
          <div className={`warning-item ${warning.severity}`} key={warning.message}>
            <AlertTriangle size={14} />
            <span>{warning.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="preview-row">
      <span>{label}</span>
      <div>
        <strong>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </div>
  );
}
