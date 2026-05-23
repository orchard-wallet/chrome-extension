import type { WalletNetworkSetting } from "../core/networks.js";

export function txExplorerUrl(hash: string, network: WalletNetworkSetting | null | undefined): string | null {
  if (!hash) {
    return null;
  }

  if (network?.explorerUrl) {
    const base = network.explorerUrl.replace(/\/$/, "");
    if (!/^https?:\/\//i.test(base)) {
      return null;
    }
    return `${base}/tx/${hash}`;
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
