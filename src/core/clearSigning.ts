import { formatUnits, isAddress, maxUint256, parseUnits, type Address } from "viem";
import i18n from "../i18n";
import type { RecipientResolution } from "./ens";
import type { WalletNetworkSetting } from "./networks";
import type { TransactionFeeEstimate } from "./rpc";

export type PreviewSeverity = "info" | "warning" | "danger";

export interface PreviewWarning {
  severity: PreviewSeverity;
  message: string;
}

export interface NativeTransferPreview {
  action: "send-native-token";
  title: string;
  networkId: string;
  chainId: number;
  networkName: string;
  from: Address;
  to: Address;
  recipientLabel: string;
  recipientSource: "ens" | "address";
  asset: string;
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

export type ContractCallPreview = {
  action: "contract-call";
  title: string;
  networkId: string;
  chainId: number;
  networkName: string;
  from: Address;
  to: Address;
  data: string;
  warnings: PreviewWarning[];
  supported: false;
};

export type MessageSignaturePreview = {
  action: "sign-message";
  title: string;
  from: Address;
  message: string;
  warnings: PreviewWarning[];
  supported: false;
};

export type ApprovalPreview = {
  action: "token-approval";
  title: string;
  networkId: string;
  chainId: number;
  networkName: string;
  from: Address;
  spender: Address;
  tokenContract: Address;
  scope: "exact" | "unlimited";
  amount: string;
  rawAmount: bigint;
  warnings: PreviewWarning[];
  supported: false;
};

export type ClearSigningPreview = NativeTransferPreview | ContractCallPreview | MessageSignaturePreview | ApprovalPreview;

const ERC20_APPROVE_SELECTOR = "0x095ea7b3";

export type ClearSigningPreviewResult =
  | {
      ok: true;
      preview: NativeTransferPreview;
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
    return recipient.primaryName ?? i18n.t("common:clearSigning.recipient.ethereumAddress");
  }

  return i18n.t("common:clearSigning.recipient.unknown");
}

export function buildNativeEthTransferPreview(input: {
  from: Address | null;
  recipient: RecipientResolution;
  amount: string;
  network: WalletNetworkSetting | null;
  feeEstimate?: TransactionFeeEstimate | null;
}): ClearSigningPreviewResult {
  if (!input.from) {
    return { ok: false, reason: i18n.t("common:clearSigning.validation.noWallet") };
  }

  if (!input.network?.chainId) {
    return { ok: false, reason: i18n.t("common:clearSigning.validation.noNetwork") };
  }

  if (input.recipient.kind === "empty") {
    return { ok: false, reason: i18n.t("common:clearSigning.validation.noRecipient") };
  }

  if (input.recipient.kind === "invalid") {
    return { ok: false, reason: input.recipient.reason };
  }

  const normalizedAmount = normalizeAmountInput(input.amount);

  if (!normalizedAmount) {
    return { ok: false, reason: i18n.t("common:clearSigning.validation.noAmount") };
  }

  let amountWei: bigint;

  try {
    amountWei = parseUnits(normalizedAmount, 18);
  } catch {
    return {
      ok: false,
      reason: i18n.t("common:clearSigning.validation.invalidAmount", {
        symbol: input.network.nativeCurrencySymbol
      })
    };
  }

  if (amountWei <= 0n) {
    return { ok: false, reason: i18n.t("common:clearSigning.validation.amountTooLow") };
  }

  const warnings: PreviewWarning[] = input.feeEstimate
    ? [
        {
          severity: "info",
          message: i18n.t("common:clearSigning.warning.reviewBeforeSigning")
        }
      ]
    : [
        {
          severity: "info",
          message: i18n.t("common:clearSigning.warning.feeNotEstimated")
        }
      ];

  if (input.recipient.kind === "address" && !input.recipient.primaryName) {
    warnings.push({
      severity: "warning",
      message: i18n.t("common:clearSigning.warning.rawAddress")
    });
  }

  if (input.recipient.primaryName && input.recipient.primaryName !== recipientLabel(input.recipient)) {
    warnings.push({
      severity: "info",
      message: i18n.t("common:clearSigning.warning.reverseEns", { name: input.recipient.primaryName })
    });
  }

  return {
    ok: true,
    preview: {
      action: "send-native-token",
      title: i18n.t("common:clearSigning.title.sendNative", {
        symbol: input.network.nativeCurrencySymbol
      }),
      networkId: input.network.networkId,
      chainId: input.network.chainId,
      networkName: input.network.name,
      from: input.from,
      to: input.recipient.address,
      recipientLabel: recipientLabel(input.recipient),
      recipientSource: input.recipient.kind,
      asset: input.network.nativeCurrencySymbol,
      amountWei,
      amount: formatUnits(amountWei, 18),
      data: "0x",
      nonce: input.feeEstimate?.nonce ?? null,
      gasLimit: input.feeEstimate?.gasLimit ?? null,
      maxFeePerGas: input.feeEstimate?.maxFeePerGas ?? null,
      maxPriorityFeePerGas: input.feeEstimate?.maxPriorityFeePerGas ?? null,
      estimatedNetworkFee: input.feeEstimate
        ? `${input.feeEstimate.estimatedFeeNative} ${input.network.nativeCurrencySymbol}`
        : i18n.t("common:clearSigning.fee.pending"),
      warnings
    }
  };
}

