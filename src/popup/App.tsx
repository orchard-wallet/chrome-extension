import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Activity,
  ChevronDown,
  Check,
  Coins,
  Copy,
  Eye,
  EyeOff,
  FileCheck2,
  KeyRound,
  Loader2,
  Maximize2,
  Network,
  QrCode,
  RefreshCcw,
  Search,
  Send,
  Settings2,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Unplug,
  Wallet,
  X
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { createPublicClient, createWalletClient, http, parseEther, type Address } from "viem";
import { mainnet } from "viem/chains";
import { formatTokenAmount, formatUsd, type AssetStore, type ChainAssetSnapshot } from "../core/assets";
import type { ActivityEventInput } from "../core/activity";
import { buildNativeTokenTransferPreview, buildPufferDepositPreview, canSignPreview, type PufferDepositPreview } from "../core/clearSigning";
import { createPufferClient, fetchPufETHRate, fetchPufferApy, PUFFER_DEPOSIT_NETWORK_ID, PUFFER_VAULT_MAINNET } from "../core/puffer";
import { createTcxViemAccount } from "../core/tcxViemAccount";
import { resolveRecipient, type RecipientResolution } from "../core/ens";
import { getBuiltInNetworkSettings, type WalletNetworkSetting } from "../core/networks";
import { readPortfolioStore, refreshPortfolio } from "../core/portfolio";
import { broadcastSignedTransaction, checkNetworkHealth, estimateNativeTokenTransfer, type NetworkHealthCheck, type TransactionFeeEstimate } from "../core/rpc";
import { createEthereumPasskeyWallet, signNativeTokenTransfer, type NativeTransferSignResult } from "../core/tcx";
import { createPasskeyPrf, unlockPasskeyPrf } from "../core/webauthn";
import ethTokenIcon from "./assets/eth-token.png";
import {
  appendActivityEvent,
  clearPendingNativeSendReview,
  clearWalletRecord,
  readNetworkSettings,
  readPendingNativeSendReview,
  readRecentRecipients,
  readWalletUiSettings,
  readWalletRecord,
  upsertRecentRecipient,
  writeNetworkSettings,
  writeWalletUiSettings,
  DEFAULT_WALLET_UI_SETTINGS,
  type PendingNativeSendReview,
  type PendingWalletConnectProposal,
  type RecentRecipient,
  WalletRecord,
  writeWalletRecord
} from "../lib/storage";

type PopupView = "home" | "send" | "receive" | "pufeth" | "security" | "settings";
type Status = "checking" | "idle" | "creating" | "ready" | "error";
type OnboardingStep = "intro" | "name" | "ready";
type ResolverStatus = "idle" | "resolving";
type FeeStatus = "idle" | "estimating" | "ready" | "error";
type SigningStatus = "idle" | "signing" | "broadcasting" | "broadcasted" | "error";
type PortfolioLoadStatus = "idle" | "loading" | "ready" | "error";
type WalletConnectStatus = "idle" | "pairing" | "paired" | "error";
type WalletConnectSessionsStatus = "idle" | "loading" | "ready" | "error";
type WalletConnectProposalStatus = "idle" | "loading" | "ready" | "error";

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

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function openSettingsPage(targetView?: string) {
  const targetPath = `src/settings/index.html${targetView ? `#${targetView}` : ""}`;

  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    window.open(chrome.runtime.getURL(targetPath), "_blank", "noopener,noreferrer");
    return;
  }

  if (typeof chrome !== "undefined" && chrome.runtime?.openOptionsPage) {
    chrome.runtime.openOptionsPage();
    return;
  }

  window.open(`/src/settings/index.html${targetView ? `#${targetView}` : ""}`, "_blank", "noopener,noreferrer");
}

function sendRuntimeMessage<TResponse>(message: unknown): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    if (!chrome.runtime?.sendMessage) {
      reject(new Error("Chrome runtime messaging is unavailable."));
      return;
    }

    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime?.lastError;

      if (runtimeError?.message) {
        reject(new Error(runtimeError.message));
        return;
      }

      if (!response) {
        reject(new Error("WalletConnect background service did not respond. Reload the extension and try again."));
        return;
      }

      resolve(response as TResponse);
    });
  });
}

function txExplorerUrl(hash: string, network: WalletNetworkSetting | null): string | null {
  if (network?.explorerUrl) {
    return `${network.explorerUrl.replace(/\/$/, "")}/tx/${hash}`;
  }

  switch (network?.chainId) {
    case 1:
      return `https://etherscan.io/tx/${hash}`;
    case 11155111:
      return `https://sepolia.etherscan.io/tx/${hash}`;
    case 42161:
      return `https://arbiscan.io/tx/${hash}`;
    case 421614:
      return `https://sepolia.arbiscan.io/tx/${hash}`;
    case 137:
      return `https://polygonscan.com/tx/${hash}`;
    case 80002:
      return `https://amoy.polygonscan.com/tx/${hash}`;
    default:
      return null;
  }
}

