export type NetworkFamily = "ethereum" | "arbitrum" | "hyperliquid" | "tron" | "bitcoin" | "polygon" | "custom";

export interface WalletNetworkSetting {
  networkId: string;
  family: NetworkFamily;
  name: string;
  chain: string;
  chainId?: number;
  enabled: boolean;
  selectedRpcUrl: string;
  rpcUrls: string[];
  nativeCurrencySymbol: string;
  explorerUrl?: string;
  isCustom?: boolean;
}

export interface CustomNetworkInput {
  name: string;
  family: NetworkFamily;
  chain: string;
  chainId?: number;
  rpcUrl: string;
  nativeCurrencySymbol: string;
}

const BUILT_IN_NETWORKS: WalletNetworkSetting[] = [
  {
    networkId: "ethereum-mainnet",
    family: "ethereum",
    name: "Ethereum Mainnet",
    chain: "ETH",
    chainId: 1,
    enabled: true,
    selectedRpcUrl: "https://eth.llamarpc.com",
    rpcUrls: ["https://eth.llamarpc.com", "https://ethereum-rpc.publicnode.com", "https://cloudflare-eth.com"],
    nativeCurrencySymbol: "ETH",
    explorerUrl: "https://etherscan.io"
  },
  {
    networkId: "ethereum-sepolia",
    family: "ethereum",
    name: "Ethereum Sepolia",
    chain: "ETH",
    chainId: 11155111,
    enabled: false,
    selectedRpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com", "https://rpc.sepolia.org", "https://1rpc.io/sepolia"],
    nativeCurrencySymbol: "ETH",
    explorerUrl: "https://sepolia.etherscan.io"
  },
  {
    networkId: "ethereum-holesky",
    family: "ethereum",
    name: "Ethereum Holesky",
    chain: "ETH",
    chainId: 17000,
    enabled: false,
    selectedRpcUrl: "https://ethereum-holesky-rpc.publicnode.com",
    rpcUrls: ["https://ethereum-holesky-rpc.publicnode.com", "https://holesky.drpc.org"],
    nativeCurrencySymbol: "ETH",
    explorerUrl: "https://holesky.etherscan.io"
  },
  {
    networkId: "ethereum-hoodi",
    family: "ethereum",
    name: "Ethereum Hoodi",
    chain: "ETH",
    chainId: 560048,
    enabled: false,
    selectedRpcUrl: "https://rpc.hoodi.ethpandaops.io",
    rpcUrls: ["https://rpc.hoodi.ethpandaops.io"],
    nativeCurrencySymbol: "ETH",
    explorerUrl: "https://hoodi.etherscan.io"
  },
  {
    networkId: "arbitrum-one",
    family: "arbitrum",
    name: "Arbitrum One",
    chain: "ETH",
    chainId: 42161,
    enabled: true,
    selectedRpcUrl: "https://arb1.arbitrum.io/rpc",
    rpcUrls: ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com", "https://1rpc.io/arb"],
    nativeCurrencySymbol: "ETH",
    explorerUrl: "https://arbiscan.io"
  },
  {
    networkId: "arbitrum-nova",
    family: "arbitrum",
    name: "Arbitrum Nova",
    chain: "ETH",
    chainId: 42170,
    enabled: false,
    selectedRpcUrl: "https://nova.arbitrum.io/rpc",
    rpcUrls: ["https://nova.arbitrum.io/rpc", "https://arbitrum-nova.publicnode.com"],
    nativeCurrencySymbol: "ETH",
    explorerUrl: "https://nova.arbiscan.io"
  },
  {
    networkId: "arbitrum-sepolia",
    family: "arbitrum",
    name: "Arbitrum Sepolia",
    chain: "ETH",
    chainId: 421614,
    enabled: false,
    selectedRpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    rpcUrls: ["https://sepolia-rollup.arbitrum.io/rpc", "https://arbitrum-sepolia-rpc.publicnode.com"],
    nativeCurrencySymbol: "ETH",
    explorerUrl: "https://sepolia.arbiscan.io"
  },
  {
    networkId: "hyperliquid-mainnet",
    family: "hyperliquid",
    name: "HyperEVM",
    chain: "HYPE",
    chainId: 999,
    enabled: true,
    selectedRpcUrl: "https://rpc.hyperliquid.xyz/evm",
    rpcUrls: ["https://rpc.hyperliquid.xyz/evm", "https://rpc.hypurrscan.io", "https://hyperliquid.drpc.org"],
    nativeCurrencySymbol: "HYPE",
    explorerUrl: "https://hyperevmscan.io"
  },
  {
    networkId: "hyperliquid-testnet",
    family: "hyperliquid",
    name: "Hyperliquid EVM Testnet",
    chain: "HYPE",
    chainId: 998,
    enabled: false,
    selectedRpcUrl: "https://rpc.hyperliquid-testnet.xyz/evm",
    rpcUrls: ["https://rpc.hyperliquid-testnet.xyz/evm"],
    nativeCurrencySymbol: "HYPE",
    explorerUrl: "https://testnet.purrsec.com"
  },
  {
    networkId: "tron-mainnet",
    family: "tron",
    name: "Tron Mainnet",
    chain: "TRON",
    chainId: 728126428,
    enabled: true,
    selectedRpcUrl: "https://api.trongrid.io/jsonrpc",
    rpcUrls: ["https://api.trongrid.io/jsonrpc", "https://tron.drpc.org", "https://rpc.ankr.com/tron_jsonrpc"],
    nativeCurrencySymbol: "TRX",
    explorerUrl: "https://tronscan.org"
  },
  {
    networkId: "tron-shasta",
    family: "tron",
    name: "Tron Shasta",
    chain: "TRON",
    chainId: 2494104990,
    enabled: false,
    selectedRpcUrl: "https://api.shasta.trongrid.io/jsonrpc",
    rpcUrls: ["https://api.shasta.trongrid.io/jsonrpc"],
    nativeCurrencySymbol: "TRX",
    explorerUrl: "https://shasta.tronscan.org"
  },
  {
    networkId: "tron-nile",
    family: "tron",
    name: "Tron Nile",
    chain: "TRON",
    chainId: 3448148188,
    enabled: false,
    selectedRpcUrl: "https://nile.trongrid.io/jsonrpc",
    rpcUrls: ["https://nile.trongrid.io/jsonrpc"],
    nativeCurrencySymbol: "TRX",
    explorerUrl: "https://nile.tronscan.org"
  },
  {
    networkId: "bitcoin-mainnet",
    family: "bitcoin",
    name: "Bitcoin Mainnet",
    chain: "BTC",
    enabled: true,
    selectedRpcUrl: "https://blockstream.info/api",
    rpcUrls: ["https://blockstream.info/api", "https://mempool.space/api"],
    nativeCurrencySymbol: "BTC",
    explorerUrl: "https://mempool.space"
  },
  {
    networkId: "bitcoin-testnet",
    family: "bitcoin",
    name: "Bitcoin Testnet",
    chain: "BTC",
    enabled: false,
    selectedRpcUrl: "https://blockstream.info/testnet/api",
    rpcUrls: ["https://blockstream.info/testnet/api", "https://mempool.space/testnet/api"],
    nativeCurrencySymbol: "tBTC",
    explorerUrl: "https://mempool.space/testnet"
  },
  {
    networkId: "bitcoin-signet",
    family: "bitcoin",
    name: "Bitcoin Signet",
    chain: "BTC",
    enabled: false,
    selectedRpcUrl: "https://mempool.space/signet/api",
    rpcUrls: ["https://mempool.space/signet/api"],
    nativeCurrencySymbol: "sBTC",
    explorerUrl: "https://mempool.space/signet"
  },
  {
    networkId: "polygon-mainnet",
    family: "polygon",
    name: "Polygon PoS",
    chain: "POL",
    chainId: 137,
    enabled: true,
    selectedRpcUrl: "https://polygon-rpc.com",
    rpcUrls: ["https://polygon-rpc.com", "https://polygon-bor-rpc.publicnode.com", "https://1rpc.io/matic"],
    nativeCurrencySymbol: "POL",
    explorerUrl: "https://polygonscan.com"
  },
  {
    networkId: "polygon-amoy",
    family: "polygon",
    name: "Polygon Amoy",
    chain: "POL",
    chainId: 80002,
    enabled: false,
    selectedRpcUrl: "https://rpc-amoy.polygon.technology",
    rpcUrls: ["https://rpc-amoy.polygon.technology", "https://polygon-amoy-bor-rpc.publicnode.com"],
    nativeCurrencySymbol: "POL",
    explorerUrl: "https://amoy.polygonscan.com"
  }
];

