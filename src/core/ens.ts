import { createPublicClient, fallback, getAddress, http, isAddress, toCoinType, type Address } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";

export type RecipientResolution =
  | {
      kind: "empty";
      input: "";
    }
  | {
      kind: "address";
      input: string;
      address: Address;
      primaryName: string | null;
    }
  | {
      kind: "ens";
      input: string;
      normalizedName: string;
      address: Address;
      primaryName: string | null;
    }
  | {
      kind: "invalid";
      input: string;
      reason: string;
    };

const ENS_GATEWAY_URLS = ["https://ccip-v3.ens.xyz", "https://ccip.ens.xyz"];

const client = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http("https://ethereum.publicnode.com"),
    http("https://eth.llamarpc.com"),
    http("https://rpc.ankr.com/eth")
  ])
});

async function withTimeout<T>(operation: Promise<T>, timeoutMs = 10_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error("ENS resolution timed out. Check the network connection or RPC gateway."));
    }, timeoutMs);

    operation
      .then(resolve)
      .catch(reject)
      .finally(() => window.clearTimeout(timeoutId));
  });
}

export async function resolveEnsName(name: string): Promise<Address | null> {
  const normalizedName = normalize(name);
  const address = await withTimeout(
    client.getEnsAddress({
      name: normalizedName,
      coinType: toCoinType(mainnet.id),
      gatewayUrls: ENS_GATEWAY_URLS
    })
  );

  return address ? getAddress(address) : null;
}

export async function lookupPrimaryName(address: Address): Promise<string | null> {
  return withTimeout(
    client.getEnsName({
      address,
      coinType: toCoinType(mainnet.id),
      gatewayUrls: ENS_GATEWAY_URLS
    })
  );
}

async function safeLookupPrimaryName(address: Address): Promise<string | null> {
  try {
    return await lookupPrimaryName(address);
  } catch {
    return null;
  }
}

export async function resolveRecipient(input: string): Promise<RecipientResolution> {
  const trimmedInput = input.trim();

  if (!trimmedInput) {
    return { kind: "empty", input: "" };
  }

  if (isAddress(trimmedInput)) {
    const address = getAddress(trimmedInput);
    return {
      kind: "address",
      input: trimmedInput,
      address,
      primaryName: await safeLookupPrimaryName(address)
    };
  }

  if (!trimmedInput.includes(".")) {
    return {
      kind: "invalid",
      input: trimmedInput,
      reason: "Enter an Ethereum address or ENS name."
    };
  }

  try {
    const normalizedName = normalize(trimmedInput);
    const address = await resolveEnsName(normalizedName);

    if (!address) {
      return {
        kind: "invalid",
        input: trimmedInput,
        reason: "No Ethereum address record was found for this ENS name."
      };
    }

    return {
      kind: "ens",
      input: trimmedInput,
      normalizedName,
      address,
      primaryName: await safeLookupPrimaryName(address)
    };
  } catch (cause) {
    return {
      kind: "invalid",
      input: trimmedInput,
      reason: cause instanceof Error ? cause.message : "Unable to resolve recipient."
    };
  }
}
