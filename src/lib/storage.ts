import type { WalletNetworkSetting } from "../core/networks";
import { emptyAssetStore, type AssetStore } from "../core/assets";

export interface WalletRecord {
  address: string;
  credentialId: string;
  derivationPath: string;
  keystoreJson: string;
  rpId: string;
  userId: string;
}

export interface WalletConnectSettings {
  projectId: string;
}

export const DEFAULT_WALLETCONNECT_PROJECT_ID = "505809dab1e280de6ee9dbec82c22c24";

const WALLET_KEY = "walletRecord";
const NETWORK_SETTINGS_KEY = "networkSettings";
const WALLETCONNECT_SETTINGS_KEY = "walletConnectSettings";
const ASSET_STORE_KEY = "assetStore";

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

function chromeLocalStorage() {
  if (!chrome.storage?.local) {
    throw new Error("Chrome local storage is unavailable.");
  }

  return chrome.storage.local;
}

export async function readWalletRecord(): Promise<WalletRecord | null> {
  if (hasChromeStorage()) {
    const result = await chromeLocalStorage().get(WALLET_KEY);
    return (result[WALLET_KEY] as WalletRecord | null) ?? null;
  }

  const raw = localStorage.getItem(WALLET_KEY);
  return raw ? (JSON.parse(raw) as WalletRecord) : null;
}

export async function writeWalletRecord(record: WalletRecord): Promise<void> {
  if (hasChromeStorage()) {
    await chromeLocalStorage().set({ [WALLET_KEY]: record });
    return;
  }

  localStorage.setItem(WALLET_KEY, JSON.stringify(record));
}

export async function clearWalletRecord(): Promise<void> {
  if (hasChromeStorage()) {
    await chromeLocalStorage().remove(WALLET_KEY);
    return;
  }

  localStorage.removeItem(WALLET_KEY);
}

export async function readNetworkSettings(): Promise<WalletNetworkSetting[]> {
  if (hasChromeStorage()) {
    const result = await chromeLocalStorage().get(NETWORK_SETTINGS_KEY);
    return (result[NETWORK_SETTINGS_KEY] as WalletNetworkSetting[] | undefined) ?? [];
  }

  const raw = localStorage.getItem(NETWORK_SETTINGS_KEY);
  return raw ? (JSON.parse(raw) as WalletNetworkSetting[]) : [];
}

export async function writeNetworkSettings(settings: WalletNetworkSetting[]): Promise<void> {
  if (hasChromeStorage()) {
    await chromeLocalStorage().set({ [NETWORK_SETTINGS_KEY]: settings });
    return;
  }

  localStorage.setItem(NETWORK_SETTINGS_KEY, JSON.stringify(settings));
}

export async function readWalletConnectSettings(): Promise<WalletConnectSettings> {
  if (hasChromeStorage()) {
    const result = await chromeLocalStorage().get(WALLETCONNECT_SETTINGS_KEY);
    return (result[WALLETCONNECT_SETTINGS_KEY] as WalletConnectSettings | undefined) ?? {
      projectId: DEFAULT_WALLETCONNECT_PROJECT_ID
    };
  }

  const raw = localStorage.getItem(WALLETCONNECT_SETTINGS_KEY);
  return raw ? (JSON.parse(raw) as WalletConnectSettings) : { projectId: DEFAULT_WALLETCONNECT_PROJECT_ID };
}

export async function writeWalletConnectSettings(settings: WalletConnectSettings): Promise<void> {
  if (hasChromeStorage()) {
    await chromeLocalStorage().set({ [WALLETCONNECT_SETTINGS_KEY]: settings });
    return;
  }

  localStorage.setItem(WALLETCONNECT_SETTINGS_KEY, JSON.stringify(settings));
}

export async function readAssetStore(): Promise<AssetStore> {
  if (hasChromeStorage()) {
    const result = await chromeLocalStorage().get(ASSET_STORE_KEY);
    return (result[ASSET_STORE_KEY] as AssetStore | undefined) ?? emptyAssetStore();
  }

  const raw = localStorage.getItem(ASSET_STORE_KEY);
  return raw ? (JSON.parse(raw) as AssetStore) : emptyAssetStore();
}

export async function writeAssetStore(store: AssetStore): Promise<void> {
  if (hasChromeStorage()) {
    await chromeLocalStorage().set({ [ASSET_STORE_KEY]: store });
    return;
  }

  localStorage.setItem(ASSET_STORE_KEY, JSON.stringify(store));
}
