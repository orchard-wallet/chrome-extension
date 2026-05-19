import { createPublicClient, defineChain, fallback, formatEther, formatUnits, http, type Address, type Hex } from "viem";
import { mainnet } from "viem/chains";
import { readNetworkSettings } from "../lib/storage";
import type { WalletNetworkSetting } from "./networks";

export interface TransactionFeeEstimate {
  nonce: bigint;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  estimatedFeeWei: bigint;
  estimatedFeeNative: string;
  estimatedFeeEth: string;
}

export interface EthBalance {
  wei: bigint;
  eth: string;
}

const defaultTransports = [
  http("https://ethereum.publicnode.com"),
  http("https://eth.llamarpc.com"),
  http("https://rpc.ankr.com/eth")
];

function createClientForNetwork(network: WalletNetworkSetting) {
  if (typeof network.chainId !== "number") {
    throw new Error(`${network.name} does not have an EVM chain ID.`);
  }

  const rpcUrls = Array.from(new Set([network.selectedRpcUrl, ...network.rpcUrls].filter((url) => /^https?:\/\//i.test(url))));
  const chain = defineChain({
    id: network.chainId,
    name: network.name,
    nativeCurrency: {
      decimals: 18,
      name: network.nativeCurrencySymbol,
      symbol: network.nativeCurrencySymbol
    },
    rpcUrls: {
      default: {
        http: rpcUrls.length > 0 ? rpcUrls : [network.selectedRpcUrl]
      }
    }
  });

  return createPublicClient({
    chain,
    transport: fallback(rpcUrls.map((url) => http(url)))
  });
}

async function createMainnetClient() {
  const settings = await readNetworkSettings();
  const ethereumSetting = settings.find(
    (setting) => (setting.networkId === "ethereum-mainnet" || setting.chainId === mainnet.id) && setting.enabled
  );
  const transports = ethereumSetting?.selectedRpcUrl
    ? [http(ethereumSetting.selectedRpcUrl), ...defaultTransports]
    : defaultTransports;

  return createPublicClient({
    chain: mainnet,
    transport: fallback(transports)
  });
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs = 12_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error("RPC request timed out. Check the network connection or RPC gateway."));
    }, timeoutMs);

    operation
      .then(resolve)
      .catch(reject)
      .finally(() => window.clearTimeout(timeoutId));
  });
}

export async function estimateNativeEthTransfer(input: {
  from: Address;
  to: Address;
  value: bigint;
  network?: WalletNetworkSetting;
}): Promise<TransactionFeeEstimate> {
  const client = input.network ? createClientForNetwork(input.network) : await createMainnetClient();
  const [nonce, gasLimit, fees] = await Promise.all([
    withTimeout(client.getTransactionCount({ address: input.from, blockTag: "pending" })),
    withTimeout(
      client.estimateGas({
        account: input.from,
        to: input.to,
        value: input.value
      })
    ),
    withTimeout(client.estimateFeesPerGas({ type: "eip1559" }))
  ]);

  const maxFeePerGas = fees.maxFeePerGas ?? 0n;
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? 0n;
  const estimatedFeeWei = gasLimit * maxFeePerGas;

  return {
    nonce: BigInt(nonce),
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    estimatedFeeWei,
    estimatedFeeNative: formatUnits(estimatedFeeWei, 18),
    estimatedFeeEth: formatEther(estimatedFeeWei)
  };
}

export async function getEthBalance(address: Address): Promise<EthBalance> {
  const client = await createMainnetClient();
  const wei = await withTimeout(
    client.getBalance({
      address,
      blockTag: "safe"
    })
  );

  return {
    wei,
    eth: formatEther(wei)
  };
}

export async function broadcastSignedTransaction(serializedTransaction: Hex, network?: WalletNetworkSetting): Promise<Hex> {
  const client = network ? createClientForNetwork(network) : await createMainnetClient();
  return withTimeout(
    client.sendRawTransaction({
      serializedTransaction
    })
  );
}
