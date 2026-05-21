import SignClient from "@walletconnect/sign-client";
import { formatJsonRpcError, formatJsonRpcResult } from "@walletconnect/jsonrpc-utils";
import { getSdkError } from "@walletconnect/utils";
import { getAddress, type Address } from "viem";
import { refreshPortfolio } from "./core/portfolio";
import { hasWalletConnectProjectId, requireWalletConnectProjectId } from "./core/walletConnectConfig";
import {
  readNetworkSettings,
  readPendingWalletConnectProposals,
  readWalletRecord,
  readWalletConnectSessionActivity,
  recordWalletConnectSessionActivity,
  removePendingWalletConnectProposal,
  removeWalletConnectSessionActivity,
  upsertPendingWalletConnectProposal,
  type PendingWalletConnectProposal,
  type WalletConnectSessionActivity,
  type WalletRecord
} from "./lib/storage";
import { getBuiltInNetworkSettings } from "./core/networks";

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
      type: "walletconnect_pending_proposals";
    }
  | {
      type: "walletconnect_approve_proposal";
      id: number;
    }
  | {
      type: "walletconnect_reject_proposal";
      id: number;
    }
  | {
      type: "walletconnect_disconnect_all";
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
  domain?: string;
  lastActiveAt?: string;
  methodHistory?: string[];
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
const SUPPORTED_WALLETCONNECT_METHODS = ["eth_accounts", "eth_requestAccounts", "personal_sign", "eth_sendTransaction"];
const SUPPORTED_WALLETCONNECT_EVENTS = ["accountsChanged", "chainChanged"];

function schedulePortfolioRefresh() {
  chrome.alarms?.create(PORTFOLIO_REFRESH_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: PORTFOLIO_REFRESH_PERIOD_MINUTES
  });
}

