import SignClient from "@walletconnect/sign-client";
import { formatJsonRpcError, formatJsonRpcResult } from "@walletconnect/jsonrpc-utils";
import { getSdkError } from "@walletconnect/utils";
import { getAddress, type Address } from "viem";
import { refreshPortfolio } from "./core/portfolio";
import {
  DEFAULT_WALLETCONNECT_PROJECT_ID,
  readWalletConnectSettings,
  readWalletRecord,
  writeWalletConnectSettings,
  type WalletRecord
} from "./lib/storage";

const PORTFOLIO_REFRESH_ALARM = "portfolio-refresh";
const PORTFOLIO_REFRESH_PERIOD_MINUTES = 15;

type RuntimeMessage =
  | {
      type: "dapp_request";
      id: string;
      method: string;
      params: unknown[];
      origin: string;
    }
  | {
      type: "walletconnect_pair";
      uri: string;
    }
  | {
      type: "walletconnect_status";
    }
  | {
      type: "walletconnect_sessions";
    }
  | {
      type: "walletconnect_disconnect";
      topic: string;
    };

interface WalletConnectSessionSummary {
  topic: string;
  name: string;
  description: string;
  url: string;
  icons: string[];
  accounts: string[];
  chains: string[];
  methods: string[];
  expiry?: number;
}

interface WalletConnectSessionLike {
  topic: string;
  expiry?: number;
  peer?: {
    metadata?: {
      name?: string;
      description?: string;
      url?: string;
      icons?: string[];
    };
  };
  namespaces?: Record<
    string,
    {
      accounts?: string[];
      chains?: string[];
      methods?: string[];
    }
  >;
}

let signClientPromise: Promise<SignClient> | null = null;

function schedulePortfolioRefresh() {
  chrome.alarms?.create(PORTFOLIO_REFRESH_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: PORTFOLIO_REFRESH_PERIOD_MINUTES
  });
}

chrome.runtime?.onInstalled?.addListener(async () => {
  const { walletRecord, walletConnectSettings } =
    (await chrome.storage?.local?.get(["walletRecord", "walletConnectSettings"])) ?? {};

  if (!walletRecord) {
    await chrome.storage?.local?.set({ walletRecord: null });
  }

  if (!walletConnectSettings) {
    await writeWalletConnectSettings({ projectId: DEFAULT_WALLETCONNECT_PROJECT_ID });
  }

  schedulePortfolioRefresh();
});

chrome.runtime?.onStartup?.addListener(() => {
  schedulePortfolioRefresh();
});

chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm.name !== PORTFOLIO_REFRESH_ALARM) {
    return;
  }

  readWalletRecord()
    .then(async (wallet) => {
      if (wallet?.address) {
        await refreshPortfolio(wallet.address as Address);
      }
    })
    .catch(() => undefined);
});

function jsonRpcError(code: number, message: string) {
  return {
    error: {
      code,
      message
    }
  };
}

async function currentWallet(): Promise<WalletRecord> {
  const wallet = await readWalletRecord();

  if (!wallet) {
    throw new Error("Create or unlock a wallet before connecting to dapps.");
  }

  return wallet;
}

async function handleDappRequest(message: Extract<RuntimeMessage, { type: "dapp_request" }>) {
  const wallet = await readWalletRecord();
  const address = wallet?.address ? getAddress(wallet.address as Address) : null;

  switch (message.method) {
    case "eth_requestAccounts":
      if (!address) {
        return jsonRpcError(4100, "Wallet is not initialized.");
      }
      return { result: [address] };
    case "eth_accounts":
      return { result: address ? [address] : [] };
    case "eth_chainId":
      return { result: "0x1" };
    case "net_version":
      return { result: "1" };
    case "wallet_switchEthereumChain": {
      const requested = message.params?.[0] as { chainId?: string } | undefined;

      if (!requested?.chainId || requested.chainId === "0x1") {
        return { result: null };
      }

      return jsonRpcError(4902, "Only Ethereum Mainnet is currently active in the injected provider.");
    }
    case "eth_sendTransaction":
    case "eth_signTransaction":
    case "personal_sign":
    case "eth_sign":
    case "eth_signTypedData":
    case "eth_signTypedData_v4":
      return jsonRpcError(4200, `${message.method} requires an approval UI and is not enabled yet.`);
    default:
      return jsonRpcError(4200, `Unsupported method: ${message.method}`);
  }
}

