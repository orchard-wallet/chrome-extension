chrome.runtime?.onInstalled?.addListener(async () => {
  const { walletRecord } = await chrome.storage?.local?.get(["walletRecord"]) ?? {};

  if (!walletRecord) {
    await chrome.storage?.local?.set({ walletRecord: null });
  }
});