chrome.runtime?.onInstalled?.addListener(async () => {
  const { walletRecord } = (await chrome.storage?.local?.get(["walletRecord"])) ?? {};

  if (!walletRecord) {
    await chrome.storage?.local?.set({ walletRecord: null });
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
        await refreshPortfolio(wallet.address as Address, wallet.chainAccounts);
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

interface WalletConnectProposalLike {
  id: number;
  params?: {
    expiryTimestamp?: number;
    proposer?: {
      metadata?: {
        name?: string;
        description?: string;
        url?: string;
        icons?: string[];
      };
    };
    requiredNamespaces?: Record<string, { chains?: string[]; methods?: string[]; events?: string[] }>;
    optionalNamespaces?: Record<string, { chains?: string[]; methods?: string[]; events?: string[] }>;
  };
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function proposalNamespaceValues(
  namespaces: Record<string, { chains?: string[]; methods?: string[]; events?: string[] }> | undefined,
  key: "chains" | "methods" | "events"
): string[] {
  return unique(Object.values(namespaces ?? {}).flatMap((namespace) => namespace[key] ?? []));
}

function metadataDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function summarizeProposal(proposal: WalletConnectProposalLike, supportedChains: string[]): PendingWalletConnectProposal {
  const metadata = proposal.params?.proposer?.metadata;
  const requiredChains = proposalNamespaceValues(proposal.params?.requiredNamespaces, "chains");
  const optionalChains = proposalNamespaceValues(proposal.params?.optionalNamespaces, "chains");
  const requiredMethods = proposalNamespaceValues(proposal.params?.requiredNamespaces, "methods");
  const optionalMethods = proposalNamespaceValues(proposal.params?.optionalNamespaces, "methods");
  const requiredEvents = proposalNamespaceValues(proposal.params?.requiredNamespaces, "events");
  const optionalEvents = proposalNamespaceValues(proposal.params?.optionalNamespaces, "events");
  const requestedChains = unique([...requiredChains, ...optionalChains]);
  const requestedMethods = unique([...requiredMethods, ...optionalMethods]);
  const riskyMethods = requestedMethods.filter((method) => !SUPPORTED_WALLETCONNECT_METHODS.includes(method));
  const domain = metadataDomain(metadata?.url?.trim() ?? "");

  return {
    id: proposal.id,
    name: metadata?.name?.trim() || "Unknown dapp",
    description: metadata?.description?.trim() || "",
    url: metadata?.url?.trim() || "",
    icons: metadata?.icons ?? [],
    requiredChains,
    optionalChains,
    requiredMethods,
    optionalMethods,
    requiredEvents,
    optionalEvents,
    receivedAt: new Date().toISOString(),
    expiresAt: proposal.params?.expiryTimestamp ? new Date(proposal.params.expiryTimestamp * 1000).toISOString() : undefined,
    unsupportedChains: requestedChains.filter((chain) => !supportedChains.includes(chain)),
    riskyMethods,
    domainMismatch: Boolean(domain && metadata?.name && !metadata.name.toLowerCase().replace(/\s+/g, "").includes(domain.split(".")[0]))
  };
}

async function supportedWalletConnectChains(address: Address): Promise<string[]> {
  const settings = await readNetworkSettings();
  return getBuiltInNetworkSettings(settings)
    .filter(
      (network) =>
        network.enabled &&
        ["ethereum", "arbitrum", "hyperliquid", "polygon", "custom"].includes(network.family) &&
        typeof network.chainId === "number"
    )
    .map((network) => `eip155:${network.chainId}:${getAddress(address)}`);
}

async function supportedWalletConnectChainIds(): Promise<string[]> {
  const settings = await readNetworkSettings();
  return getBuiltInNetworkSettings(settings)
    .filter(
      (network) =>
        network.enabled &&
        ["ethereum", "arbitrum", "hyperliquid", "polygon", "custom"].includes(network.family) &&
        typeof network.chainId === "number"
    )
    .map((network) => `eip155:${network.chainId}`);
}

async function storePendingProposal(proposal: WalletConnectProposalLike) {
  const supportedChains = await supportedWalletConnectChainIds();
  await upsertPendingWalletConnectProposal(summarizeProposal(proposal, supportedChains));
  const actionApi = (chrome as unknown as { action?: { openPopup?: () => Promise<void> } }).action;
  actionApi?.openPopup?.().catch(() => undefined);
}

async function approvePendingProposal(id: number): Promise<{
  proposals: PendingWalletConnectProposal[];
  sessions: WalletConnectSessionSummary[];
}> {
  const wallet = await currentWallet();
  const client = await initWalletConnect();
  const accounts = await supportedWalletConnectChains(wallet.address as Address);
  const chains = accounts.map((account) => account.split(":").slice(0, 2).join(":"));

  if (accounts.length === 0) {
    throw new Error("Enable at least one EVM network before approving a dapp connection.");
  }

  const { acknowledged } = await client.approve({
    id,
    namespaces: {
      eip155: {
        accounts,
        chains,
        methods: SUPPORTED_WALLETCONNECT_METHODS,
        events: SUPPORTED_WALLETCONNECT_EVENTS
      }
    }
  });

  await acknowledged();
  await removePendingWalletConnectProposal(id);

  return {
    proposals: await readPendingWalletConnectProposals(),
    sessions: await listWalletConnectSessions()
  };
}

async function rejectPendingProposal(id: number): Promise<PendingWalletConnectProposal[]> {
  const client = await initWalletConnect();

  try {
    await client.reject({
      id,
      reason: getSdkError("USER_REJECTED")
    });
  } finally {
    await removePendingWalletConnectProposal(id);
  }

  return readPendingWalletConnectProposals();
}

async function initWalletConnect(): Promise<SignClient> {
  if (signClientPromise) {
    return signClientPromise;
  }

  signClientPromise = (async () => {
    const client = await SignClient.init({
      projectId: requireWalletConnectProjectId(),
      metadata: {
        name: "Passkey Wallet",
        description: "Passkey wallet Chrome extension prototype",
        url: "https://localhost",
        icons: []
      }
    });

    client.on("session_proposal", async (proposal) => {
      await storePendingProposal(proposal as WalletConnectProposalLike);
    });

    client.on("session_request", async (event) => {
      const { topic, id, params } = event;
      const method = params.request.method;
      const session = client.session.get(topic) as WalletConnectSessionLike | undefined;
      const domain = metadataDomain(session?.peer?.metadata?.url?.trim() ?? "") ?? "walletconnect";

      try {
        await recordWalletConnectSessionActivity({ topic, method, domain });
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

function summarizeWalletConnectSession(
  session: WalletConnectSessionLike,
  activity?: WalletConnectSessionActivity
): WalletConnectSessionSummary {
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
    expiry: session.expiry,
    domain: activity?.domain ?? metadataDomain(metadata?.url?.trim() ?? "") ?? undefined,
    lastActiveAt: activity?.lastActiveAt,
    methodHistory: activity ? Object.entries(activity.methodCounts).map(([method, count]) => `${method} x${count}`) : []
  };
}

async function listWalletConnectSessions(): Promise<WalletConnectSessionSummary[]> {
  const client = await initWalletConnect();
  const activity = await readWalletConnectSessionActivity();
  return client.session
    .getAll()
    .map((session) => summarizeWalletConnectSession(session as WalletConnectSessionLike, activity[session.topic]))
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
  await removeWalletConnectSessionActivity(topic);

  return listWalletConnectSessions();
}

async function disconnectAllWalletConnectSessions(): Promise<WalletConnectSessionSummary[]> {
  const client = await initWalletConnect();
  const sessions = client.session.getAll();

  await Promise.allSettled(
    sessions.map((session) =>
      client.disconnect({
        topic: session.topic,
        reason: getSdkError("USER_DISCONNECTED")
      })
    )
  );
  await Promise.allSettled(sessions.map((session) => removeWalletConnectSessionActivity(session.topic)));

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
        sendResponse({ result: { configured: hasWalletConnectProjectId() } });
        return;
      }

      if (runtimeMessage.type === "walletconnect_sessions") {
        sendResponse({ result: { sessions: await listWalletConnectSessions() } });
        return;
      }

      if (runtimeMessage.type === "walletconnect_pending_proposals") {
        sendResponse({ result: { proposals: await readPendingWalletConnectProposals() } });
        return;
      }

      if (runtimeMessage.type === "walletconnect_approve_proposal") {
        sendResponse({ result: await approvePendingProposal(runtimeMessage.id) });
        return;
      }

      if (runtimeMessage.type === "walletconnect_reject_proposal") {
        sendResponse({ result: { proposals: await rejectPendingProposal(runtimeMessage.id) } });
        return;
      }

      if (runtimeMessage.type === "walletconnect_disconnect") {
        sendResponse({ result: { sessions: await disconnectWalletConnectSession(runtimeMessage.topic) } });
        return;
      }

      if (runtimeMessage.type === "walletconnect_disconnect_all") {
        sendResponse({ result: { sessions: await disconnectAllWalletConnectSessions() } });
      }
    } catch (cause) {
      sendResponse(jsonRpcError(5000, cause instanceof Error ? cause.message : "Request failed."));
    }
  })();

  return true;
});
