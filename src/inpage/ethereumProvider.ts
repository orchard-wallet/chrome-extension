type ProviderListener = (...args: unknown[]) => void;

interface ProviderRequestArguments {
  method: string;
  params?: unknown[] | Record<string, unknown>;
}

interface ProviderResponse {
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface Eip6963ProviderDetail {
  info: Eip6963ProviderInfo;
  provider: typeof provider;
}

const listeners = new Map<string, Set<ProviderListener>>();
let requestId = 0;
const providerUuid = crypto.randomUUID();
const orchardWalletIcon =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="16" fill="#fff5ee"/>
      <path d="M32 56c13-11 21-24 21-37C53 8 44 2 32 2S11 8 11 19c0 13 8 26 21 37Z" fill="none" stroke="#111" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M32 2c-5 14-5 31 0 54m0-54c5 14 5 31 0 54" fill="none" stroke="#111" stroke-width="3" stroke-linecap="round"/>
    </svg>`
  );

function emit(event: string, ...args: unknown[]) {
  listeners.get(event)?.forEach((listener) => listener(...args));
}

function normalizeParams(params: ProviderRequestArguments["params"]): unknown[] {
  if (!params) {
    return [];
  }

  return Array.isArray(params) ? params : [params];
}

function chainIdFromParams(params: ProviderRequestArguments["params"]): string | null {
  const firstParam = normalizeParams(params)[0] as { chainId?: unknown } | undefined;

  if (typeof firstParam?.chainId !== "string" || !/^0x[0-9a-f]+$/i.test(firstParam.chainId)) {
    return null;
  }

  return `0x${BigInt(firstParam.chainId).toString(16)}`;
}

function decimalChainId(chainId: string): string {
  return BigInt(chainId).toString(10);
}

function request(args: ProviderRequestArguments): Promise<unknown> {
  const id = `mpw-${Date.now()}-${requestId++}`;

  return new Promise((resolve, reject) => {
    const handleResponse = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        id: string;
        response: ProviderResponse;
      };

      if (detail.id !== id) {
        return;
      }

      window.removeEventListener("orchard-wallet:response", handleResponse);

      if (detail.response?.error) {
        reject(Object.assign(new Error(detail.response.error.message), detail.response.error));
        return;
      }

      resolve(detail.response?.result);
    };

    window.addEventListener("orchard-wallet:response", handleResponse);
    window.dispatchEvent(
      new CustomEvent("orchard-wallet:request", {
        detail: {
          id,
          method: args.method,
          params: normalizeParams(args.params)
        }
      })
    );
  });
}

const provider = {
  isMetaMask: true,
  isMyPasskeyWallet: true,
  _metamask: {
    isUnlocked: async () => Boolean(provider.selectedAddress)
  },
  chainId: "0x1",
  selectedAddress: null as string | null,
  async request(args: ProviderRequestArguments) {
    if (args.method === "eth_chainId") {
      return provider.chainId;
    }

    if (args.method === "net_version") {
      return decimalChainId(provider.chainId);
    }

    const result = await request(args);

    if ((args.method === "eth_accounts" || args.method === "eth_requestAccounts") && Array.isArray(result)) {
      const accounts = result.filter((account): account is string => typeof account === "string");
      const nextAddress = accounts[0] ?? null;

      if (provider.selectedAddress !== nextAddress) {
        provider.selectedAddress = nextAddress;
        emit("accountsChanged", accounts);
      }
    }

    if (args.method === "wallet_switchEthereumChain") {
      const nextChainId = chainIdFromParams(args.params);

      if (nextChainId && provider.chainId !== nextChainId) {
        provider.chainId = nextChainId;
        emit("chainChanged", nextChainId);
      }
    }

    return result;
  },
  enable: () => provider.request({ method: "eth_requestAccounts" }),
  on(event: string, listener: ProviderListener) {
    const eventListeners = listeners.get(event) ?? new Set<ProviderListener>();
    eventListeners.add(listener);
    listeners.set(event, eventListeners);
    return provider;
  },
  removeListener(event: string, listener: ProviderListener) {
    listeners.get(event)?.delete(listener);
    return provider;
  }
};

provider.request({ method: "eth_accounts" })
  .then((accounts) => {
    if (Array.isArray(accounts) && typeof accounts[0] === "string") {
      provider.selectedAddress = accounts[0];
    }
  })
  .catch(() => undefined);

function announceProvider() {
  const detail: Eip6963ProviderDetail = Object.freeze({
    info: Object.freeze({
      uuid: providerUuid,
      name: "Orchard Wallet",
      icon: orchardWalletIcon,
      rdns: "com.orchardwallet"
    }),
    provider
  });

  window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
}

Object.defineProperty(window, "ethereum", {
  value: provider,
  configurable: true
});

window.addEventListener("eip6963:requestProvider", announceProvider);
announceProvider();
window.dispatchEvent(new Event("ethereum#initialized"));
