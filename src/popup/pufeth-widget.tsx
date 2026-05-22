import { AlertTriangle, ArrowRight, Check, Database, KeyRound, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPublicClient, encodeFunctionData, http, parseEther, type Address } from "viem";
import { mainnet } from "viem/chains";
import type { ActivityEventInput } from "../core/activity";
import { buildPufferDepositPreview, type PufferDepositPreview } from "../core/clearSigning";
import type { WalletNetworkSetting } from "../core/networks";
import {
  fetchPufETHRate,
  fetchPufferApy,
  PUFFER_DEPOSIT_ABI,
  PUFFER_DEPOSIT_NETWORK_ID,
  PUFFER_VAULT_MAINNET
} from "../core/puffer";
import { broadcastSignedTransaction } from "../core/rpc";
import { signEthereumTransaction } from "../core/tcx";
import { unlockPasskeyPrf } from "../core/webauthn";
import type { WalletRecord } from "../lib/storage";

// Local copy of formatAddress — consistent with the duplicate already present
// in both App.tsx and SettingsApp.tsx.
function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Local copy of PreviewRow — the original in App.tsx is used 26× there and
// stays; this copy keeps pufeth-widget.tsx self-contained.
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

export function PufETHWidget({
  wallet,
  network,
  ethBalance,
  onConverted,
  onDone
}: {
  wallet: WalletRecord | null;
  network: WalletNetworkSetting | null;
  ethBalance: string | null;
  onConverted?: (event: ActivityEventInput) => void;
  onDone?: () => void;
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

    let ethAmountWei: bigint;
    try {
      ethAmountWei = parseEther(amount);
    } catch {
      setError(t("popup:pufeth.errors.convert"));
      setPhase("error");
      return;
    }

    setPreview(
      buildPufferDepositPreview({
        from: wallet.address as Address,
        vaultAddress: PUFFER_VAULT_MAINNET,
        ethAmount: amount,
        ethAmountWei,
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
      // The Puffer SDK's transact() forces viem's JSON-RPC eth_sendTransaction
      // path, which cannot use this wallet's passkey/tcx signer. So build the
      // depositETH call ourselves and run it through the wallet's own pipeline.
      const from = wallet.address as Address;
      const publicClient = createPublicClient({ chain: mainnet, transport: http(network.selectedRpcUrl) });
      const data = encodeFunctionData({
        abi: PUFFER_DEPOSIT_ABI,
        functionName: "depositETH",
        args: [from]
      });

      const [nonce, fees, gasLimit] = await Promise.all([
        publicClient.getTransactionCount({ address: from, blockTag: "pending" }),
        publicClient.estimateFeesPerGas(),
        publicClient.estimateGas({ account: from, to: PUFFER_VAULT_MAINNET, value: preview.ethAmountWei, data })
      ]);

      const prfKey = await unlockPasskeyPrf(wallet.credentialId);
      const signed = await signEthereumTransaction({
        keystoreJson: wallet.keystoreJson,
        key: prfKey,
        derivationPath: wallet.derivationPath,
        tx: {
          nonce,
          gasLimit,
          to: PUFFER_VAULT_MAINNET,
          value: preview.ethAmountWei,
          data,
          chainId: mainnet.id,
          maxFeePerGas: fees.maxFeePerGas,
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas
        }
      });

      const hash = await broadcastSignedTransaction(signed.serializedTransaction, network);

      setTxHash(hash);
      setPhase("success");
      onConverted?.({
        type: "transaction_broadcasted",
        title: t("popup:pufeth.successTitle"),
        detail: preview.estimatedPufEth
          ? t("popup:pufeth.estimate", { amount: preview.estimatedPufEth })
          : t("popup:pufeth.successDetail"),
        severity: "success",
        amount: {
          value: preview.ethAmount,
          symbol: "ETH",
          direction: "out"
        },
        networkName: preview.networkName,
        txHash: hash
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("popup:pufeth.errors.convert"));
      setPhase("error");
    }
  }

  if (phase === "preview" && preview) {
    return (
      <div className="clear-signing-sheet pufeth-preview" role="region" aria-label={t("popup:pufeth.previewTitle")}>
        <div className="preview-hero">
          <span className="preview-direction" aria-hidden="true">
            <ArrowRight size={18} />
          </span>
          <span>{preview.title}</span>
          <strong>{preview.ethAmount} ETH</strong>
          <small>{preview.networkName}</small>
        </div>
        <PreviewRow label={t("popup:pufeth.pay")} value={`${preview.ethAmount} ETH`} />
        <PreviewRow
          label={t("popup:pufeth.receive")}
          value={preview.estimatedPufEth ? t("popup:pufeth.estimate", { amount: preview.estimatedPufEth }) : "≈ — pufETH"}
        />
        <PreviewRow label={t("popup:pufeth.networkFee")} value={t("popup:clearSigning.pending")} detail={preview.networkName} />
        <PreviewRow label={t("popup:clearSigning.from")} value={formatAddress(preview.from)} detail={formatAddress(preview.vaultAddress)} />
        <div className="warning-list">
          {preview.warnings.map((warning) => (
            <div className={`warning-item ${warning.severity}`} key={warning.message}>
              <AlertTriangle size={14} />
              <span>{warning.message}</span>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="primary-button"
          onClick={() => void handleConfirm()}
        >
          <KeyRound size={18} />
          {t("popup:pufeth.confirm")}
        </button>
        <button
          type="button"
          className="clear-signing-cancel"
          onClick={() => setPhase("input")}
        >
          {t("common:actions.cancel")}
        </button>
      </div>
    );
  }

  if (phase === "signing") {
    return (
      <div className="clear-signing-sheet pufeth-signing" role="status">
        <div className="preview-hero">
          <Loader2 className="spin" size={32} />
          <span>{t("popup:pufeth.signing")}</span>
        </div>
      </div>
    );
  }

  if (phase === "success") {
    return (
      <div className="clear-signing-sheet pufeth-success" role="status">
        <div className="preview-hero">
          <Check size={32} />
          <span>{t("popup:pufeth.successTitle")}</span>
          <small>{t("popup:pufeth.successDetail")}</small>
        </div>
        {txHash ? (
          <a
            href={`https://etherscan.io/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="primary-button"
          >
            {t("popup:pufeth.viewTx")}
          </a>
        ) : null}
        <button
          type="button"
          className="clear-signing-cancel"
          onClick={() => {
            setPhase("input");
            setAmount("");
            setTxHash(null);
            setPreview(null);
            setError(null);
            onDone?.();
          }}
        >
          {t("common:actions.done")}
        </button>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="clear-signing-sheet pufeth-error" role="alert">
        <div className="warning-list">
          <div className="warning-item danger">
            <AlertTriangle size={14} />
            <span>{error ?? t("popup:pufeth.errors.convert")}</span>
          </div>
        </div>
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            setPhase("input");
            setPreview(null);
            setError(null);
          }}
        >
          {t("common:actions.retry")}
        </button>
      </div>
    );
  }

  // input phase — compact portal widget design
  return (
    <div className="pufeth-widget" role="region" aria-label={t("popup:pufeth.widgetTitle")}>
      <div className="pufeth-widget-header">
        <span className="pufeth-widget-icon" aria-hidden="true">
          <Database size={16} />
        </span>
        <div className="pufeth-widget-title">
          <strong>{t("popup:pufeth.widgetTitle")}</strong>
          <small>{t("popup:pufeth.stakeEth")}</small>
        </div>
      </div>

      {!isMainnet ? (
        <p className="inline-error pufeth-widget-error">{t("popup:pufeth.wrongNetwork")}</p>
      ) : (
        <div className="pufeth-widget-body">
          <div className="pufeth-widget-amount-row">
            <input
              type="number"
              min="0"
              step="any"
              placeholder={t("popup:pufeth.amountPlaceholder")}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="pufeth-widget-amount-input"
              aria-label={t("popup:pufeth.amountLabel")}
            />
            <button
              type="button"
              className="pufeth-widget-max"
              onClick={handleMax}
              disabled={!wallet || ethBalance == null}
            >
              {t("popup:pufeth.max")}
            </button>
            <button
              type="button"
              className="pufeth-widget-mint"
              disabled={!wallet || !amount || Number(amount) <= 0 || insufficient}
              onClick={handleConvert}
            >
              {t("popup:pufeth.mint")}
            </button>
          </div>

          {insufficient ? (
            <p className="inline-error pufeth-widget-insufficient">{t("popup:pufeth.insufficient")}</p>
          ) : estimatedPufEth ? (
            <small className="pufeth-widget-estimate">
              {t("popup:pufeth.estimate", { amount: estimatedPufEth })}
            </small>
          ) : null}
        </div>
      )}
    </div>
  );
}
