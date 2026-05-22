import {
  Activity,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleCheck,
  Clock3,
  Copy,
  Database,
  Download,
  DollarSign,
  Eye,
  EyeOff,
  Globe2,
  GripVertical,
  HelpCircle,
  Home,
  Info,
  Link2,
  Loader2,
  PieChart,
  Plus,
  QrCode,
  RefreshCcw,
  Repeat2,
  Save,
  Search,
  Send,
  Settings2,
  SlidersHorizontal,
  Shield,
  ShieldCheck,
  Star,
  Trash2,
  Unplug,
  UsersRound,
  Wallet
} from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import i18n, { changeAppLanguage } from "../i18n";
import { SUPPORTED_LANGUAGES, type AppLanguage } from "../i18n/config";
import { formatUnits, parseUnits, type Address } from "viem";
import { buildNativeTokenTransferPreview, canSignPreview } from "../core/clearSigning";
import {
  ACTIVITY_FILTERS,
  activityTotals,
  searchActivityEvents,
  type ActivityCategory,
  type ActivityEvent,
  type ActivityStatus
} from "../core/activity";
import { resolveRecipient, type RecipientResolution } from "../core/ens";
import {
  createCustomNetwork,
  getBuiltInNetworkSettings,
  type NetworkFamily,
  type WalletNetworkSetting
} from "../core/networks";
import { readPortfolioStore, refreshPortfolio } from "../core/portfolio";
import type { AssetDefinition, AssetStore, ChainAssetSnapshot } from "../core/assets";
import { isEvmAssetNetwork } from "../core/assets";
import { curatedEvmSwapAssets } from "../core/evmAssets";
import { searchAddressBookContacts, type AddressBookContact } from "../core/addressBook";
import { estimateNativeTokenTransfer, type TransactionFeeEstimate } from "../core/rpc";
import {
  getZeroExSwapPrice,
  getZeroExSwapQuote,
  tokenAddressForZeroEx,
  type ZeroExSwapQuote
} from "../core/zeroEx";
import {
  readNetworkSettings,
  readActivityEvents,
  addAddressBookContact,
  readAddressBookContacts,
  readRecentRecipients,
  readWalletUiSettings,
  readWalletRecord,
  clearWalletRecord,
  writePendingNativeSendReview,
  removeAddressBookContact,
  updateAddressBookContact,
  writeNetworkSettings,
  writeWalletUiSettings,
  DEFAULT_WALLET_UI_SETTINGS,
  type WalletUiSettings,
  type RecentRecipient
} from "../lib/storage";

type SaveStatus = "idle" | "saving" | "saved" | "error";
type SettingsView = "networks" | "connected-dapps" | "portfolio" | "activity" | "address-book" | "send" | "swap" | "security" | "settings";
type WalletConnectSessionsStatus = "idle" | "loading" | "ready" | "error";
type SendResolverStatus = "idle" | "resolving";
type SendFeeStatus = "idle" | "estimating" | "ready" | "error";
type SwapQuoteStatus = "idle" | "loading" | "ready" | "error";

interface SwapAssetOption {
  definition: AssetDefinition;
  balance: string | null;
  rawBalance: string | null;
}

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

const FAMILIES: NetworkFamily[] = ["ethereum", "arbitrum", "hyperliquid", "tron", "bitcoin", "polygon", "custom"];

function matchesQuery(network: WalletNetworkSetting, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  return [network.name, network.family, network.chain, network.chainId?.toString() ?? "", network.nativeCurrencySymbol]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatRelativeAge(value: string): string {
  const timestamp = new Date(value).getTime();
  const elapsedMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));

  if (!Number.isFinite(elapsedMinutes) || elapsedMinutes < 1) {
    return i18n.t("settings:time.now");
  }

  if (elapsedMinutes < 60) {
    return i18n.t("settings:time.minutesAgo", { count: elapsedMinutes });
  }

  if (elapsedMinutes < 1440) {
    return i18n.t("settings:time.hoursAgo", { count: Math.round(elapsedMinutes / 60) });
  }

  return i18n.t("settings:time.daysAgo", { count: Math.round(elapsedMinutes / 1440) });
}

function formatUsd(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return i18n.t("settings:time.notRefreshed");
  }

  const numericValue = typeof value === "string" ? Number(value) : value;

  if (!Number.isFinite(numericValue)) {
    return i18n.t("settings:time.notRefreshed");
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(numericValue);
}

function formatUpdatedAt(value: string | null | undefined): string {
  if (!value) {
    return i18n.t("settings:time.refreshToUpdate");
  }

  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return i18n.t("settings:time.refreshToUpdate");
  }

  return i18n.t("settings:time.updated", {
    time: timestamp.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
  });
}

function settingsViewFromHash(): SettingsView {
  if (typeof window === "undefined") {
    return "networks";
  }

  return window.location.hash === "#portfolio"
    ? "portfolio"
    : window.location.hash === "#activity"
      ? "activity"
    : window.location.hash === "#address-book"
      ? "address-book"
    : window.location.hash === "#settings"
      ? "settings"
    : window.location.hash === "#connected-dapps"
      ? "connected-dapps"
    : window.location.hash === "#send"
        ? "send"
        : window.location.hash === "#swap"
          ? "swap"
        : window.location.hash === "#security"
          ? "security"
        : "networks";
}

function formatRelativeTime(value: string | number | null | undefined): string {
  if (!value) {
    return i18n.t("settings:time.noActivity");
  }

  const timestamp = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  const deltaMs = Date.now() - timestamp.getTime();

  if (Number.isNaN(deltaMs)) {
    return i18n.t("settings:time.noActivity");
  }

  const absoluteDelta = Math.abs(deltaMs);
  const minutes = Math.round(absoluteDelta / 60000);
  const hours = Math.round(absoluteDelta / 3600000);
  const days = Math.round(absoluteDelta / 86400000);

  if (minutes < 1) {
    return i18n.t("settings:time.justNow");
  }

  if (minutes < 60) {
    return i18n.t("settings:time.minutesAgo", { count: minutes });
  }

  if (hours < 24) {
    return i18n.t("settings:time.hoursAgo", { count: hours });
  }

  return i18n.t("settings:time.daysAgo", { count: days });
}

function methodLabel(method: string): string {
  switch (method) {
    case "eth_accounts":
    case "eth_requestAccounts":
      return i18n.t("settings:connectedDapps.methodViewBalance");
    case "personal_sign":
    case "eth_signTypedData":
    case "eth_signTypedData_v4":
      return i18n.t("settings:connectedDapps.methodRequestSignatures");
    case "eth_sendTransaction":
      return i18n.t("settings:connectedDapps.methodRequestApproval");
    default:
      return method.replace(/^eth_/, "").replaceAll("_", " ");
  }
}

function sessionPermissions(session: WalletConnectSessionSummary): string {
  const labels = Array.from(new Set(session.methods.map(methodLabel)));
  return labels.length ? labels.slice(0, 3).join(", ") : i18n.t("settings:connectedDapps.methodViewBalance");
}

function originLabel(session: WalletConnectSessionSummary): string {
  try {
    return session.domain ?? new URL(session.url).hostname;
  } catch {
    return session.domain ?? session.url ?? "Unknown origin";
  }
}

function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const runtime = typeof chrome === "undefined" ? undefined : chrome.runtime;

    if (!runtime?.sendMessage) {
      reject(new Error("Chrome runtime is unavailable."));
      return;
    }

    runtime.sendMessage(message, (response: unknown) => {
      const runtimeError = runtime.lastError;
      const typedResponse = response as T & { error?: { message?: string } };

      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      if (typedResponse && "error" in typedResponse && typedResponse.error) {
        reject(new Error(typedResponse.error.message ?? "WalletConnect request failed."));
        return;
      }

      resolve(typedResponse);
    });
  });
}