export const buildNativeTokenTransferPreview = buildNativeEthTransferPreview;

function decodeApprovalData(data: string): { spender: Address; amount: bigint } | null {
  if (!data.startsWith(ERC20_APPROVE_SELECTOR) || data.length < 138) {
    return null;
  }

  const spenderHex = `0x${data.slice(34, 74)}`;
  const amountHex = `0x${data.slice(74, 138)}`;

  if (!isAddress(spenderHex)) {
    return null;
  }

  try {
    return {
      spender: spenderHex,
      amount: BigInt(amountHex)
    };
  } catch {
    return null;
  }
}

export function buildContractCallPreview(input: {
  from: Address;
  to: Address;
  data: string;
  network: WalletNetworkSetting;
}): ContractCallPreview | ApprovalPreview {
  const approval = decodeApprovalData(input.data);

  if (approval) {
    const unlimited = approval.amount > maxUint256 / 2n;
    return {
      action: "token-approval",
      title: unlimited
        ? i18n.t("common:clearSigning.title.unlimitedTokenApproval")
        : i18n.t("common:clearSigning.title.tokenApproval"),
      networkId: input.network.networkId,
      chainId: input.network.chainId ?? 0,
      networkName: input.network.name,
      from: input.from,
      spender: approval.spender,
      tokenContract: input.to,
      scope: unlimited ? "unlimited" : "exact",
      amount: approval.amount.toString(),
      rawAmount: approval.amount,
      warnings: [
        {
          severity: unlimited ? "danger" : "warning",
          message: unlimited
            ? i18n.t("common:clearSigning.warning.unlimitedApproval")
            : i18n.t("common:clearSigning.warning.exactApproval")
        }
      ],
      supported: false
    };
  }

  return {
    action: "contract-call",
    title: i18n.t("common:clearSigning.title.unsupportedContractCall"),
    networkId: input.network.networkId,
    chainId: input.network.chainId ?? 0,
    networkName: input.network.name,
    from: input.from,
    to: input.to,
    data: input.data,
    warnings: [
      {
        severity: "danger",
        message: i18n.t("common:clearSigning.warning.unsupportedContractCall")
      }
    ],
    supported: false
  };
}

export function buildMessageSignaturePreview(input: {
  from: Address;
  message: string;
}): MessageSignaturePreview {
  return {
    action: "sign-message",
    title: i18n.t("common:clearSigning.title.unsupportedMessageSignature"),
    from: input.from,
    message: input.message,
    warnings: [
      {
        severity: "danger",
        message: i18n.t("common:clearSigning.warning.unsupportedMessage")
      }
    ],
    supported: false
  };
}

export function buildWalletConnectRequestPreview(input: {
  method: string;
  params: unknown[];
  from: Address;
  network: WalletNetworkSetting;
}): ClearSigningPreview {
  if (input.method === "eth_sendTransaction" || input.method === "eth_signTransaction") {
    const tx = input.params[0] as { from?: string; to?: string; data?: string; value?: string } | undefined;

    if (tx?.to && isAddress(tx.to)) {
      return buildContractCallPreview({
        from: isAddress(tx.from ?? "") ? (tx.from as Address) : input.from,
        to: tx.to as Address,
        data: tx.data ?? "0x",
        network: input.network
      });
    }
  }

  if (input.method === "personal_sign" || input.method === "eth_sign") {
    return buildMessageSignaturePreview({
      from: input.from,
      message: String(input.params[0] ?? "")
    });
  }

  if (input.method.startsWith("eth_signTypedData")) {
    return buildMessageSignaturePreview({
      from: input.from,
      message: i18n.t("common:clearSigning.message.typedDataRequest")
    });
  }

  return {
    action: "contract-call",
    title: i18n.t("common:clearSigning.title.unsupportedWalletConnect"),
    networkId: input.network.networkId,
    chainId: input.network.chainId ?? 0,
    networkName: input.network.name,
    from: input.from,
    to: input.from,
    data: "0x",
    warnings: [
      {
        severity: "danger",
        message: i18n.t("common:clearSigning.warning.unsupportedMethod", { method: input.method })
      }
    ],
    supported: false
  };
}

export function canSignPreview(preview: ClearSigningPreview): boolean {
  return preview.action === "send-native-token" && (
    preview.nonce !== null &&
    preview.gasLimit !== null &&
    preview.maxFeePerGas !== null &&
    preview.maxPriorityFeePerGas !== null
  );
}
