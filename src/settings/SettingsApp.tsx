import { Check, Plus, Save, Search, Server, Settings2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createCustomNetwork,
  getBuiltInNetworkSettings,
  type NetworkFamily,
  type WalletNetworkSetting
} from "../core/networks";
import {
  readNetworkSettings,
  readWalletConnectSettings,
  writeNetworkSettings,
  writeWalletConnectSettings
} from "../lib/storage";

type SaveStatus = "idle" | "saving" | "saved" | "error";

const FAMILIES: NetworkFamily[] = ["ethereum", "arbitrum", "hyperliquid", "tron", "bitcoin", "polygon", "custom"];

function matchesQuery(network: WalletNetworkSetting, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  return [
    network.name,
    network.family,
    network.chain,
    network.chainId?.toString() ?? "",
    network.nativeCurrencySymbol
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

export function SettingsApp() {
  const [networks, setNetworks] = useState<WalletNetworkSetting[]>([]);
  const [query, setQuery] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [newNetworkName, setNewNetworkName] = useState("");
  const [newNetworkFamily, setNewNetworkFamily] = useState<NetworkFamily>("custom");
  const [newNetworkChain, setNewNetworkChain] = useState("");
  const [newNetworkChainId, setNewNetworkChainId] = useState("");
  const [newNetworkSymbol, setNewNetworkSymbol] = useState("");
  const [newNetworkRpcUrl, setNewNetworkRpcUrl] = useState("");
  const [walletConnectProjectId, setWalletConnectProjectId] = useState("");

  useEffect(() => {
    Promise.all([readNetworkSettings(), readWalletConnectSettings()])
      .then(([savedSettings, walletConnectSettings]) => {
        setNetworks(getBuiltInNetworkSettings(savedSettings));
        setWalletConnectProjectId(walletConnectSettings.projectId);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Unable to load network settings.");
        setNetworks(getBuiltInNetworkSettings());
      });
  }, []);

  const enabledNetworks = useMemo(() => networks.filter((network) => network.enabled), [networks]);
  const visibleNetworks = useMemo(() => networks.filter((network) => matchesQuery(network, query)), [networks, query]);

  function updateNetwork(networkId: string, updater: (network: WalletNetworkSetting) => WalletNetworkSetting) {
    setNetworks((currentNetworks) =>
      currentNetworks.map((network) => (network.networkId === networkId ? updater(network) : network))
    );
    setSaveStatus("idle");
  }

  function removeNetwork(networkId: string) {
    setNetworks((currentNetworks) => currentNetworks.filter((network) => network.networkId !== networkId));
    setSaveStatus("idle");
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
      await writeWalletConnectSettings({ projectId: walletConnectProjectId.trim() });
      setSaveStatus("saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save network settings.");
      setSaveStatus("error");
    }
  }

  return (
    <main className="settings-shell">
      <header className="settings-header">
        <div className="brand-mark" aria-hidden="true">
          <Settings2 size={18} />
        </div>
        <div>
          <p className="eyebrow">Passkey Wallet</p>
          <h1>Network Settings</h1>
        </div>
      </header>

      <section className="settings-summary">
        <div>
          <span>Enabled networks</span>
          <strong>{enabledNetworks.length}</strong>
        </div>
        <div>
          <span>Built-in and custom</span>
          <strong>{networks.length}</strong>
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

      <section className="manual-network-panel">
        <div className="resolver-heading">
          <div>
            <span className="muted">WalletConnect v2</span>
            <h3>Relay Project</h3>
          </div>
          <Settings2 size={16} />
        </div>

        <div className="manual-network-grid">
          <label className="manual-rpc-url">
            <span>Project ID</span>
            <input
              value={walletConnectProjectId}
              onChange={(event) => {
                setWalletConnectProjectId(event.target.value);
                setSaveStatus("idle");
              }}
              placeholder="WalletConnect Cloud Project ID"
            />
          </label>
        </div>
      </section>

      <section className="manual-network-panel">
        <div className="resolver-heading">
          <div>
            <span className="muted">Manual RPC</span>
            <h3>Add Network</h3>
          </div>
          <Plus size={16} />
        </div>

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
            <input
              value={newNetworkChainId}
              onChange={(event) => setNewNetworkChainId(event.target.value)}
              inputMode="numeric"
              placeholder="Optional"
            />
          </label>
          <label>
            <span>Symbol</span>
            <input value={newNetworkSymbol} onChange={(event) => setNewNetworkSymbol(event.target.value)} placeholder="ETH" />
          </label>
          <label className="manual-rpc-url">
            <span>RPC URL</span>
            <input
              value={newNetworkRpcUrl}
              onChange={(event) => setNewNetworkRpcUrl(event.target.value)}
              placeholder="https://..."
            />
          </label>
        </div>

        <button type="button" className="secondary-button settings-button" onClick={handleAddNetwork}>
          <Plus size={17} />
          Add custom RPC
        </button>
      </section>

      {error ? <p className="error-box">{error}</p> : null}

      <section className="network-list" aria-label="Network RPC settings">
        {visibleNetworks.map((network) => (
          <article className={`network-row ${network.enabled ? "enabled" : ""}`} key={network.networkId}>
            <div className="network-title">
              <Server size={18} />
              <div>
                <h2>{network.name}</h2>
                <p>
                  {network.family} · {network.chainId ? `Chain ID ${network.chainId}` : network.chain} ·{" "}
                  {network.nativeCurrencySymbol}
                </p>
              </div>
            </div>

            <div className="network-actions">
              <label className="network-toggle">
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
                <span>{network.enabled ? "Enabled" : "Disabled"}</span>
              </label>

              {network.isCustom ? (
                <button type="button" className="icon-danger-button" onClick={() => removeNetwork(network.networkId)} title="Remove custom network">
                  <Trash2 size={16} />
                </button>
              ) : null}
            </div>

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
          </article>
        ))}

        {visibleNetworks.length === 0 ? (
          <div className="settings-empty">
            <Search size={20} />
            <span>No networks match this search.</span>
          </div>
        ) : null}
      </section>

      <footer className="settings-footer">
        <span>{visibleNetworks.length < networks.length ? `Showing ${visibleNetworks.length} of ${networks.length}` : `${networks.length} networks`}</span>
        <button type="button" className="primary-button settings-save" onClick={handleSave} disabled={saveStatus === "saving"}>
          {saveStatus === "saved" ? <Check size={17} /> : <Save size={17} />}
          {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Save settings"}
        </button>
      </footer>
    </main>
  );
}
