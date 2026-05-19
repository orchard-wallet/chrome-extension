import { formatEther, parseEther, type Address } from "viem";
import type { RecipientResolution } from "./ens";
import type { TransactionFeeEstimate } from "./rpc";

export type PreviewSeverity = "info" | "warning" | "danger";

export interface PreviewWarning {
  severity: PreviewSeverity;
  message: string;
}

export interface ClearSigningPreview {
  action: "send-native-token";
  title: string;
  chainId: 1;
  networkName: "Ethereum Mainnet";
  from: Address;
  to: Address;
  recipientLabel: string;
  recipientSource: "ens" | "address";
  asset: "ETH";
  amountWei: bigint;
  amount: string;
  data: "0x";
  nonce: bigint | null;
  gasLimit: bigint | null;
  maxFeePerGas: bigint | null;
  maxPriorityFeePerGas: bigint | null;
  estimatedNetworkFee: string;
  warnings: PreviewWarning[];
}

export type ClearSigningPreviewResult =
  | {
      ok: true;
      preview: ClearSigningPreview;
    }
  | {
      ok: false;
      reason: string;
    };

function normalizeAmountInput(amount: string): string {
  return amount.trim().replace(",", ".");
}

function recipientLabel(recipient: RecipientResolution): string {
  if (recipient.kind === "ens") {
    return recipient.normalizedName;
  }

  if (recipient.kind === "address") {
    return recipient.primaryName ?? "Ethereum address";
  }

  return "Unknown recipient";
}

export function buildNativeEthTransferPreview(input: {
  from: Address | null;
  recipient: RecipientResolution;
  amountEth: string;
  feeEstimate?: TransactionFeeEstimate | null;
}): ClearSigningPreviewResult {
  if (!input.from) {
    return { ok: false, reason: "Create or unlock a wallet before sending." };
  }

  if (input.recipient.kind === "empty") {
    return { ok: false, reason: "Enter a recipient address or ENS name." };
  }

  if (input.recipient.kind === "invalid") {
    return { ok: false, reason: input.recipient.reason };
  }

  const normalizedAmount = normalizeAmountInput(input.amountEth);

  if (!normalizedAmount) {
    return { ok: false, reason: "Enter an amount." };
  }

  let amountWei: bigint;

  try {
    amountWei = parseEther(normalizedAmount);
  } catch {
    return { ok: false, reason: "Enter a valid ETH amount." };
  }

  if (amountWei <= 0n) {
    return { ok: false, reason: "Amount must be greater than 0." };
  }

  const warnings: PreviewWarning[] = input.feeEstimate
    ? [
        {
          severity: "info",
          message: "Review the recipient, amount, network, and fee before signing with your passkey."
        }
      ]
    : [
        {
          severity: "info",
          message: "Network fee is not estimated yet. This preview only covers transaction intent."
        }
      ];

  if (input.recipient.kind === "address" && !input.recipient.primaryName) {
    warnings.push({
      severity: "warning",
      message: "Recipient was entered as a raw address. Verify it out-of-band before signing."
    });
  }

  if (input.recipient.primaryName && input.recipient.primaryName !== recipientLabel(input.recipient)) {
    warnings.push({
      severity: "info",
      message: `Reverse ENS points to ${input.recipient.primaryName}.`
    });
  }

  return {
    ok: true,
    preview: {
      action: "send-native-token",
      title: "Send ETH",
      chainId: 1,
      networkName: "Ethereum Mainnet",
      from: input.from,
      to: input.recipient.address,
      recipientLabel: recipientLabel(input.recipient),
      recipientSource: input.recipient.kind,
      asset: "ETH",
      amountWei,
      amount: formatEther(amountWei),
      data: "0x",
      nonce: input.feeEstimate?.nonce ?? null,
      gasLimit: input.feeEstimate?.gasLimit ?? null,
      maxFeePerGas: input.feeEstimate?.maxFeePerGas ?? null,
      maxPriorityFeePerGas: input.feeEstimate?.maxPriorityFeePerGas ?? null,
      estimatedNetworkFee: input.feeEstimate ? `${input.feeEstimate.estimatedFeeEth} ETH` : "Pending estimation",
      warnings
    }
  };
}

export function canSignPreview(preview: ClearSigningPreview): boolean {
  return (
    preview.nonce !== null &&
    preview.gasLimit !== null &&
    preview.maxFeePerGas !== null &&
    preview.maxPriorityFeePerGas !== null
  );
}
