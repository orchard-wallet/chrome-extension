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
  Wallet
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { buildNativeEthTransferPreview, canSignPreview } from "../core/clearSigning";
import { resolveRecipient, type RecipientResolution } from "../core/ens";
import {
  broadcastSignedTransaction,
  estimateNativeEthTransfer,
  getEthBalance,
  type EthBalance,
  type TransactionFeeEstimate
} from "../core/rpc";
import { createEthereumPasskeyWallet, signEthereumTransfer, type EthereumSignResult } from "../core/tcx";
import { createPasskeyPrf, unlockPasskeyPrf } from "../core/webauthn";
import { clearWalletRecord, readWalletRecord, WalletRecord, writeWalletRecord } from "../lib/storage";

type Status = "idle" | "creating" | "ready" | "error";
type ResolverStatus = "idle" | "resolving";
type FeeStatus = "idle" | "estimating" | "ready" | "error";
type SigningStatus = "idle" | "signing" | "broadcasting" | "broadcasted" | "error";
type BalanceStatus = "idle" | "loading" | "ready" | "error";

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

export function App() {
  const [wallet, setWallet] = useState<WalletRecord | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [balanceStatus, setBalanceStatus] = useState<BalanceStatus>("idle");
  const [balance, setBalance] = useState<EthBalance | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [resolverStatus, setResolverStatus] = useState<ResolverStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [recipientInput, setRecipientInput] = useState("");
  const [recipientResolution, setRecipientResolution] = useState<RecipientResolution>({ kind: "empty", input: "" });
  const [amountInput, setAmountInput] = useState("");
  const [feeStatus, setFeeStatus] = useState<FeeStatus>("idle");
  const [feeEstimate, setFeeEstimate] = useState<TransactionFeeEstimate | null>(null);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [previewAccepted, setPreviewAccepted] = useState(false);
  const [signingStatus, setSigningStatus] = useState<SigningStatus>("idle");
  const [signingError, setSigningError] = useState<string | null>(null);
  const [signatureResult, setSignatureResult] = useState<EthereumSignResult | null>(null);
  const [broadcastHash, setBroadcastHash] = useState<string | null>(null);

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

  const displayAddress = useMemo(() => (wallet ? formatAddress(wallet.address) : "No wallet yet"), [wallet]);
  const displayBalance = useMemo(() => {
    if (!wallet) {
      return "0.00";
    }

    if (balanceStatus === "loading") {
      return "Loading";
    }

    if (!balance) {
      return "--";
    }

    const numericBalance = Number(balance.eth);

    if (!Number.isFinite(numericBalance)) {
      return balance.eth;
    }

    if (numericBalance === 0) {
      return "0.00";
    }

    if (numericBalance < 0.0001) {
      return "<0.0001";
    }

    return numericBalance.toLocaleString(undefined, {
      maximumFractionDigits: 4
    });
  }, [balance, balanceStatus, wallet]);
  const previewResult = useMemo(
    () =>
      buildNativeEthTransferPreview({
        from: wallet ? (wallet.address as Address) : null,
        recipient: recipientResolution,
        amountEth: amountInput,
        feeEstimate
      }),
    [amountInput, feeEstimate, recipientResolution, wallet]
  );

  const basePreviewResult = useMemo(
    () =>
      buildNativeEthTransferPreview({
        from: wallet ? (wallet.address as Address) : null,
        recipient: recipientResolution,
        amountEth: amountInput
      }),
    [amountInput, recipientResolution, wallet]
  );

  useEffect(() => {
    setPreviewAccepted(false);
    setSigningStatus("idle");
    setSigningError(null);
    setSignatureResult(null);
    setBroadcastHash(null);
  }, [amountInput, feeEstimate, recipientResolution]);

  useEffect(() => {
    let cancelled = false;

    setBalance(null);
    setBalanceError(null);

    if (!wallet) {
      setBalanceStatus("idle");
      return () => {
        cancelled = true;
      };
    }

    setBalanceStatus("loading");

    getEthBalance(wallet.address as Address)
      .then((nextBalance) => {
        if (!cancelled) {
          setBalance(nextBalance);
          setBalanceStatus("ready");
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setBalanceError(cause instanceof Error ? cause.message : "Unable to load ETH balance.");
          setBalanceStatus("error");
        }
      });

    return () => {
      cancelled = true;
    };
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
      value: basePreviewResult.preview.amountWei
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
  }, [basePreviewResult]);

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

      const hash = await broadcastSignedTransaction(result.serializedTransaction);
      setBroadcastHash(hash);
      setSigningStatus("broadcasted");
    } catch (cause) {
      setSigningError(cause instanceof Error ? cause.message : "Unable to sign or broadcast transaction.");
      setSigningStatus("error");
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
            <span className="muted">Ethereum Mainnet</span>
            <h2>{displayAddress}</h2>
          </div>
          <div className={`status-pill ${wallet ? "ready" : ""}`}>
            {wallet ? <Check size={14} /> : <ShieldCheck size={14} />}
            {wallet ? "Ready" : "Locked"}
          </div>
        </div>

        <div className="balance-value">
          <span>{displayBalance}</span>
          <small>ETH</small>
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

        {balanceError ? <p className="inline-error">{balanceError}</p> : null}
      </section>

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

      <section className="send-panel" aria-label="Send ETH">
        <div className="resolver-heading">
          <div>
            <span className="muted">Clear Signing</span>
            <h3>Send ETH</h3>
          </div>
          <FileCheck2 size={16} />
        </div>

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
            <strong>ETH</strong>
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
            <a href={`https://etherscan.io/tx/${broadcastHash}`} target="_blank" rel="noreferrer">
              View on Etherscan
            </a>
          </div>
        ) : null}

        {signingError ? <p className="resolver-result invalid">{signingError}</p> : null}
      </section>

      {error ? <p className="error-box">{error}</p> : null}
    </main>
  );
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
