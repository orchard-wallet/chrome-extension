import type { Address } from "viem";

export const ZERO_EX_NATIVE_TOKEN = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

export interface ZeroExSwapRequest {
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  taker?: Address;
  slippageBps?: number;
}

export interface ZeroExIssueAllowance {
  actual: string;
  spender: Address;
}

export interface ZeroExSwapQuote {
  allowanceTarget?: Address;
  blockNumber?: string;
  buyAmount: string;
  buyToken: string;
  fees?: {
    integratorFee?: ZeroExFee | null;
    zeroExFee?: ZeroExFee | null;
    gasFee?: ZeroExFee | null;
  };
  gas?: string;
  gasPrice?: string;
  estimatedPriceImpact?: string | null;
  issues?: {
    allowance?: ZeroExIssueAllowance | null;
    balance?: {
      token: string;
      actual: string;
      expected: string;
    } | null;
    simulationIncomplete?: boolean;
  };
  liquidityAvailable: boolean;
  minBuyAmount?: string;
  route?: {
    fills?: Array<{
      from: string;
      to: string;
      source: string;
      proportionBps: string;
    }>;
    tokens?: Array<{
      address: string;
      symbol: string;
    }>;
  };
  sellAmount: string;
  sellToken: string;
  totalNetworkFee?: string;
  transaction?: {
    to: Address;
    data: string;
    gas: string;
    gasPrice?: string;
    value: string;
  };
  zid?: string;
}

interface ZeroExFee {
  amount: string;
  token: string;
  type: string;
}

function requireZeroExApiKey(): string {
  const apiKey = import.meta.env.VITE_ZERO_EX_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("Configure VITE_ZERO_EX_API_KEY before requesting 0x swap quotes.");
  }

  return apiKey;
}

function queryString(request: ZeroExSwapRequest, includeTaker: boolean): string {
  const params = new URLSearchParams({
    chainId: request.chainId.toString(),
    sellToken: request.sellToken,
    buyToken: request.buyToken,
    sellAmount: request.sellAmount
  });

  if (includeTaker && request.taker) {
    params.set("taker", request.taker);
  }

  if (request.slippageBps !== undefined) {
    params.set("slippageBps", request.slippageBps.toString());
  }

  return params.toString();
}

async function getZeroExSwap(endpoint: "price" | "quote", request: ZeroExSwapRequest): Promise<ZeroExSwapQuote> {
  if (!Number.isInteger(request.chainId) || request.chainId <= 0) {
    throw new Error("0x quotes require an EVM chain ID.");
  }

  if (endpoint === "quote" && !request.taker) {
    throw new Error("A wallet address is required for an executable 0x quote.");
  }

  const response = await fetch(`https://api.0x.org/swap/allowance-holder/${endpoint}?${queryString(request, endpoint === "quote")}`, {
    headers: {
      "0x-api-key": requireZeroExApiKey(),
      "0x-version": "v2"
    }
  });
  const payload = (await response.json()) as ZeroExSwapQuote & {
    reason?: string;
    message?: string;
    validationErrors?: Array<{ reason?: string; field?: string }>;
  };

  if (!response.ok) {
    const validationReason = payload.validationErrors?.map((error) => error.reason ?? error.field).filter(Boolean).join(" ");
    throw new Error(validationReason || payload.reason || payload.message || `0x ${endpoint} request failed.`);
  }

  if (!payload.liquidityAvailable) {
    throw new Error("0x did not find available liquidity for this route.");
  }

  return payload;
}

export function tokenAddressForZeroEx(asset: { kind: string; contractAddress?: string }): string {
  return asset.kind === "native" ? ZERO_EX_NATIVE_TOKEN : asset.contractAddress ?? "";
}

export function getZeroExSwapPrice(request: ZeroExSwapRequest): Promise<ZeroExSwapQuote> {
  return getZeroExSwap("price", request);
}

export function getZeroExSwapQuote(request: ZeroExSwapRequest): Promise<ZeroExSwapQuote> {
  return getZeroExSwap("quote", request);
}