function normalizeRpcUrl(url: string): string | null {
  const trimmed = url.trim();

  if (!trimmed) {
    return null;
  }

  if (!trimmed.startsWith("https://") && !trimmed.startsWith("http://") && !trimmed.startsWith("wss://")) {
    return null;
  }

  return trimmed;
}

function mergeRpcUrls(saved: WalletNetworkSetting | undefined, builtIn: WalletNetworkSetting): string[] {
  return Array.from(new Set([...(saved?.rpcUrls ?? []), ...builtIn.rpcUrls].map(normalizeRpcUrl).filter((url): url is string => Boolean(url))));
}

export function getBuiltInNetworkSettings(savedSettings: WalletNetworkSetting[] = []): WalletNetworkSetting[] {
  const savedByNetworkId = new Map(savedSettings.map((setting) => [setting.networkId, setting]));
  const savedByChainId = new Map(
    savedSettings
      .filter((setting) => setting.chainId !== undefined)
      .map((setting) => [setting.chainId, setting])
  );
  const builtInIds = new Set(BUILT_IN_NETWORKS.map((network) => network.networkId));
  const mergedBuiltIns = BUILT_IN_NETWORKS.map((builtIn) => {
    const saved = savedByNetworkId.get(builtIn.networkId) ?? (builtIn.chainId ? savedByChainId.get(builtIn.chainId) : undefined);
    const rpcUrls = mergeRpcUrls(saved, builtIn);
    const selectedRpcUrl =
      saved?.selectedRpcUrl && rpcUrls.includes(saved.selectedRpcUrl) ? saved.selectedRpcUrl : builtIn.selectedRpcUrl;

    return {
      ...builtIn,
      enabled: saved?.enabled ?? builtIn.enabled,
      selectedRpcUrl,
      explorerUrl: saved?.explorerUrl ?? builtIn.explorerUrl,
      rpcUrls
    };
  });

  const customNetworks = savedSettings.filter((setting) => setting.networkId && (setting.isCustom || !builtInIds.has(setting.networkId)));

  return [...mergedBuiltIns, ...customNetworks];
}

export function createCustomNetwork(input: CustomNetworkInput): WalletNetworkSetting {
  const rpcUrl = normalizeRpcUrl(input.rpcUrl);

  if (!input.name.trim()) {
    throw new Error("Network name is required.");
  }

  if (!rpcUrl) {
    throw new Error("RPC URL must start with http://, https://, or wss://.");
  }

  return {
    networkId: `custom-${crypto.randomUUID()}`,
    family: input.family,
    name: input.name.trim(),
    chain: input.chain.trim() || input.family.toUpperCase(),
    chainId: input.chainId,
    enabled: true,
    selectedRpcUrl: rpcUrl,
    rpcUrls: [rpcUrl],
    nativeCurrencySymbol: input.nativeCurrencySymbol.trim() || input.chain.trim() || "COIN",
    explorerUrl: undefined,
    isCustom: true
  };
}
