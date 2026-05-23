import type { Address } from "viem";
import type { WalletNetworkSetting } from "../networks";
import { zeroExProvider } from "./zeroExProvider";

export const PRICE_REFRESH_INTERVAL_MS = 10_000;

export interface QuoteTokenInfo {
  symbol: string;
  decimals: number;
  kind: "native" | "erc20" | string;
  contractAddress?: string;
}

export interface QuoteRequest {
  network: WalletNetworkSetting;
  sellToken: QuoteTokenInfo;
  buyToken: QuoteTokenInfo;
  sellAmount: string;
  taker?: Address;
  slippageBps?: number;
}

export interface QuoteIssueAllowance {
  actual: string;
  spender: Address;
}

export interface QuoteResult {
  providerId: string;
  buyAmount: string;
  sellAmount: string;
  minBuyAmount?: string;
  totalNetworkFee?: string;
  estimatedPriceImpact?: string | null;
  route?: {
    fills?: Array<{ from: string; to: string; source: string; proportionBps: string }>;
    tokens?: Array<{ address: string; symbol: string }>;
  };
  issues?: {
    allowance?: QuoteIssueAllowance | null;
    balance?: { token: string; actual: string; expected: string } | null;
    simulationIncomplete?: boolean;
  };
  transaction?: {
    to: Address;
    data: string;
    gas: string;
    gasPrice?: string;
    value: string;
  };
  raw?: unknown;
}

export interface QuoteProvider {
  readonly id: string;
  supports(network: WalletNetworkSetting): boolean;
  getPrice(request: QuoteRequest): Promise<QuoteResult>;
  getQuote(request: QuoteRequest): Promise<QuoteResult>;
}

const REGISTERED_PROVIDERS: QuoteProvider[] = [zeroExProvider];

export function selectQuoteProvider(network: WalletNetworkSetting | null | undefined): QuoteProvider | null {
  if (!network) {
    return null;
  }
  return REGISTERED_PROVIDERS.find((provider) => provider.supports(network)) ?? null;
}
