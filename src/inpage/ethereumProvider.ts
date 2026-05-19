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

const listeners = new Map<string, Set<ProviderListener>>();
let requestId = 0;

function emit(event: string, ...args: unknown[]) {
  listeners.get(event)?.forEach((listener) => listener(...args));
}

function normalizeParams(params: ProviderRequestArguments["params"]): unknown[] {
  if (!params) {
    return [];
  }

  return Array.isArray(params) ? params : [params];
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

      window.removeEventListener("my-passkey-wallet:response", handleResponse);

      if (detail.response?.error) {
        reject(Object.assign(new Error(detail.response.error.message), detail.response.error));
        return;
      }

      resolve(detail.response?.result);
    };

    window.addEventListener("my-passkey-wallet:response", handleResponse);
    window.dispatchEvent(
      new CustomEvent("my-passkey-wallet:request", {
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
  chainId: "0x1",
  selectedAddress: null as string | null,
  request,
  enable: () => request({ method: "eth_requestAccounts" }),
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

request({ method: "eth_accounts" })
  .then((accounts) => {
    if (Array.isArray(accounts) && typeof accounts[0] === "string") {
      provider.selectedAddress = accounts[0];
      emit("accountsChanged", accounts);
    }
  })
  .catch(() => undefined);

Object.defineProperty(window, "ethereum", {
  value: provider,
  configurable: true
});

window.dispatchEvent(new Event("ethereum#initialized"));
