import {
  Activity,
  Check,
  ChevronDown,
  Download,
  Globe2,
  HelpCircle,
  Home,
  Link2,
  Loader2,
  PieChart,
  Plus,
  RefreshCcw,
  Repeat2,
  Save,
  Search,
  Send,
  Settings2,
  SlidersHorizontal,
  Shield,
  Trash2,
  Unplug,
  Wallet
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createCustomNetwork,
  getBuiltInNetworkSettings,
  type NetworkFamily,
  type WalletNetworkSetting
} from "../core/networks";
import { readPortfolioStore } from "../core/portfolio";
import type { AssetStore, ChainAssetSnapshot } from "../core/assets";
import {
  readNetworkSettings,
  readWalletRecord,
  writeNetworkSettings
} from "../lib/storage";

type SaveStatus = "idle" | "saving" | "saved" | "error";
type SettingsView = "networks" | "connected-dapps" | "portfolio";
type WalletConnectSessionsStatus = "idle" | "loading" | "ready" | "error";

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

function formatUsd(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "Not refreshed";
  }

  const numericValue = typeof value === "string" ? Number(value) : value;

  if (!Number.isFinite(numericValue)) {
    return "Not refreshed";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(numericValue);
}

function formatUpdatedAt(value: string | null | undefined): string {
  if (!value) {
    return "Refresh portfolio to update";
  }

  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return "Refresh portfolio to update";
  }

  return `Updated ${timestamp.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
}

function settingsViewFromHash(): SettingsView {
  if (typeof window === "undefined") {
    return "networks";
  }

  return window.location.hash === "#portfolio" ? "portfolio" : window.location.hash === "#connected-dapps" ? "connected-dapps" : "networks";
}

function formatRelativeTime(value: string | number | null | undefined): string {
  if (!value) {
    return "No activity";
  }

  const timestamp = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  const deltaMs = Date.now() - timestamp.getTime();

  if (Number.isNaN(deltaMs)) {
    return "No activity";
  }

  const absoluteDelta = Math.abs(deltaMs);
  const minutes = Math.round(absoluteDelta / 60000);
  const hours = Math.round(absoluteDelta / 3600000);
  const days = Math.round(absoluteDelta / 86400000);

  if (minutes < 1) {
    return "Just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${days}d ago`;
}

function methodLabel(method: string): string {
  switch (method) {
    case "eth_accounts":
    case "eth_requestAccounts":
      return "View balance";
    case "personal_sign":
    case "eth_signTypedData":
    case "eth_signTypedData_v4":
      return "Request signatures";
    case "eth_sendTransaction":
      return "Request approval";
    default:
      return method.replace(/^eth_/, "").replaceAll("_", " ");
  }
}

