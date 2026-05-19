import type { WalletNetworkSetting } from "../core/networks";

export interface WalletRecord {
  address: string;
  credentialId: string;
  derivationPath: string;
  keystoreJson: string;
  rpId: string;
  userId: string;
}

const WALLET_KEY = "walletRecord";
const NETWORK_SETTINGS_KEY = "networkSettings";

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