export function SettingsApp() {
  const { t } = useTranslation();
  const [view, setView] = useState<SettingsView>(() => settingsViewFromHash());
  const [networks, setNetworks] = useState<WalletNetworkSetting[]>([]);
  const [query, setQuery] = useState("");
  const [sessionQuery, setSessionQuery] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [walletConnectSessions, setWalletConnectSessions] = useState<WalletConnectSessionSummary[]>([]);
  const [walletConnectSessionsStatus, setWalletConnectSessionsStatus] = useState<WalletConnectSessionsStatus>("idle");
  const [walletConnectSessionsError, setWalletConnectSessionsError] = useState<string | null>(null);
  const [disconnectingTopic, setDisconnectingTopic] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletRecord, setWalletRecord] = useState<Awaited<ReturnType<typeof readWalletRecord>>>(null);
  const [portfolioStore, setPortfolioStore] = useState<AssetStore | null>(null);
  const [portfolioTotal, setPortfolioTotal] = useState<string>(() => formatUsd(undefined));
  const [portfolioUpdatedAt, setPortfolioUpdatedAt] = useState<string>(() => formatUpdatedAt(undefined));
  const [newNetworkName, setNewNetworkName] = useState("");
  const [newNetworkFamily, setNewNetworkFamily] = useState<NetworkFamily>("custom");
  const [newNetworkChain, setNewNetworkChain] = useState("");
  const [newNetworkChainId, setNewNetworkChainId] = useState("");
  const [newNetworkSymbol, setNewNetworkSymbol] = useState("");
  const [newNetworkRpcUrl, setNewNetworkRpcUrl] = useState("");
  const [sendTokenQuery, setSendTokenQuery] = useState("");
  const [sendRecipientInput, setSendRecipientInput] = useState("");
  const [sendRecipientResolution, setSendRecipientResolution] = useState<RecipientResolution>({ kind: "empty", input: "" });
  const [sendResolverStatus, setSendResolverStatus] = useState<SendResolverStatus>("idle");
  const [sendNetworkId, setSendNetworkId] = useState<string | null>(null);
  const [sendAmountInput, setSendAmountInput] = useState("");
  const [sendFeeEstimate, setSendFeeEstimate] = useState<TransactionFeeEstimate | null>(null);
  const [sendFeeStatus, setSendFeeStatus] = useState<SendFeeStatus>("idle");
  const [sendFeeError, setSendFeeError] = useState<string | null>(null);
  const [sendReviewError, setSendReviewError] = useState<string | null>(null);
  const [swapNetworkId, setSwapNetworkId] = useState<string | null>(null);
  const [swapSellAssetId, setSwapSellAssetId] = useState<string | null>(null);
  const [swapBuyAssetId, setSwapBuyAssetId] = useState<string | null>(null);
  const [swapSellAmount, setSwapSellAmount] = useState("");
  const [swapPrice, setSwapPrice] = useState<ZeroExSwapQuote | null>(null);
  const [swapPriceStatus, setSwapPriceStatus] = useState<SwapQuoteStatus>("idle");
  const [swapQuote, setSwapQuote] = useState<ZeroExSwapQuote | null>(null);
  const [swapQuoteStatus, setSwapQuoteStatus] = useState<SwapQuoteStatus>("idle");
  const [swapError, setSwapError] = useState<string | null>(null);
  const [recentRecipients, setRecentRecipients] = useState<RecentRecipient[]>([]);
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [activityQuery, setActivityQuery] = useState("");
  const [activityFilter, setActivityFilter] = useState<"all" | ActivityCategory>("all");
  const [addressBookContacts, setAddressBookContacts] = useState<AddressBookContact[]>([]);
  const [addressBookQuery, setAddressBookQuery] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactRecipient, setContactRecipient] = useState("");
  const [contactNetworkId, setContactNetworkId] = useState("");
  const [contactFavorite, setContactFavorite] = useState(false);
  const [contactTrusted, setContactTrusted] = useState(true);
  const [addressBookError, setAddressBookError] = useState<string | null>(null);
  const [uiSettings, setUiSettings] = useState<WalletUiSettings>(DEFAULT_WALLET_UI_SETTINGS);
  const [uiSettingsError, setUiSettingsError] = useState<string | null>(null);
  const [resetWalletPending, setResetWalletPending] = useState(false);

  function applyPortfolioStore(nextStore: AssetStore) {
    setPortfolioStore(nextStore);
    setPortfolioTotal(formatUsd(nextStore.portfolioSnapshot?.totalValueUsd));
    setPortfolioUpdatedAt(formatUpdatedAt(nextStore.portfolioSnapshot?.lastUpdatedAt ?? nextStore.portfolioSnapshot?.refreshedAt));
  }

  useEffect(() => {
    Promise.all([readNetworkSettings(), readWalletRecord(), readPortfolioStore(), readRecentRecipients(), readActivityEvents(), readAddressBookContacts(), readWalletUiSettings()])
      .then(([savedSettings, walletRecord, portfolioStore, recipients, events, contacts, walletUiSettings]) => {
        setNetworks(getBuiltInNetworkSettings(savedSettings));
        setWalletRecord(walletRecord);
        setWalletAddress(walletRecord?.address ?? null);
        applyPortfolioStore(portfolioStore);
        setRecentRecipients(recipients);
        setActivityEvents(events);
        setAddressBookContacts(contacts);
        setUiSettings(walletUiSettings);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : t("settings:errors.loadSettings"));
        setNetworks(getBuiltInNetworkSettings());
      });
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!walletRecord) {
      return () => {
        cancelled = true;
      };
    }

    refreshPortfolio(walletRecord.address as Address, walletRecord.chainAccounts)
      .then(({ store }) => {
        if (!cancelled) {
          applyPortfolioStore(store);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : t("settings:errors.loadPortfolio"));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [walletRecord]);

  useEffect(() => {
    const storageChanges = typeof chrome === "undefined" ? undefined : chrome.storage?.onChanged;

    if (!storageChanges) {
      return;
    }

    const handleStorageChange = (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, areaName: string) => {
      if (areaName !== "local") {
        return;
      }

      if (changes.assetStore) {
        readPortfolioStore()
          .then(applyPortfolioStore)
          .catch(() => undefined);
      }

      if (changes.activityEvents) {
        readActivityEvents()
          .then(setActivityEvents)
          .catch(() => undefined);
      }

      if (changes.addressBookContacts) {
        readAddressBookContacts()
          .then(setAddressBookContacts)
          .catch(() => undefined);
      }

      if (changes.walletUiSettings) {
        readWalletUiSettings()
          .then(setUiSettings)
          .catch(() => undefined);
      }
    };

    storageChanges.addListener(handleStorageChange);

    return () => {
      storageChanges.removeListener(handleStorageChange);
    };
  }, []);

  useEffect(() => {
    if (view === "connected-dapps") {
      void loadWalletConnectSessions();
    }
  }, [view]);

  const enabledNetworks = useMemo(() => networks.filter((network) => network.enabled), [networks]);
  const sendNetworks = useMemo(
    () =>
      enabledNetworks.filter(
        (network) =>
          ["ethereum", "arbitrum", "hyperliquid", "polygon", "custom"].includes(network.family) &&
          typeof network.chainId === "number" &&
          /^https?:\/\//i.test(network.selectedRpcUrl)
      ),
    [enabledNetworks]
  );
  const visibleNetworks = useMemo(() => networks.filter((network) => matchesQuery(network, query)), [networks, query]);
  const portfolioSnapshots = useMemo(
    () => Object.values(portfolioStore?.chainAssetSnapshots ?? {}).sort((a, b) => Number(b.totalValueUsd ?? 0) - Number(a.totalValueUsd ?? 0)),
    [portfolioStore]
  );
  const visibleSessions = useMemo(() => {
    const normalizedQuery = sessionQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return walletConnectSessions;
    }

    return walletConnectSessions.filter((session) =>
      [session.name, session.url, session.domain ?? "", session.accounts.join(" "), session.chains.join(" "), session.methods.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [sessionQuery, walletConnectSessions]);
  const recentSessions = useMemo(
    () =>
      [...walletConnectSessions]
        .sort((a, b) => new Date(b.lastActiveAt ?? 0).getTime() - new Date(a.lastActiveAt ?? 0).getTime())
        .slice(0, 4),
    [walletConnectSessions]
  );
  const visibleActivityEvents = useMemo(
    () => searchActivityEvents(activityEvents, activityFilter, activityQuery),
    [activityEvents, activityFilter, activityQuery]
  );
  const activitySummary = useMemo(() => activityTotals(activityEvents), [activityEvents]);
  const visibleAddressBookContacts = useMemo(
    () => searchAddressBookContacts(addressBookContacts, addressBookQuery),
    [addressBookContacts, addressBookQuery]
  );
  const selectedSendNetwork = useMemo(
    () => sendNetworks.find((network) => network.networkId === sendNetworkId) ?? sendNetworks[0] ?? null,
    [sendNetworkId, sendNetworks]
  );
  const selectedSwapNetwork = useMemo(
    () => sendNetworks.find((network) => network.networkId === swapNetworkId) ?? sendNetworks[0] ?? null,
    [sendNetworks, swapNetworkId]
  );
  const swapAssets = useMemo(
    () => swapAssetsForNetwork(portfolioStore, selectedSwapNetwork),
    [portfolioStore, selectedSwapNetwork]
  );
  const selectedSwapSellAsset = useMemo(
    () => swapAssets.find((asset) => asset.definition.assetId === swapSellAssetId) ?? swapAssets[0] ?? null,
    [swapAssets, swapSellAssetId]
  );
  const selectedSwapBuyAsset = useMemo(
    () =>
      swapAssets.find((asset) => asset.definition.assetId === swapBuyAssetId && asset.definition.assetId !== selectedSwapSellAsset?.definition.assetId) ??
      swapAssets.find((asset) => asset.definition.assetId !== selectedSwapSellAsset?.definition.assetId) ??
      null,
    [selectedSwapSellAsset, swapAssets, swapBuyAssetId]
  );
  const sendIntent = useMemo(
    () =>
      buildNativeTokenTransferPreview({
        from: walletAddress ? (walletAddress as Address) : null,
        recipient: sendRecipientResolution,
        amount: sendAmountInput,
        network: selectedSendNetwork
      }),
    [sendAmountInput, sendRecipientResolution, selectedSendNetwork, walletAddress]
  );
  const sendPreview = useMemo(
    () =>
      buildNativeTokenTransferPreview({
        from: walletAddress ? (walletAddress as Address) : null,
        recipient: sendRecipientResolution,
        amount: sendAmountInput,
        network: selectedSendNetwork,
        feeEstimate: sendFeeEstimate
      }),
    [sendAmountInput, sendFeeEstimate, sendRecipientResolution, selectedSendNetwork, walletAddress]
  );

  useEffect(() => {
    if (!sendNetworks.length) {
      setSendNetworkId(null);
      setSwapNetworkId(null);
      return;
    }

    setSendNetworkId((current) => (current && sendNetworks.some((network) => network.networkId === current) ? current : sendNetworks[0].networkId));
    setSwapNetworkId((current) => (current && sendNetworks.some((network) => network.networkId === current) ? current : sendNetworks[0].networkId));
  }, [sendNetworks]);

  useEffect(() => {
    setSwapSellAssetId((current) => (current && swapAssets.some((asset) => asset.definition.assetId === current) ? current : swapAssets[0]?.definition.assetId ?? null));
  }, [swapAssets]);

  useEffect(() => {
    setSwapBuyAssetId((current) =>
      current && swapAssets.some((asset) => asset.definition.assetId === current && asset.definition.assetId !== selectedSwapSellAsset?.definition.assetId)
        ? current
        : swapAssets.find((asset) => asset.definition.assetId !== selectedSwapSellAsset?.definition.assetId)?.definition.assetId ?? null
    );
  }, [selectedSwapSellAsset, swapAssets]);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setSwapPrice(null);
      setSwapQuote(null);
      setSwapError(null);

      const request = buildZeroExRequest(selectedSwapNetwork, selectedSwapSellAsset, selectedSwapBuyAsset, swapSellAmount);

      if (!request) {
        setSwapPriceStatus("idle");
        return;
      }

      setSwapPriceStatus("loading");
      getZeroExSwapPrice(request)
        .then((price) => {
          if (!cancelled) {
            setSwapPrice(price);
            setSwapPriceStatus("ready");
          }
        })
        .catch((cause: unknown) => {
          if (!cancelled) {
            setSwapPriceStatus("error");
            setSwapError(cause instanceof Error ? cause.message : t("settings:errors.swapPrice"));
          }
        });
    }, 360);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [selectedSwapBuyAsset, selectedSwapNetwork, selectedSwapSellAsset, swapSellAmount]);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setSendResolverStatus(sendRecipientInput.trim() ? "resolving" : "idle");

      resolveRecipient(sendRecipientInput)
        .then((resolution) => {
          if (!cancelled) {
            setSendRecipientResolution(resolution);
            setSendResolverStatus("idle");
          }
        })
        .catch((cause: unknown) => {
          if (!cancelled) {
            setSendRecipientResolution({
              kind: "invalid",
              input: sendRecipientInput,
              reason: cause instanceof Error ? cause.message : t("settings:errors.resolveRecipient")
            });
            setSendResolverStatus("idle");
          }
        });
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [sendRecipientInput]);

  useEffect(() => {
    let cancelled = false;

    setSendFeeEstimate(null);
    setSendFeeError(null);

    if (!sendIntent.ok) {
      setSendFeeStatus("idle");
      return () => {
        cancelled = true;
      };
    }

    setSendFeeStatus("estimating");
    estimateNativeTokenTransfer({
      from: sendIntent.preview.from,
      to: sendIntent.preview.to,
      value: sendIntent.preview.amountWei,
      network: selectedSendNetwork ?? undefined
    })
      .then((estimate) => {
        if (!cancelled) {
          setSendFeeEstimate(estimate);
          setSendFeeStatus("ready");
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setSendFeeStatus("error");
          setSendFeeError(cause instanceof Error ? cause.message : t("settings:errors.feeEstimate"));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSendNetwork, sendIntent]);

  function updateNetwork(networkId: string, updater: (network: WalletNetworkSetting) => WalletNetworkSetting) {
    setNetworks((currentNetworks) => currentNetworks.map((network) => (network.networkId === networkId ? updater(network) : network)));
    setSaveStatus("idle");
  }

  function removeNetwork(networkId: string) {
    setNetworks((currentNetworks) => currentNetworks.filter((network) => network.networkId !== networkId));
    setSaveStatus("idle");
  }

  function selectView(nextView: SettingsView) {
    setView(nextView);

    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", nextView === "networks" ? "#networks" : `#${nextView}`);
    }
  }

  function handleAddNetwork() {
    setError(null);

    try {
      const parsedChainId = newNetworkChainId.trim() ? Number(newNetworkChainId.trim()) : undefined;

      if (parsedChainId !== undefined && (!Number.isInteger(parsedChainId) || parsedChainId < 0)) {
        throw new Error(t("settings:errors.chainIdInvalid"));
      }

      const network = createCustomNetwork({
        name: newNetworkName,
        family: newNetworkFamily,
        chain: newNetworkChain,
        chainId: parsedChainId,
        rpcUrl: newNetworkRpcUrl,
        nativeCurrencySymbol: newNetworkSymbol
      });

      setNetworks((currentNetworks) => [...currentNetworks, network]);
      setNewNetworkName("");
      setNewNetworkFamily("custom");
      setNewNetworkChain("");
      setNewNetworkChainId("");
      setNewNetworkSymbol("");
      setNewNetworkRpcUrl("");
      setSaveStatus("idle");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings:errors.addNetwork"));
    }
  }

  async function handleSave() {
    setSaveStatus("saving");
    setError(null);

    try {
      await writeNetworkSettings(networks);
      setSaveStatus("saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings:errors.saveSettings"));
      setSaveStatus("error");
    }
  }

  async function loadWalletConnectSessions() {
    setWalletConnectSessionsStatus("loading");
    setWalletConnectSessionsError(null);

    try {
      const response = await sendRuntimeMessage<{ result?: { sessions: WalletConnectSessionSummary[] } }>({
        type: "walletconnect_sessions"
      });
      setWalletConnectSessions(response.result?.sessions ?? []);
      setWalletConnectSessionsStatus("ready");
    } catch (cause) {
      setWalletConnectSessionsError(cause instanceof Error ? cause.message : t("settings:errors.loadSessions"));
      setWalletConnectSessionsStatus("error");
    }
  }

  async function handleDisconnectWalletConnectSession(topic: string) {
    setDisconnectingTopic(topic);
    setWalletConnectSessionsError(null);

    try {
      const response = await sendRuntimeMessage<{ result?: { sessions: WalletConnectSessionSummary[] } }>({
        type: "walletconnect_disconnect",
        topic
      });
      setWalletConnectSessions(response.result?.sessions ?? []);
    } catch (cause) {
      setWalletConnectSessionsError(cause instanceof Error ? cause.message : t("settings:errors.disconnectSession"));
    } finally {
      setDisconnectingTopic(null);
    }
  }

  async function handleDisconnectAllWalletConnectSessions() {
    setDisconnectingTopic("__all__");
    setWalletConnectSessionsError(null);

    try {
      const response = await sendRuntimeMessage<{ result?: { sessions: WalletConnectSessionSummary[] } }>({
        type: "walletconnect_disconnect_all"
      });
      setWalletConnectSessions(response.result?.sessions ?? []);
    } catch (cause) {
      setWalletConnectSessionsError(cause instanceof Error ? cause.message : t("settings:errors.disconnectAll"));
    } finally {
      setDisconnectingTopic(null);
    }
  }

  async function handleReviewSendTransfer() {
    setSendReviewError(null);

    if (!sendPreview.ok || !selectedSendNetwork || !canSignPreview(sendPreview.preview)) {
      setSendReviewError(t("settings:errors.reviewTransferIncomplete"));
      return;
    }

    try {
      await writePendingNativeSendReview({
        networkId: selectedSendNetwork.networkId,
        recipientInput: sendRecipientInput,
        recipientResolution: sendRecipientResolution,
        amountInput: sendAmountInput,
        createdAt: new Date().toISOString()
      });

      if (typeof chrome !== "undefined" && chrome.action?.openPopup) {
        await chrome.action.openPopup();
        return;
      }

      const popupUrl =
        typeof chrome !== "undefined" && chrome.runtime?.getURL
          ? chrome.runtime.getURL("src/popup/index.html")
          : "/src/popup/index.html";
      window.open(popupUrl, "orchard-portal", "popup,width=780,height=600");
    } catch (cause) {
      setSendReviewError(cause instanceof Error ? cause.message : t("settings:errors.reviewTransfer"));
    }
  }

  async function handleRequestSwapQuote() {
    setSwapError(null);
    setSwapQuote(null);

    const request = buildZeroExRequest(selectedSwapNetwork, selectedSwapSellAsset, selectedSwapBuyAsset, swapSellAmount, walletAddress);

    if (!request) {
      setSwapError(t("settings:errors.swapNoAssets"));
      return;
    }

    setSwapQuoteStatus("loading");

    try {
      setSwapQuote(await getZeroExSwapQuote(request));
      setSwapQuoteStatus("ready");
    } catch (cause) {
      setSwapQuoteStatus("error");
      setSwapError(cause instanceof Error ? cause.message : t("settings:errors.swapQuote"));
    }
  }

  function handleFlipSwapAssets() {
    setSwapSellAssetId(swapBuyAssetId);
    setSwapBuyAssetId(swapSellAssetId);
    setSwapPrice(null);
    setSwapQuote(null);
  }

  async function handleAddAddressBookContact() {
    const nextName = contactName.trim();
    const nextRecipient = contactRecipient.trim();

    if (!nextName || !nextRecipient) {
      setAddressBookError(t("settings:errors.addContactValidation"));
      return;
    }

    const selectedNetwork = networks.find((network) => network.networkId === contactNetworkId);

    try {
      setAddressBookContacts(await addAddressBookContact({
        name: nextName,
        address: nextRecipient,
        ensName: nextRecipient.includes(".") ? nextRecipient : undefined,
        networkId: selectedNetwork?.networkId,
        networkName: selectedNetwork?.name,
        favorite: contactFavorite,
        trusted: contactTrusted
      }));
      setContactName("");
      setContactRecipient("");
      setContactNetworkId("");
      setContactFavorite(false);
      setContactTrusted(true);
      setAddressBookError(null);
    } catch (cause) {
      setAddressBookError(cause instanceof Error ? cause.message : t("settings:errors.addContact"));
    }
  }

  async function handleToggleAddressBookFlag(contactId: string, flag: "favorite" | "trusted") {
    try {
      setAddressBookContacts(await updateAddressBookContact(contactId, (contact) => ({ ...contact, [flag]: !contact[flag] })));
      setAddressBookError(null);
    } catch (cause) {
      setAddressBookError(cause instanceof Error ? cause.message : t("settings:errors.updateContact"));
    }
  }

  async function handleRemoveAddressBookContact(contactId: string) {
    try {
      setAddressBookContacts(await removeAddressBookContact(contactId));
      setAddressBookError(null);
    } catch (cause) {
      setAddressBookError(cause instanceof Error ? cause.message : t("settings:errors.removeContact"));
    }
  }

  async function persistUiSettings(nextSettings: WalletUiSettings) {
    setUiSettings(nextSettings);
    setUiSettingsError(null);

    try {
      await writeWalletUiSettings(nextSettings);
    } catch (cause) {
      setUiSettingsError(cause instanceof Error ? cause.message : t("settings:errors.savePreferences"));
    }
  }

  function handleTogglePortalWidget(widgetId: string) {
    const nextVisibleWidgets = uiSettings.visibleWidgets.includes(widgetId)
      ? uiSettings.visibleWidgets.filter((id) => id !== widgetId)
      : [...uiSettings.visibleWidgets, widgetId];
    void persistUiSettings({ ...uiSettings, visibleWidgets: nextVisibleWidgets });
  }

  function handleMovePortalWidget(widgetId: string, direction: -1 | 1) {
    const index = uiSettings.widgetOrder.indexOf(widgetId);
    const targetIndex = index + direction;

    if (index < 0 || targetIndex < 0 || targetIndex >= uiSettings.widgetOrder.length) {
      return;
    }

    const nextWidgetOrder = [...uiSettings.widgetOrder];
    [nextWidgetOrder[index], nextWidgetOrder[targetIndex]] = [nextWidgetOrder[targetIndex], nextWidgetOrder[index]];
    void persistUiSettings({ ...uiSettings, widgetOrder: nextWidgetOrder });
  }

  function handleResetPortalWidgets() {
    void persistUiSettings({
      ...uiSettings,
      visibleWidgets: DEFAULT_WALLET_UI_SETTINGS.visibleWidgets,
      widgetOrder: DEFAULT_WALLET_UI_SETTINGS.widgetOrder
    });
  }

  async function handleResetLocalWallet() {
    if (!resetWalletPending) {
      setResetWalletPending(true);
      return;
    }

    try {
      await clearWalletRecord();
      setWalletRecord(null);
      setWalletAddress(null);
      setResetWalletPending(false);
    } catch (cause) {
      setUiSettingsError(cause instanceof Error ? cause.message : t("settings:errors.resetWallet"));
    }
  }

  function handlePreviewPortal() {
    const popupUrl =
      typeof chrome !== "undefined" && chrome.runtime?.getURL
        ? chrome.runtime.getURL("src/popup/index.html")
        : "/src/popup/index.html";
    window.open(popupUrl, "orchard-portal-preview", "popup,width=780,height=600");
  }

  return (
    <main className="settings-layout">
      <aside className="settings-sidebar" aria-label={t("settings:sidebar.navigationLabel")}>
        <nav className="settings-side-nav">
          <SidebarItem icon={<Home size={18} />} label={t("settings:sidebar.home")} />
          <SidebarItem icon={<PieChart size={18} />} label={t("settings:sidebar.portfolio")} active={view === "portfolio"} onClick={() => selectView("portfolio")} />
          <SidebarItem icon={<Activity size={18} />} label={t("settings:sidebar.activity")} active={view === "activity"} onClick={() => selectView("activity")} />
          <SidebarItem icon={<Send size={18} />} label={t("settings:sidebar.send")} active={view === "send"} onClick={() => selectView("send")} />
          <SidebarItem icon={<Download size={18} />} label={t("settings:sidebar.receive")} />
          <SidebarItem icon={<Repeat2 size={18} />} label={t("settings:sidebar.swap")} active={view === "swap"} onClick={() => selectView("swap")} />
          <SidebarItem icon={<Globe2 size={18} />} label={t("settings:sidebar.networks")} active={view === "networks"} onClick={() => selectView("networks")} />
          <SidebarItem icon={<UsersRound size={18} />} label={t("settings:sidebar.addressBook")} active={view === "address-book"} onClick={() => selectView("address-book")} />
          <SidebarItem
            icon={<Link2 size={18} />}
            label={t("settings:sidebar.connectedDapp")}
            active={view === "connected-dapps"}
            badge={walletConnectSessions.length ? String(walletConnectSessions.length) : undefined}
            onClick={() => selectView("connected-dapps")}
          />
          <SidebarItem icon={<Shield size={18} />} label={t("settings:sidebar.security")} active={view === "security"} onClick={() => selectView("security")} />
          <SidebarItem icon={<Settings2 size={18} />} label={t("settings:sidebar.settings")} active={view === "settings"} onClick={() => selectView("settings")} />
        </nav>

        <div className="settings-sidebar-spacer" />

        <section className="sidebar-balance-card" aria-label={t("settings:sidebar.totalBalance")}>
          <span>{t("settings:sidebar.totalBalance")}</span>
          <strong>{portfolioTotal}</strong>
          <small>{portfolioUpdatedAt}</small>
          <svg viewBox="0 0 120 42" aria-hidden="true">
            <polyline points="2,34 18,34 30,28 43,31 54,18 67,15 80,24 93,20 110,9 118,12" />
          </svg>
        </section>

        <section className="sidebar-wallet-card" aria-label={t("settings:regions.activeWallet")}>
          <span className="sidebar-wallet-avatar" />
          <div>
            <strong>{t("settings:sidebar.wallet1")}</strong>
            <small title={walletAddress ?? undefined}>{walletAddress ?? t("settings:sidebar.noWallet")}</small>
          </div>
        </section>
      </aside>

      {view === "send" ? (
      <SendSettingsPanel
        walletAddress={walletAddress}
        portfolioTotal={portfolioTotal}
        portfolioStore={portfolioStore}
        networks={sendNetworks}
        selectedNetwork={selectedSendNetwork}
        tokenQuery={sendTokenQuery}
        recipientInput={sendRecipientInput}
        recipientResolution={sendRecipientResolution}
        resolverStatus={sendResolverStatus}
        amountInput={sendAmountInput}
        feeStatus={sendFeeStatus}
        feeError={sendFeeError}
        reviewError={sendReviewError}
        preview={sendPreview}
        recentRecipients={recentRecipients}
        onTokenQuery={setSendTokenQuery}
        onSelectNetwork={setSendNetworkId}
        onRecipientInput={setSendRecipientInput}
        onAmountInput={setSendAmountInput}
        onReviewTransfer={handleReviewSendTransfer}
        onOpenAddressBook={() => selectView("address-book")}
      />
      ) : view === "swap" ? (
      <SwapSettingsPanel
        walletAddress={walletAddress}
        network={selectedSwapNetwork}
        networks={sendNetworks}
        assets={swapAssets}
        sellAsset={selectedSwapSellAsset}
        buyAsset={selectedSwapBuyAsset}
        sellAmount={swapSellAmount}
        price={swapPrice}
        priceStatus={swapPriceStatus}
        quote={swapQuote}
        quoteStatus={swapQuoteStatus}
        error={swapError}
        onNetwork={setSwapNetworkId}
        onSellAsset={setSwapSellAssetId}
        onBuyAsset={setSwapBuyAssetId}
        onSellAmount={setSwapSellAmount}
        onFlip={handleFlipSwapAssets}
        onQuote={handleRequestSwapQuote}
      />
      ) : view === "activity" ? (
      <ActivitySettingsPanel
        events={visibleActivityEvents}
        totalEvents={activityEvents.length}
        summary={activitySummary}
        query={activityQuery}
        filter={activityFilter}
        onQuery={setActivityQuery}
        onFilter={setActivityFilter}
      />
      ) : view === "address-book" ? (
      <AddressBookSettingsPanel
        contacts={visibleAddressBookContacts}
        totalContacts={addressBookContacts.length}
        favoriteCount={addressBookContacts.filter((contact) => contact.favorite).length}
        recentRecipients={recentRecipients}
        networks={networks}
        query={addressBookQuery}
        name={contactName}
        recipient={contactRecipient}
        networkId={contactNetworkId}
        favorite={contactFavorite}
        trusted={contactTrusted}
        error={addressBookError}
        onQuery={setAddressBookQuery}
        onName={setContactName}
        onRecipient={setContactRecipient}
        onNetwork={setContactNetworkId}
        onFavorite={setContactFavorite}
        onTrusted={setContactTrusted}
        onAdd={handleAddAddressBookContact}
        onToggleFlag={handleToggleAddressBookFlag}
        onRemove={handleRemoveAddressBookContact}
        onUseRecipient={(recipient) => {
          setSendRecipientInput(recipient);
          selectView("send");
        }}
      />
      ) : view === "networks" ? (
      <section className="settings-main-panel">
        <header className="settings-page-header">
          <div>
            <h1>{t("settings:networks.title")}</h1>
            <p>{t("settings:networks.description")}</p>
          </div>
          <button type="button" className="settings-help-button" aria-label={t("settings:networks.helpLabel")}>
            <HelpCircle size={18} />
          </button>
        </header>

        <section className="settings-network-hero">
          <div>
            <span className="settings-hero-icon">
              <Globe2 size={26} />
            </span>
            <strong>{networks.length}</strong>
            <p>
              <b>{t("settings:networks.networkCount", { count: networks.length })}</b>
              <span>{t("settings:networks.available")}</span>
            </p>
          </div>
          <div>
            <span className="settings-hero-icon">
              <Check size={26} />
            </span>
            <strong>{enabledNetworks.length}</strong>
            <p>
              <b>{t("settings:networks.enabledCount")}</b>
              <span>{t("settings:networks.networkCount", { count: enabledNetworks.length })}</span>
            </p>
          </div>
        </section>

        <section className="settings-toolbar">
          <label className="settings-search">
            <Search size={16} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("settings:networks.searchPlaceholder")}
            />
          </label>
        </section>

        {error ? <p className="error-box">{error}</p> : null}

        <section className="network-list settings-network-table" aria-label={t("settings:regions.networkRpcSettings")}>
          {visibleNetworks.map((network) => (
            <details className={`network-row ${network.enabled ? "enabled" : ""}`} key={network.networkId}>
              <summary className="network-row-summary">
                <div className="network-title">
                  <ChainBadge network={network} />
                  <div>
                    <h2>
                      {network.name}
                      {network.networkId === "ethereum-mainnet" ? <span className="default-badge">{t("settings:networks.defaultBadge")}</span> : null}
                    </h2>
                    <p>{network.chainId ? t("settings:networks.chainIdPrefix", { chainId: network.chainId }) : network.family}</p>
                  </div>
                </div>

                <strong className="network-token-symbol">{network.nativeCurrencySymbol}</strong>

                <div className="network-actions">
                  <span className={`network-state ${network.enabled ? "enabled" : ""}`}>{network.enabled ? t("settings:networks.enabled") : t("settings:networks.disabled")}</span>
                  <label className="switch-toggle" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={network.enabled}
                      onChange={(event) =>
                        updateNetwork(network.networkId, (currentNetwork) => ({
                          ...currentNetwork,
                          enabled: event.target.checked
                        }))
                      }
                    />
                    <span />
                  </label>

                  {network.isCustom ? (
                    <button
                      type="button"
                      className="icon-danger-button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        removeNetwork(network.networkId);
                      }}
                      title={t("settings:networks.removeLabel")}
                    >
                      <Trash2 size={16} />
                    </button>
                  ) : null}

                  <ChevronDown size={16} className="network-row-chevron" />
                </div>
              </summary>

              <label className="rpc-select">
                <span>{t("settings:networks.rpcEndpoint")}</span>
                <select
                  value={network.selectedRpcUrl}
                  disabled={!network.enabled}
                  onChange={(event) =>
                    updateNetwork(network.networkId, (currentNetwork) => ({
                      ...currentNetwork,
                      selectedRpcUrl: event.target.value
                    }))
                  }
                >
                  {network.rpcUrls.map((rpcUrl) => (
                    <option value={rpcUrl} key={rpcUrl}>
                      {rpcUrl}
                    </option>
                  ))}
                </select>
              </label>
            </details>
          ))}

          {visibleNetworks.length === 0 ? (
            <div className="settings-empty">
              <Search size={20} />
              <span>{t("settings:networks.noMatch")}</span>
            </div>
          ) : null}
        </section>

        <details className="manual-network-panel settings-add-network">
          <summary>
            <span className="add-network-icon">
              <Plus size={20} />
            </span>
            <div>
              <strong>{t("settings:networks.addCustomTitle")}</strong>
              <small>{t("settings:networks.addCustomDescription")}</small>
            </div>
          </summary>

          <div className="manual-network-grid">
            <label>
              <span>{t("settings:networks.nameLabel")}</span>
              <input value={newNetworkName} onChange={(event) => setNewNetworkName(event.target.value)} placeholder={t("settings:networks.namePlaceholder")} />
            </label>
            <label>
              <span>{t("settings:networks.familyLabel")}</span>
              <select value={newNetworkFamily} onChange={(event) => setNewNetworkFamily(event.target.value as NetworkFamily)}>
                {FAMILIES.map((family) => (
                  <option value={family} key={family}>
                    {family}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t("settings:networks.chainIdLabel")}</span>
              <input value={newNetworkChain} onChange={(event) => setNewNetworkChain(event.target.value)} placeholder={t("settings:networks.networkChainPlaceholder")} />
            </label>
            <label>
              <span>{t("settings:networks.chainIdLabel")}</span>
              <input value={newNetworkChainId} onChange={(event) => setNewNetworkChainId(event.target.value)} inputMode="numeric" placeholder={t("settings:networks.chainIdOptional")} />
            </label>
            <label>
              <span>{t("settings:networks.symbolLabel")}</span>
              <input value={newNetworkSymbol} onChange={(event) => setNewNetworkSymbol(event.target.value)} placeholder={t("settings:networks.symbolPlaceholder")} />
            </label>
            <label className="manual-rpc-url">
              <span>{t("settings:networks.rpcUrlLabel")}</span>
              <input value={newNetworkRpcUrl} onChange={(event) => setNewNetworkRpcUrl(event.target.value)} placeholder={t("settings:networks.rpcUrlPlaceholder")} />
            </label>
          </div>

          <button type="button" className="secondary-button settings-button" onClick={handleAddNetwork}>
            <Plus size={17} />
            {t("settings:networks.addCustomButton")}
          </button>
        </details>

        <footer className="settings-footer">
          <span>{visibleNetworks.length < networks.length ? t("settings:networks.showingCount", { visible: visibleNetworks.length, total: networks.length }) : t("settings:networks.networkCount", { count: networks.length })}</span>
          <button type="button" className="primary-button settings-save" onClick={handleSave} disabled={saveStatus === "saving"}>
            {saveStatus === "saved" ? <Check size={17} /> : <Save size={17} />}
            {saveStatus === "saving" ? t("settings:networks.saving") : saveStatus === "saved" ? t("settings:networks.saved") : t("settings:networks.saveSettings")}
          </button>
        </footer>
      </section>
      ) : view === "connected-dapps" ? (
      <section className="settings-main-panel connected-dapp-panel">
        <header className="settings-page-header connected-dapp-header">
          <div>
            <h1>{t("settings:connectedDapps.title")}</h1>
            <p>{t("settings:connectedDapps.description")}</p>
          </div>
          <button type="button" className="settings-help-button" aria-label={t("settings:connectedDapps.helpLabel")}>
            <HelpCircle size={18} />
          </button>
        </header>

        <section className="connected-session-hero">
          <div>
            <span>{t("settings:connectedDapps.overview")}</span>
            <strong>
              {t("settings:connectedDapps.active", { count: walletConnectSessions.length })}
              <i />
            </strong>
            <small>{walletConnectSessions.length > 0 ? t("settings:connectedDapps.activeConnections") : t("settings:connectedDapps.noConnections")}</small>
          </div>
          <div className="recent-session-list">
            <span>{t("settings:connectedDapps.recentActivity")}</span>
            {recentSessions.length > 0 ? (
              recentSessions.map((session) => (
                <div className="recent-session-item" key={session.topic}>
                  <DappIcon session={session} />
                  <strong>{session.name}</strong>
                  <small>{formatRelativeTime(session.lastActiveAt)}</small>
                </div>
              ))
            ) : (
              <p>{t("settings:connectedDapps.noActivity")}</p>
            )}
          </div>
        </section>

        <section className="connected-session-toolbar">
          <label className="settings-search">
            <Search size={16} />
            <input
              type="search"
              value={sessionQuery}
              onChange={(event) => setSessionQuery(event.target.value)}
              placeholder={t("settings:connectedDapps.searchPlaceholder")}
            />
          </label>
          <button type="button" className="session-filter-button">
            <SlidersHorizontal size={16} />
            {t("settings:connectedDapps.filterButton")}
          </button>
          <button type="button" className="session-filter-button session-sort-button" onClick={loadWalletConnectSessions}>
            <RefreshCcw className={walletConnectSessionsStatus === "loading" ? "spin" : undefined} size={16} />
            {t("settings:connectedDapps.sortLastActive")}
          </button>
        </section>

        <section className="connected-session-table" aria-label={t("settings:regions.connectedSessions")}>
          {visibleSessions.map((session) => (
            <article className="connected-session-row" key={session.topic}>
              <div className="connected-session-app">
                <DappIcon session={session} />
                <div>
                  <strong>{session.name}</strong>
                  <span>{originLabel(session)}</span>
                  <small><i /> {t("settings:connectedDapps.connected")}</small>
                </div>
              </div>
              <div>
                <span>{t("settings:connectedDapps.lastActive")}</span>
                <strong>{formatRelativeTime(session.lastActiveAt)}</strong>
              </div>
              <div>
                <span>{t("settings:connectedDapps.connectedAccount")}</span>
                <strong>{t("settings:connectedDapps.account1")}</strong>
                <small>{session.accounts[0]?.split(":").pop() ? formatAddress(session.accounts[0].split(":").pop() ?? "") : (walletAddress ? formatAddress(walletAddress) : t("settings:connectedDapps.noAccount"))}</small>
              </div>
              <div>
                <span>{t("settings:connectedDapps.allowedChains")}</span>
                <ChainPills chains={session.chains} />
              </div>
              <div>
                <span>{t("settings:connectedDapps.permissions")}</span>
                <strong>{sessionPermissions(session)}</strong>
              </div>
              <button
                type="button"
                className="wc-disconnect session-row-action"
                disabled={disconnectingTopic === session.topic}
                onClick={() => handleDisconnectWalletConnectSession(session.topic)}
                title={t("settings:connectedDapps.disconnectLabel")}
              >
                {disconnectingTopic === session.topic ? <Loader2 className="spin" size={16} /> : <Unplug size={16} />}
              </button>
            </article>
          ))}

          {visibleSessions.length === 0 ? (
            <div className="settings-empty connected-session-empty">
              <Link2 size={20} />
              <span>{walletConnectSessionsStatus === "loading" ? t("settings:connectedDapps.loading") : t("settings:connectedDapps.empty")}</span>
            </div>
          ) : null}
        </section>

        {walletConnectSessionsError ? <p className="error-box">{walletConnectSessionsError}</p> : null}

        <footer className="settings-footer">
          <span>{visibleSessions.length < walletConnectSessions.length ? t("settings:connectedDapps.showingCount", { visible: visibleSessions.length, total: walletConnectSessions.length }) : t("settings:connectedDapps.showingTotal", { count: walletConnectSessions.length })}</span>
          <div className="settings-footer-actions">
            <button
              type="button"
              className="disconnect-all-button"
              disabled={walletConnectSessions.length === 0 || disconnectingTopic === "__all__"}
              onClick={handleDisconnectAllWalletConnectSessions}
            >
              {disconnectingTopic === "__all__" ? <Loader2 className="spin" size={16} /> : <Unplug size={16} />}
              {t("settings:connectedDapps.disconnectAll")}
            </button>
            <button type="button" className="primary-button settings-save" onClick={handleSave} disabled={saveStatus === "saving"}>
            {saveStatus === "saved" ? <Check size={17} /> : <Save size={17} />}
              {saveStatus === "saving" ? t("settings:networks.saving") : saveStatus === "saved" ? t("settings:networks.saved") : t("settings:networks.saveSettings")}
            </button>
          </div>
        </footer>
      </section>
      ) : view === "security" ? (
      <SecuritySettingsPanel
        walletRecord={walletRecord}
        addressBookCount={addressBookContacts.length}
        onOpenAddressBook={() => selectView("address-book")}
      />
      ) : view === "settings" ? (
      <WalletSettingsPanel
        walletRecord={walletRecord}
        walletAddress={walletAddress}
        settings={uiSettings}
        snapshots={portfolioSnapshots}
        portfolioTotal={portfolioTotal}
        error={uiSettingsError}
        resetWalletPending={resetWalletPending}
        onTogglePrivacy={() => void persistUiSettings({ ...uiSettings, privacyMode: !uiSettings.privacyMode })}
        onResetWallet={() => void handleResetLocalWallet()}
        onOpenNetworks={() => selectView("networks")}
        onToggleWidget={handleTogglePortalWidget}
        onMoveWidget={handleMovePortalWidget}
        onResetWidgets={handleResetPortalWidgets}
        onPreviewPortal={handlePreviewPortal}
        onCompactMode={(compactMode) => void persistUiSettings({ ...uiSettings, compactMode })}
        onStartPage={(startPage) => void persistUiSettings({ ...uiSettings, startPage })}
      />
      ) : (
      <PortfolioSettingsPanel
        walletAddress={walletAddress}
        total={portfolioTotal}
        updatedAt={portfolioUpdatedAt}
        snapshots={portfolioSnapshots}
      />
      )}
    </main>
  );
}

