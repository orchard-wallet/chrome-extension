export interface WalletRecord {
  address: string;
  credentialId: string;
  derivationPath: string;
  keystoreJson: string;
  rpId: string;
  userId: string;
}

const WALLET_KEY = "walletRecord";

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
