const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim() ?? "";

export function hasWalletConnectProjectId(): boolean {
  return Boolean(walletConnectProjectId);
}

export function requireWalletConnectProjectId(): string {
  if (!walletConnectProjectId) {
    throw new Error("WalletConnect is not configured. Set VITE_WALLETCONNECT_PROJECT_ID before building the extension.");
  }

  return walletConnectProjectId;
}
