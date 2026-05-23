import {
  ZERO_EX_NATIVE_TOKEN,
  getZeroExSwapPrice,
  getZeroExSwapQuote,
  type ZeroExSwapQuote,
  type ZeroExSwapRequest
} from "../zeroEx";
import type { WalletNetworkSetting } from "../networks";
import type { QuoteProvider, QuoteRequest, QuoteResult, QuoteTokenInfo } from "./quoteProvider";

const EVM_FAMILIES = new Set<string>(["ethereum", "arbitrum", "polygon", "hyperliquid"]);

function isEvmNetwork(network: WalletNetworkSetting): boolean {
  return Number.isInteger(network.chainId) && (network.chainId as number) > 0 && EVM_FAMILIES.has(network.family);
}

function tokenAddress(token: QuoteTokenInfo): string {
  if (token.kind === "native") {
    return ZERO_EX_NATIVE_TOKEN;
  }
  return token.contractAddress ?? "";
}

function toZeroExRequest(request: QuoteRequest): ZeroExSwapRequest {
  return {
    chainId: request.network.chainId as number,
    sellToken: tokenAddress(request.sellToken),
    buyToken: tokenAddress(request.buyToken),
    sellAmount: request.sellAmount,
    taker: request.taker,
    slippageBps: request.slippageBps
  };
}

function adaptResult(payload: ZeroExSwapQuote): QuoteResult {
  return {
    providerId: zeroExProvider.id,
    buyAmount: payload.buyAmount,
    sellAmount: payload.sellAmount,
    minBuyAmount: payload.minBuyAmount,
    totalNetworkFee: payload.totalNetworkFee,
    estimatedPriceImpact: payload.estimatedPriceImpact,
    route: payload.route,
    issues: payload.issues,
    transaction: payload.transaction,
    raw: payload
  };
}

export const zeroExProvider: QuoteProvider = {
  id: "zero-ex",
  supports(network) {
    return isEvmNetwork(network);
  },
  async getPrice(request) {
    return adaptResult(await getZeroExSwapPrice(toZeroExRequest(request)));
  },
  async getQuote(request) {
    return adaptResult(await getZeroExSwapQuote(toZeroExRequest(request)));
  }
};