function sessionPermissions(session: WalletConnectSessionSummary): string {
  const labels = Array.from(new Set(session.methods.map(methodLabel)));
  return labels.length ? labels.slice(0, 3).join(", ") : "View balance";
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
  const [portfolioStore, setPortfolioStore] = useState<AssetStore | null>(null);
  const [portfolioTotal, setPortfolioTotal] = useState("Not refreshed");
  const [portfolioUpdatedAt, setPortfolioUpdatedAt] = useState("Refresh portfolio to update");
  const [newNetworkName, setNewNetworkName] = useState("");
  const [newNetworkFamily, setNewNetworkFamily] = useState<NetworkFamily>("custom");
  const [newNetworkChain, setNewNetworkChain] = useState("");
  const [newNetworkChainId, setNewNetworkChainId] = useState("");
  const [newNetworkSymbol, setNewNetworkSymbol] = useState("");
  const [newNetworkRpcUrl, setNewNetworkRpcUrl] = useState("");
  useEffect(() => {
    Promise.all([readNetworkSettings(), readWalletRecord(), readPortfolioStore()])
      .then(([savedSettings, walletRecord, portfolioStore]) => {
        setNetworks(getBuiltInNetworkSettings(savedSettings));
        setWalletAddress(walletRecord?.address ?? null);
        setPortfolioStore(portfolioStore);
        setPortfolioTotal(formatUsd(portfolioStore.portfolioSnapshot?.totalValueUsd));
        setPortfolioUpdatedAt(formatUpdatedAt(portfolioStore.portfolioSnapshot?.lastUpdatedAt ?? portfolioStore.portfolioSnapshot?.refreshedAt));
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Unable to load network settings.");
        setNetworks(getBuiltInNetworkSettings());
      });
  }, []);

  useEffect(() => {
    if (view === "connected-dapps") {
      void loadWalletConnectSessions();
    }
  }, [view]);

  const enabledNetworks = useMemo(() => networks.filter((network) => network.enabled), [networks]);
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
        throw new Error("Chain ID must be a positive integer.");
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
      setError(cause instanceof Error ? cause.message : "Unable to add network.");
    }
  }

  async function handleSave() {
    setSaveStatus("saving");
    setError(null);

    try {
      await writeNetworkSettings(networks);
      setSaveStatus("saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save network settings.");
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
      setWalletConnectSessionsError(cause instanceof Error ? cause.message : "Unable to load WalletConnect sessions.");
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
      setWalletConnectSessionsError(cause instanceof Error ? cause.message : "Unable to disconnect WalletConnect session.");
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
      setWalletConnectSessionsError(cause instanceof Error ? cause.message : "Unable to disconnect WalletConnect sessions.");
    } finally {
      setDisconnectingTopic(null);
    }
  }

  return (
    <main className="settings-layout">
      <aside className="settings-sidebar" aria-label="Wallet settings navigation">
        <nav className="settings-side-nav">
          <SidebarItem icon={<Home size={18} />} label="Home" />
          <SidebarItem icon={<PieChart size={18} />} label="Portfolio" active={view === "portfolio"} onClick={() => selectView("portfolio")} />
          <SidebarItem icon={<Activity size={18} />} label="Activity" />
          <SidebarItem icon={<Send size={18} />} label="Send" />
          <SidebarItem icon={<Download size={18} />} label="Receive" />
          <SidebarItem icon={<Repeat2 size={18} />} label="Swap" />
          <SidebarItem icon={<Globe2 size={18} />} label="Networks" active={view === "networks"} onClick={() => selectView("networks")} />
          <SidebarItem
            icon={<Link2 size={18} />}
            label="Connected dApp"
            active={view === "connected-dapps"}
            badge={walletConnectSessions.length ? String(walletConnectSessions.length) : undefined}
            onClick={() => selectView("connected-dapps")}
          />
          <SidebarItem icon={<Shield size={18} />} label="Security" />
          <SidebarItem icon={<Settings2 size={18} />} label="Settings" />
        </nav>

        <div className="settings-sidebar-spacer" />

        <section className="sidebar-balance-card" aria-label="Total balance">
          <span>Total Balance</span>
          <strong>{portfolioTotal}</strong>
          <small>{portfolioUpdatedAt}</small>
          <svg viewBox="0 0 120 42" aria-hidden="true">
            <polyline points="2,34 18,34 30,28 43,31 54,18 67,15 80,24 93,20 110,9 118,12" />
          </svg>
        </section>

        <section className="sidebar-wallet-card" aria-label="Active wallet">
          <span className="sidebar-wallet-avatar" />
          <div>
            <strong>Wallet 1</strong>
            <small title={walletAddress ?? undefined}>{walletAddress ?? "No wallet created"}</small>
          </div>
        </section>
      </aside>

      {view === "networks" ? (
      <section className="settings-main-panel">
        <header className="settings-page-header">
          <div>
            <h1>Network Management</h1>
            <p>Enable and manage the blockchains you use.</p>
          </div>
          <button type="button" className="settings-help-button" aria-label="Network settings help">
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
              <b>Networks</b>
              <span>Available</span>
            </p>
          </div>
          <div>
            <span className="settings-hero-icon">
              <Check size={26} />
            </span>
            <strong>{enabledNetworks.length}</strong>
            <p>
              <b>Enabled</b>
              <span>Networks</span>
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
              placeholder="Search network, family, or chain ID"
            />
          </label>
        </section>

        {error ? <p className="error-box">{error}</p> : null}

        <section className="network-list settings-network-table" aria-label="Network RPC settings">
          {visibleNetworks.map((network) => (
            <details className={`network-row ${network.enabled ? "enabled" : ""}`} key={network.networkId}>
              <summary className="network-row-summary">
                <div className="network-title">
                  <ChainBadge network={network} />
                  <div>
                    <h2>
                      {network.name}
                      {network.networkId === "ethereum-mainnet" ? <span className="default-badge">Default</span> : null}
                    </h2>
                    <p>{network.chainId ? `Chain ID ${network.chainId}` : network.family}</p>
                  </div>
                </div>

                <strong className="network-token-symbol">{network.nativeCurrencySymbol}</strong>

                <div className="network-actions">
                  <span className={`network-state ${network.enabled ? "enabled" : ""}`}>{network.enabled ? "Enabled" : "Disabled"}</span>
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
                      title="Remove custom network"
                    >
                      <Trash2 size={16} />
                    </button>
                  ) : null}

                  <ChevronDown size={16} className="network-row-chevron" />
                </div>
              </summary>

              <label className="rpc-select">
                <span>RPC endpoint</span>
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
              <span>No networks match this search.</span>
            </div>
          ) : null}
        </section>

        <details className="manual-network-panel settings-add-network">
          <summary>
            <span className="add-network-icon">
              <Plus size={20} />
            </span>
            <div>
              <strong>Add Custom Network</strong>
              <small>Manually add a network using RPC details.</small>
            </div>
          </summary>

          <div className="manual-network-grid">
            <label>
              <span>Name</span>
              <input value={newNetworkName} onChange={(event) => setNewNetworkName(event.target.value)} placeholder="My RPC" />
            </label>
            <label>
              <span>Family</span>
              <select value={newNetworkFamily} onChange={(event) => setNewNetworkFamily(event.target.value as NetworkFamily)}>
                {FAMILIES.map((family) => (
                  <option value={family} key={family}>
                    {family}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Chain</span>
              <input value={newNetworkChain} onChange={(event) => setNewNetworkChain(event.target.value)} placeholder="ETH" />
            </label>
            <label>
              <span>Chain ID</span>
              <input value={newNetworkChainId} onChange={(event) => setNewNetworkChainId(event.target.value)} inputMode="numeric" placeholder="Optional" />
            </label>
            <label>
              <span>Symbol</span>
              <input value={newNetworkSymbol} onChange={(event) => setNewNetworkSymbol(event.target.value)} placeholder="ETH" />
            </label>
            <label className="manual-rpc-url">
              <span>RPC URL</span>
              <input value={newNetworkRpcUrl} onChange={(event) => setNewNetworkRpcUrl(event.target.value)} placeholder="https://..." />
            </label>
          </div>

          <button type="button" className="secondary-button settings-button" onClick={handleAddNetwork}>
            <Plus size={17} />
            Add custom RPC
          </button>
        </details>

        <footer className="settings-footer">
          <span>{visibleNetworks.length < networks.length ? `Showing ${visibleNetworks.length} of ${networks.length}` : `${networks.length} networks`}</span>
          <button type="button" className="primary-button settings-save" onClick={handleSave} disabled={saveStatus === "saving"}>
            {saveStatus === "saved" ? <Check size={17} /> : <Save size={17} />}
            {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Save settings"}
          </button>
        </footer>
      </section>
      ) : view === "connected-dapps" ? (
      <section className="settings-main-panel connected-dapp-panel">
        <header className="settings-page-header connected-dapp-header">
          <div>
            <h1>Connected Sessions</h1>
            <p>Manage WalletConnect connections and review app permissions across your accounts.</p>
          </div>
          <button type="button" className="settings-help-button" aria-label="Connected dapp help">
            <HelpCircle size={18} />
          </button>
        </header>

        <section className="connected-session-hero">
          <div>
            <span>Overview</span>
            <strong>
              {walletConnectSessions.length} Active Session{walletConnectSessions.length === 1 ? "" : "s"}
              <i />
            </strong>
            <small>{walletConnectSessions.length > 0 ? "All connections are available for review." : "No dapps are connected right now."}</small>
          </div>
          <div className="recent-session-list">
            <span>Recent Activity</span>
            {recentSessions.length > 0 ? (
              recentSessions.map((session) => (
                <div className="recent-session-item" key={session.topic}>
                  <DappIcon session={session} />
                  <strong>{session.name}</strong>
                  <small>{formatRelativeTime(session.lastActiveAt)}</small>
                </div>
              ))
            ) : (
              <p>No recent WalletConnect activity.</p>
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
              placeholder="Search sessions or apps"
            />
          </label>
          <button type="button" className="session-filter-button">
            <SlidersHorizontal size={16} />
            Filter
          </button>
          <button type="button" className="session-filter-button session-sort-button" onClick={loadWalletConnectSessions}>
            <RefreshCcw className={walletConnectSessionsStatus === "loading" ? "spin" : undefined} size={16} />
            Last Active
          </button>
        </section>

        <section className="connected-session-table" aria-label="Connected WalletConnect sessions">
          {visibleSessions.map((session) => (
            <article className="connected-session-row" key={session.topic}>
              <div className="connected-session-app">
                <DappIcon session={session} />
                <div>
                  <strong>{session.name}</strong>
                  <span>{originLabel(session)}</span>
                  <small><i /> Connected</small>
                </div>
              </div>
              <div>
                <span>Last Active</span>
                <strong>{formatRelativeTime(session.lastActiveAt)}</strong>
              </div>
              <div>
                <span>Connected Account</span>
                <strong>Account 1</strong>
                <small>{session.accounts[0]?.split(":").pop() ? formatAddress(session.accounts[0].split(":").pop() ?? "") : (walletAddress ? formatAddress(walletAddress) : "No account")}</small>
              </div>
              <div>
                <span>Allowed Chains</span>
                <ChainPills chains={session.chains} />
              </div>
              <div>
                <span>Permissions</span>
                <strong>{sessionPermissions(session)}</strong>
              </div>
              <button
                type="button"
                className="wc-disconnect session-row-action"
                disabled={disconnectingTopic === session.topic}
                onClick={() => handleDisconnectWalletConnectSession(session.topic)}
                title="Disconnect dapp"
              >
                {disconnectingTopic === session.topic ? <Loader2 className="spin" size={16} /> : <Unplug size={16} />}
              </button>
            </article>
          ))}

          {visibleSessions.length === 0 ? (
            <div className="settings-empty connected-session-empty">
              <Link2 size={20} />
              <span>{walletConnectSessionsStatus === "loading" ? "Loading connected dapps." : "No connected dapps match this view."}</span>
            </div>
          ) : null}
        </section>

        {walletConnectSessionsError ? <p className="error-box">{walletConnectSessionsError}</p> : null}

        <footer className="settings-footer">
          <span>{visibleSessions.length < walletConnectSessions.length ? `Showing ${visibleSessions.length} of ${walletConnectSessions.length}` : `${walletConnectSessions.length} connected dapps`}</span>
          <div className="settings-footer-actions">
            <button
              type="button"
              className="disconnect-all-button"
              disabled={walletConnectSessions.length === 0 || disconnectingTopic === "__all__"}
              onClick={handleDisconnectAllWalletConnectSessions}
            >
              {disconnectingTopic === "__all__" ? <Loader2 className="spin" size={16} /> : <Unplug size={16} />}
              Disconnect All
            </button>
            <button type="button" className="primary-button settings-save" onClick={handleSave} disabled={saveStatus === "saving"}>
            {saveStatus === "saved" ? <Check size={17} /> : <Save size={17} />}
              {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Save settings"}
            </button>
          </div>
        </footer>
      </section>
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
  return (
    <section className="settings-main-panel settings-portfolio-panel">
      <header className="settings-page-header">
        <div>
          <h1>Portfolio</h1>
          <p>Browse assets across every enabled network.</p>
        </div>
        <button type="button" className="settings-help-button" aria-label="Portfolio help">
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
            <b>Total Portfolio</b>
            <span>{updatedAt}</span>
          </p>
        </div>
        <div>
          <span className="settings-hero-icon">
            <Wallet size={26} />
          </span>
          <strong>{snapshots.length}</strong>
          <p>
            <b>Networks</b>
            <span>{walletAddress ? formatAddress(walletAddress) : "No wallet created"}</span>
          </p>
        </div>
      </section>

      <section className="portfolio-settings-list" aria-label="Portfolio networks">
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
            <span>No portfolio snapshot yet. Refresh assets from the wallet Portal.</span>
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
  const visibleChains = chains.slice(0, 2);
  const extraCount = Math.max(0, chains.length - visibleChains.length);

  if (chains.length === 0) {
    return <small>No chains</small>;
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