async function initWalletConnect(): Promise<SignClient> {
  if (signClientPromise) {
    return signClientPromise;
  }

  signClientPromise = (async () => {
    const settings = await readWalletConnectSettings();

    if (!settings.projectId.trim()) {
      throw new Error("WalletConnect Project ID is required in Settings.");
    }

    const client = await SignClient.init({
      projectId: settings.projectId.trim(),
      metadata: {
        name: "Passkey Wallet",
        description: "Passkey wallet Chrome extension prototype",
        url: "https://localhost",
        icons: []
      }
    });

    client.on("session_proposal", async (proposal) => {
      try {
        const wallet = await currentWallet();
        const account = `eip155:1:${getAddress(wallet.address as Address)}`;
        const { acknowledged } = await client.approve({
          id: proposal.id,
          namespaces: {
            eip155: {
              accounts: [account],
              methods: ["eth_accounts", "eth_requestAccounts", "personal_sign", "eth_sendTransaction"],
              events: ["accountsChanged", "chainChanged"]
            }
          }
        });

        await acknowledged();
      } catch {
        await client.reject({
          id: proposal.id,
          reason: getSdkError("USER_REJECTED")
        });
      }
    });

    client.on("session_request", async (event) => {
      const { topic, id, params } = event;
      const method = params.request.method;

      try {
        const result = await handleDappRequest({
          type: "dapp_request",
          id: String(id),
          method,
          params: Array.isArray(params.request.params) ? params.request.params : [],
          origin: "walletconnect"
        });

        if ("error" in result) {
          await client.respond({ topic, response: formatJsonRpcError(id, result.error) });
          return;
        }

        await client.respond({ topic, response: formatJsonRpcResult(id, result.result) });
      } catch (cause) {
        await client.respond({
          topic,
          response: formatJsonRpcError(id, {
            code: 5000,
            message: cause instanceof Error ? cause.message : "Unable to handle WalletConnect request."
          })
        });
      }
    });

    client.on("session_delete", () => undefined);
    client.on("session_expire", () => undefined);
    client.on("session_update", () => undefined);

    return client;
  })().catch((cause) => {
    signClientPromise = null;
    throw cause;
  });

  return signClientPromise;
}

function summarizeWalletConnectSession(session: WalletConnectSessionLike): WalletConnectSessionSummary {
  const namespaces = Object.values(session.namespaces ?? {});
  const accounts = Array.from(new Set(namespaces.flatMap((namespace) => namespace.accounts ?? [])));
  const chains = Array.from(new Set(namespaces.flatMap((namespace) => namespace.chains ?? accounts.map((account) => account.split(":").slice(0, 2).join(":")))));
  const methods = Array.from(new Set(namespaces.flatMap((namespace) => namespace.methods ?? [])));
  const metadata = session.peer?.metadata;

  return {
    topic: session.topic,
    name: metadata?.name?.trim() || "Unknown dapp",
    description: metadata?.description?.trim() || "",
    url: metadata?.url?.trim() || "",
    icons: metadata?.icons ?? [],
    accounts,
    chains,
    methods,
    expiry: session.expiry
  };
}

async function listWalletConnectSessions(): Promise<WalletConnectSessionSummary[]> {
  const client = await initWalletConnect();
  return client.session
    .getAll()
    .map((session) => summarizeWalletConnectSession(session as WalletConnectSessionLike))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function disconnectWalletConnectSession(topic: string): Promise<WalletConnectSessionSummary[]> {
  if (!topic.trim()) {
    throw new Error("WalletConnect session topic is required.");
  }

  const client = await initWalletConnect();
  await client.disconnect({
    topic,
    reason: getSdkError("USER_DISCONNECTED")
  });

  return listWalletConnectSessions();
}

async function pairWalletConnect(uri: string) {
  if (!uri.trim().startsWith("wc:")) {
    throw new Error("Enter a valid WalletConnect v2 URI.");
  }

  const wallet = await currentWallet();
  const client = await initWalletConnect();
  await client.core.pairing.pair({ uri });

  return {
    address: getAddress(wallet.address as Address),
    pairings: client.core.pairing.getPairings().length,
    sessions: client.session.getAll().length
  };
}

chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
  const runtimeMessage = message as RuntimeMessage;

  if (!runtimeMessage?.type) {
    return false;
  }

  (async () => {
    try {
      if (runtimeMessage.type === "dapp_request") {
        sendResponse(await handleDappRequest(runtimeMessage));
        return;
      }

      if (runtimeMessage.type === "walletconnect_pair") {
        sendResponse({ result: await pairWalletConnect(runtimeMessage.uri) });
        return;
      }

      if (runtimeMessage.type === "walletconnect_status") {
        const settings = await readWalletConnectSettings();
        sendResponse({ result: { configured: Boolean(settings.projectId.trim()) } });
        return;
      }

      if (runtimeMessage.type === "walletconnect_sessions") {
        sendResponse({ result: { sessions: await listWalletConnectSessions() } });
        return;
      }

      if (runtimeMessage.type === "walletconnect_disconnect") {
        sendResponse({ result: { sessions: await disconnectWalletConnectSession(runtimeMessage.topic) } });
      }
    } catch (cause) {
      sendResponse(jsonRpcError(5000, cause instanceof Error ? cause.message : "Request failed."));
    }
  })();

  return true;
});
