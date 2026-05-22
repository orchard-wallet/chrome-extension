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