export function App() {
  const { t } = useTranslation();
  const [view, setView] = useState<PopupView>("home");
  const [wallet, setWallet] = useState<WalletRecord | null>(null);
  const [status, setStatus] = useState<Status>("checking");
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>("intro");
  const [walletName, setWalletName] = useState(t("popup:onboarding.name.placeholder"));
  const [portfolioStatus, setPortfolioStatus] = useState<PortfolioLoadStatus>("idle");
  const [portfolioStore, setPortfolioStore] = useState<AssetStore | null>(null);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);
  const [selectedChainId, setSelectedChainId] = useState<string | null>(null);
  const [networkSettings, setNetworkSettings] = useState<WalletNetworkSetting[]>([]);
  const [networkHealth, setNetworkHealth] = useState<Record<string, NetworkHealthCheck>>({});
  const [networkHealthStatus, setNetworkHealthStatus] = useState<"idle" | "loading" | "ready">("idle");
  const [privacyMode, setPrivacyMode] = useState(false);
  const [compactMode, setCompactMode] = useState(false);
  const [visibleWidgets, setVisibleWidgets] = useState<string[]>([]);
  const [widgetOrder, setWidgetOrder] = useState<string[]>([]);
  const [resolverStatus, setResolverStatus] = useState<ResolverStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [recentRecipients, setRecentRecipients] = useState<RecentRecipient[]>([]);
  const [recipientInput, setRecipientInput] = useState("");
  const [recipientResolution, setRecipientResolution] = useState<RecipientResolution>({ kind: "empty", input: "" });
  const [sendNetworks, setSendNetworks] = useState<WalletNetworkSetting[]>([]);
  const [selectedSendNetworkId, setSelectedSendNetworkId] = useState<string | null>(null);
  const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
  const [amountInput, setAmountInput] = useState("");
  const [feeStatus, setFeeStatus] = useState<FeeStatus>("idle");
  const [feeEstimate, setFeeEstimate] = useState<TransactionFeeEstimate | null>(null);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [previewAccepted, setPreviewAccepted] = useState(false);
  const [pendingSendReview, setPendingSendReview] = useState<PendingNativeSendReview | null>(null);
  const [acceptPendingSendReview, setAcceptPendingSendReview] = useState(false);
  const [signingStatus, setSigningStatus] = useState<SigningStatus>("idle");
  const [signingError, setSigningError] = useState<string | null>(null);
  const [signatureResult, setSignatureResult] = useState<NativeTransferSignResult | null>(null);
  const [broadcastHash, setBroadcastHash] = useState<string | null>(null);
  const [walletConnectUri, setWalletConnectUri] = useState("");
  const [walletConnectStatus, setWalletConnectStatus] = useState<WalletConnectStatus>("idle");
  const [walletConnectMessage, setWalletConnectMessage] = useState<string | null>(null);
  const [walletConnectSessionsStatus, setWalletConnectSessionsStatus] = useState<WalletConnectSessionsStatus>("idle");
  const [walletConnectSessions, setWalletConnectSessions] = useState<WalletConnectSessionSummary[]>([]);
  const [walletConnectSessionsError, setWalletConnectSessionsError] = useState<string | null>(null);
  const [disconnectingTopic, setDisconnectingTopic] = useState<string | null>(null);
  const [walletConnectProposalsStatus, setWalletConnectProposalsStatus] = useState<WalletConnectProposalStatus>("idle");
  const [walletConnectProposals, setWalletConnectProposals] = useState<PendingWalletConnectProposal[]>([]);
  const [walletConnectProposalsError, setWalletConnectProposalsError] = useState<string | null>(null);
  const [actingProposalId, setActingProposalId] = useState<number | null>(null);

  function applyNetworkSettings(settings: WalletNetworkSetting[]) {
    const mergedNetworks = getBuiltInNetworkSettings(settings);
    const evmNetworks = mergedNetworks.filter(
      (network) =>
        network.enabled &&
        ["ethereum", "arbitrum", "hyperliquid", "polygon", "custom"].includes(network.family) &&
        typeof network.chainId === "number" &&
        /^https?:\/\//i.test(network.selectedRpcUrl)
    );

    setSendNetworks(evmNetworks);
    setSelectedSendNetworkId((current) =>
      current && evmNetworks.some((network) => network.networkId === current) ? current : (evmNetworks[0]?.networkId ?? null)
    );
    setNetworkSettings(mergedNetworks);
  }

  useEffect(() => {
    readWalletRecord()
      .then((record) => {
        setWallet(record);
        setStatus(record ? "ready" : "idle");
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : t("popup:errors.loadWallet"));
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    readWalletUiSettings()
      .then((settings) => {
        setPrivacyMode(settings.privacyMode);
        setCompactMode(settings.compactMode);
        setVisibleWidgets(settings.visibleWidgets);
        setWidgetOrder(settings.widgetOrder);
        setSelectedSendNetworkId(settings.defaultSendNetworkId);
        setView(settings.startPage === "portal" ? "home" : settings.startPage);
      })
      .catch(() => undefined);

    readRecentRecipients()
      .then(setRecentRecipients)
      .catch(() => undefined);

    readPendingNativeSendReview()
      .then(setPendingSendReview)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;

    readNetworkSettings()
      .then((settings) => {
        if (cancelled) {
          return;
        }

        applyNetworkSettings(settings);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : t("popup:errors.loadNetworks"));
          applyNetworkSettings([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const enabledNetworks = networkSettings.filter((network) => network.enabled);

    if (enabledNetworks.length === 0) {
      setNetworkHealth({});
      setNetworkHealthStatus("idle");
      return () => {
        cancelled = true;
      };
    }

    setNetworkHealthStatus("loading");
    Promise.all(enabledNetworks.map((network) => checkNetworkHealth(network)))
      .then((results) => {
        if (!cancelled) {
          setNetworkHealth(Object.fromEntries(results.map((result) => [result.networkId, result])));
          setNetworkHealthStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNetworkHealthStatus("ready");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [networkSettings]);

  const displayAddress = useMemo(() => (wallet ? formatAddress(wallet.address) : t("popup:header.noWallet")), [wallet, t]);
  const displayPortfolioTotal = useMemo(() => {
    if (!wallet) {
      return "$0.00";
    }

    if (portfolioStatus === "loading") {
      return t("common:status.loading");
    }

    return formatUsd(portfolioStore?.portfolioSnapshot?.totalValueUsd);
  }, [portfolioStatus, portfolioStore, wallet]);
  const chainSnapshots = useMemo(
    () => Object.values(portfolioStore?.chainAssetSnapshots ?? {}),
    [portfolioStore]
  );
  const selectedChain = useMemo(
    () =>
      selectedChainId
        ? (portfolioStore?.chainAssetSnapshots[selectedChainId] ?? null)
        : (chainSnapshots.find((snapshot) => snapshot.status === "ready") ?? chainSnapshots[0] ?? null),
    [chainSnapshots, portfolioStore, selectedChainId]
  );
  const mainnetEthBalance = useMemo(
    () => chainSnapshots.find((snapshot) => snapshot.networkId === PUFFER_DEPOSIT_NETWORK_ID)?.nativeBalance ?? null,
    [chainSnapshots]
  );
  const mainnetNetwork = useMemo(
    () => networkSettings.find((n) => n.networkId === PUFFER_DEPOSIT_NETWORK_ID) ?? null,
    [networkSettings]
  );
  const selectedSendNetwork = useMemo(
    () => sendNetworks.find((network) => network.networkId === selectedSendNetworkId) ?? sendNetworks[0] ?? null,
    [selectedSendNetworkId, sendNetworks]
  );
  const broadcastExplorerUrl = useMemo(
    () => (broadcastHash ? txExplorerUrl(broadcastHash, selectedSendNetwork) : null),
    [broadcastHash, selectedSendNetwork]
  );
  const previewResult = useMemo(
    () =>
      buildNativeTokenTransferPreview({
        from: wallet ? (wallet.address as Address) : null,
        recipient: recipientResolution,
        amount: amountInput,
        network: selectedSendNetwork,
        feeEstimate
      }),
    [amountInput, feeEstimate, recipientResolution, selectedSendNetwork, wallet]
  );

  const basePreviewResult = useMemo(
    () =>
      buildNativeTokenTransferPreview({
        from: wallet ? (wallet.address as Address) : null,
        recipient: recipientResolution,
        amount: amountInput,
        network: selectedSendNetwork
      }),
    [amountInput, recipientResolution, selectedSendNetwork, wallet]
  );

  useEffect(() => {
    setPreviewAccepted(false);
    setSigningStatus("idle");
    setSigningError(null);
    setSignatureResult(null);
    setBroadcastHash(null);
  }, [amountInput, feeEstimate, recipientResolution, selectedSendNetworkId]);

  useEffect(() => {
    if (!pendingSendReview || !wallet || !sendNetworks.some((network) => network.networkId === pendingSendReview.networkId)) {
      return;
    }

    setView("send");
    setSelectedSendNetworkId(pendingSendReview.networkId);
    setRecipientInput(pendingSendReview.recipientInput);
    setRecipientResolution(pendingSendReview.recipientResolution);
    setAmountInput(pendingSendReview.amountInput);
    setAcceptPendingSendReview(true);
    setPendingSendReview(null);
    void clearPendingNativeSendReview();
  }, [pendingSendReview, sendNetworks, wallet]);

  useEffect(() => {
    if (!acceptPendingSendReview || !previewResult.ok || !canSignPreview(previewResult.preview)) {
      return;
    }

    setPreviewAccepted(true);
    setAcceptPendingSendReview(false);
  }, [acceptPendingSendReview, previewResult]);

  useEffect(() => {
    let cancelled = false;

    setPortfolioError(null);

    if (!wallet) {
      setPortfolioStore(null);
      setPortfolioStatus("idle");
      return () => {
        cancelled = true;
      };
    }

    setPortfolioStatus("loading");

    readPortfolioStore()
      .then((cachedStore) => {
        if (!cancelled) {
          setPortfolioStore(cachedStore);
        }
      })
      .catch(() => undefined);

    refreshPortfolio(wallet.address as Address, wallet.chainAccounts)
      .then(({ store }) => {
        if (!cancelled) {
          setPortfolioStore(store);
          setPortfolioStatus("ready");
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setPortfolioError(cause instanceof Error ? cause.message : t("popup:errors.refreshPortfolio"));
          setPortfolioStatus("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [wallet, t]);

  useEffect(() => {
    if (!wallet) {
      setWalletConnectSessions([]);
      setWalletConnectSessionsStatus("idle");
      setWalletConnectProposals([]);
      setWalletConnectProposalsStatus("idle");
      return;
    }

    void refreshWalletConnectSessions();
    void refreshWalletConnectProposals();
  }, [wallet]);

  useEffect(() => {
    let cancelled = false;

    setFeeEstimate(null);
    setFeeError(null);

    if (!basePreviewResult.ok) {
      setFeeStatus("idle");
      return () => {
        cancelled = true;
      };
    }

    setFeeStatus("estimating");

    estimateNativeTokenTransfer({
      from: basePreviewResult.preview.from,
      to: basePreviewResult.preview.to,
      value: basePreviewResult.preview.amountWei,
      network: selectedSendNetwork ?? undefined
    })
      .then((estimate) => {
        if (!cancelled) {
          setFeeEstimate(estimate);
          setFeeStatus("ready");
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setFeeError(cause instanceof Error ? cause.message : t("popup:errors.estimateFee"));
          setFeeStatus("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [basePreviewResult, selectedSendNetwork]);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setResolverStatus(recipientInput.trim() ? "resolving" : "idle");

      resolveRecipient(recipientInput)
        .then((result) => {
          if (!cancelled) {
            setRecipientResolution(result);
          }
        })
        .catch((cause: unknown) => {
          if (!cancelled) {
            setRecipientResolution({
              kind: "invalid",
              input: recipientInput,
              reason: cause instanceof Error ? cause.message : t("popup:errors.resolveRecipient")
            });
          }
        })
        .finally(() => {
          if (!cancelled) {
            setResolverStatus("idle");
          }
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [recipientInput]);

  async function handleCreateWallet(nextWalletName = walletName.trim()) {
    if (!nextWalletName) {
      setError(t("popup:errors.enterWalletName"));
      setOnboardingStep("name");
      return;
    }

    setStatus("creating");
    setError(null);

    try {
      const passkey = await createPasskeyPrf(nextWalletName);
      const created = await createEthereumPasskeyWallet(passkey);
      const record: WalletRecord = {
        name: nextWalletName,
        ...passkey,
        ...created
      };

      await writeWalletRecord(record);
      setWallet(record);
      setWalletName(record.name ?? "");
      setStatus("ready");
      setOnboardingStep("ready");
      void recordActivity({
        type: "wallet_created",
        title: "Wallet created",
        detail: formatAddress(record.address),
        severity: "success"
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("popup:errors.createWallet"));
      setStatus("error");
    }
  }

  async function handleCopy() {
    if (!wallet) {
      return;
    }

    await navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  async function handleReset() {
    await clearWalletRecord();
    setWallet(null);
    setStatus("idle");
    setOnboardingStep("intro");
    setWalletName(t("popup:onboarding.name.placeholder"));
    setError(null);
    setPortfolioStore(null);
    setSelectedChainId(null);
    void recordActivity({
      type: "wallet_reset",
      title: "Wallet reset",
      detail: "Local wallet record was removed from this browser.",
      severity: "warning"
    });
  }

  async function handleRefreshPortfolio() {
    if (!wallet) {
      return;
    }

    setPortfolioStatus("loading");
    setPortfolioError(null);

    try {
      const { store } = await refreshPortfolio(wallet.address as Address, wallet.chainAccounts);
      setPortfolioStore(store);
      setPortfolioStatus("ready");
    } catch (cause) {
      setPortfolioError(cause instanceof Error ? cause.message : t("popup:errors.refreshPortfolio"));
      setPortfolioStatus("error");
    }
  }

  async function recordActivity(event: ActivityEventInput) {
    try {
      await appendActivityEvent(event);
    } catch {
      // Activity is helpful history, not a blocker for signing or wallet actions.
    }
  }

  async function handleSelectSendNetwork(networkId: string | null) {
    setSelectedSendNetworkId(networkId);

    try {
      const settings = await readWalletUiSettings();
      await writeWalletUiSettings({
        ...settings,
        defaultSendNetworkId: networkId
      });
    } catch {
      setError(t("popup:errors.defaultSendNetwork"));
    }
  }

  async function handleUpdateNetwork(networkId: string, updater: (network: WalletNetworkSetting) => WalletNetworkSetting) {
    const nextNetworks = networkSettings.map((network) => (network.networkId === networkId ? updater(network) : network));
    applyNetworkSettings(nextNetworks);

    try {
      await writeNetworkSettings(nextNetworks);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("popup:errors.saveNetwork"));
    }
  }

  async function handleTogglePrivacyMode() {
    const nextPrivacyMode = !privacyMode;
    setPrivacyMode(nextPrivacyMode);

    try {
      const settings = await readWalletUiSettings();
      await writeWalletUiSettings({
        ...settings,
        privacyMode: nextPrivacyMode
      });
    } catch {
      setError(t("popup:errors.privacyMode"));
    }
  }

  async function persistWidgetSettings(nextVisibleWidgets: string[], nextWidgetOrder: string[]) {
    setVisibleWidgets(nextVisibleWidgets);
    setWidgetOrder(nextWidgetOrder);

    try {
      const settings = await readWalletUiSettings();
      await writeWalletUiSettings({
        ...settings,
        visibleWidgets: nextVisibleWidgets,
        widgetOrder: nextWidgetOrder
      });
    } catch {
      setError(t("popup:errors.widgetLayout"));
    }
  }

  function handleToggleWidget(widgetId: string) {
    const nextVisibleWidgets = visibleWidgets.includes(widgetId)
      ? visibleWidgets.filter((id) => id !== widgetId)
      : [...visibleWidgets, widgetId];
    void persistWidgetSettings(nextVisibleWidgets, widgetOrder);
  }

  function handleMoveWidget(widgetId: string, direction: -1 | 1) {
    const index = widgetOrder.indexOf(widgetId);

    if (index === -1) {
      return;
    }

    const targetIndex = index + direction;

    if (targetIndex < 0 || targetIndex >= widgetOrder.length) {
      return;
    }

    const nextWidgetOrder = [...widgetOrder];
    [nextWidgetOrder[index], nextWidgetOrder[targetIndex]] = [nextWidgetOrder[targetIndex], nextWidgetOrder[index]];
    void persistWidgetSettings(visibleWidgets, nextWidgetOrder);
  }

  function handleResetWidgets() {
    void persistWidgetSettings(DEFAULT_WALLET_UI_SETTINGS.visibleWidgets, DEFAULT_WALLET_UI_SETTINGS.widgetOrder);
  }

  async function handlePreviewAction() {
    if (!previewResult.ok || !wallet || !canSignPreview(previewResult.preview)) {
      return;
    }

    if (!previewAccepted) {
      setPreviewAccepted(true);
      void recordActivity({
        type: "transfer_preview_accepted",
        title: "Transfer preview reviewed",
        detail: `${previewResult.preview.amount} ${previewResult.preview.asset} to ${previewResult.preview.recipientLabel}`,
        severity: "info"
      });
      return;
    }

    setSigningStatus("signing");
    setSigningError(null);

    try {
      const key = await unlockPasskeyPrf(wallet.credentialId);
      const result = await signNativeTokenTransfer({
        keystoreJson: wallet.keystoreJson,
        key,
        derivationPath: wallet.derivationPath,
        preview: previewResult.preview
      });

      setSignatureResult(result);
      void recordActivity({
        type: "transaction_signed",
        title: "Transaction signed",
        detail: `${previewResult.preview.amount} ${previewResult.preview.asset} on ${previewResult.preview.networkName}`,
        severity: "success",
        amount: {
          value: previewResult.preview.amount,
          symbol: previewResult.preview.asset,
          direction: "out"
        },
        networkName: previewResult.preview.networkName
      });
      setSigningStatus("broadcasting");

      const hash = await broadcastSignedTransaction(result.serializedTransaction, selectedSendNetwork ?? undefined);
      setBroadcastHash(hash);
      setSigningStatus("broadcasted");
      void recordActivity({
        type: "transaction_broadcasted",
        title: "Transaction broadcasted",
        detail: hash,
        severity: "success",
        amount: {
          value: previewResult.preview.amount,
          symbol: previewResult.preview.asset,
          direction: "out"
        },
        networkName: previewResult.preview.networkName,
        txHash: hash
      });
      if (selectedSendNetwork) {
        upsertRecentRecipient({
          address: previewResult.preview.to,
          ensLabel: previewResult.preview.recipientSource === "ens" ? previewResult.preview.recipientLabel : undefined,
          lastUsedAt: new Date().toISOString(),
          networkId: selectedSendNetwork.networkId,
          networkName: selectedSendNetwork.name
        })
          .then(setRecentRecipients)
          .catch(() => undefined);
      }
    } catch (cause) {
      setSigningError(cause instanceof Error ? cause.message : t("popup:errors.signOrBroadcast"));
      setSigningStatus("error");
      void recordActivity({
        type: "signing_failed",
        title: "Signing failed",
        detail: cause instanceof Error ? cause.message : "Unable to sign or broadcast transaction.",
        severity: "danger"
      });
    }
  }

  async function handleWalletConnectPair() {
    setWalletConnectStatus("pairing");
    setWalletConnectMessage(null);

    try {
      if (!wallet) {
        throw new Error(t("popup:errors.wcNoWallet"));
      }

      const response = await sendRuntimeMessage<{ result?: { pairings: number; sessions: number }; error?: { message: string } }>({
        type: "walletconnect_pair",
        uri: walletConnectUri.trim()
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      setWalletConnectStatus("paired");
      setWalletConnectMessage(t("popup:walletConnect.pairingSent", { count: response.result?.pairings ?? 0 }));
      await refreshWalletConnectSessions();
    } catch (cause) {
      setWalletConnectStatus("error");
      setWalletConnectMessage(cause instanceof Error ? cause.message : t("popup:errors.wcPair"));
    }
  }

  async function refreshWalletConnectSessions() {
    setWalletConnectSessionsStatus("loading");
    setWalletConnectSessionsError(null);

    try {
      const response = await sendRuntimeMessage<{
        result?: { sessions: WalletConnectSessionSummary[] };
        error?: { message: string };
      }>({
        type: "walletconnect_sessions"
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      setWalletConnectSessions(response.result?.sessions ?? []);
      setWalletConnectSessionsStatus("ready");
    } catch (cause) {
      setWalletConnectSessionsError(cause instanceof Error ? cause.message : t("popup:errors.wcSessions"));
      setWalletConnectSessionsStatus("error");
    }
  }

  async function refreshWalletConnectProposals() {
    setWalletConnectProposalsStatus("loading");
    setWalletConnectProposalsError(null);

    try {
      const response = await sendRuntimeMessage<{
        result?: { proposals: PendingWalletConnectProposal[] };
        error?: { message: string };
      }>({
        type: "walletconnect_pending_proposals"
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      setWalletConnectProposals(response.result?.proposals ?? []);
      setWalletConnectProposalsStatus("ready");
    } catch (cause) {
      setWalletConnectProposalsError(cause instanceof Error ? cause.message : t("popup:errors.wcProposals"));
      setWalletConnectProposalsStatus("error");
    }
  }

  async function handleWalletConnectApproveProposal(id: number) {
    setActingProposalId(id);
    setWalletConnectProposalsError(null);

    try {
      const response = await sendRuntimeMessage<{
        result?: { proposals: PendingWalletConnectProposal[]; sessions: WalletConnectSessionSummary[] };
        error?: { message: string };
      }>({
        type: "walletconnect_approve_proposal",
        id
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      setWalletConnectProposals(response.result?.proposals ?? []);
      setWalletConnectSessions(response.result?.sessions ?? []);
      setWalletConnectSessionsStatus("ready");
      setWalletConnectProposalsStatus("ready");
      const proposal = walletConnectProposals.find((item) => item.id === id);
      void recordActivity({
        type: "walletconnect_connected",
        title: "Dapp connected",
        detail: proposal?.name ?? `Proposal ${id}`,
        severity: "success"
      });
    } catch (cause) {
      setWalletConnectProposalsError(cause instanceof Error ? cause.message : t("popup:errors.wcApprove"));
      setWalletConnectProposalsStatus("error");
    } finally {
      setActingProposalId(null);
    }
  }

  async function handleWalletConnectRejectProposal(id: number) {
    setActingProposalId(id);
    setWalletConnectProposalsError(null);

    try {
      const response = await sendRuntimeMessage<{
        result?: { proposals: PendingWalletConnectProposal[] };
        error?: { message: string };
      }>({
        type: "walletconnect_reject_proposal",
        id
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      setWalletConnectProposals(response.result?.proposals ?? []);
      setWalletConnectProposalsStatus("ready");
      const proposal = walletConnectProposals.find((item) => item.id === id);
      void recordActivity({
        type: "walletconnect_rejected",
        title: "Dapp request rejected",
        detail: proposal?.name ?? `Proposal ${id}`,
        severity: "warning"
      });
    } catch (cause) {
      setWalletConnectProposalsError(cause instanceof Error ? cause.message : t("popup:errors.wcReject"));
      setWalletConnectProposalsStatus("error");
    } finally {
      setActingProposalId(null);
    }
  }

  async function handleWalletConnectDisconnect(topic: string) {
    setDisconnectingTopic(topic);
    setWalletConnectSessionsError(null);

    try {
      const response = await sendRuntimeMessage<{
        result?: { sessions: WalletConnectSessionSummary[] };
        error?: { message: string };
      }>({
        type: "walletconnect_disconnect",
        topic
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      setWalletConnectSessions(response.result?.sessions ?? []);
      setWalletConnectSessionsStatus("ready");
      void recordActivity({
        type: "walletconnect_disconnected",
        title: "Dapp disconnected",
        detail: walletConnectSessions.find((session) => session.topic === topic)?.name ?? "WalletConnect session",
        severity: "info"
      });
    } catch (cause) {
      setWalletConnectSessionsError(cause instanceof Error ? cause.message : t("popup:errors.wcDisconnect"));
      setWalletConnectSessionsStatus("error");
    } finally {
      setDisconnectingTopic(null);
    }
  }

  async function handleWalletConnectDisconnectAll() {
    setDisconnectingTopic("__all__");
    setWalletConnectSessionsError(null);

    try {
      const response = await sendRuntimeMessage<{
        result?: { sessions: WalletConnectSessionSummary[] };
        error?: { message: string };
      }>({
        type: "walletconnect_disconnect_all"
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      setWalletConnectSessions(response.result?.sessions ?? []);
      setWalletConnectSessionsStatus("ready");
      void recordActivity({
        type: "walletconnect_disconnected",
        title: "All dapps disconnected",
        detail: `${walletConnectSessions.length} WalletConnect session${walletConnectSessions.length === 1 ? "" : "s"}`,
        severity: "info"
      });
    } catch (cause) {
      setWalletConnectSessionsError(cause instanceof Error ? cause.message : t("popup:errors.wcDisconnectAll"));
      setWalletConnectSessionsStatus("error");
    } finally {
      setDisconnectingTopic(null);
    }
  }

  if (!wallet || onboardingStep === "ready") {
    return (
      <main className="wallet-shell onboarding-shell">
        <WalletOnboarding
          step={onboardingStep}
          walletName={walletName}
          status={status}
          error={error}
          onWalletName={(name) => {
            setWalletName(name);
            setError(null);
          }}
          onContinue={() => {
            setError(null);
            setOnboardingStep("name");
          }}
          onCreate={() => handleCreateWallet(walletName.trim())}
          onPortal={() => setOnboardingStep("intro")}
        />
      </main>
    );
  }

  return (
    <main className={`wallet-shell view-${view}${compactMode ? " compact-portal" : ""}`}>
      <AppHeader
        view={view}
        wallet={wallet}
        displayAddress={displayAddress}
        onBack={() => setView("home")}
        onSelect={setView}
        onOpenSettings={() => setView("settings")}
      />

      <div className="view-stack">
        {view === "home" ? (
          <HomeDashboard
            wallet={wallet}
            status={status}
            privacyMode={privacyMode}
            displayAddress={displayAddress}
            displayPortfolioTotal={displayPortfolioTotal}
            portfolioStatus={portfolioStatus}
            portfolioStore={portfolioStore}
            portfolioError={portfolioError}
            snapshots={chainSnapshots}
            visibleWidgets={visibleWidgets}
            widgetOrder={widgetOrder}
            failedNetworkCount={portfolioStore?.portfolioSnapshot?.failedNetworkIds?.length ?? 0}
            onCreateWallet={handleCreateWallet}
            onReset={handleReset}
            onRefreshPortfolio={handleRefreshPortfolio}
            onNavigate={setView}
            onOpenPortfolioSettings={() => openSettingsPage("portfolio")}
            onOpenActivitySettings={() => openSettingsPage("activity")}
          />
        ) : null}

        {view === "receive" && wallet ? (
          <ReceiveView
            wallet={wallet}
            network={selectedSendNetwork}
            copied={copied}
            onCopy={handleCopy}
            onDone={() => setView("home")}
          />
        ) : null}

        {view === "send" ? (
          <SendView
            resolverStatus={resolverStatus}
            recipientInput={recipientInput}
            recipientResolution={recipientResolution}
            sendNetworks={sendNetworks}
            selectedSendNetwork={selectedSendNetwork}
            chainSnapshots={chainSnapshots}
            amountInput={amountInput}
            feeStatus={feeStatus}
            feeError={feeError}
            previewResult={previewResult}
            previewAccepted={previewAccepted}
            tokenPickerOpen={tokenPickerOpen}
            signingStatus={signingStatus}
            signingError={signingError}
            signatureResult={signatureResult}
            broadcastHash={broadcastHash}
            broadcastExplorerUrl={broadcastExplorerUrl}
            onRecipientInput={setRecipientInput}
            onNetworkSelect={handleSelectSendNetwork}
            onTokenPickerOpen={setTokenPickerOpen}
            onAmountInput={setAmountInput}
            onPreviewAction={handlePreviewAction}
            onCancelPreview={() => setPreviewAccepted(false)}
          />
        ) : null}

        {view === "pufeth" ? (
          <section className="pufeth-view" aria-label={t("popup:pufeth.title")}>
            <div className="pufeth-view-header">
              <span>{t("popup:pufeth.title")}</span>
            </div>
            <PufETHWidget
              wallet={wallet}
              network={mainnetNetwork}
              ethBalance={mainnetEthBalance}
              onConverted={recordActivity}
              onDone={() => setView("home")}
            />
          </section>
        ) : null}

        {view === "security" ? (
          <SecurityView
            wallet={wallet}
            previewReady={previewResult.ok}
            sessions={walletConnectSessions}
            proposals={walletConnectProposals}
            portfolioError={portfolioError}
            networkHealth={networkHealth}
          />
        ) : null}

        {view === "settings" ? (
          <SettingsView
            wallet={wallet}
            status={status}
            privacyMode={privacyMode}
            visibleWidgets={visibleWidgets}
            widgetOrder={widgetOrder}
            onCreateWallet={handleCreateWallet}
            onReset={handleReset}
            onTogglePrivacy={handleTogglePrivacyMode}
            onToggleWidget={handleToggleWidget}
            onMoveWidget={handleMoveWidget}
            onResetWidgets={handleResetWidgets}
            onOpenSettings={openSettingsPage}
          />
        ) : null}

        {error ? <p className="error-box">{error}</p> : null}
      </div>
    </main>
  );
}

function WalletOnboarding({
  step,
  walletName,
  status,
  error,
  onWalletName,
  onContinue,
  onCreate,
  onPortal
}: {
  step: OnboardingStep;
  walletName: string;
  status: Status;
  error: string | null;
  onWalletName: (name: string) => void;
  onContinue: () => void;
  onCreate: () => void;
  onPortal: () => void;
}) {
  const { t } = useTranslation();
  const checking = status === "checking";
  const creating = status === "creating";
  const displayName = walletName.trim() || t("popup:onboarding.name.placeholder");

  return (
    <section className={`wallet-onboarding onboarding-step-${step}`} aria-label={t("popup:onboarding.sectionLabel")}>
      <header className="onboarding-brandbar">
        <div>
          <OrchardMark />
          <strong>{t("popup:onboarding.brandName")}</strong>
        </div>
        <button type="button" aria-label={t("popup:onboarding.close")} onClick={() => window.close()}>
          <X size={22} />
        </button>
      </header>

      {checking ? (
        <div className="onboarding-loading">
          <Loader2 className="spin" size={22} />
          <span>{t("popup:onboarding.checkingState")}</span>
        </div>
      ) : step === "intro" ? (
        <div className="onboarding-stage onboarding-intro">
          <div className="onboarding-copy">
            <h1>{t("popup:onboarding.intro.heading")}</h1>
            <p>{t("popup:onboarding.intro.subtext")}</p>
          </div>

          <PasskeyOrbitIllustration />

          <div className="onboarding-feature-grid">
            <OnboardingFeature icon={<ShieldCheck size={18} />} title={t("popup:onboarding.feature.biometrics.title")} detail={t("popup:onboarding.feature.biometrics.detail")} tone="green" />
            <OnboardingFeature icon={<KeyRound size={18} />} title={t("popup:onboarding.feature.signin.title")} detail={t("popup:onboarding.feature.signin.detail")} tone="lilac" />
            <OnboardingFeature icon={<Network size={18} />} title={t("popup:onboarding.feature.eoa.title")} detail={t("popup:onboarding.feature.eoa.detail")} tone="blue" />
            <OnboardingFeature icon={<Check size={18} />} title={t("popup:onboarding.feature.selfCustody.title")} detail={t("popup:onboarding.feature.selfCustody.detail")} tone="green" />
          </div>

          <button type="button" className="onboarding-cta" onClick={onContinue}>
            {t("popup:onboarding.cta")}
            <ArrowRight size={20} />
          </button>
        </div>
      ) : step === "name" ? (
        <form
          className="onboarding-stage onboarding-name"
          onSubmit={(event) => {
            event.preventDefault();
            onCreate();
          }}
        >
          <div className="onboarding-copy">
            <h1>{t("popup:onboarding.name.heading")}</h1>
            <p>{t("popup:onboarding.name.subtext")}</p>
          </div>

          <section className="wallet-name-card">
            <label htmlFor="wallet-name">{t("popup:onboarding.name.label")}</label>
            <input
              id="wallet-name"
              autoFocus
              autoComplete="off"
              maxLength={48}
              onChange={(event) => onWalletName(event.target.value)}
              placeholder={t("popup:onboarding.name.placeholder")}
              value={walletName}
            />
            <small>{t("popup:onboarding.name.hint")}</small>
            <div className="wallet-name-preview">
              <span>
                <Wallet size={24} />
              </span>
              <div>
                <strong>{displayName}</strong>
                <em>{t("popup:onboarding.name.thisDevice")}</em>
              </div>
            </div>
          </section>

          <p className="onboarding-note">
            <KeyRound size={18} />
            <span>{t("popup:onboarding.name.passkeyNote")}</span>
          </p>

          <button type="submit" className="onboarding-cta" disabled={!walletName.trim() || creating}>
            {creating ? <Loader2 className="spin" size={20} /> : null}
            {creating ? t("popup:onboarding.creating") : t("popup:onboarding.createWallet")}
          </button>
        </form>
      ) : (
        <div className="onboarding-stage onboarding-ready">
          <div className="onboarding-copy">
            <h1>{t("popup:onboarding.ready.heading")}</h1>
            <p>{t("popup:onboarding.ready.subtext")}</p>
          </div>

          <WalletReadyIllustration />

          <section className="onboarding-checklist" aria-label={t("popup:onboarding.walletSetupCompleted")}>
            <OnboardingCheck label={t("popup:onboarding.checklist.passkey")} />
            <OnboardingCheck label={t("popup:onboarding.checklist.eoa")} />
            <OnboardingCheck label={t("popup:onboarding.checklist.networks")} />
          </section>

          <p className="onboarding-backup">
            <ShieldCheck size={18} />
            {t("popup:onboarding.backup")}
          </p>

          <button type="button" className="onboarding-cta" onClick={onPortal}>
            {t("popup:onboarding.goToPortal")}
            <ArrowRight size={20} />
          </button>
        </div>
      )}

      {error ? <p className="error-box onboarding-error">{error}</p> : null}
    </section>
  );
}

function OrchardMark() {
  return (
    <span className="orchard-onboarding-mark" aria-hidden="true">
      <svg viewBox="0 0 48 58">
        <path d="M24 56c12-10 19-22 19-34C43 10 35 3 24 3S5 10 5 22c0 12 7 24 19 34Z" />
        <path d="M24 3c-5 12-5 26 0 53m0-53c5 12 5 26 0 53" />
        <path d="M24 2v-1" />
      </svg>
    </span>
  );
}

function OnboardingFeature({
  icon,
  title,
  detail,
  tone
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  tone: "green" | "lilac" | "blue";
}) {
  return (
    <article className="onboarding-feature">
      <span className={tone}>{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </article>
  );
}

function OnboardingCheck({ label }: { label: string }) {
  return (
    <div>
      <span>
        <Check size={18} />
      </span>
      <strong>{label}</strong>
    </div>
  );
}

function PasskeyOrbitIllustration() {
  return (
    <section className="onboarding-orbit passkey-orbit" aria-hidden="true">
      <span className="orbit-ring" />
      <span className="orbit-card card-left" />
      <span className="orbit-card card-center">
        <ShieldCheck size={34} />
      </span>
      <span className="orbit-card card-right">
        <KeyRound size={31} />
      </span>
    </section>
  );
}

function WalletReadyIllustration() {
  return (
    <section className="onboarding-orbit ready-orbit" aria-hidden="true">
      <span className="orbit-ring" />
      <span className="ready-wallet">
        <OrchardMark />
      </span>
      <span className="ready-check">
        <Check size={28} />
      </span>
    </section>
  );
}

function AppHeader({
  view,
  wallet,
  displayAddress,
  onBack,
  onSelect,
  onOpenSettings
}: {
  view: PopupView;
  wallet: WalletRecord | null;
  displayAddress: string;
  onBack: () => void;
  onSelect: (view: PopupView) => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();

  return (
    <section className="topbar orchard-header" aria-label={t("popup:regions.walletStatus")}>
      {view === "home" ? (
        <div className="brand-mark" aria-hidden="true">
          <KeyRound size={18} />
        </div>
      ) : (
        <button type="button" className="settings-icon-button" onClick={onBack} aria-label={t("popup:header.backToHome")}>
          <ArrowLeft size={17} />
        </button>
      )}
      <div>
        <p className="eyebrow">{wallet ? displayAddress : t("popup:header.noWallet")}</p>
      </div>
      <button
        type="button"
        className={`settings-icon-button ${view === "send" ? "active" : ""}`}
        disabled={!wallet}
        onClick={() => onSelect("send")}
        aria-label={t("popup:header.send")}
        title={t("popup:header.send")}
      >
        <Send size={17} />
      </button>
      <button
        type="button"
        className={`settings-icon-button ${view === "receive" ? "active" : ""}`}
        disabled={!wallet}
        onClick={() => onSelect("receive")}
        aria-label={t("popup:header.receive")}
        title={t("popup:header.receive")}
      >
        <QrCode size={17} />
      </button>
      <button type="button" className="settings-icon-button" onClick={onOpenSettings} aria-label={t("popup:header.settings")}>
        <Settings2 size={17} />
      </button>
    </section>
  );
}

function PufETHWidget({
  wallet,
  network,
  ethBalance,
  onConverted,
  onDone
}: {
  wallet: WalletRecord | null;
  network: WalletNetworkSetting | null;
  ethBalance: string | null;
  onConverted: (event: ActivityEventInput) => void;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState<string | null>(null);
  const [apy, setApy] = useState<string | null>(null);
  const [phase, setPhase] = useState<"input" | "preview" | "signing" | "success" | "error">("input");
  const [preview, setPreview] = useState<PufferDepositPreview | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isMainnet = network?.networkId === PUFFER_DEPOSIT_NETWORK_ID;

  useEffect(() => {
    void fetchPufETHRate().then((value) => setRate(value?.pufEthPerEth ?? null));
    void fetchPufferApy().then(setApy);
  }, []);

  const estimatedPufEth = useMemo(() => {
    const eth = Number(amount);
    if (!rate || !Number.isFinite(eth) || eth <= 0) {
      return null;
    }
    return (eth * Number(rate)).toFixed(6);
  }, [amount, rate]);

  const insufficient = useMemo(() => {
    const eth = Number(amount);
    return Number.isFinite(eth) && eth > 0 && ethBalance != null && eth > Number(ethBalance);
  }, [amount, ethBalance]);

  function handleMax() {
    if (ethBalance == null) {
      return;
    }
    const max = Math.max(0, Number(ethBalance) - 0.002);
    setAmount(max > 0 ? max.toFixed(6) : "0");
  }

  function handleConvert() {
    if (!wallet || !network) {
      return;
    }
    const eth = Number(amount);
    if (!Number.isFinite(eth) || eth <= 0 || insufficient) {
      return;
    }
    setError(null);
    setPreview(
      buildPufferDepositPreview({
        from: wallet.address as Address,
        vaultAddress: PUFFER_VAULT_MAINNET as Address,
        ethAmount: amount,
        ethAmountWei: parseEther(amount),
        estimatedPufEth,
        networkName: network.name
      })
    );
    setPhase("preview");
  }

  async function handleConfirm() {
    if (!wallet || !network || !preview) {
      return;
    }
    setPhase("signing");
    setError(null);
    try {
      const transport = http(network.selectedRpcUrl);
      const account = createTcxViemAccount(wallet);
      const walletClient = createWalletClient({ account, chain: mainnet, transport });
      const publicClient = createPublicClient({ chain: mainnet, transport });
      const pufferClient = createPufferClient(walletClient, publicClient);

      const hash = await pufferClient.vault
        .depositETH(wallet.address as Address)
        .transact(preview.ethAmountWei);

      setTxHash(hash);
      setPhase("success");
      onConverted({
        type: "transaction_broadcasted",
        title: t("popup:pufeth.successTitle"),
        detail: preview.estimatedPufEth
          ? t("popup:pufeth.estimate", { amount: preview.estimatedPufEth })
          : t("popup:pufeth.successDetail"),
        severity: "success",
        amount: {
          value: preview.ethAmount,
          symbol: "ETH",
          direction: "out"
        },
        networkName: preview.networkName,
        txHash: hash ?? undefined
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("popup:pufeth.errors.convert"));
      setPhase("error");
    }
  }

  if (phase === "preview" && preview) {
    return (
      <div className="clear-signing-sheet pufeth-preview" role="region" aria-label={t("popup:pufeth.previewTitle")}>
        <div className="preview-hero">
          <span className="preview-direction" aria-hidden="true">
            <ArrowRight size={18} />
          </span>
          <span>{preview.title}</span>
          <strong>{preview.ethAmount} ETH</strong>
          <small>{preview.networkName}</small>
        </div>
        <PreviewRow label={t("popup:pufeth.pay")} value={`${preview.ethAmount} ETH`} />
        <PreviewRow
          label={t("popup:pufeth.receive")}
          value={preview.estimatedPufEth ? t("popup:pufeth.estimate", { amount: preview.estimatedPufEth }) : "≈ — pufETH"}
        />
        <PreviewRow label={t("popup:pufeth.networkFee")} value={t("popup:clearSigning.pending")} detail={preview.networkName} />
        <PreviewRow label={t("popup:clearSigning.from")} value={formatAddress(preview.from)} detail={formatAddress(preview.vaultAddress)} />
        <div className="warning-list">
          {preview.warnings.map((warning) => (
            <div className={`warning-item ${warning.severity}`} key={warning.message}>
              <AlertTriangle size={14} />
              <span>{warning.message}</span>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="primary-button"
          onClick={() => void handleConfirm()}
        >
          <KeyRound size={18} />
          {t("popup:pufeth.confirm")}
        </button>
        <button
          type="button"
          className="clear-signing-cancel"
          onClick={() => setPhase("input")}
        >
          {t("common:actions.cancel")}
        </button>
      </div>
    );
  }

  if (phase === "signing") {
    return (
      <div className="clear-signing-sheet pufeth-signing" role="status">
        <div className="preview-hero">
          <Loader2 className="spin" size={32} />
          <span>{t("popup:pufeth.signing")}</span>
        </div>
      </div>
    );
  }

  if (phase === "success") {
    return (
      <div className="clear-signing-sheet pufeth-success" role="status">
        <div className="preview-hero">
          <Check size={32} />
          <span>{t("popup:pufeth.successTitle")}</span>
          <small>{t("popup:pufeth.successDetail")}</small>
        </div>
        {txHash ? (
          <a
            href={`https://etherscan.io/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="primary-button"
          >
            {t("popup:pufeth.viewTx")}
          </a>
        ) : null}
        <button
          type="button"
          className="clear-signing-cancel"
          onClick={() => {
            setPhase("input");
            setAmount("");
            setTxHash(null);
            onDone?.();
          }}
        >
          {t("common:actions.done")}
        </button>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="clear-signing-sheet pufeth-error" role="alert">
        <div className="warning-list">
          <div className="warning-item danger">
            <AlertTriangle size={14} />
            <span>{error ?? t("popup:pufeth.errors.convert")}</span>
          </div>
        </div>
        <button
          type="button"
          className="primary-button"
          onClick={() => setPhase("input")}
        >
          {t("common:actions.retry")}
        </button>
      </div>
    );
  }

  // input phase
  return (
    <div className="action-widget pufeth-input" role="region" aria-label={t("popup:pufeth.title")}>
      <strong>{t("popup:pufeth.title")}</strong>
      <small>{t("popup:pufeth.subtitle")}</small>

      {!isMainnet ? (
        <p className="inline-error">{t("popup:pufeth.wrongNetwork")}</p>
      ) : (
        <>
          <div className="pufeth-amount-row">
            <input
              type="number"
              min="0"
              step="any"
              placeholder={t("popup:pufeth.amountPlaceholder")}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="pufeth-amount-input"
              aria-label={t("popup:pufeth.amountLabel")}
            />
            <button
              type="button"
              className="mini-icon-button"
              onClick={handleMax}
              disabled={!wallet || ethBalance == null}
            >
              {t("popup:pufeth.max")}
            </button>
          </div>

          {estimatedPufEth ? (
            <small className="pufeth-estimate">
              {t("popup:pufeth.estimate", { amount: estimatedPufEth })}
            </small>
          ) : null}

          <small className="pufeth-apy">
            {apy ? t("popup:pufeth.apy", { apy }) : t("popup:pufeth.apyUnavailable")}
          </small>

          {insufficient ? (
            <p className="inline-error">{t("popup:pufeth.insufficient")}</p>
          ) : null}

          <button
            type="button"
            className="primary-button"
            disabled={!wallet || !amount || Number(amount) <= 0 || insufficient}
            onClick={handleConvert}
          >
            {t("popup:pufeth.convert")}
          </button>
        </>
      )}
    </div>
  );
}

function HomeDashboard({
  wallet,
  status,
  privacyMode,
  displayAddress,
  displayPortfolioTotal,
  portfolioStatus,
  portfolioStore,
  portfolioError,
  snapshots,
  visibleWidgets,
  widgetOrder,
  failedNetworkCount,
  onCreateWallet,
  onReset,
  onRefreshPortfolio,
  onNavigate,
  onOpenPortfolioSettings,
  onOpenActivitySettings
}: {
  wallet: WalletRecord | null;
  status: Status;
  privacyMode: boolean;
  displayAddress: string;
  displayPortfolioTotal: string;
  portfolioStatus: PortfolioLoadStatus;
  portfolioStore: AssetStore | null;
  portfolioError: string | null;
  snapshots: ChainAssetSnapshot[];
  visibleWidgets: string[];
  widgetOrder: string[];
  failedNetworkCount: number;
  onCreateWallet: () => void;
  onReset: () => void;
  onRefreshPortfolio: () => void;
  onNavigate: (view: PopupView) => void;
  onOpenPortfolioSettings: () => void;
  onOpenActivitySettings: () => void;
}) {
  const { t } = useTranslation();
  const topAssets = snapshots
    .filter((snapshot) => snapshot.status === "ready")
    .sort((a, b) => Number(b.totalValueUsd ?? 0) - Number(a.totalValueUsd ?? 0))
    .slice(0, 4);
  const assetTiles = topAssets.length > 0 ? topAssets : fallbackAssetTiles();

  const visibleWidgetSet = new Set(visibleWidgets.length ? visibleWidgets : DEFAULT_WALLET_UI_SETTINGS.visibleWidgets);
  const actionWidgets = [
    { id: "send", node: <ActionWidget icon={<Send size={18} />} title={t("popup:widgets.send.title")} detail={t("popup:widgets.send.detail")} disabled={!wallet} onClick={() => onNavigate("send")} key="send" /> },
    { id: "receive", node: <ActionWidget icon={<QrCode size={18} />} title={t("popup:widgets.receive.title")} detail={t("popup:widgets.receive.detail")} disabled={!wallet} onClick={() => onNavigate("receive")} key="receive" /> },
    { id: "swap", node: <ActionWidget icon={<RefreshCcw size={18} />} title={t("popup:widgets.swap.title")} detail={t("popup:widgets.swap.detail")} disabled onClick={() => undefined} key="swap" /> },
    { id: "activity", node: <ActionWidget icon={<Activity size={18} />} title={t("popup:widgets.activity.title")} detail={t("popup:widgets.activity.detail")} disabled={!wallet} onClick={onOpenActivitySettings} key="activity" /> },
    { id: "pufeth", node: <ActionWidget icon={<Coins size={18} />} title={t("popup:pufeth.title")} detail={t("popup:pufeth.subtitle")} disabled={!wallet} onClick={() => onNavigate("pufeth")} key="pufeth" /> }
  ]
    .filter((widget) => visibleWidgetSet.has(widget.id))
    .sort((a, b) => {
      const order = widgetOrder.length ? widgetOrder : DEFAULT_WALLET_UI_SETTINGS.widgetOrder;
      return order.indexOf(a.id) - order.indexOf(b.id);
    })
    .map((widget) => widget.node);
  const assetWidgets = assetTiles.map((snapshot, index) => (
    <AssetWidgetRow snapshot={snapshot} privacyMode={privacyMode} toneIndex={index} key={snapshot.networkId} />
  ));

  return (
    <section className="portal-shell" aria-label={t("popup:regions.walletPortal")}>
      {visibleWidgetSet.has("balance") ? <section className="hero-widget" aria-label={t("popup:regions.portfolioBalance")}>
        <div className="orchard-hero-copy">
          <div>
            <span>{t("popup:home.balance.label")}</span>
            <strong>{privacyMode ? t("popup:home.balance.hidden") : displayPortfolioTotal}</strong>
            <small>{t("popup:home.balance.today")}</small>
          </div>
          <span className="time-badge">1D</span>
          <Sparkline className="hero-line" />
        </div>

        <div className="widget-meta-row">
          <span>{portfolioStatus === "loading" ? t("popup:home.balance.refreshing") : portfolioStore?.portfolioSnapshot?.lastUpdatedAt ? t("popup:home.balance.updated", { time: new Date(portfolioStore.portfolioSnapshot.lastUpdatedAt).toLocaleTimeString() }) : t("popup:home.balance.noRefresh")}</span>
          <button type="button" className="mini-icon-button" disabled={!wallet || portfolioStatus === "loading"} onClick={onRefreshPortfolio} aria-label={t("popup:home.balance.refreshAriaLabel")}>
            <RefreshCcw className={portfolioStatus === "loading" ? "spin" : undefined} size={15} />
          </button>
        </div>
        {portfolioError ? <p className="inline-error">{portfolioError}</p> : null}
      </section> : null}

      {actionWidgets.length || visibleWidgetSet.has("portfolio") || visibleWidgetSet.has("assets") ? <section className="portal-content">
        <div className="portal-left">
          {actionWidgets.length ? <div className="portal-action-grid">{actionWidgets}</div> : null}
          {visibleWidgetSet.has("portfolio") ? <SummaryWidget
            icon={<Network size={17} />}
            label={t("popup:portfolio.heading")}
            value={privacyMode ? t("popup:home.balance.hidden") : displayPortfolioTotal}
            detail={failedNetworkCount > 0 ? t("popup:home.failedRefresh", { count: failedNetworkCount }) : "+2.10%"}
            tone={failedNetworkCount > 0 ? "warning" : "ready"}
            onClick={onOpenPortfolioSettings}
          /> : null}
        </div>
        {visibleWidgetSet.has("assets") ? <div className="portal-right">
          <div className="portal-asset-grid">{assetWidgets}</div>
        </div> : null}
      </section> : null}


      <button type="button" className="view-all-assets portal-view-all" disabled={!wallet} onClick={onOpenPortfolioSettings}>
        <span>{t("popup:home.viewAllAssets")}</span>
        <ChevronDown size={16} />
      </button>
      <SettingsView
        wallet={wallet}
        status={status}
        privacyMode={privacyMode}
        visibleWidgets={visibleWidgets}
        widgetOrder={widgetOrder}
        onCreateWallet={onCreateWallet}
        onReset={onReset}
        onTogglePrivacy={() => undefined}
        onToggleWidget={() => undefined}
        onMoveWidget={() => undefined}
        onResetWidgets={() => undefined}
        onOpenSettings={() => onNavigate("settings")}
        compact
      />
    </section>
  );
}

function ActionWidget({
  icon,
  title,
  detail,
  disabled,
  onClick
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="action-widget" disabled={disabled} onClick={onClick}>
      <span>{icon}</span>
      <strong>{title}</strong>
      <small>{detail}</small>
    </button>
  );
}

function SummaryWidget({
  icon,
  label,
  value,
  detail,
  tone,
  onClick
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: "ready" | "warning" | "neutral";
  onClick: () => void;
}) {
  return (
    <button type="button" className={`summary-widget ${tone}`} onClick={onClick}>
      <span>{icon}</span>
      <small>{label}</small>
      <strong>{value}</strong>
      <em>{detail}</em>
    </button>
  );
}

function SmartInsightWidget({
  sessions,
  enabledNetworkCount,
  onClick
}: {
  sessions: WalletConnectSessionSummary[];
  enabledNetworkCount: number;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const copy =
    sessions.length > 0
      ? t("popup:smartInsight.dappsConnected", { count: sessions.length, networks: enabledNetworkCount })
      : t("popup:smartInsight.usdcApy");

  return (
    <button type="button" className="smart-insight-card" onClick={onClick}>
      <span aria-hidden="true">◌</span>
      <div>
        <strong>{t("popup:smartInsight.label")}</strong>
        <small>{copy}</small>
      </div>
      <ChevronDown size={16} />
    </button>
  );
}

function Sparkline({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <svg className={`mini-sparkline ${className}`.trim()} viewBox="0 0 180 64" role="img" aria-label={t("popup:home.balance.label")}>
      <polyline
        points="2,45 18,45 32,37 45,42 60,25 76,18 91,22 107,34 123,35 140,24 158,13 178,18"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="178" cy="18" r="4" fill="currentColor" />
    </svg>
  );
}

function fallbackAssetTiles(): ChainAssetSnapshot[] {
  return [
    fallbackAssetTile("bitcoin-mainnet", "Bitcoin", "bitcoin", "BTC", "5,231.34", "+1.35%"),
    fallbackAssetTile("ethereum-mainnet", "Ethereum", "ethereum", "ETH", "3,246.38", "+0.82%"),
    fallbackAssetTile("solana-mainnet", "Solana", "custom", "SOL", "1,732.26", "+3.25%"),
    fallbackAssetTile("usdc-demo", "USD Coin", "custom", "USDC", "1,248.73", "+0.01%")
  ];
}

function fallbackAssetTile(
  networkId: string,
  networkName: string,
  family: WalletNetworkSetting["family"],
  symbol: string,
  value: string,
  change: string
): ChainAssetSnapshot {
  return {
    networkId,
    networkName,
    family,
    nativeCurrencySymbol: symbol,
    accountId: "",
    status: "ready",
    assetIds: [],
    totalValueUsd: value.replace(/,/g, ""),
    nativeBalance: change
  };
}

function WidgetHeader({ label, title, actionLabel, onAction }: { label: string; title: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="resolver-heading">
      <div>
        <span className="muted">{label}</span>
        <h3>{title}</h3>
      </div>
      {actionLabel && onAction ? (
        <button type="button" className="text-button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function StatusBadge({ ready, label }: { ready: boolean; label: string }) {
  return (
    <div className={`status-pill ${ready ? "ready" : ""}`}>
      {ready ? <Check size={14} /> : <ShieldCheck size={14} />}
      {label}
    </div>
  );
}

function AssetWidgetRow({
  snapshot,
  privacyMode,
  toneIndex = 0
}: {
  snapshot: ChainAssetSnapshot;
  privacyMode: boolean;
  toneIndex?: number;
}) {
  const { t } = useTranslation();
  const isFallbackChange = snapshot.nativeBalance?.startsWith("+") || snapshot.nativeBalance?.startsWith("-");

  return (
    <div className={`asset-widget-row asset-tone-${(toneIndex % 4) + 1}`}>
      <TokenIcon symbol={snapshot.nativeCurrencySymbol} />
      <div>
        <strong>{snapshot.networkName}</strong>
        <span>{snapshot.nativeCurrencySymbol}</span>
      </div>
      <div>
        <strong>{privacyMode ? t("popup:home.balance.hidden") : formatUsd(snapshot.totalValueUsd)}</strong>
        <span>{privacyMode ? t("popup:home.balance.hidden") : isFallbackChange ? snapshot.nativeBalance : snapshot.nativeBalance ? `${formatTokenAmount(snapshot.nativeBalance)} ${snapshot.nativeCurrencySymbol}` : "+0.01%"}</span>
      </div>
      <Sparkline />
      <ChevronDown size={15} />
    </div>
  );
}

function TokenIcon({ symbol }: { symbol: string }) {
  if (symbol.toUpperCase() === "ETH") {
    return (
      <div className="token-icon token-icon-image" aria-hidden="true">
        <img src={ethTokenIcon} alt="" />
      </div>
    );
  }

  return (
    <div className="token-icon" aria-hidden="true">
      {symbol.slice(0, 2).toUpperCase()}
    </div>
  );
}

function PortfolioPanel({
  snapshots,
  selectedChain,
  store,
  accountId,
  loading,
  privacyMode,
  onRefresh,
  onSelect
}: {
  snapshots: ChainAssetSnapshot[];
  selectedChain: ChainAssetSnapshot | null;
  store: AssetStore | null;
  accountId: string | null;
  loading: boolean;
  privacyMode: boolean;
  onRefresh: () => void;
  onSelect: (networkId: string) => void;
}) {
  const { t } = useTranslation();
  const groupedAssets = groupAssets(store, accountId, snapshots);

  return (
    <section className="portfolio-panel" aria-label={t("popup:regions.multiChainAssets")}>
      <div className="resolver-heading">
        <div>
          <span className="muted">{t("popup:assets.heading")}</span>
          <h3>{t("popup:assets.enabled")}</h3>
        </div>
        <button type="button" className="mini-icon-button" disabled={loading} onClick={onRefresh} title={t("popup:assets.refreshButton")}>
          <RefreshCcw className={loading ? "spin" : undefined} size={15} />
        </button>
      </div>

      {snapshots.length > 0 ? (
        <div className="chain-list">
          {snapshots.map((snapshot) => (
            <button
              type="button"
              className={`chain-row ${selectedChain?.networkId === snapshot.networkId ? "selected" : ""}`}
              key={snapshot.networkId}
              onClick={() => onSelect(snapshot.networkId)}
            >
              <div>
                <strong>{snapshot.networkName}</strong>
                <span>{chainStatusLabel(snapshot, t)}</span>
              </div>
              <div>
                <strong>{privacyMode ? t("popup:home.balance.hidden") : formatUsd(snapshot.totalValueUsd)}</strong>
                <span>
                  {privacyMode ? t("popup:home.balance.hidden") : snapshot.nativeBalance ? formatTokenAmount(snapshot.nativeBalance) : "--"} {snapshot.nativeCurrencySymbol}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <p className="resolver-hint">{t("popup:assets.hint")}</p>
      )}

      {selectedChain ? <ChainAssetDetail snapshot={selectedChain} store={store} accountId={accountId} privacyMode={privacyMode} onRefresh={onRefresh} /> : null}
      {groupedAssets.length > 0 ? <TokenDistribution groups={groupedAssets} privacyMode={privacyMode} /> : null}
    </section>
  );
}

interface AssetGroup {
  symbol: string;
  name: string;
  totalValueUsd: number;
  totalBalance: number;
  rows: Array<{
    networkId: string;
    networkName: string;
    symbol: string;
    balance: string | null;
    valueUsd: number;
  }>;
}

function groupAssets(store: AssetStore | null, accountId: string | null, snapshots: ChainAssetSnapshot[]): AssetGroup[] {
  const groups = new Map<string, AssetGroup>();

  for (const snapshot of snapshots) {
    for (const assetId of snapshot.assetIds) {
      const definition = store?.assetDefinitions[assetId];
      const balance = accountId ? store?.assetBalances[`${accountId.toLowerCase()}:${assetId}`] : undefined;
      const price = store?.assetPrices[assetId];
      const symbol = definition?.symbol ?? (assetId === snapshot.nativeAssetId ? snapshot.nativeCurrencySymbol : "TOKEN");
      const groupKey = definition?.groupKey ?? `${definition?.kind ?? "asset"}:${symbol}`;
      const valueUsd = balance && price ? Number(balance.decimalAmount) * Number(price.value) : assetId === snapshot.nativeAssetId ? Number(snapshot.totalValueUsd ?? 0) : 0;
      const group = groups.get(groupKey) ?? {
        symbol,
        name: definition?.name ?? symbol,
        totalValueUsd: 0,
        totalBalance: 0,
        rows: []
      };
      group.totalValueUsd += Number.isFinite(valueUsd) ? valueUsd : 0;
      group.totalBalance += Number(balance?.decimalAmount ?? (assetId === snapshot.nativeAssetId ? snapshot.nativeBalance : 0) ?? 0);
      group.rows.push({
        networkId: snapshot.networkId,
        networkName: snapshot.networkName,
        symbol,
        balance: balance?.decimalAmount ?? (assetId === snapshot.nativeAssetId ? snapshot.nativeBalance ?? null : null),
        valueUsd: Number.isFinite(valueUsd) ? valueUsd : 0
      });
      groups.set(groupKey, group);
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.totalValueUsd - a.totalValueUsd);
}

function TokenDistribution({ groups, privacyMode }: { groups: AssetGroup[]; privacyMode: boolean }) {
  const { t } = useTranslation();
  const selected = groups[0];
  const total = groups.reduce((sum, group) => sum + group.totalValueUsd, 0);
  const highestNetwork = selected.rows
    .slice()
    .sort((a, b) => b.valueUsd - a.valueUsd)[0];
  const lowestNetwork = selected.rows
    .slice()
    .sort((a, b) => a.valueUsd - b.valueUsd)[0];

  return (
    <div className="token-distribution">
      <WidgetHeader label={t("popup:portfolio.distribution.heading")} title={t("popup:portfolio.distribution.label", { symbol: selected.symbol })} />
      <div className="distribution-hero">
        <TokenIcon symbol={selected.symbol} />
        <div>
          <strong>{selected.symbol}</strong>
          <span>{privacyMode ? t("popup:home.balance.hidden") : formatUsd(selected.totalValueUsd.toFixed(2))}</span>
        </div>
        <div className="distribution-ring" aria-hidden="true" />
      </div>
      <div className="token-tabs" aria-label={t("popup:regions.tokenDistributionSelector")}>
        {groups.map((group) => (
          <button type="button" className={group.symbol === selected.symbol ? "selected" : ""} key={group.symbol}>
            {group.symbol}
          </button>
        ))}
      </div>
      <div className="distribution-summary">
        <SummaryTile label={t("popup:portfolio.distribution.topNetwork")} value={highestNetwork?.networkName ?? t("popup:portfolio.distribution.none")} detail={privacyMode ? t("popup:home.balance.hidden") : formatUsd(highestNetwork?.valueUsd.toFixed(2))} />
        <SummaryTile label={t("popup:portfolio.distribution.lowestNetwork")} value={lowestNetwork?.networkName ?? t("popup:portfolio.distribution.none")} detail={privacyMode ? t("popup:home.balance.hidden") : formatUsd(lowestNetwork?.valueUsd.toFixed(2))} />
      </div>
      <div className="distribution-bars">
        {selected.rows.map((row) => {
          const value = row.valueUsd;
          const percent = total > 0 ? Math.max(4, Math.round((value / total) * 100)) : 12;
          return (
            <div className="distribution-row" key={`${row.networkId}-${row.symbol}`}>
              <div>
                <strong>{row.networkName}</strong>
                <span>{privacyMode ? t("popup:home.balance.hidden") : `${row.balance ? formatTokenAmount(row.balance) : "--"} ${row.symbol}`}</span>
              </div>
              <div className="progress-track" aria-hidden="true">
                <span style={{ width: `${percent}%` }} />
              </div>
              <em>{privacyMode ? t("popup:home.balance.hidden") : formatUsd(row.valueUsd.toFixed(2))}</em>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SummaryTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="summary-tile">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function ChainAssetDetail({
  snapshot,
  store,
  accountId,
  privacyMode,
  onRefresh
}: {
  snapshot: ChainAssetSnapshot;
  store: AssetStore | null;
  accountId: string | null;
  privacyMode: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const tokenRows = (snapshot.tokenAssetIds ?? [])
    .map((assetId) => ({
      definition: store?.assetDefinitions[assetId],
      balance: accountId ? store?.assetBalances[`${accountId.toLowerCase()}:${assetId}`] : undefined,
      price: store?.assetPrices[assetId]
    }))
    .filter((row) => row.definition);

  return (
    <div className="chain-detail">
      <div className="preview-row">
        <span>{t("popup:chainDetail.network")}</span>
        <div>
          <strong>{snapshot.networkName}</strong>
          <small>{snapshot.chainId ? t("popup:chainDetail.chainId", { chainId: snapshot.chainId }) : snapshot.family}</small>
        </div>
      </div>
      <div className="preview-row">
        <span>{t("popup:chainDetail.nativeAsset")}</span>
        <div>
          <strong>
            {privacyMode ? t("popup:home.balance.hidden") : snapshot.nativeBalance ? formatTokenAmount(snapshot.nativeBalance) : "--"} {snapshot.nativeCurrencySymbol}
          </strong>
          <small>{privacyMode ? t("popup:home.balance.hidden") : `${formatUsd(snapshot.totalValueUsd)} - ${assetFreshnessLabel(snapshot.refreshedAt, snapshot.staleAt, t)}`}</small>
        </div>
      </div>
      <button type="button" className="secondary-button" onClick={onRefresh}>
        <RefreshCcw size={16} />
        {t("popup:chainDetail.refreshButton", { symbol: snapshot.nativeCurrencySymbol })}
      </button>
      <div className="preview-row">
        <span>{t("popup:chainDetail.status")}</span>
        <div>
          <strong>{chainStatusLabel(snapshot, t)}</strong>
          {snapshot.error ? <small>{snapshot.error}</small> : snapshot.staleAt ? <small>{t("popup:chainDetail.freshUntil", { time: new Date(snapshot.staleAt).toLocaleTimeString() })}</small> : null}
        </div>
      </div>
      {tokenRows.length > 0 ? (
        <div className="token-balance-list">
          <span>{t("popup:chainDetail.tokens")}</span>
          {tokenRows.map((row) => {
            const value = row.balance && row.price ? Number(row.balance.decimalAmount) * Number(row.price.value) : null;
            return (
              <div className="asset-widget-row" key={row.definition?.assetId}>
                <TokenIcon symbol={row.definition?.symbol ?? "?"} />
              <div>
                <strong>{row.definition?.symbol}</strong>
                  <span>{row.definition?.name} - {assetFreshnessLabel(row.balance?.refreshedAt, undefined, t)}</span>
              </div>
                <div>
                  <strong>{privacyMode ? t("popup:home.balance.hidden") : value === null || !Number.isFinite(value) ? "--" : formatUsd(value.toFixed(2))}</strong>
                  <span>{privacyMode ? t("popup:home.balance.hidden") : `${row.balance ? formatTokenAmount(row.balance.decimalAmount) : "--"} ${row.definition?.symbol}`}</span>
              </div>
              <button type="button" className="mini-icon-button" onClick={onRefresh} aria-label={t("popup:chainDetail.refreshSymbol", { symbol: row.definition?.symbol ?? "" })}>
                <RefreshCcw size={14} />
              </button>
            </div>
          );
        })}
        </div>
      ) : null}
    </div>
  );
}

function assetFreshnessLabel(refreshedAt?: string, staleAt?: string, t?: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!refreshedAt) {
    return t ? t("popup:chainDetail.notRefreshed") : "Not refreshed";
  }

  if (staleAt && Date.parse(staleAt) < Date.now()) {
    return t ? t("popup:chainDetail.stale", { time: new Date(staleAt).toLocaleTimeString() }) : `Stale since ${new Date(staleAt).toLocaleTimeString()}`;
  }

  return t ? t("popup:chainDetail.updated", { time: new Date(refreshedAt).toLocaleTimeString() }) : `Updated ${new Date(refreshedAt).toLocaleTimeString()}`;
}

function chainStatusLabel(snapshot: ChainAssetSnapshot, t?: (key: string) => string): string {
  if (snapshot.status === "ready" && snapshot.totalValueUsd === null) {
    return t ? t("popup:portfolio.balancePriceUnavailable") : "Balance ready, price unavailable";
  }

  if (snapshot.status === "ready") {
    return t ? t("common:status.ready") : "Ready";
  }

  if (snapshot.status === "unsupported") {
    return t ? t("popup:portfolio.adapterPending") : "Adapter pending";
  }

  return snapshot.status === "error"
    ? (t ? t("popup:portfolio.refreshFailed") : "Refresh failed")
    : (t ? t("popup:portfolio.refreshing") : "Refreshing");
}

function ReceiveView({
  wallet,
  network,
  copied,
  onCopy,
  onDone
}: {
  wallet: WalletRecord;
  network: WalletNetworkSetting | null;
  copied: boolean;
  onCopy: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [showFullAddress, setShowFullAddress] = useState(false);
  const asset = network?.nativeCurrencySymbol ?? "ETH";
  const networkName = network?.name.replace(/\s+(Mainnet|network)$/i, "") ?? "Ethereum";
  const address = showFullAddress ? wallet.address : formatAddress(wallet.address);

  async function handleShare() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: t("popup:receive.heading", { asset }),
          text: wallet.address
        });
        return;
      } catch {
        return;
      }
    }

    onCopy();
  }

  return (
    <section className="receive-panel receive-sheet" aria-label={t("popup:receive.sectionLabel")}>
      <div className="receive-sheet-heading">
        <div>
          <span>{t("popup:receive.label")}</span>
          <h3>{t("popup:receive.heading", { asset })}</h3>
        </div>
        <strong>{networkName}</strong>
      </div>

      <div className="receive-qr-stage">
        <div className="qr-wrap receive-qr-card">
          <QRCodeSVG value={wallet.address} size={212} marginSize={2} level="M" />
        </div>
        <p>{t("popup:receive.qrHint", { asset, network: networkName })}</p>
      </div>

      <section className="receive-address-card" aria-label={t("popup:receive.addressLabel")}>
        <div className="receive-address-tabs" aria-hidden="true">
          <span>{t("popup:receive.addressTab")}</span>
          <em>ENS</em>
        </div>
        <div className="receive-address-line">
          <div>
            <strong>{address}</strong>
            <small title={wallet.address}>{wallet.address}</small>
          </div>
          <button type="button" onClick={onCopy} aria-label={copied ? t("popup:receive.addressCopied") : t("popup:receive.copyAddress")}>
            {copied ? <Check size={20} /> : <Copy size={20} />}
          </button>
          <button type="button" onClick={() => void handleShare()} aria-label={t("popup:receive.shareAddress")}>
            <Share2 size={20} />
          </button>
        </div>
      </section>

      <div className="receive-options" aria-label={t("popup:regions.receiveOptions")}>
        <button type="button" onClick={() => setShowFullAddress((current) => !current)}>
          <Eye size={17} />
          {showFullAddress ? t("popup:receive.showShortAddress") : t("popup:receive.showFullAddress")}
        </button>
        <button type="button" disabled>
          <SlidersHorizontal size={17} />
          {t("popup:receive.setAmount")}
        </button>
      </div>

      <button type="button" className="primary-button receive-done" onClick={onDone}>
        {t("common:actions.done")}
      </button>
      <button type="button" className="receive-copy-footer" onClick={onCopy}>
        <Copy size={16} />
        {copied ? t("popup:receive.addressCopied") : t("popup:receive.copyAddress")}
      </button>
    </section>
  );
}

function SendView({
  resolverStatus,
  recipientInput,
  recipientResolution,
  sendNetworks,
  selectedSendNetwork,
  chainSnapshots,
  amountInput,
  feeStatus,
  feeError,
  previewResult,
  previewAccepted,
  tokenPickerOpen,
  signingStatus,
  signingError,
  signatureResult,
  broadcastHash,
  broadcastExplorerUrl,
  onRecipientInput,
  onNetworkSelect,
  onTokenPickerOpen,
  onAmountInput,
  onPreviewAction,
  onCancelPreview
}: {
  resolverStatus: ResolverStatus;
  recipientInput: string;
  recipientResolution: RecipientResolution;
  sendNetworks: WalletNetworkSetting[];
  selectedSendNetwork: WalletNetworkSetting | null;
  chainSnapshots: ChainAssetSnapshot[];
  amountInput: string;
  feeStatus: FeeStatus;
  feeError: string | null;
  previewResult: ReturnType<typeof buildNativeTokenTransferPreview>;
  previewAccepted: boolean;
  tokenPickerOpen: boolean;
  signingStatus: SigningStatus;
  signingError: string | null;
  signatureResult: NativeTransferSignResult | null;
  broadcastHash: string | null;
  broadcastExplorerUrl: string | null;
  onRecipientInput: (value: string) => void;
  onNetworkSelect: (networkId: string | null) => void;
  onTokenPickerOpen: (open: boolean) => void;
  onAmountInput: (value: string) => void;
  onPreviewAction: () => void;
  onCancelPreview: () => void;
}) {
  const { t } = useTranslation();
  const selectedSnapshot = selectedSendNetwork
    ? chainSnapshots.find((snapshot) => snapshot.networkId === selectedSendNetwork.networkId)
    : undefined;
  const maxAmount = selectedSnapshot?.nativeBalance ?? "";
  const recipientHint =
    resolverStatus === "resolving"
      ? t("popup:send.resolvingRecipient")
      : recipientResolution.kind === "ens"
        ? `${recipientResolution.normalizedName} resolves to ${formatAddress(recipientResolution.address)}`
        : recipientResolution.kind === "address" && recipientResolution.primaryName
          ? `Reverse ENS: ${recipientResolution.primaryName}`
          : recipientResolution.kind === "invalid"
            ? recipientResolution.reason
            : null;
  const recipientTone = recipientResolution.kind === "invalid" ? "invalid" : recipientResolution.kind === "empty" ? "" : "valid";
  const networkName = selectedSendNetwork?.name.replace(/\s+(Mainnet|network)$/i, "") ?? "Network";

  async function handlePasteRecipient() {
    try {
      const clipboardValue = await navigator.clipboard.readText();

      if (clipboardValue.trim()) {
        onRecipientInput(clipboardValue.trim());
      }
    } catch {
      return;
    }
  }

  if (previewAccepted) {
    return (
      <section className="send-preview-screen" aria-label={t("popup:regions.transactionPreview")}>
        <ClearSigningPreviewSheet
          result={previewResult}
          feeStatus={feeStatus}
          feeError={feeError}
          signingStatus={signingStatus}
          onSign={onPreviewAction}
          onCancel={onCancelPreview}
        />

        {signatureResult ? (
          <div className="signature-box">
            <span>{t("popup:send.signedTxHash")}</span>
            <strong>{signatureResult.txHash}</strong>
          </div>
        ) : null}

        {broadcastHash ? (
          <div className="signature-box broadcasted">
            <span>{t("popup:send.broadcastHash")}</span>
            <strong>{broadcastHash}</strong>
            {broadcastExplorerUrl ? (
              <a href={broadcastExplorerUrl} target="_blank" rel="noreferrer">
                {t("popup:send.viewOnExplorer")}
              </a>
            ) : null}
          </div>
        ) : null}

        {signingError ? <p className="resolver-result invalid">{signingError}</p> : null}
      </section>
    );
  }

  return (
    <section className="send-panel portal-send-panel" aria-label={t("popup:send.sectionLabel")}>
      <section className="portal-send-sheet" aria-label={t("popup:send.formLabel")}>
        <div className="portal-send-heading">
          <h2>{t("popup:send.heading")}</h2>
          <strong>{networkName}</strong>
        </div>

        <div className="token-picker-wrap portal-send-token-picker">
          <button type="button" className="portal-send-token" onClick={() => onTokenPickerOpen(!tokenPickerOpen)} disabled={sendNetworks.length === 0}>
            <TokenIcon symbol={selectedSendNetwork?.nativeCurrencySymbol ?? "?"} />
            <div>
              <strong>{selectedSendNetwork?.nativeCurrencySymbol ?? "TOKEN"}</strong>
              <small>{selectedSendNetwork?.name ?? t("popup:send.enableEvm")}</small>
            </div>
            <ChevronDown size={22} />
          </button>
          {tokenPickerOpen ? (
            <TokenPickerSheet
              networks={sendNetworks}
              selectedNetworkId={selectedSendNetwork?.networkId ?? null}
              chainSnapshots={chainSnapshots}
              onSelect={(networkId) => {
                onNetworkSelect(networkId);
                onTokenPickerOpen(false);
              }}
            />
          ) : null}
        </div>

        <label className="portal-send-label" htmlFor="portal-send-amount">{t("popup:send.amount")}</label>
        <div className="portal-send-amount">
          <div className="portal-send-amount-value">
            <input
              id="portal-send-amount"
              type="text"
              inputMode="decimal"
              value={amountInput}
              onChange={(event) => onAmountInput(event.target.value)}
              placeholder="0.00"
              spellCheck={false}
            />
            <small>{t("popup:send.usdEquivalent")}</small>
          </div>
          <button type="button" disabled={!maxAmount} onClick={() => onAmountInput(maxAmount)}>
            {t("popup:send.max")}
          </button>
        </div>

        <label className="portal-send-label" htmlFor="portal-send-recipient">{t("popup:send.recipient")}</label>
        <div className="portal-send-recipient">
          <input
            id="portal-send-recipient"
            type="text"
            value={recipientInput}
            onChange={(event) => onRecipientInput(event.target.value)}
            placeholder={t("popup:send.recipientPlaceholder")}
            spellCheck={false}
          />
          <button type="button" onClick={() => void handlePasteRecipient()} aria-label={t("popup:send.pasteRecipient")}>
            <Copy size={17} />
          </button>
        </div>
        {recipientHint ? <small className={`send-recipient-hint ${recipientTone}`}>{recipientHint}</small> : null}

        <section className="portal-send-fee" aria-live="polite">
          <Wallet size={20} />
          <div>
            <strong>{t("popup:send.estimatedFee")}</strong>
            <small>{feeStatus === "estimating" ? t("popup:send.estimating") : feeError ?? selectedSendNetwork?.name ?? t("popup:send.completeDetails")}</small>
          </div>
          <div>
            <strong>{previewResult.ok ? previewResult.preview.estimatedNetworkFee : "~$0.00"}</strong>
            <small>{maxAmount ? t("popup:send.available", { amount: formatTokenAmount(maxAmount), symbol: selectedSendNetwork?.nativeCurrencySymbol ?? "" }) : t("popup:send.balanceUnavailable")}</small>
          </div>
        </section>

        <button
          type="button"
          className="primary-button portal-send-continue"
          disabled={
            !previewResult.ok ||
            !canSignPreview(previewResult.preview) ||
            signingStatus === "signing" ||
            signingStatus === "broadcasting" ||
            signingStatus === "broadcasted"
          }
          onClick={onPreviewAction}
        >
          {signingStatus === "signing"
            ? t("popup:send.signing")
            : signingStatus === "broadcasting"
              ? t("popup:send.broadcasting")
              : signingStatus === "broadcasted"
                ? t("popup:send.broadcastSuccess")
                : t("popup:send.continue")}
        </button>
      </section>

      {signatureResult ? (
        <div className="signature-box">
          <span>{t("popup:send.signedTxHash")}</span>
          <strong>{signatureResult.txHash}</strong>
        </div>
      ) : null}

      {broadcastHash ? (
        <div className="signature-box broadcasted">
          <span>{t("popup:send.broadcastHash")}</span>
          <strong>{broadcastHash}</strong>
          {broadcastExplorerUrl ? (
            <a href={broadcastExplorerUrl} target="_blank" rel="noreferrer">
              {t("popup:send.viewOnExplorer")}
            </a>
          ) : null}
        </div>
      ) : null}

      {signingError ? <p className="resolver-result invalid">{signingError}</p> : null}
    </section>
  );
}

function TokenPickerSheet({
  networks,
  selectedNetworkId,
  chainSnapshots,
  onSelect
}: {
  networks: WalletNetworkSetting[];
  selectedNetworkId: string | null;
  chainSnapshots: ChainAssetSnapshot[];
  onSelect: (networkId: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const visibleNetworks = networks.filter((network) =>
    [network.name, network.nativeCurrencySymbol, network.chainId?.toString() ?? ""].join(" ").toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <div className="sheet-panel" aria-label={t("popup:tokenPicker.heading")}>
      <label className="settings-search compact-search">
        <Search size={16} />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("popup:tokenPicker.searchPlaceholder")} />
      </label>
      <div className="token-option-list">
        {visibleNetworks.map((network) => {
          const snapshot = chainSnapshots.find((item) => item.networkId === network.networkId);
          return (
            <button type="button" className={network.networkId === selectedNetworkId ? "selected" : ""} onClick={() => onSelect(network.networkId)} key={network.networkId}>
              <TokenIcon symbol={network.nativeCurrencySymbol} />
              <div>
                <strong>{network.nativeCurrencySymbol}</strong>
                <small>{network.name}</small>
              </div>
              <span>{snapshot?.nativeBalance ? formatTokenAmount(snapshot.nativeBalance) : "--"}</span>
            </button>
          );
        })}
      </div>
      <button type="button" className="secondary-button" disabled>
        {t("popup:tokenPicker.manageTokens")}
      </button>
    </div>
  );
}

function ConnectedSessionsView({
  walletConnectUri,
  walletConnectStatus,
  walletConnectMessage,
  proposals,
  proposalsStatus,
  proposalsError,
  actingProposalId,
  sessions,
  status,
  error,
  disconnectingTopic,
  onUriInput,
  onPair,
  onRefreshProposals,
  onApproveProposal,
  onRejectProposal,
  onRefresh,
  onDisconnect,
  onDisconnectAll
}: {
  walletConnectUri: string;
  walletConnectStatus: WalletConnectStatus;
  walletConnectMessage: string | null;
  proposals: PendingWalletConnectProposal[];
  proposalsStatus: WalletConnectProposalStatus;
  proposalsError: string | null;
  actingProposalId: number | null;
  sessions: WalletConnectSessionSummary[];
  status: WalletConnectSessionsStatus;
  error: string | null;
  disconnectingTopic: string | null;
  onUriInput: (uri: string) => void;
  onPair: () => void;
  onRefreshProposals: () => void;
  onApproveProposal: (id: number) => void;
  onRejectProposal: (id: number) => void;
  onRefresh: () => void;
  onDisconnect: (topic: string) => void;
  onDisconnectAll: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "expiring">("all");
  const [sort, setSort] = useState<"name" | "last-active" | "expiry">("name");
  const [detailTopic, setDetailTopic] = useState<string | null>(null);
  const visibleSessions = sessions
    .filter((session) =>
      [session.name, session.url, session.chains.join(" "), session.methods.join(" "), session.domain ?? ""].join(" ").toLowerCase().includes(query.trim().toLowerCase())
    )
    .filter((session) => {
      if (filter === "active") {
        return Boolean(session.lastActiveAt);
      }

      if (filter === "expiring") {
        return Boolean(session.expiry && session.expiry * 1000 < Date.now() + 7 * 24 * 60 * 60 * 1000);
      }

      return true;
    })
    .sort((a, b) => {
      if (sort === "last-active") {
        return (Date.parse(b.lastActiveAt ?? "0") || 0) - (Date.parse(a.lastActiveAt ?? "0") || 0);
      }

      if (sort === "expiry") {
        return (a.expiry ?? Number.MAX_SAFE_INTEGER) - (b.expiry ?? Number.MAX_SAFE_INTEGER);
      }

      return a.name.localeCompare(b.name);
    });
  const detailSession = sessions.find((session) => session.topic === detailTopic) ?? null;

  return (
    <section className="resolver-panel" aria-label={t("popup:walletConnect.sectionLabel")}>
      <WidgetHeader label={t("popup:walletConnect.heading")} title={t("popup:walletConnect.connectedSessions")} />

      <label className="recipient-field">
        <span>{t("popup:walletConnect.pairingLabel")}</span>
        <input type="text" value={walletConnectUri} onChange={(event) => onUriInput(event.target.value)} placeholder={t("popup:walletConnect.pairingPlaceholder")} spellCheck={false} />
      </label>

      <button type="button" className="secondary-button" disabled={!walletConnectUri.trim() || walletConnectStatus === "pairing"} onClick={onPair}>
        {walletConnectStatus === "pairing" ? <Loader2 className="spin" size={17} /> : <Settings2 size={17} />}
        {walletConnectStatus === "pairing" ? t("popup:walletConnect.pairing") : t("popup:walletConnect.pair")}
      </button>

      {walletConnectMessage ? <p className={walletConnectStatus === "error" ? "resolver-result invalid" : "resolver-result valid"}>{walletConnectMessage}</p> : null}

      <PendingProposalPanel
        proposals={proposals}
        status={proposalsStatus}
        error={proposalsError}
        actingProposalId={actingProposalId}
        onRefresh={onRefreshProposals}
        onApprove={onApproveProposal}
        onReject={onRejectProposal}
      />

      <label className="settings-search compact-search">
        <Search size={16} />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("popup:walletConnect.searchPlaceholder")} />
      </label>
      <div className="session-controls">
        <label>
          <span>{t("popup:walletConnect.filterLabel")}</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value as "all" | "active" | "expiring")}>
            <option value="all">{t("popup:walletConnect.allSessions")}</option>
            <option value="active">{t("popup:walletConnect.noActiveFilter")}</option>
            <option value="expiring">{t("popup:walletConnect.expiringFilter")}</option>
          </select>
        </label>
        <label>
          <span>{t("popup:walletConnect.sortLabel")}</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as "name" | "last-active" | "expiry")}>
            <option value="name">{t("popup:walletConnect.nameSort")}</option>
            <option value="last-active">{t("popup:walletConnect.lastActive")}</option>
            <option value="expiry">{t("popup:walletConnect.expirySort")}</option>
          </select>
        </label>
      </div>

      <WalletConnectSessionsPanel
        sessions={visibleSessions}
        status={status}
        error={error}
        disconnectingTopic={disconnectingTopic}
        onRefresh={onRefresh}
        onDisconnect={onDisconnect}
        onDisconnectAll={onDisconnectAll}
        onShowDetail={setDetailTopic}
      />
      {detailSession ? <SessionDetail session={detailSession} disconnectingTopic={disconnectingTopic} onDisconnect={onDisconnect} /> : null}
    </section>
  );
}

function PendingProposalPanel({
  proposals,
  status,
  error,
  actingProposalId,
  onRefresh,
  onApprove,
  onReject
}: {
  proposals: PendingWalletConnectProposal[];
  status: WalletConnectProposalStatus;
  error: string | null;
  actingProposalId: number | null;
  onRefresh: () => void;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="wc-session-panel">
      <div className="wc-session-heading">
        <div>
          <span>{t("popup:walletConnect.connectionRequests")}</span>
          <strong>{proposals.length}</strong>
        </div>
        <button type="button" className="mini-icon-button" disabled={status === "loading"} onClick={onRefresh} title={t("popup:walletConnect.refreshRequests")}>
          <RefreshCcw className={status === "loading" ? "spin" : undefined} size={15} />
        </button>
      </div>

      {proposals.length > 0 ? (
        <div className="wc-session-list">
          {proposals.map((proposal) => (
            <article className="proposal-row" key={proposal.id}>
              <div className="wc-session-main">
                <strong>{proposal.name}</strong>
                <span>{proposal.url || t("popup:walletConnect.noOrigin")}</span>
                <small>{proposalSummary(proposal)}</small>
              </div>
              <div className="proposal-actions">
                <button type="button" className="secondary-button" disabled={actingProposalId === proposal.id} onClick={() => onReject(proposal.id)}>
                  {t("popup:walletConnect.reject")}
                </button>
                <button type="button" className="primary-button" disabled={actingProposalId === proposal.id || proposal.riskyMethods.length > 0} onClick={() => onApprove(proposal.id)}>
                  {actingProposalId === proposal.id ? <Loader2 className="spin" size={15} /> : <Check size={15} />}
                  {t("popup:walletConnect.approve")}
                </button>
              </div>
              {proposal.riskyMethods.length > 0 || proposal.unsupportedChains.length > 0 || proposal.domainMismatch ? (
                <div className="warning-list">
                  {proposal.riskyMethods.length > 0 ? (
                    <div className="warning-item danger">
                      <AlertTriangle size={14} />
                      <span>{t("popup:walletConnect.riskyMethods", { methods: proposal.riskyMethods.join(", ") })}</span>
                    </div>
                  ) : null}
                  {proposal.unsupportedChains.length > 0 ? (
                    <div className="warning-item warning">
                      <AlertTriangle size={14} />
                      <span>{t("popup:walletConnect.unsupportedChains", { chains: proposal.unsupportedChains.join(", ") })}</span>
                    </div>
                  ) : null}
                  {proposal.domainMismatch ? (
                    <div className="warning-item warning">
                      <AlertTriangle size={14} />
                      <span>{t("popup:walletConnect.domainMismatch")}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="resolver-hint">{status === "loading" ? t("popup:walletConnect.loadingRequests") : t("popup:walletConnect.noPendingRequests")}</p>
      )}

      {error ? <p className="resolver-result invalid">{error}</p> : null}
    </div>
  );
}

function NetworksView({
  networks,
  sendNetworks,
  selectedSendNetworkId,
  portfolioStore,
  networkHealth,
  networkHealthStatus,
  onSelectDefaultSendNetwork,
  onUpdateNetwork,
  onOpenSettings
}: {
  networks: WalletNetworkSetting[];
  sendNetworks: WalletNetworkSetting[];
  selectedSendNetworkId: string | null;
  portfolioStore: AssetStore | null;
  networkHealth: Record<string, NetworkHealthCheck>;
  networkHealthStatus: "idle" | "loading" | "ready";
  onSelectDefaultSendNetwork: (networkId: string | null) => void;
  onUpdateNetwork: (networkId: string, updater: (network: WalletNetworkSetting) => WalletNetworkSetting) => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  const [expandedNetworkId, setExpandedNetworkId] = useState<string | null>(selectedSendNetworkId);

  return (
    <section className="portfolio-panel" aria-label={t("popup:network.heading")}>
      <WidgetHeader label={t("popup:network.heading")} title={t("popup:network.enabledAndBuiltIn")} actionLabel={t("popup:network.editAction")} onAction={onOpenSettings} />
      <label className="recipient-field">
        <span>{t("popup:network.defaultSendNetwork")}</span>
        <select className="network-select" value={selectedSendNetworkId ?? ""} onChange={(event) => onSelectDefaultSendNetwork(event.target.value || null)}>
          {sendNetworks.map((network) => (
            <option value={network.networkId} key={network.networkId}>
              {network.name} - {network.nativeCurrencySymbol}
            </option>
          ))}
        </select>
      </label>
      <div className="network-widget-list">
        {networks.map((network) => {
          const snapshot = portfolioStore?.chainAssetSnapshots[network.networkId];
          const health = networkHealth[network.networkId];
          return (
            <article className={`network-detail-row ${network.enabled ? "enabled" : ""}`} key={network.networkId}>
              <button type="button" className="network-row-trigger" onClick={() => setExpandedNetworkId(expandedNetworkId === network.networkId ? null : network.networkId)}>
                <TokenIcon symbol={network.nativeCurrencySymbol} />
                <div>
                  <strong>{network.name}</strong>
                  <span>{network.chainId ? t("popup:network.chainId", { chainId: network.chainId }) : network.family}</span>
                </div>
                {selectedSendNetworkId === network.networkId ? <span className="default-badge">{t("popup:network.defaultBadge")}</span> : null}
                <StatusBadge ready={network.enabled && health?.status !== "error" && snapshot?.status !== "error"} label={network.enabled ? networkHealthLabel(health, networkHealthStatus, t) : t("popup:network.disabled")} />
                <ChevronDown size={16} />
              </button>
              {expandedNetworkId === network.networkId ? (
                <div className="network-expanded">
                  <label className="network-toggle inline-toggle">
                    <input
                      type="checkbox"
                      checked={network.enabled}
                      onChange={(event) =>
                        onUpdateNetwork(network.networkId, (currentNetwork) => ({
                          ...currentNetwork,
                          enabled: event.target.checked
                        }))
                      }
                    />
                    <span>{network.enabled ? t("popup:network.enabled_true") : t("popup:network.enabled_false")}</span>
                  </label>
                  <PreviewRow label={t("popup:network.nativeToken")} value={network.nativeCurrencySymbol} detail={network.chain} />
                  <label className="recipient-field">
                    <span>{t("popup:network.rpcSelected")}</span>
                    <select
                      className="network-select"
                      value={network.selectedRpcUrl}
                      disabled={!network.enabled}
                      onChange={(event) =>
                        onUpdateNetwork(network.networkId, (currentNetwork) => ({
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
                  <PreviewRow label={t("popup:network.rpcStatus")} value={networkHealthLabel(health, networkHealthStatus, t)} detail={health?.failureReason ?? (health?.latestBlockNumber ? `Block ${health.latestBlockNumber} - ${health.latencyMs}ms` : undefined)} />
                  <PreviewRow label={t("popup:network.explorer")} value={network.explorerUrl ?? t("popup:network.explorerNotConfigured")} />
                  <PreviewRow label={t("popup:network.gasStatus")} value={health?.status === "ready" ? t("popup:network.gasStatusReady") : t("popup:network.gasStatusUnavailable")} />
                  <button type="button" className="secondary-button" disabled={!network.enabled || !sendNetworks.some((item) => item.networkId === network.networkId)} onClick={() => onSelectDefaultSendNetwork(network.networkId)}>
                    {t("popup:network.useForSends")}
                  </button>
                  <button type="button" className="secondary-button" onClick={onOpenSettings}>
                    {t("popup:network.addOrEdit")}
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function networkHealthLabel(health: NetworkHealthCheck | undefined, status: "idle" | "loading" | "ready", t?: (key: string, opts?: Record<string, unknown>) => string): string {
  if (status === "loading" && !health) {
    return t ? t("popup:network.checking") : "Checking";
  }

  if (!health) {
    return t ? t("popup:network.notChecked") : "Not checked";
  }

  if (health.status === "ready") {
    return t ? t("popup:network.rpcReady", { latency: health.latencyMs ?? "--" }) : `${health.latencyMs ?? "--"}ms`;
  }

  if (health.status === "unsupported") {
    return t ? t("popup:network.unsupported") : "Unsupported";
  }

  return t ? t("popup:network.rpcFailed") : "RPC failed";
}

function SecurityView({
  wallet,
  previewReady,
  sessions,
  proposals,
  portfolioError,
  networkHealth
}: {
  wallet: WalletRecord | null;
  previewReady: boolean;
  sessions: WalletConnectSessionSummary[];
  proposals: PendingWalletConnectProposal[];
  portfolioError: string | null;
  networkHealth: Record<string, NetworkHealthCheck>;
}) {
  const { t } = useTranslation();
  const failedNetworkCount = Object.values(networkHealth).filter((health) => health.status === "error").length;
  const riskyProposalCount = proposals.filter((proposal) => proposal.riskyMethods.length > 0 || proposal.unsupportedChains.length > 0 || proposal.domainMismatch).length;

  return (
    <section className="portfolio-panel" aria-label={t("popup:security.heading")}>
      <WidgetHeader label={t("popup:security.heading")} title={t("popup:security.title")} />
      <div className="security-grid">
        <SecurityRow label={t("popup:security.passkey.label")} value={wallet ? t("popup:security.passkey.ready") : t("popup:security.passkey.noWallet")} tone={wallet ? "ready" : "warning"} />
        <SecurityRow label={t("popup:security.clearSigning.label")} value={previewReady ? t("popup:security.clearSigning.active") : t("popup:security.clearSigning.waiting")} tone="ready" />
        <SecurityRow label={t("popup:security.dappSessions.label")} value={t("popup:security.dappSessions.value", { count: sessions.length, risky: riskyProposalCount })} tone={sessions.length > 0 || riskyProposalCount > 0 ? "warning" : "ready"} />
        <SecurityRow label={t("popup:security.portfolioRefresh.label")} value={portfolioError ?? t("popup:security.portfolioRefresh.noErrors")} tone={portfolioError ? "warning" : "ready"} />
        <SecurityRow label={t("popup:security.networkMismatch.label")} value={failedNetworkCount > 0 ? t("popup:security.networkMismatch.issue", { count: failedNetworkCount }) : t("popup:security.networkMismatch.noIssues")} tone={failedNetworkCount > 0 ? "warning" : "ready"} />
      </div>
    </section>
  );
}

function SecurityRow({ label, value, tone }: { label: string; value: string; tone: "ready" | "warning" }) {
  return (
    <div className={`security-row ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SettingsView({
  wallet,
  status,
  privacyMode,
  visibleWidgets,
  widgetOrder,
  compact,
  onCreateWallet,
  onReset,
  onTogglePrivacy,
  onToggleWidget,
  onMoveWidget,
  onResetWidgets,
  onOpenSettings
}: {
  wallet: WalletRecord | null;
  status: Status;
  privacyMode: boolean;
  visibleWidgets: string[];
  widgetOrder: string[];
  compact?: boolean;
  onCreateWallet: () => void;
  onReset: () => void;
  onTogglePrivacy: () => void;
  onToggleWidget: (widgetId: string) => void;
  onMoveWidget: (widgetId: string, direction: -1 | 1) => void;
  onResetWidgets: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();

  return (
    <section className={compact ? "setup-panel compact-setup" : "setup-panel"}>
      <div className="setup-copy">
        <Wallet size={22} />
        <div>
          <h3>{wallet ? t("popup:settings.walletCreated") : t("popup:settings.walletTitle")}</h3>
          <p>
            {wallet
              ? t("popup:settings.keystoreDescription")
              : t("popup:settings.walletDescription")}
          </p>
        </div>
      </div>

      {!compact ? (
        <button type="button" className="secondary-button" onClick={onTogglePrivacy}>
          {privacyMode ? <EyeOff size={18} /> : <Eye size={18} />}
          {privacyMode ? t("popup:settings.showBalances") : t("popup:settings.hideBalances")}
        </button>
      ) : null}

      {!wallet ? (
        <button type="button" className="primary-button" disabled={status === "creating"} onClick={onCreateWallet}>
          {status === "creating" ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />}
          {status === "creating" ? t("popup:settings.creating") : t("popup:settings.createPasskey")}
        </button>
      ) : (
        <button type="button" className="secondary-button" onClick={onReset}>
          <RefreshCcw size={18} />
          {t("popup:settings.resetLocalWallet")}
        </button>
      )}

      {!compact ? (
        <button type="button" className="secondary-button" onClick={onOpenSettings}>
          <Network size={18} />
          {t("popup:settings.openNetworkSettings")}
        </button>
      ) : null}

      {!compact ? (
        <WidgetCustomizationList
          visibleWidgets={visibleWidgets}
          widgetOrder={widgetOrder}
          onToggleWidget={onToggleWidget}
          onMoveWidget={onMoveWidget}
          onResetWidgets={onResetWidgets}
        />
      ) : null}
    </section>
  );
}

function WidgetCustomizationList({
  visibleWidgets,
  widgetOrder,
  onToggleWidget,
  onMoveWidget,
  onResetWidgets
}: {
  visibleWidgets: string[];
  widgetOrder: string[];
  onToggleWidget: (widgetId: string) => void;
  onMoveWidget: (widgetId: string, direction: -1 | 1) => void;
  onResetWidgets: () => void;
}) {
  const { t } = useTranslation();
  const widgetDescriptions: Record<string, { title: string; detail: string; recommended?: boolean }> = {
    balance: { title: t("popup:widgets.balance.title"), detail: t("popup:widgets.balance.detail"), recommended: true },
    actions: { title: t("popup:widgets.actions.title"), detail: t("popup:widgets.actions.detail"), recommended: true },
    assets: { title: t("popup:widgets.assets.title"), detail: t("popup:widgets.assets.detail"), recommended: true },
    networks: { title: t("popup:widgets.networks.title"), detail: t("popup:widgets.networks.detail") },
    sessions: { title: t("popup:widgets.sessions.title"), detail: t("popup:widgets.sessions.detail") },
    pufeth: { title: t("popup:pufeth.title"), detail: t("popup:pufeth.subtitle") }
  };
  const order = widgetOrder.length ? widgetOrder : Object.keys(widgetDescriptions);

  return (
    <div className="customization-panel">
      <div className="resolver-heading">
        <div>
          <span className="muted">{t("popup:widgets.personalization")}</span>
          <h3>{t("popup:widgets.heading")}</h3>
        </div>
        <button type="button" className="text-button" onClick={onResetWidgets}>
          {t("popup:widgets.reset")}
        </button>
      </div>
      {order.map((widgetId, index) => {
        const widget = widgetDescriptions[widgetId];

        if (!widget) {
          return null;
        }

        return (
          <div className="customization-row" key={widgetId}>
            <div className="drag-handle" aria-hidden="true">
              ::
            </div>
            <div>
              <strong>{widget.title}</strong>
              <small>{widget.detail}</small>
              {widget.recommended ? <span>{t("popup:widgets.recommended")}</span> : null}
            </div>
            <div className="customization-actions">
              <button type="button" className="mini-icon-button" disabled={index === 0} onClick={() => onMoveWidget(widgetId, -1)} aria-label={`Move ${widget.title} up`}>
                ↑
              </button>
              <button type="button" className="mini-icon-button" disabled={index === order.length - 1} onClick={() => onMoveWidget(widgetId, 1)} aria-label={`Move ${widget.title} down`}>
                ↓
              </button>
              <label className="network-toggle">
                <input type="checkbox" checked={(visibleWidgets.length ? visibleWidgets : order).includes(widgetId)} onChange={() => onToggleWidget(widgetId)} />
                <span>{(visibleWidgets.length ? visibleWidgets : order).includes(widgetId) ? t("popup:widgets.shown") : t("popup:widgets.hidden")}</span>
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function networkToSnapshot(network: WalletNetworkSetting): ChainAssetSnapshot {
  return {
    networkId: network.networkId,
    networkName: network.name,
    family: network.family,
    nativeCurrencySymbol: network.nativeCurrencySymbol,
    accountId: "",
    chainId: network.chainId,
    status: network.enabled ? "refreshing" : "unsupported",
    assetIds: [],
    totalValueUsd: null
  };
}

function WalletConnectSessionsPanel({
  sessions,
  status,
  error,
  disconnectingTopic,
  onRefresh,
  onDisconnect,
  onDisconnectAll,
  onShowDetail
}: {
  sessions: WalletConnectSessionSummary[];
  status: WalletConnectSessionsStatus;
  error: string | null;
  disconnectingTopic: string | null;
  onRefresh: () => void;
  onDisconnect: (topic: string) => void;
  onDisconnectAll?: () => void;
  onShowDetail?: (topic: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="wc-session-panel">
      <div className="wc-session-heading">
        <div>
          <span>{t("popup:walletConnect.connectedDapps")}</span>
          <strong>{sessions.length}</strong>
        </div>
        <div className="wc-heading-actions">
          {sessions.length > 0 && onDisconnectAll ? (
            <button type="button" className="mini-icon-button danger" disabled={disconnectingTopic === "__all__"} onClick={onDisconnectAll} title={t("popup:walletConnect.disconnectAll")}>
              {disconnectingTopic === "__all__" ? <Loader2 className="spin" size={15} /> : <Unplug size={15} />}
            </button>
          ) : null}
          <button type="button" className="mini-icon-button" disabled={status === "loading"} onClick={onRefresh} title={t("popup:walletConnect.refreshSessions")}>
            <RefreshCcw className={status === "loading" ? "spin" : undefined} size={15} />
          </button>
        </div>
      </div>

      {sessions.length > 0 ? (
        <div className="wc-session-list">
          {sessions.map((session) => (
            <div className="wc-session-row" key={session.topic}>
              <div className="wc-session-icon" aria-hidden="true">
                {session.icons[0] ? <img src={session.icons[0]} alt="" /> : <Settings2 size={16} />}
              </div>
              <div className="wc-session-main">
                <strong>{session.name}</strong>
                <span>{session.url || t("popup:walletConnect.noOrigin")}</span>
                <small>{walletConnectSessionMeta(session)}</small>
              </div>
              {onShowDetail ? (
                <button type="button" className="wc-disconnect" onClick={() => onShowDetail(session.topic)} title={t("popup:walletConnect.viewDetails")}>
                  <ChevronDown size={15} />
                </button>
              ) : null}
              <button
                type="button"
                className="wc-disconnect"
                disabled={disconnectingTopic === session.topic}
                onClick={() => onDisconnect(session.topic)}
                title={t("popup:walletConnect.disconnectSession")}
              >
                {disconnectingTopic === session.topic ? <Loader2 className="spin" size={15} /> : <Unplug size={15} />}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="resolver-hint">
          {status === "loading" ? t("popup:walletConnect.loadingSessions") : t("popup:walletConnect.noSessions")}
        </p>
      )}

      {error ? <p className="resolver-result invalid">{error}</p> : null}
    </div>
  );
}

function SessionDetail({
  session,
  disconnectingTopic,
  onDisconnect
}: {
  session: WalletConnectSessionSummary;
  disconnectingTopic: string | null;
  onDisconnect: (topic: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <section className="session-detail" aria-label={t("popup:walletConnect.sessionDetail")}>
      <WidgetHeader label={t("popup:walletConnect.sessionDetailHeading")} title={session.name} />
      <PreviewRow label={t("popup:walletConnect.sessionDomain")} value={(session.domain ?? session.url) || t("popup:walletConnect.sessionNoExpiry")} detail={session.url || undefined} />
      <PreviewRow label={t("popup:walletConnect.sessionAccounts")} value={session.accounts.length > 0 ? session.accounts.join(", ") : t("popup:walletConnect.sessionNoAccounts")} />
      <PreviewRow label={t("popup:walletConnect.sessionAllowedChains")} value={session.chains.length > 0 ? session.chains.join(", ") : t("popup:walletConnect.sessionNoChains")} />
      <PreviewRow label={t("popup:walletConnect.sessionPermissions")} value={session.methods.length > 0 ? session.methods.join(", ") : "No methods"} />
      <PreviewRow label={t("popup:walletConnect.sessionLastActive")} value={session.lastActiveAt ? new Date(session.lastActiveAt).toLocaleString() : t("popup:walletConnect.sessionNoActivity")} />
      <PreviewRow label={t("popup:walletConnect.sessionExpiry")} value={session.expiry ? new Date(session.expiry * 1000).toLocaleString() : t("popup:walletConnect.sessionNoExpiry")} />
      <button type="button" className="secondary-button" disabled={disconnectingTopic === session.topic} onClick={() => onDisconnect(session.topic)}>
        {disconnectingTopic === session.topic ? <Loader2 className="spin" size={16} /> : <Unplug size={16} />}
        {t("popup:walletConnect.disconnectSession")}
      </button>
    </section>
  );
}

function walletConnectSessionMeta(session: WalletConnectSessionSummary): string {
  const chainLabel = session.chains.length > 0 ? session.chains.join(", ") : "No chains";
  const accountLabel = session.accounts.length === 1 ? "1 account" : `${session.accounts.length} accounts`;
  const expiry = session.expiry ? new Date(session.expiry * 1000).toLocaleDateString() : null;
  const activity = session.lastActiveAt ? `last active ${new Date(session.lastActiveAt).toLocaleString()}` : "no activity yet";
  const methods = session.methodHistory?.length ? ` - ${session.methodHistory.join(", ")}` : "";

  return expiry ? `${chainLabel} - ${accountLabel} - expires ${expiry} - ${activity}${methods}` : `${chainLabel} - ${accountLabel} - ${activity}${methods}`;
}

function proposalSummary(proposal: PendingWalletConnectProposal): string {
  const chains = [...proposal.requiredChains, ...proposal.optionalChains];
  const methods = [...proposal.requiredMethods, ...proposal.optionalMethods];
  const expires = proposal.expiresAt ? ` - expires ${new Date(proposal.expiresAt).toLocaleTimeString()}` : "";
  return `${chains.length || 0} chains - ${methods.length || 0} methods${expires}`;
}

function ResolverResult({ resolution }: { resolution: RecipientResolution }) {
  const { t } = useTranslation();

  if (resolution.kind === "empty") {
    return <p className="resolver-hint">{t("popup:resolver.hint")}</p>;
  }

  if (resolution.kind === "invalid") {
    return <p className="resolver-result invalid">{resolution.reason}</p>;
  }

  const title = resolution.kind === "ens" ? resolution.normalizedName : (resolution.primaryName ?? t("popup:resolver.ethAddress"));

  return (
    <div className="resolver-result valid">
      <div>
        <span>{title}</span>
        <strong>{formatAddress(resolution.address)}</strong>
      </div>
      <Check size={16} />
    </div>
  );
}

function ClearSigningPreviewCard({
  result,
  feeStatus,
  feeError
}: {
  result: ReturnType<typeof buildNativeTokenTransferPreview>;
  feeStatus: FeeStatus;
  feeError: string | null;
}) {
  const { t } = useTranslation();

  if (!result.ok) {
    return <p className="resolver-hint">{result.reason}</p>;
  }

  const preview = result.preview;

  return (
    <div className="preview-card">
      <div className="preview-hero">
        <span>{preview.title}</span>
        <strong>
          {preview.amount} {preview.asset}
        </strong>
      </div>

      <PreviewRow label={t("popup:clearSigning.recipient")} value={preview.recipientLabel} detail={formatAddress(preview.to)} />
      <PreviewRow label={t("popup:clearSigning.from")} value={formatAddress(preview.from)} />
      <PreviewRow label={t("popup:network.heading")} value={preview.networkName} detail={t("popup:network.chainId", { chainId: preview.chainId })} />
      <PreviewRow label={t("popup:clearSigning.contractData")} value={preview.data} detail={t("popup:clearSigning.contractDataDetail")} />
      <PreviewRow label={t("popup:clearSigning.feeLabel")} value={preview.estimatedNetworkFee} />
      <PreviewRow
        label={t("popup:clearSigning.gas")}
        value={preview.gasLimit ? preview.gasLimit.toString() : feeStatus === "estimating" ? t("popup:clearSigning.estimating") : t("popup:clearSigning.pending")}
        detail={preview.nonce !== null ? t("popup:clearSigning.nonce", { nonce: preview.nonce.toString() }) : undefined}
      />

      <div className="warning-list">
        {feeError ? (
          <div className="warning-item danger">
            <AlertTriangle size={14} />
            <span>{feeError}</span>
          </div>
        ) : null}
        {preview.warnings.map((warning) => (
          <div className={`warning-item ${warning.severity}`} key={warning.message}>
            <AlertTriangle size={14} />
            <span>{warning.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ClearSigningPreviewSheet({
  result,
  feeStatus,
  feeError,
  signingStatus,
  onSign,
  onCancel
}: {
  result: ReturnType<typeof buildNativeTokenTransferPreview>;
  feeStatus: FeeStatus;
  feeError: string | null;
  signingStatus: SigningStatus;
  onSign: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  if (!result.ok) {
    return (
      <div className="preview-card risk-state">
        <div className="warning-item danger">
          <AlertTriangle size={14} />
          <span>{result.reason}</span>
        </div>
      </div>
    );
  }

  const preview = result.preview;
  const canSign = canSignPreview(preview);

  return (
    <section className="clear-signing-sheet" aria-label={t("popup:regions.clearSigningPreview")}>
      <div className="sheet-header">
        <div>
          <span className="muted">{t("popup:clearSigning.expiresIn")}</span>
          <h3>10:00</h3>
        </div>
        <StatusBadge ready={canSign} label={canSign ? t("popup:clearSigning.parsed") : t("popup:clearSigning.risk")} />
      </div>
      <div className="preview-hero">
        <span className="preview-direction" aria-hidden="true">
          <ArrowRight size={18} />
        </span>
        <span>{preview.title}</span>
        <strong>
          {preview.amount} {preview.asset}
        </strong>
        <small>{preview.networkName.replace(/\s+(Mainnet|network)$/i, "")}</small>
      </div>
      <PreviewRow label={t("popup:clearSigning.recipient")} value={preview.recipientLabel} detail={formatAddress(preview.to)} />
      <PreviewRow label={t("popup:clearSigning.from")} value={formatAddress(preview.from)} />
      <PreviewRow label={t("popup:clearSigning.feeLabel")} value={preview.estimatedNetworkFee} />
      <div className="safety-scope">
        <ShieldCheck size={16} />
        <div>
          <strong>{t("popup:clearSigning.safetyScope")}</strong>
          <span>
            {t("popup:clearSigning.safetyScopeText", { asset: preview.asset })}
          </span>
        </div>
      </div>
      <details className="advanced-data">
        <summary>{t("popup:clearSigning.advancedData")}</summary>
        <p>{t("popup:clearSigning.advancedDataSubtitle")}</p>
        <PreviewRow label={t("popup:clearSigning.calldata")} value={preview.data} detail={t("popup:clearSigning.calldataDetail")} />
        <PreviewRow label={t("popup:clearSigning.gas")} value={preview.gasLimit ? preview.gasLimit.toString() : feeStatus === "estimating" ? t("popup:clearSigning.estimating") : t("popup:clearSigning.pending")} />
      </details>
      <div className="warning-list">
        <div className="warning-item info clear-signing-review-note">
          <AlertTriangle size={14} />
          <span>{t("popup:clearSigning.reviewNote")}</span>
        </div>
        {feeError ? (
          <div className="warning-item danger">
            <AlertTriangle size={14} />
            <span>{feeError}</span>
          </div>
        ) : null}
      </div>
      <button type="button" className="primary-button" disabled={!canSign || signingStatus === "signing" || signingStatus === "broadcasting"} onClick={onSign}>
        {signingStatus === "signing" || signingStatus === "broadcasting" ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />}
        {signingStatus === "signing" ? t("popup:clearSigning.signing") : signingStatus === "broadcasting" ? t("popup:clearSigning.broadcasting") : t("popup:clearSigning.signAndContinue")}
      </button>
      <button type="button" className="clear-signing-cancel" onClick={onCancel} disabled={signingStatus === "signing" || signingStatus === "broadcasting"}>
        {t("common:actions.cancel")}
      </button>
    </section>
  );
}

function PreviewRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="preview-row">
      <span>{label}</span>
      <div>
        <strong>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </div>
  );
}