function ActivitySettingsPanel({
  events,
  totalEvents,
  summary,
  query,
  filter,
  onQuery,
  onFilter
}: {
  events: ActivityEvent[];
  totalEvents: number;
  summary: ReturnType<typeof activityTotals>;
  query: string;
  filter: "all" | ActivityCategory;
  onQuery: (query: string) => void;
  onFilter: (filter: "all" | ActivityCategory) => void;
}) {
  const { t } = useTranslation();
  const eventGroups = activityGroups(events);

  return (
    <section className="settings-main-panel activity-settings-panel">
      <header className="settings-page-header">
        <div>
          <h1>{t("settings:activity.title")}</h1>
          <p>{t("settings:activity.description")}</p>
        </div>
        <button type="button" className="settings-help-button" aria-label={t("settings:activity.helpLabel")}>
          <HelpCircle size={18} />
        </button>
      </header>

      <section className="activity-summary-hero" aria-label={t("settings:regions.activityOverview")}>
        <ActivitySummaryItem icon={<Activity size={28} />} value={summary.total} label={t("settings:activity.summaryTotal")} detail={t("settings:activity.recentHistory")} />
        <ActivitySummaryItem icon={<Clock3 size={28} />} value={summary.pending} label={t("settings:activity.summaryPending")} detail={t("settings:activity.requiresAttention")} tone="pending" />
        <ActivitySummaryItem icon={<CircleCheck size={28} />} value={summary.successful} label={t("settings:activity.summarySuccessful")} detail={t("settings:activity.recordedActions")} tone="success" />
      </section>

      <section className="activity-toolbar" aria-label={t("settings:regions.activityFilters")}>
        <div className="activity-filter-tabs">
          {ACTIVITY_FILTERS.map((item) => (
            <button type="button" className={item.id === filter ? "active" : ""} onClick={() => onFilter(item.id)} key={item.id}>
              {item.label}
            </button>
          ))}
        </div>
        <label className="settings-search activity-search">
          <Search size={16} />
          <input type="search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder={t("settings:activity.searchPlaceholder")} />
        </label>
        <span className="activity-sort-pill">
          <SlidersHorizontal size={16} />
          {t("settings:activity.latestFirst")}
        </span>
      </section>

      <section className="activity-timeline" aria-label={t("settings:regions.activityHistory")}>
        {eventGroups.map((group) => (
          <section className="activity-day-group" key={group.label}>
            <h2>{group.label}</h2>
            <div className="activity-table">
              {group.events.map((event) => (
                <article className="activity-table-row" key={event.id}>
                  <span className={`activity-kind ${event.category} ${event.status}`}>{activityIcon(event)}</span>
                  <div className="activity-main">
                    <strong>{event.title}</strong>
                    <small>{event.detail}</small>
                  </div>
                  <ActivityAmountCell event={event} />
                  <time dateTime={event.createdAt}>{formatActivityTime(event.createdAt)}</time>
                  <span className={`activity-status ${event.status}`}>{activityStatusLabel(event.status, t)}</span>
                </article>
              ))}
            </div>
          </section>
        ))}

        {events.length === 0 ? (
          <div className="settings-empty activity-empty">
            <Activity size={20} />
            <span>{totalEvents ? t("settings:activity.emptyFiltered") : t("settings:activity.empty")}</span>
          </div>
        ) : null}
      </section>
    </section>
  );
}

