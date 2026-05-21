import { formatUnits, isAddress, maxUint256, parseUnits, type Address } from "viem";
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
    return recipient.primaryName ?? "Ethereum address";
  }

  return "Unknown recipient";
}

export function buildNativeEthTransferPreview(input: {
  from: Address | null;
  recipient: RecipientResolution;
  amount: string;
  network: WalletNetworkSetting | null;
  feeEstimate?: TransactionFeeEstimate | null;
}): ClearSigningPreviewResult {
  if (!input.from) {
    return { ok: false, reason: "Create or unlock a wallet before sending." };
  }

  if (!input.network?.chainId) {
    return { ok: false, reason: "Choose an enabled EVM network before sending." };
  }

  if (input.recipient.kind === "empty") {
    return { ok: false, reason: "Enter a recipient address or ENS name." };
  }

  if (input.recipient.kind === "invalid") {
    return { ok: false, reason: input.recipient.reason };
  }

  const normalizedAmount = normalizeAmountInput(input.amount);

  if (!normalizedAmount) {
    return { ok: false, reason: "Enter an amount." };
  }

  let amountWei: bigint;

  try {
    amountWei = parseUnits(normalizedAmount, 18);
  } catch {
    return { ok: false, reason: `Enter a valid ${input.network.nativeCurrencySymbol} amount.` };
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
      title: `Send ${input.network.nativeCurrencySymbol}`,
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
        : "Pending estimation",
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
      title: unlimited ? "Unlimited token approval" : "Token approval",
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
            ? "This approval can let the spender move unlimited tokens until revoked."
            : "This approval grants token spending permission to another address."
        }
      ],
      supported: false
    };
  }

  return {
    action: "contract-call",
    title: "Unsupported contract call",
    networkId: input.network.networkId,
    chainId: input.network.chainId ?? 0,
    networkName: input.network.name,
    from: input.from,
    to: input.to,
    data: input.data,
    warnings: [
      {
        severity: "danger",
        message: "This contract call is not supported by the clear-signing parser and cannot be signed directly."
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
    title: "Unsupported message signature",
    from: input.from,
    message: input.message,
    warnings: [
      {
        severity: "danger",
        message: "Message signing is not supported by the clear-signing parser yet."
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
      message: "Typed data request"
    });
  }

  return {
    action: "contract-call",
    title: "Unsupported WalletConnect request",
    networkId: input.network.networkId,
    chainId: input.network.chainId ?? 0,
    networkName: input.network.name,
    from: input.from,
    to: input.from,
    data: "0x",
    warnings: [
      {
        severity: "danger",
        message: `${input.method} is not supported by the clear-signing parser.`
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
