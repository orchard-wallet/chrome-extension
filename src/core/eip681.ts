import { parseUnits } from "viem";

export interface NativeReceiveRequestInput {
  address: string;
  chainId?: number;
  amount?: string;
}

export interface NativeReceiveRequestUri {
  uri: string;
  valueWei: bigint | null;
}

export function buildNativeReceiveRequestUri({
  address,
  chainId,
  amount
}: NativeReceiveRequestInput): NativeReceiveRequestUri {
  const target = chainId ? `${address}@${chainId}` : address;
  const normalizedAmount = amount?.trim() ?? "";

  if (!normalizedAmount) {
    return { uri: `ethereum:${target}`, valueWei: null };
  }

  const valueWei = parseUnits(normalizedAmount, 18);
  return {
    uri: `ethereum:${target}?value=${valueWei.toString()}`,
    valueWei
  };
}