function AddressBookSettingsPanel({
  contacts,
  totalContacts,
  favoriteCount,
  recentRecipients,
  networks,
  query,
  name,
  recipient,
  networkId,
  favorite,
  trusted,
  error,
  onQuery,
  onName,
  onRecipient,
  onNetwork,
  onFavorite,
  onTrusted,
  onAdd,
  onToggleFlag,
  onRemove,
  onUseRecipient
}: {
  contacts: AddressBookContact[];
  totalContacts: number;
  favoriteCount: number;
  recentRecipients: RecentRecipient[];
  networks: WalletNetworkSetting[];
  query: string;
  name: string;
  recipient: string;
  networkId: string;
  favorite: boolean;
  trusted: boolean;
  error: string | null;
  onQuery: (query: string) => void;
  onName: (name: string) => void;
  onRecipient: (recipient: string) => void;
  onNetwork: (networkId: string) => void;
  onFavorite: (favorite: boolean) => void;
  onTrusted: (trusted: boolean) => void;
  onAdd: () => void;
  onToggleFlag: (contactId: string, flag: "favorite" | "trusted") => void;
  onRemove: (contactId: string) => void;
  onUseRecipient: (recipient: string) => void;
}) {
  const { t } = useTranslation();
  const trustedContacts = contacts.filter((contact) => contact.trusted).slice(0, 5);
  const recentRows = recentRecipients.slice(0, 5);

  async function copyRecipient(value: string) {
    await navigator.clipboard?.writeText(value);
  }

  return (
    <section className="settings-main-panel address-book-settings-panel">
      <header className="settings-page-header">
        <div>
          <h1>{t("settings:addressBook.title")}</h1>
          <p>{t("settings:addressBook.description")}</p>
        </div>
        <button type="button" className="settings-help-button" aria-label={t("settings:addressBook.helpLabel")}>
          <HelpCircle size={18} />
        </button>
      </header>

      <section className="address-book-hero" aria-label={t("settings:regions.addressBookOverview")}>
        <AddressBookSummary icon={<UsersRound size={24} />} value={totalContacts} label={t("settings:addressBook.totalContacts")} />
        <AddressBookSummary icon={<Star size={24} />} value={favoriteCount} label={t("settings:addressBook.favorites")} />
        <AddressBookSummary icon={<Clock3 size={24} />} value={recentRecipients.length} label={t("settings:addressBook.recentRecipients")} />
      </section>

      <section className="address-book-toolbar" aria-label={t("settings:regions.addressBookControls")}>
        <label className="settings-search address-book-search">
          <Search size={16} />
          <input
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder={t("settings:addressBook.searchPlaceholder")}
          />
        </label>
        <span className="address-book-tool-pill">
          <SlidersHorizontal size={16} />
          {t("settings:addressBook.filter")}
        </span>
        <span className="address-book-tool-pill">
          <ArrowRight size={16} />
          {t("settings:addressBook.recentFirst")}
        </span>
      </section>

      <section className="address-book-layout">
        <div className="address-book-primary">
          <form
            className="address-book-add-card"
            onSubmit={(event) => {
              event.preventDefault();
              onAdd();
            }}
          >
            <div>
              <strong>{t("settings:addressBook.addContactTitle")}</strong>
              <small>{t("settings:addressBook.addContactDescription")}</small>
            </div>
            <div className="address-book-add-fields">
              <input value={name} onChange={(event) => onName(event.target.value)} placeholder={t("settings:addressBook.addNamePlaceholder")} />
              <input value={recipient} onChange={(event) => onRecipient(event.target.value)} placeholder={t("settings:addressBook.addRecipientPlaceholder")} spellCheck={false} />
              <select value={networkId} onChange={(event) => onNetwork(event.target.value)}>
                <option value="">{t("settings:addressBook.anyNetworkOption")}</option>
                {networks.map((network) => (
                  <option value={network.networkId} key={network.networkId}>
                    {network.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="address-book-add-actions">
              <label>
                <input type="checkbox" checked={favorite} onChange={(event) => onFavorite(event.target.checked)} />
                {t("settings:addressBook.favorites")}
              </label>
              <label>
                <input type="checkbox" checked={trusted} onChange={(event) => onTrusted(event.target.checked)} />
                {t("settings:addressBook.trusted")}
              </label>
              <button type="submit">
                <Plus size={16} />
                {t("settings:addressBook.addButton")}
              </button>
            </div>
            {error ? <small className="address-book-error">{error}</small> : null}
          </form>

          <section className="address-book-table" aria-label={t("settings:regions.savedContacts")}>
            <header>
              <span>{t("settings:addressBook.tableContact")}</span>
              <span>{t("settings:addressBook.tableAddress")}</span>
              <span>{t("settings:addressBook.tableNetworkTags")}</span>
              <span>{t("settings:addressBook.tableLastUsed")}</span>
              <span>{t("settings:addressBook.tableActions")}</span>
            </header>

            {contacts.map((contact) => (
              <article className="address-book-row" key={contact.id}>
                <button
                  type="button"
                  className={`address-book-star${contact.favorite ? " active" : ""}`}
                  aria-label={contact.favorite ? t("settings:addressBook.removeFavoriteLabel", { name: contact.name }) : t("settings:addressBook.addFavoriteLabel", { name: contact.name })}
                  onClick={() => onToggleFlag(contact.id, "favorite")}
                >
                  <Star size={15} />
                </button>
                <span className="address-book-avatar">{contact.name.slice(0, 1).toUpperCase()}</span>
                <div className="address-book-contact">
                  <strong>{contact.name}</strong>
                  <small>{contact.networkName ?? t("settings:addressBook.allNetworks")}</small>
                </div>
                <div className="address-book-recipient">
                  <strong>{contact.ensName ?? formatAddress(contact.address)}</strong>
                  <small title={contact.address}>{contact.ensName ? formatAddress(contact.address) : contact.address}</small>
                </div>
                <div className="address-book-tags">
                  <span>{contact.networkName ?? t("settings:addressBook.anyNetwork")}</span>
                  {contact.trusted ? (
                    <button type="button" onClick={() => onToggleFlag(contact.id, "trusted")}>
                      {t("settings:addressBook.trusted")}
                    </button>
                  ) : (
                    <button type="button" onClick={() => onToggleFlag(contact.id, "trusted")}>
                      {t("settings:addressBook.markTrusted")}
                    </button>
                  )}
                </div>
                <time dateTime={contact.lastUsedAt}>{contact.lastUsedAt ? formatRelativeAge(contact.lastUsedAt) : t("settings:addressBook.notUsed")}</time>
                <div className="address-book-actions">
                  <button type="button" aria-label={t("settings:addressBook.sendToLabel", { name: contact.name })} onClick={() => onUseRecipient(contact.ensName ?? contact.address)}>
                    <Send size={15} />
                  </button>
                  <button type="button" aria-label={t("settings:addressBook.copyAddressLabel", { name: contact.name })} onClick={() => void copyRecipient(contact.address)}>
                    <Copy size={15} />
                  </button>
                  <button type="button" aria-label={t("settings:addressBook.removeLabel", { name: contact.name })} onClick={() => onRemove(contact.id)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            ))}

            {contacts.length === 0 ? (
              <div className="settings-empty address-book-empty">
                <UsersRound size={20} />
                <span>{totalContacts ? t("settings:addressBook.emptyFiltered") : t("settings:addressBook.empty")}</span>
              </div>
            ) : null}
          </section>
        </div>

        <aside className="address-book-aside">
          <AddressBookAside title={t("settings:addressBook.recentRecipients")}>
            {recentRows.map((row) => (
              <button type="button" onClick={() => onUseRecipient(row.ensLabel ?? row.address)} key={`${row.address}:${row.lastUsedAt}`}>
                <span>{(row.ensLabel ?? row.address).slice(0, 1).toUpperCase()}</span>
                <strong>{row.ensLabel ?? formatAddress(row.address)}</strong>
                <small>{row.networkName}</small>
              </button>
            ))}
            {recentRows.length === 0 ? <small>{t("settings:addressBook.recentRecipientsEmpty")}</small> : null}
          </AddressBookAside>

          <AddressBookAside title={t("settings:addressBook.trustedContacts")}>
            {trustedContacts.map((contact) => (
              <button type="button" onClick={() => onUseRecipient(contact.ensName ?? contact.address)} key={contact.id}>
                <ShieldCheck size={15} />
                <strong>{contact.name}</strong>
                <small>{contact.networkName ?? t("settings:addressBook.allNetworks")}</small>
              </button>
            ))}
            {trustedContacts.length === 0 ? <small>{t("settings:addressBook.trustedContactsEmpty")}</small> : null}
          </AddressBookAside>
        </aside>
      </section>
    </section>
  );
}

function AddressBookSummary({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return (
    <div>
      <span>{icon}</span>
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}

function AddressBookAside({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      <div>{children}</div>
    </section>
  );
}

function ActivitySummaryItem({
  icon,
  value,
  label,
  detail,
  tone = "default"
}: {
  icon: ReactNode;
  value: number;
  label: string;
  detail: string;
  tone?: "default" | "pending" | "success";
}) {
  return (
    <div className={tone}>
      <span>{icon}</span>
      <strong>{value}</strong>
      <p>
        <b>{label}</b>
        <small>{detail}</small>
      </p>
    </div>
  );
}

function ActivityAmountCell({ event }: { event: ActivityEvent }) {
  if (!event.amount) {
    return <span className="activity-amount" />;
  }

  const prefix = event.amount.direction === "in" ? "+" : event.amount.direction === "out" ? "-" : "";

  return (
    <strong className={`activity-amount ${event.amount.direction ?? ""}`}>
      {prefix}{event.amount.value} {event.amount.symbol}
    </strong>
  );
}

function activityIcon(event: ActivityEvent): ReactNode {
  switch (event.category) {
    case "wallet":
      return <Wallet size={18} />;
    case "send":
      return <Send size={18} />;
    case "receive":
      return <Download size={18} />;
    case "swap":
      return <Repeat2 size={18} />;
    case "dapp":
      return <Link2 size={18} />;
    case "security":
      return <Shield size={18} />;
    case "settings":
      return <Globe2 size={18} />;
    case "sign":
    default:
      return <ShieldCheck size={18} />;
  }
}

function activityGroups(events: ActivityEvent[]): Array<{ label: string; events: ActivityEvent[] }> {
  const sorted = [...events].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const groups = new Map<string, ActivityEvent[]>();

  sorted.forEach((event) => {
    const label = formatActivityDay(event.createdAt);
    groups.set(label, [...(groups.get(label) ?? []), event]);
  });

  return Array.from(groups, ([label, groupedEvents]) => ({ label, events: groupedEvents }));
}

function formatActivityDay(value: string): string {
  const timestamp = new Date(value);
  const today = new Date();

  if (timestamp.toDateString() === today.toDateString()) {
    return i18n.t("settings:activity.today");
  }

  return timestamp.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function formatActivityTime(value: string): string {
  const timestamp = new Date(value);
  return timestamp.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function activityStatusLabel(status: ActivityStatus, t: (key: string) => string): string {
  switch (status) {
    case "approved":
      return t("settings:activity.statusApproved");
    case "pending":
      return t("settings:activity.statusPending");
    case "reminder":
      return t("settings:activity.statusReminder");
    case "failed":
      return t("settings:activity.statusFailed");
    case "completed":
    default:
      return t("settings:activity.statusCompleted");
  }
}


function WalletSettingsPanel({
  walletRecord,
  walletAddress,
  settings,
  snapshots,
  portfolioTotal,
  error,
  resetWalletPending,
  onTogglePrivacy,
  onResetWallet,
  onOpenNetworks,
  onToggleWidget,
  onMoveWidget,
  onResetWidgets,
  onPreviewPortal,
  onCompactMode,
  onStartPage
}: {
  walletRecord: Awaited<ReturnType<typeof readWalletRecord>>;
  walletAddress: string | null;
  settings: WalletUiSettings;
  snapshots: ChainAssetSnapshot[];
  portfolioTotal: string;
  error: string | null;
  resetWalletPending: boolean;
  onTogglePrivacy: () => void;
  onResetWallet: () => void;
  onOpenNetworks: () => void;
  onToggleWidget: (widgetId: string) => void;
  onMoveWidget: (widgetId: string, direction: -1 | 1) => void;
  onResetWidgets: () => void;
  onPreviewPortal: () => void;
  onCompactMode: (compactMode: boolean) => void;
  onStartPage: (startPage: WalletUiSettings["startPage"]) => void;
}) {
  const { t } = useTranslation();

  function getPortalWidget(widgetId: string): { title: string; detail: string; recommended?: boolean } | undefined {
    const map: Record<string, { title: string; detail: string; recommended?: boolean }> = {
      balance: { title: t("settings:widgets.balanceTitle"), detail: t("settings:widgets.balanceDetail"), recommended: true },
      assets: { title: t("settings:widgets.assetsTitle"), detail: t("settings:widgets.assetsDetail"), recommended: true },
      send: { title: t("settings:widgets.sendTitle"), detail: t("settings:widgets.sendDetail") },
      receive: { title: t("settings:widgets.receiveTitle"), detail: t("settings:widgets.receiveDetail") },
      swap: { title: t("settings:widgets.swapTitle"), detail: t("settings:widgets.swapDetail") },
      activity: { title: t("settings:widgets.activityTitle"), detail: t("settings:widgets.activityDetail") },
      portfolio: { title: t("settings:widgets.portfolioTitle"), detail: t("settings:widgets.portfolioDetail") },
      pufeth: { title: t("settings:widgets.pufethTitle"), detail: t("settings:widgets.pufethDetail") }
    };
    return map[widgetId];
  }

  const widgetOrder = settings.widgetOrder.filter((widgetId) => getPortalWidget(widgetId));
  const visibleWidgetIds = widgetOrder.filter((widgetId) => settings.visibleWidgets.includes(widgetId));
  const topAssets = snapshots.slice(0, 3);

  return (
    <section className="settings-main-panel wallet-settings-panel">
      <header className="settings-page-header wallet-settings-header">
        <div>
          <h1>{t("settings:walletSettings.title")}</h1>
          <p>{t("settings:walletSettings.description")}</p>
        </div>
      </header>

      <section className="wallet-settings-hero" aria-label={t("settings:regions.walletSettingsOverview")}>
        <SettingsMetric icon={<Wallet size={24} />} value={walletRecord ? 1 : 0} label={t("settings:walletSettings.wallet")} detail={walletRecord ? t("settings:walletSettings.localWalletConnected") : t("settings:walletSettings.noWalletFirst")} />
        <SettingsMetric icon={<QrCode size={24} />} value={visibleWidgetIds.length} label={t("settings:walletSettings.widgetsShown")} detail={t("settings:walletSettings.onPortal")} />
        <SettingsMetric icon={<EyeOff size={24} />} value={Math.max(0, widgetOrder.length - visibleWidgetIds.length)} label={t("settings:walletSettings.hiddenWidgets")} detail={t("settings:walletSettings.notVisible")} />
      </section>

      <h2 className="wallet-settings-section-title">{t("settings:walletSettings.walletControlsTitle")}</h2>
      <section className="wallet-controls-grid" aria-label={t("settings:regions.walletControls")}>
        <SettingsControl
          icon={settings.privacyMode ? <Eye size={18} /> : <EyeOff size={18} />}
          title={settings.privacyMode ? t("settings:walletSettings.showBalances") : t("settings:walletSettings.hideBalances")}
          detail={settings.privacyMode ? t("settings:walletSettings.showBalancesDetail") : t("settings:walletSettings.hideBalancesDetail")}
          onClick={onTogglePrivacy}
        />
        <SettingsControl
          icon={<RefreshCcw size={18} />}
          title={resetWalletPending ? t("settings:walletSettings.confirmReset") : t("settings:walletSettings.resetWallet")}
          detail={resetWalletPending ? t("settings:walletSettings.confirmResetDetail") : t("settings:walletSettings.resetWalletDetail")}
          onClick={onResetWallet}
          tone={resetWalletPending ? "danger" : "default"}
        />
        <SettingsControl
          icon={<Globe2 size={18} />}
          title={t("settings:walletSettings.openNetworks")}
          detail={t("settings:walletSettings.openNetworksDetail")}
          onClick={onOpenNetworks}
        />
      </section>

      <section className="portal-layout-editor" aria-label={t("settings:regions.portalDashboardLayout")}>
        <div className="portal-layout-list">
          <header>
            <h2>{t("settings:walletSettings.layoutTitle")}</h2>
            <p>{t("settings:walletSettings.layoutDescription")}</p>
          </header>

          <div className="portal-widget-rows">
            {widgetOrder.map((widgetId, index) => {
              const widget = getPortalWidget(widgetId);
              const visible = settings.visibleWidgets.includes(widgetId);

              if (!widget) return null;

              return (
                <article className={`portal-widget-row${visible ? "" : " hidden"}`} key={widgetId}>
                  <GripVertical size={16} />
                  <span>{portalWidgetIcon(widgetId)}</span>
                  <div>
                    <strong>{widget.title}</strong>
                    <small>{widget.detail}</small>
                  </div>
                  {widget.recommended ? <em>{t("settings:walletSettings.recommended")}</em> : <em />}
                  <div className="portal-widget-actions">
                    <button type="button" disabled={index === 0} onClick={() => onMoveWidget(widgetId, -1)} aria-label={t("settings:walletSettings.moveUp", { title: widget.title })}>
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={index === widgetOrder.length - 1}
                      onClick={() => onMoveWidget(widgetId, 1)}
                      aria-label={t("settings:walletSettings.moveDown", { title: widget.title })}
                    >
                      ↓
                    </button>
                    <button type="button" onClick={() => onToggleWidget(widgetId)} aria-label={visible ? t("settings:walletSettings.hideWidget", { title: widget.title }) : t("settings:walletSettings.showWidget", { title: widget.title })}>
                      {visible ? <Eye size={15} /> : <EyeOff size={15} />}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <small className="portal-layout-footnote">{t("settings:walletSettings.footnoteDashboard")}</small>
        </div>

        <div className="portal-preview-column">
          <header>
            <h2>{t("settings:walletSettings.portalPreview")}</h2>
            <div>
              <button type="button" onClick={onResetWidgets}>
                <RefreshCcw size={14} />
                {t("settings:walletSettings.resetLayout")}
              </button>
              <button type="button" onClick={onPreviewPortal}>
                <Eye size={14} />
                {t("settings:walletSettings.previewPortal")}
              </button>
            </div>
          </header>
          <PortalSettingsPreview
            compactMode={settings.compactMode}
            privacyMode={settings.privacyMode}
            portfolioTotal={portfolioTotal}
            visibleWidgets={visibleWidgetIds}
            snapshots={topAssets}
          />
          <small>{t("settings:walletSettings.previewUpdates")}</small>
        </div>
      </section>

      <h2 className="wallet-settings-section-title">{t("settings:walletSettings.personalizationTitle")}</h2>
      <section className="personalization-grid" aria-label={t("settings:regions.portalPersonalization")}>
        <label className="personalization-setting">
          <span>
            <Settings2 size={18} />
          </span>
          <strong>{t("settings:preferences.compactMode")}</strong>
          <small>{t("settings:preferences.compactModeDetail")}</small>
          <i className="switch-toggle">
            <input type="checkbox" checked={settings.compactMode} onChange={(event) => onCompactMode(event.target.checked)} />
            <span />
          </i>
        </label>

        <label className="personalization-setting">
          <span>
            <DollarSign size={18} />
          </span>
          <strong>{t("settings:preferences.defaultCurrency")}</strong>
          <small>{t("settings:preferences.defaultCurrencyDetail")}</small>
          <select value={settings.defaultCurrency} onChange={() => undefined}>
            <option value="USD">USD</option>
          </select>
        </label>

        <label className="personalization-setting">
          <span>
            <Home size={18} />
          </span>
          <strong>{t("settings:preferences.startPage")}</strong>
          <small>{t("settings:preferences.startPageDetail")}</small>
          <select value={settings.startPage} onChange={(event) => onStartPage(event.target.value as WalletUiSettings["startPage"])}>
            <option value="portal">{t("settings:preferences.startPagePortal")}</option>
            <option value="send">{t("settings:preferences.startPageSend")}</option>
            <option value="receive">{t("settings:preferences.startPageReceive")}</option>
          </select>
        </label>

        <LanguageSelector />
      </section>

      {walletAddress ? <small className="wallet-settings-address">{t("settings:walletSettings.activeAddress", { address: walletAddress })}</small> : null}
      {error ? <p className="error-box">{error}</p> : null}
    </section>
  );
}

function SettingsMetric({ icon, value, label, detail }: { icon: ReactNode; value: number; label: string; detail: string }) {
  return (
    <div>
      <span>{icon}</span>
      <strong>{value}</strong>
      <p>
        <b>{label}</b>
        <small>{detail}</small>
      </p>
    </div>
  );
}

function SettingsControl({
  icon,
  title,
  detail,
  onClick,
  tone = "default"
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  onClick: () => void;
  tone?: "default" | "danger";
}) {
  return (
    <button type="button" className={`wallet-control ${tone}`} onClick={onClick}>
      <span>{icon}</span>
      <strong>{title}</strong>
      <small>{detail}</small>
    </button>
  );
}

function LanguageSelector() {
  const { t, i18n } = useTranslation();
  const currentLanguage = i18n.language as AppLanguage;

  async function handleLanguageChange(event: ChangeEvent<HTMLSelectElement>) {
    await changeAppLanguage(event.target.value as AppLanguage);
  }

  return (
    <label className="personalization-setting">
      <span>
        <Globe2 size={18} />
      </span>
      <strong>{t("settings:language.title")}</strong>
      <small>{t("settings:language.description")}</small>
      <select value={currentLanguage} onChange={(event) => void handleLanguageChange(event)}>
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option value={lang.code} key={lang.code}>
            {lang.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function PortalSettingsPreview({
  compactMode,
  privacyMode,
  portfolioTotal,
  visibleWidgets,
  snapshots
}: {
  compactMode: boolean;
  privacyMode: boolean;
  portfolioTotal: string;
  visibleWidgets: string[];
  snapshots: ChainAssetSnapshot[];
}) {
  const { t } = useTranslation();

  function getWidgetMeta(widgetId: string): { title: string; detail: string } | undefined {
    const map: Record<string, { title: string; detail: string }> = {
      balance: { title: t("settings:widgets.balanceTitle"), detail: t("settings:widgets.balanceDetail") },
      assets: { title: t("settings:widgets.assetsTitle"), detail: t("settings:widgets.assetsDetail") },
      send: { title: t("settings:widgets.sendTitle"), detail: t("settings:widgets.sendDetail") },
      receive: { title: t("settings:widgets.receiveTitle"), detail: t("settings:widgets.receiveDetail") },
      swap: { title: t("settings:widgets.swapTitle"), detail: t("settings:widgets.swapDetail") },
      activity: { title: t("settings:widgets.activityTitle"), detail: t("settings:widgets.activityDetail") },
      portfolio: { title: t("settings:widgets.portfolioTitle"), detail: t("settings:widgets.portfolioDetail") },
      pufeth: { title: t("settings:widgets.pufethTitle"), detail: t("settings:widgets.pufethDetail") }
    };
    return map[widgetId];
  }

  return (
    <section className={`portal-settings-preview${compactMode ? " compact" : ""}`}>
      {visibleWidgets.includes("balance") ? (
        <div className="portal-preview-balance">
          <span>{t("settings:walletSettings.totalBalance")}</span>
          <strong>{privacyMode ? t("settings:widgets.hidden") : portfolioTotal}</strong>
          <small>{t("settings:walletSettings.today")}</small>
          <svg viewBox="0 0 120 36" aria-hidden="true">
            <polyline points="2,26 20,26 33,19 47,23 61,9 76,13 89,23 104,13 118,16" />
          </svg>
        </div>
      ) : null}
      <div className="portal-preview-grid">
        {visibleWidgets.map((widgetId) => {
          if (widgetId === "balance") {
            return null;
          }

          if (widgetId === "assets") {
            return snapshots.map((snapshot) => (
              <div className="portal-preview-asset" key={snapshot.networkId}>
                <TokenBadge symbol={snapshot.nativeCurrencySymbol} family={snapshot.family} />
                <strong>{privacyMode ? t("settings:widgets.hidden") : formatUsd(snapshot.totalValueUsd)}</strong>
                <small>{snapshot.networkName}</small>
              </div>
            ));
          }

          if (widgetId === "pufeth") {
            return (
              <div className="portal-preview-tile pufeth" key={widgetId}>
                <div className="portal-preview-pufeth-header">
                  <span className="portal-preview-pufeth-icon"><Database size={14} /></span>
                  <div>
                    <strong>{t("popup:pufeth.widgetTitle")}</strong>
                    <small>{t("popup:pufeth.stakeEth")}</small>
                  </div>
                </div>
                <div className="portal-preview-pufeth-body">
                  <span className="portal-preview-pufeth-input">0.0</span>
                  <span className="portal-preview-pufeth-max">{t("popup:pufeth.max")}</span>
                  <span className="portal-preview-pufeth-mint">{t("popup:pufeth.mint")}</span>
                </div>
              </div>
            );
          }

          const meta = getWidgetMeta(widgetId);
          return (
            <div className={`portal-preview-tile ${widgetId}`} key={widgetId}>
              <span>{portalWidgetIcon(widgetId)}</span>
              <strong>{meta?.title}</strong>
              <small>{meta?.detail}</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function portalWidgetIcon(widgetId: string): ReactNode {
  switch (widgetId) {
    case "assets":
      return <PieChart size={17} />;
    case "send":
      return <Send size={17} />;
    case "receive":
      return <QrCode size={17} />;
    case "swap":
      return <Repeat2 size={17} />;
    case "activity":
      return <Activity size={17} />;
    case "portfolio":
      return <Clock3 size={17} />;
    case "pufeth":
      return <Database size={17} />;
    case "balance":
    default:
      return <Wallet size={17} />;
  }
}

function SecuritySettingsPanel({
  walletRecord,
  addressBookCount,
  onOpenAddressBook
}: {
  walletRecord: Awaited<ReturnType<typeof readWalletRecord>>;
  addressBookCount: number;
  onOpenAddressBook: () => void;
}) {
  const { t } = useTranslation();
  const walletName = walletRecord?.name?.trim() || "Wallet 1";
  const passkeyStatus = walletRecord ? t("settings:security.passkeyOn") : t("settings:security.passkeyOff");
  const transactionConfirmationStatus = walletRecord ? t("settings:security.transactionConfirmationsOn") : t("settings:security.transactionConfirmationsOff");

  function handleDownloadKeystore() {
    if (!walletRecord?.keystoreJson) {
      return;
    }

    const walletLabel = walletName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "wallet";
    const addressLabel = walletRecord.address.slice(2, 10).toLowerCase();
    const blob = new Blob([walletRecord.keystoreJson], { type: "application/json" });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = downloadUrl;
    anchor.download = `orchard-${walletLabel}-${addressLabel}-keystore.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();

    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
  }

  return (
    <section className="settings-main-panel security-settings-panel">
      <header className="settings-page-header security-settings-header">
        <div>
          <h1>{t("settings:security.title")}</h1>
          <p>{t("settings:security.description")}</p>
        </div>
        <button type="button" className="settings-help-button" aria-label={t("settings:security.helpLabel")}>
          <HelpCircle size={18} />
        </button>
      </header>

      <section className="security-settings-card" aria-label={t("settings:regions.securitySettings")}>
        <div className="security-protection-banner">
          <span>
            <ShieldCheck size={28} />
          </span>
          <div>
            <strong>{walletRecord ? t("settings:security.protected") : t("settings:security.notReady")}</strong>
            <small>{walletRecord ? t("settings:security.protectedDetail") : t("settings:security.notReadyDetail")}</small>
          </div>
        </div>

        <div className="security-settings-list">
          <SecuritySettingRow
            label={t("settings:security.keystoreBackup")}
            value={walletRecord ? t("settings:security.keystoreDownload") : t("settings:security.keystoreUnavailable")}
            onClick={walletRecord ? handleDownloadKeystore : undefined}
            icon={<Download size={16} />}
          />
          <SecuritySettingRow label={t("settings:security.biometricUnlock")} value={passkeyStatus} />
          <SecuritySettingRow label={t("settings:security.transactionConfirmationsLabel")} value={transactionConfirmationStatus} />
          <SecuritySettingRow label={t("settings:security.addressBook")} value={t("settings:security.addressBookCount", { count: addressBookCount })} onClick={onOpenAddressBook} />
        </div>

        <button
          type="button"
          className="security-download-button"
          onClick={handleDownloadKeystore}
          disabled={!walletRecord?.keystoreJson}
        >
          <Download size={18} />
          {t("settings:security.downloadKeystore")}
        </button>
      </section>
    </section>
  );
}

function SecuritySettingRow({
  label,
  value,
  icon,
  onClick
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      {icon}
    </>
  );

  return onClick ? (
    <button type="button" className="security-setting-row actionable" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="security-setting-row">
      {content}
    </div>
  );
}

function SendSettingsPanel({
  walletAddress,
  portfolioTotal,
  portfolioStore,
  networks,
  selectedNetwork,
  tokenQuery,
  recipientInput,
  recipientResolution,
  resolverStatus,
  amountInput,
  feeStatus,
  feeError,
  reviewError,
  preview,
  recentRecipients,
  onTokenQuery,
  onSelectNetwork,
  onRecipientInput,
  onAmountInput,
  onReviewTransfer,
  onOpenAddressBook
}: {
  walletAddress: string | null;
  portfolioTotal: string;
  portfolioStore: AssetStore | null;
  networks: WalletNetworkSetting[];
  selectedNetwork: WalletNetworkSetting | null;
  tokenQuery: string;
  recipientInput: string;
  recipientResolution: RecipientResolution;
  resolverStatus: SendResolverStatus;
  amountInput: string;
  feeStatus: SendFeeStatus;
  feeError: string | null;
  reviewError: string | null;
  preview: ReturnType<typeof buildNativeTokenTransferPreview>;
  recentRecipients: RecentRecipient[];
  onTokenQuery: (value: string) => void;
  onSelectNetwork: (networkId: string | null) => void;
  onRecipientInput: (value: string) => void;
  onAmountInput: (value: string) => void;
  onReviewTransfer: () => void;
  onOpenAddressBook: () => void;
}) {
  const { t } = useTranslation();
  const selectedSnapshot = selectedNetwork ? portfolioStore?.chainAssetSnapshots[selectedNetwork.networkId] : undefined;
  const filteredNetworks = networks.filter((network) =>
    [network.name, network.nativeCurrencySymbol, network.chainId?.toString() ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(tokenQuery.trim().toLowerCase())
  );
  const selectedBalance = selectedSnapshot?.nativeBalance ?? "";
  const recipientHint =
    resolverStatus === "resolving"
      ? t("settings:send.recipientHintResolving")
      : recipientResolution.kind === "ens"
        ? t("settings:send.recipientHintEns", { name: recipientResolution.normalizedName, address: formatAddress(recipientResolution.address) })
        : recipientResolution.kind === "address"
          ? recipientResolution.primaryName
            ? t("settings:send.recipientHintReverseEns", { name: recipientResolution.primaryName })
            : t("settings:send.recipientHintAddress")
          : recipientResolution.kind === "invalid"
            ? recipientResolution.reason
            : t("settings:send.recipientHintDefault");
  const recipientTone = recipientResolution.kind === "invalid" ? "invalid" : recipientResolution.kind === "empty" ? "" : "valid";
  const recentRows = recentRecipients.slice(0, 4);

  return (
    <section className="settings-main-panel send-settings-panel">
      <header className="send-settings-header">
        <h1>{t("settings:send.title")}</h1>
        <button type="button" className="learn-send-button" disabled>
          <HelpCircle size={16} />
          {t("settings:send.helpButton")}
        </button>
      </header>

      <div className="send-settings-layout">
        <section className="send-form-card" aria-label={t("settings:regions.sendTransferForm")}>
          <label>{t("settings:send.fromLabel")}</label>
          <div className="send-account-row">
            <span className="sidebar-wallet-avatar" />
            <div>
              <strong>{t("settings:send.wallet1")}</strong>
              <small>{walletAddress ? formatAddress(walletAddress) : t("settings:send.noWallet")}</small>
            </div>
            <div>
              <strong>{portfolioTotal}</strong>
              <small>{t("settings:send.totalBalance")}</small>
            </div>
            <ChevronDown size={17} />
          </div>

          <label>{t("settings:send.tokenLabel")}</label>
          <button type="button" className="send-token-row" disabled={!selectedNetwork}>
            {selectedNetwork ? (
              <TokenBadge symbol={selectedNetwork.nativeCurrencySymbol} family={selectedNetwork.family} />
            ) : (
              <span className="token-badge family-custom" />
            )}
            <div>
              <strong>{selectedNetwork?.nativeCurrencySymbol ?? "TOKEN"}</strong>
              <small>{selectedNetwork ? `${selectedNetwork.name} network` : t("settings:send.enableEvm")}</small>
            </div>
            <div>
              <strong>
                {selectedBalance ? formatWalletAmount(selectedBalance) : "--"} {selectedNetwork?.nativeCurrencySymbol ?? ""}
              </strong>
              <small>{formatUsd(selectedSnapshot?.totalValueUsd)}</small>
            </div>
            <ChevronDown size={17} />
          </button>

          <label htmlFor="settings-send-recipient">{t("settings:send.recipientLabel")}</label>
          <div className="send-recipient-row">
            <input
              id="settings-send-recipient"
              value={recipientInput}
              onChange={(event) => onRecipientInput(event.target.value)}
              placeholder={t("settings:send.recipientPlaceholder")}
              spellCheck={false}
            />
            <button type="button" onClick={onOpenAddressBook}>
              <BookOpen size={16} />
              {t("settings:send.addressBook")}
            </button>
            <button type="button" aria-label={t("settings:send.scanRecipientLabel")} disabled>
              <QrCode size={16} />
            </button>
          </div>
          <small className={`send-recipient-hint ${recipientTone}`}>{recipientHint}</small>

          <label htmlFor="settings-send-network">{t("settings:send.networkLabel")}</label>
          <div className="send-network-row">
            {selectedNetwork ? <ChainBadge network={selectedNetwork} /> : <span className="chain-badge family-custom" />}
            <select
              id="settings-send-network"
              value={selectedNetwork?.networkId ?? ""}
              onChange={(event) => onSelectNetwork(event.target.value || null)}
              disabled={!networks.length}
            >
              {networks.map((network) => (
                <option value={network.networkId} key={network.networkId}>
                  {network.name}
                </option>
              ))}
            </select>
            <span>
              {t("settings:send.balance", { amount: selectedBalance ? formatWalletAmount(selectedBalance) : "--", symbol: selectedNetwork?.nativeCurrencySymbol ?? "" })}
            </span>
          </div>

          <label htmlFor="settings-send-amount">{t("settings:send.amountLabel")}</label>
          <div className="send-amount-row">
            <input
              id="settings-send-amount"
              inputMode="decimal"
              value={amountInput}
              onChange={(event) => onAmountInput(event.target.value)}
              placeholder="0.0"
              spellCheck={false}
            />
            <button type="button" disabled={!selectedBalance} onClick={() => onAmountInput(selectedBalance)}>
              {t("settings:send.maxButton")}
            </button>
            <strong>{selectedNetwork?.nativeCurrencySymbol ?? "TOKEN"}</strong>
          </div>
          <small className="send-usd-hint">{preview.ok ? preview.preview.amount : "0.00"} {selectedNetwork?.nativeCurrencySymbol ?? ""}</small>

          <section className="send-fee-card" aria-live="polite">
            <div>
              <strong>{t("settings:send.feeLabel")}</strong>
              <small>{feeStatus === "estimating" ? t("settings:send.estimating") : feeStatus === "ready" ? t("settings:send.feeLikely") : t("settings:send.complete")}</small>
            </div>
            <div>
              <strong>{preview.ok ? preview.preview.estimatedNetworkFee : t("settings:send.feePending")}</strong>
              <small>{feeError ?? selectedNetwork?.name ?? t("settings:send.noNetwork")}</small>
            </div>
          </section>

          <button
            type="button"
            className="review-transfer-button"
            disabled={!preview.ok || !canSignPreview(preview.preview)}
            onClick={onReviewTransfer}
          >
            {t("settings:send.reviewButton")}
            <ArrowRight size={20} />
          </button>
          {reviewError ? <small className="send-review-error">{reviewError}</small> : null}
          <small className="send-review-note">{t("settings:send.reviewNote")}</small>
        </section>

        <aside className="send-side-column">
          <section className="send-token-picker-card" aria-label={t("settings:regions.selectSendToken")}>
            <div className="send-side-heading">
              <h2>{t("settings:send.selectToken")}</h2>
            </div>
            <label className="settings-search">
              <Search size={17} />
              <input value={tokenQuery} onChange={(event) => onTokenQuery(event.target.value)} placeholder={t("settings:send.searchTokens")} />
            </label>
            <div className="send-token-option-list">
              {filteredNetworks.map((network) => {
                const snapshot = portfolioStore?.chainAssetSnapshots[network.networkId];
                const selected = network.networkId === selectedNetwork?.networkId;
                return (
                  <button type="button" className={selected ? "selected" : ""} key={network.networkId} onClick={() => onSelectNetwork(network.networkId)}>
                    <TokenBadge symbol={network.nativeCurrencySymbol} family={network.family} />
                    <div>
                      <strong>{network.nativeCurrencySymbol}</strong>
                      <small>{network.name}</small>
                    </div>
                    <div>
                      <strong>
                        {snapshot?.nativeBalance ? formatWalletAmount(snapshot.nativeBalance) : "--"} {network.nativeCurrencySymbol}
                      </strong>
                      <small>{formatUsd(snapshot?.totalValueUsd)}</small>
                    </div>
                    {selected ? <Check size={16} /> : null}
                  </button>
                );
              })}
            </div>
            <button type="button" className="send-manage-token" disabled>
              <SlidersHorizontal size={16} />
              {t("settings:send.manageTokens")}
              <ChevronDown size={16} />
            </button>
          </section>

          <section className="send-recent-card" aria-label={t("settings:regions.recentRecipients")}>
            <div className="send-side-heading">
              <h2>{t("settings:send.recentRecipients")}</h2>
              <button type="button" disabled>{t("settings:send.viewAll")}</button>
            </div>
            {recentRows.length ? (
              recentRows.map((recipient) => (
                <button
                  type="button"
                  className="send-recent-row"
                  onClick={() => onRecipientInput(recipient.ensLabel ?? recipient.address)}
                  key={`${recipient.networkId}-${recipient.address}`}
                >
                  <span className="sidebar-wallet-avatar" />
                  <div>
                    <strong>{recipient.ensLabel ?? formatAddress(recipient.address)}</strong>
                    <small>{formatAddress(recipient.address)}</small>
                  </div>
                  <em>{recipient.ensLabel ? "ENS" : "Address"}</em>
                </button>
              ))
            ) : (
              <div className="send-empty-recent">{t("settings:send.noRecentRecipients")}</div>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}

function swapAssetsForNetwork(store: AssetStore | null, network: WalletNetworkSetting | null): SwapAssetOption[] {
  if (!network || !isEvmAssetNetwork(network)) {
    return [];
  }

  // Start from the curated catalog so the selector is never empty, even before
  // the portfolio has been refreshed. Then merge in any extra tokens the
  // portfolio discovered (e.g. user-imported ERC-20s).
  const definitionsById = new Map<string, AssetDefinition>(
    curatedEvmSwapAssets(network).map((definition) => [definition.assetId, definition])
  );

  if (store) {
    for (const definition of Object.values(store.assetDefinitions)) {
      const usable =
        definition.kind === "native" || (definition.kind === "erc20" && Boolean(definition.contractAddress));
      if (definition.networkId === network.networkId && usable && !definitionsById.has(definition.assetId)) {
        definitionsById.set(definition.assetId, definition);
      }
    }
  }

  return [...definitionsById.values()]
    .map((definition) => {
      const balance = store
        ? Object.values(store.assetBalances).find((assetBalance) => assetBalance.assetId === definition.assetId)
        : undefined;
      return {
        definition,
        balance: balance?.decimalAmount ?? null,
        rawBalance: balance?.rawAmount ?? null
      };
    })
    .sort((a, b) => {
      if (a.definition.kind === "native") {
        return -1;
      }

      if (b.definition.kind === "native") {
        return 1;
      }

      return a.definition.symbol.localeCompare(b.definition.symbol);
    });
}

function buildZeroExRequest(
  network: WalletNetworkSetting | null,
  sellAsset: SwapAssetOption | null,
  buyAsset: SwapAssetOption | null,
  sellAmount: string,
  taker?: string | null
) {
  if (!network?.chainId || !sellAsset || !buyAsset || sellAsset.definition.assetId === buyAsset.definition.assetId) {
    return null;
  }

  const sellToken = tokenAddressForZeroEx(sellAsset.definition);
  const buyToken = tokenAddressForZeroEx(buyAsset.definition);

  if (!sellToken || !buyToken) {
    return null;
  }

  try {
    const rawAmount = parseUnits(sellAmount.trim().replace(",", "."), sellAsset.definition.decimals);

    if (rawAmount <= 0n) {
      return null;
    }

    return {
      chainId: network.chainId,
      sellToken,
      buyToken,
      sellAmount: rawAmount.toString(),
      slippageBps: 50,
      ...(taker ? { taker: taker as Address } : {})
    };
  } catch {
    return null;
  }
}

function SwapSettingsPanel({
  walletAddress,
  network,
  networks,
  assets,
  sellAsset,
  buyAsset,
  sellAmount,
  price,
  priceStatus,
  quote,
  quoteStatus,
  error,
  onNetwork,
  onSellAsset,
  onBuyAsset,
  onSellAmount,
  onFlip,
  onQuote
}: {
  walletAddress: string | null;
  network: WalletNetworkSetting | null;
  networks: WalletNetworkSetting[];
  assets: SwapAssetOption[];
  sellAsset: SwapAssetOption | null;
  buyAsset: SwapAssetOption | null;
  sellAmount: string;
  price: ZeroExSwapQuote | null;
  priceStatus: SwapQuoteStatus;
  quote: ZeroExSwapQuote | null;
  quoteStatus: SwapQuoteStatus;
  error: string | null;
  onNetwork: (networkId: string | null) => void;
  onSellAsset: (assetId: string | null) => void;
  onBuyAsset: (assetId: string | null) => void;
  onSellAmount: (amount: string) => void;
  onFlip: () => void;
  onQuote: () => void;
}) {
  const { t } = useTranslation();
  const displayQuote = quote ?? price;
  const displayedBuyAmount = displayQuote && buyAsset ? formatSwapBaseAmount(displayQuote.buyAmount, buyAsset.definition.decimals) : "--";
  const minimumReceived = quote?.minBuyAmount && buyAsset ? formatSwapBaseAmount(quote.minBuyAmount, buyAsset.definition.decimals) : "--";
  const networkFee = displayQuote?.totalNetworkFee && network ? `${formatSwapBaseAmount(displayQuote.totalNetworkFee, 18)} ${network.nativeCurrencySymbol}` : "--";
  const routeSources = Array.from(new Set(displayQuote?.route?.fills?.map((fill) => fill.source) ?? [])).slice(0, 3);
  const balanceIssue = quote?.issues?.balance;
  const allowanceIssue = quote?.issues?.allowance;
  const quoteReady = Boolean(quote?.transaction);

  return (
    <section className="settings-main-panel swap-settings-panel">
      <header className="settings-page-header swap-settings-header">
        <div>
          <h1>{t("settings:swap.title")}</h1>
          <p>{t("settings:swap.description")}</p>
        </div>
        <button type="button" className="settings-help-button" aria-label={t("settings:swap.helpLabel")}>
          <HelpCircle size={18} />
        </button>
      </header>

      <section className="swap-summary-hero" aria-label={t("settings:regions.swapSummary")}>
        <SettingsMetric icon={<Repeat2 size={24} />} value={1} label={t("settings:swap.zeroExLabel")} detail={t("settings:swap.quoteSourceLabel")} />
        <SettingsMetric icon={<SlidersHorizontal size={24} />} value={50} label={t("settings:swap.slippageBpsLabel")} detail={t("settings:swap.slippageBpsDetail")} />
        <SettingsMetric icon={<Clock3 size={24} />} value={30} label={t("settings:swap.secondsLabel")} detail={t("settings:swap.requestFreshQuote")} />
      </section>

      <div className="swap-settings-layout">
        <section className="swap-form-card" aria-label={t("settings:regions.swapForm")}>
          <label htmlFor="swap-network">{t("settings:swap.networkLabel")}</label>
          <div className="swap-network-select">
            {network ? <ChainBadge network={network} /> : <span className="chain-badge family-custom" />}
            <select id="swap-network" value={network?.networkId ?? ""} onChange={(event) => onNetwork(event.target.value || null)}>
              {networks.map((option) => (
                <option value={option.networkId} key={option.networkId}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>

          <SwapAssetRow
            label={t("settings:swap.youPay")}
            asset={sellAsset}
            assets={assets.filter((asset) => asset.definition.assetId !== buyAsset?.definition.assetId)}
            amount={sellAmount}
            editable
            onAsset={onSellAsset}
            onAmount={onSellAmount}
          />

          <button type="button" className="swap-flip-button" onClick={onFlip} aria-label={t("settings:swap.flipLabel")} disabled={!sellAsset || !buyAsset}>
            <Repeat2 size={17} />
          </button>

          <SwapAssetRow
            label={t("settings:swap.youReceive")}
            asset={buyAsset}
            assets={assets.filter((asset) => asset.definition.assetId !== sellAsset?.definition.assetId)}
            amount={displayedBuyAmount}
            editable={false}
            onAsset={onBuyAsset}
            onAmount={() => undefined}
          />

          <div className="swap-quote-meta">
            <span>
              <ShieldCheck size={15} />
              {priceStatus === "loading" ? t("settings:swap.requesting") : displayQuote ? t("settings:swap.routeReady") : t("settings:swap.enterAmount")}
            </span>
            <small>{walletAddress ? formatAddress(walletAddress) : t("settings:swap.noWallet")}</small>
          </div>

          <section className="swap-detail-card" aria-label={t("settings:regions.swapQuoteDetails")}>
            <SwapDetail label={t("settings:swap.rate")} value={sellAsset && buyAsset && displayQuote ? `1 ${sellAsset.definition.symbol} ~ ${formatSwapRate(displayQuote, sellAsset, buyAsset)} ${buyAsset.definition.symbol}` : "--"} />
            <SwapDetail label={t("settings:swap.priceImpact")} value={displayQuote?.estimatedPriceImpact ? `${displayQuote.estimatedPriceImpact}%` : "--"} />
            <SwapDetail label={t("settings:swap.networkFee")} value={networkFee} />
            <SwapDetail label={t("settings:swap.minimumReceived")} value={`${minimumReceived} ${buyAsset?.definition.symbol ?? ""}`} />
          </section>

          <section className="swap-route-card" aria-label={t("settings:regions.swapRoute")}>
            <strong>{t("settings:swap.routeLabel")}</strong>
            <div>
              <span>{sellAsset?.definition.symbol ?? "Sell asset"}</span>
              <ArrowRight size={14} />
              {routeSources.length ? routeSources.map((source) => <span key={source}>{source}</span>) : <span>0x route</span>}
              <ArrowRight size={14} />
              <span>{buyAsset?.definition.symbol ?? "Buy asset"}</span>
            </div>
          </section>

          <button type="button" className="swap-review-button" disabled={!walletAddress || !sellAmount || quoteStatus === "loading"} onClick={onQuote}>
            {quoteStatus === "loading" ? <Loader2 className="spin" size={18} /> : null}
            {quoteReady ? t("settings:swap.quoteReady") : t("settings:swap.quoteRequest")}
            <ArrowRight size={18} />
          </button>
          {error ? <p className="error-box">{error}</p> : null}
        </section>

        <aside className="swap-side-column">
          <section className="swap-best-quote" aria-label={t("settings:regions.swapQuoteStatus")}>
            <header>
              <strong>{t("settings:swap.quoteLabel")}</strong>
              <small>{quote ? t("settings:swap.firmQuote") : t("settings:swap.indicativePrice")}</small>
            </header>
            <article className={quoteReady ? "ready" : ""}>
              <span className="token-badge family-custom">0x</span>
              <div>
                <strong>{t("settings:swap.quoteSource")}</strong>
                <small>{routeSources.join(", ") || t("settings:swap.routeWaiting")}</small>
              </div>
              <b>{displayedBuyAmount} {buyAsset?.definition.symbol ?? ""}</b>
            </article>
            <SwapIssue
              tone={balanceIssue ? "warning" : "ready"}
              title={balanceIssue ? t("settings:swap.balanceIssue") : t("settings:swap.balanceCheck")}
              detail={balanceIssue ? t("settings:swap.balanceIssueDetail") : t("settings:swap.balanceReadyDetail")}
            />
            <SwapIssue
              tone={allowanceIssue ? "warning" : "ready"}
              title={allowanceIssue ? t("settings:swap.allowanceRequired") : t("settings:swap.allowanceCheck")}
              detail={allowanceIssue ? t("settings:swap.allowanceRequiredDetail", { spender: formatAddress(allowanceIssue.spender) }) : t("settings:swap.allowanceReadyDetail")}
            />
          </section>

          <section className="swap-safety-card">
            <ShieldCheck size={30} />
            <div>
              <strong>{t("settings:swap.clearBoundary")}</strong>
              <p>{t("settings:swap.clearBoundaryDetail")}</p>
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}

function SwapAssetRow({
  label,
  asset,
  assets,
  amount,
  editable,
  onAsset,
  onAmount
}: {
  label: string;
  asset: SwapAssetOption | null;
  assets: SwapAssetOption[];
  amount: string;
  editable: boolean;
  onAsset: (assetId: string | null) => void;
  onAmount: (amount: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className={`swap-asset-row${editable ? " editable" : ""}`}>
      <header>
        <label>{label}</label>
        <small>{t("settings:swap.balanceLabel", { amount: asset?.balance ? formatWalletAmount(asset.balance) : "--", symbol: asset?.definition.symbol ?? "" })}</small>
      </header>
      <div>
        <TokenBadge symbol={asset?.definition.symbol ?? "?"} family="custom" />
        <select value={asset?.definition.assetId ?? ""} onChange={(event) => onAsset(event.target.value || null)}>
          {assets.map((option) => (
            <option value={option.definition.assetId} key={option.definition.assetId}>
              {option.definition.symbol} - {option.definition.name}
            </option>
          ))}
        </select>
        {editable ? (
          <input inputMode="decimal" value={amount} onChange={(event) => onAmount(event.target.value)} placeholder="0.0" aria-label={t("settings:swap.youPay")} />
        ) : (
          <strong>{amount}</strong>
        )}
      </div>
    </section>
  );
}

function SwapDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>
        {label}
        <Info size={12} />
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function SwapIssue({ tone, title, detail }: { tone: "ready" | "warning"; title: string; detail: string }) {
  return (
    <article className={`swap-issue ${tone}`}>
      <CircleCheck size={18} />
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function formatSwapBaseAmount(amount: string, decimals: number): string {
  try {
    return formatWalletAmount(formatUnits(BigInt(amount), decimals));
  } catch {
    return "--";
  }
}

function formatSwapRate(quote: ZeroExSwapQuote, sellAsset: SwapAssetOption, buyAsset: SwapAssetOption): string {
  const sellAmount = Number(formatUnits(BigInt(quote.sellAmount), sellAsset.definition.decimals));
  const buyAmount = Number(formatUnits(BigInt(quote.buyAmount), buyAsset.definition.decimals));

  if (!Number.isFinite(sellAmount) || !Number.isFinite(buyAmount) || sellAmount <= 0) {
    return "--";
  }

  return new Intl.NumberFormat("en-US", { maximumFractionDigits: buyAmount / sellAmount < 1 ? 6 : 4 }).format(buyAmount / sellAmount);
}

function formatWalletAmount(value: string): string {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return value;
  }

  return new Intl.NumberFormat("en-US", { maximumFractionDigits: amount < 1 ? 6 : 4 }).format(amount);
}

function PortfolioSettingsPanel({
  walletAddress,
  total,
  updatedAt,
  snapshots
}: {
  walletAddress: string | null;
  total: string;
  updatedAt: string;
  snapshots: ChainAssetSnapshot[];
}) {
  const { t } = useTranslation();
  return (
    <section className="settings-main-panel settings-portfolio-panel">
      <header className="settings-page-header">
        <div>
          <h1>{t("settings:portfolio.title")}</h1>
          <p>{t("settings:portfolio.description")}</p>
        </div>
        <button type="button" className="settings-help-button" aria-label={t("settings:portfolio.helpLabel")}>
          <HelpCircle size={18} />
        </button>
      </header>

      <section className="settings-network-hero portfolio-settings-hero">
        <div>
          <span className="settings-hero-icon">
            <PieChart size={26} />
          </span>
          <strong>{total}</strong>
          <p>
            <b>{t("settings:portfolio.totalPortfolio")}</b>
            <span>{updatedAt}</span>
          </p>
        </div>
        <div>
          <span className="settings-hero-icon">
            <Wallet size={26} />
          </span>
          <strong>{snapshots.length}</strong>
          <p>
            <b>{t("settings:portfolio.networksAvailable")}</b>
            <span>{walletAddress ? formatAddress(walletAddress) : t("settings:portfolio.noWallet")}</span>
          </p>
        </div>
      </section>

      <section className="portfolio-settings-list" aria-label={t("settings:regions.portfolioNetworks")}>
        {snapshots.length > 0 ? (
          snapshots.map((snapshot) => (
            <article className="portfolio-settings-row" key={snapshot.networkId}>
              <span className={`chain-badge family-${snapshot.family}`}>
                <NetworkGlyph family={snapshot.family} />
              </span>
              <div>
                <strong>{snapshot.networkName}</strong>
                <small>{snapshot.status}</small>
              </div>
              <div>
                <strong>{formatUsd(snapshot.totalValueUsd)}</strong>
                <small>
                  {snapshot.nativeBalance ?? "--"} {snapshot.nativeCurrencySymbol}
                </small>
              </div>
            </article>
          ))
        ) : (
          <div className="settings-empty">
            <PieChart size={20} />
            <span>{t("settings:portfolio.empty")}</span>
          </div>
        )}
      </section>
    </section>
  );
}

function SidebarItem({
  icon,
  label,
  active,
  badge,
  onClick
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  badge?: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" className={active ? "active" : ""} onClick={onClick}>
      {icon}
      <span>{label}</span>
      {badge ? <em>{badge}</em> : null}
    </button>
  );
}

function DappIcon({ session }: { session: WalletConnectSessionSummary }) {
  return (
    <span className="dapp-session-icon">
      {session.icons[0] ? <img src={session.icons[0]} alt="" /> : <Link2 size={22} />}
    </span>
  );
}

function ChainPills({ chains }: { chains: string[] }) {
  const { t } = useTranslation();
  const visibleChains = chains.slice(0, 2);
  const extraCount = Math.max(0, chains.length - visibleChains.length);

  if (chains.length === 0) {
    return <small>{t("settings:connectedDapps.noChains")}</small>;
  }

  return (
    <div className="chain-pill-list">
      {visibleChains.map((chain) => (
        <span className="chain-pill" key={chain}>
          {chain.replace("eip155:", "")}
        </span>
      ))}
      {extraCount > 0 ? <span className="chain-pill">+{extraCount}</span> : null}
    </div>
  );
}

function ChainBadge({ network }: { network: WalletNetworkSetting }) {
  return (
    <span className={`chain-badge family-${network.family}`} aria-label={`${network.name} icon`}>
      <NetworkGlyph family={network.family} />
    </span>
  );
}

function TokenBadge({ symbol, family }: { symbol: string; family: NetworkFamily }) {
  return (
    <span className={`token-badge token-${symbol.toLowerCase()} family-${family}`} aria-label={`${symbol} token icon`}>
      <TokenGlyph symbol={symbol} family={family} />
    </span>
  );
}

function TokenGlyph({ symbol, family }: { symbol: string; family: NetworkFamily }) {
  switch (symbol.toUpperCase()) {
    case "ETH":
      return <NetworkGlyph family="ethereum" />;
    case "POL":
    case "MATIC":
      return <NetworkGlyph family="polygon" />;
    case "HYPE":
      return <NetworkGlyph family="hyperliquid" />;
    case "BTC":
      return <NetworkGlyph family="bitcoin" />;
    case "TRX":
      return <NetworkGlyph family="tron" />;
    case "USDC":
      return (
        <svg viewBox="0 0 32 32" role="img" aria-hidden="true">
          <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeWidth="2.2" />
          <path d="M19.6 11.8c-.8-.7-2-1.1-3.4-1.1-1.9 0-3.2.9-3.2 2.3 0 3.7 7.3 1.5 7.3 5.6 0 1.7-1.5 2.8-3.7 3M15.9 8.7v14.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.1" />
        </svg>
      );
    case "USDT":
      return (
        <svg viewBox="0 0 32 32" role="img" aria-hidden="true">
          <path d="M8 9h16M16 9v14M10.5 15.2c2.3 1.4 8.7 1.4 11 0" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
          <ellipse cx="16" cy="15.1" rx="8.5" ry="3.3" fill="none" stroke="currentColor" strokeWidth="2.1" />
        </svg>
      );
    case "WBTC":
      return (
        <svg viewBox="0 0 32 32" role="img" aria-hidden="true">
          <path
            d="M11.2 4.7h9.6L27.3 11.2v9.6L20.8 27.3h-9.6L4.7 20.8v-9.6L11.2 4.7Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinejoin="round"
          />
          <path
            d="M14 10.5v11M17.6 10.5v11M12.6 13h5.1c1.7 0 2.7.8 2.7 2 0 .9-.6 1.5-1.5 1.8 1.1.3 1.8 1 1.8 2.1 0 1.4-1.1 2.2-2.9 2.2h-5.2"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.9"
          />
        </svg>
      );
    default:
      return <NetworkGlyph family={family} />;
  }
}

function NetworkGlyph({ family }: { family: NetworkFamily }) {
  switch (family) {
    case "ethereum":
      return (
        <svg viewBox="0 0 32 32" role="img" aria-hidden="true">
          <path d="M16 3 8 16l8 4 8-4L16 3Z" fill="currentColor" opacity="0.96" />
          <path d="m8 17 8 12 8-12-8 4-8-4Z" fill="currentColor" opacity="0.72" />
          <path d="M16 3v17l8-4L16 3Z" fill="#fff" opacity="0.34" />
        </svg>
      );
    case "arbitrum":
      return (
        <svg viewBox="0 0 32 32" role="img" aria-hidden="true">
          <path d="M16 3.5 26.8 9.8v12.4L16 28.5 5.2 22.2V9.8L16 3.5Z" fill="none" stroke="currentColor" strokeWidth="2.4" />
          <path d="m12.4 23 7.4-14M17.3 24l5.6-10.6" fill="none" stroke="#fff" strokeLinecap="round" strokeWidth="2.4" />
          <path d="m9.4 18.8 5.7-10.6" fill="none" stroke="#fff" opacity="0.72" strokeLinecap="round" strokeWidth="2.4" />
        </svg>
      );
    case "polygon":
      return (
        <svg viewBox="0 0 32 32" role="img" aria-hidden="true">
          <path d="M12.5 10.2 8.1 12.8v5.4l4.4 2.6 4.5-2.6v-5.4l-4.5-2.6Z" fill="none" stroke="currentColor" strokeWidth="2.4" />
          <path d="m17 12.8 2.5-1.5 4.4 2.6v5.4l-4.4 2.6-4.4-2.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
        </svg>
      );
    case "bitcoin":
      return (
        <svg viewBox="0 0 32 32" role="img" aria-hidden="true">
          <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeWidth="2.3" />
          <path d="M13.8 8.5v15M18 8.5v15M11.4 12h6.4c2.1 0 3.3 1 3.3 2.5 0 1.1-.7 1.9-1.8 2.2 1.4.3 2.3 1.2 2.3 2.6 0 1.7-1.4 2.8-3.6 2.8h-6.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
        </svg>
      );
    case "tron":
      return (
        <svg viewBox="0 0 32 32" role="img" aria-hidden="true">
          <path d="M7 6.8 25.4 11 16 27 7 6.8Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="2.3" />
          <path d="m7 6.8 9 7.8 9.4-3.6M16 14.6V27" fill="none" stroke="#fff" opacity="0.7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        </svg>
      );
    case "hyperliquid":
      return (
        <svg viewBox="0 0 32 32" role="img" aria-hidden="true">
          <path d="M6 12.3c3.1-4.4 7.4-4.4 10.5 0s7.4 4.4 10.5 0M6 19.7c3.1-4.4 7.4-4.4 10.5 0s7.4 4.4 10.5 0" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.8" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 32 32" role="img" aria-hidden="true">
          <path d="M16 5v22M5 16h22M8.2 8.2l15.6 15.6M23.8 8.2 8.2 23.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.1" />
        </svg>
      );
  }
}
