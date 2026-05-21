import init, { create_keystore, derive_accounts, sign_tx } from "@consenlabs/tcx-wasm";
import type { Hex } from "viem";
import type { NativeTransferPreview } from "./clearSigning";

export interface CreatedWallet {
  address: string;
  chainAccounts: {
    ethereum: string;
    tron?: string;
    bitcoin?: string;
  };
  derivationPath: string;
  keystoreJson: string;
}

export interface EthereumSignResult {
  signature: string;
  serializedTransaction: Hex;
  txHash: string;
}

export type NativeTransferSignResult = EthereumSignResult;

let initPromise: Promise<void> | null = null;

async function initTcx(): Promise<void> {
  initPromise ??= init().then(() => undefined);
  await initPromise;
}

export async function createEthereumPasskeyWallet(input: {
  credentialId: string;
  prfKeyHex: string;
  rpId: string;
  userId: string;
}): Promise<CreatedWallet> {
  await initTcx();

  const keystoreJson = create_keystore(
    JSON.stringify({
      prfKey: input.prfKeyHex,
      userId: input.userId,
      credentialId: input.credentialId,
      rpId: input.rpId,
      network: "MAINNET"
    })
  );

  const derivationPath = "m/44'/60'/0'/0/0";
  const tronDerivationPath = "m/44'/195'/0'/0/0";
  const bitcoinDerivationPath = "m/84'/0'/0'/0/0";
  const accounts = JSON.parse(
    derive_accounts(
      JSON.stringify({
        keystoreJson,
        key: input.prfKeyHex,
        derivations: [
          {
            chain: "ETHEREUM",
            derivationPath,
            chainId: "1",
            network: "MAINNET"
          },
          {
            chain: "TRON",
            derivationPath: tronDerivationPath,
            network: "MAINNET"
          },
          {
            chain: "BITCOIN",
            derivationPath: bitcoinDerivationPath,
            network: "MAINNET",
            segWit: "VERSION_0"
          }
        ]
      })
    )
  ) as Array<{ address: string; chain?: string }>;

  const ethereum = accounts.find((account) => account.chain === "ETHEREUM")?.address ?? accounts[0]?.address;
  const tron = accounts.find((account) => account.chain === "TRON")?.address;
  const bitcoin = accounts.find((account) => account.chain === "BITCOIN")?.address;

  if (!ethereum) {
    throw new Error("tcx-wasm did not return an Ethereum address.");
  }

  return {
    address: ethereum,
    chainAccounts: {
      ethereum,
      tron,
      bitcoin
    },
    derivationPath,
    keystoreJson
  };
}

function requiredBigInt(value: bigint | null, label: string): string {
  if (value === null) {
    throw new Error(`${label} is required before signing.`);
  }

  return value.toString();
}

function normalizeSerializedTransaction(signature: string): Hex {
  const serializedTransaction = signature.startsWith("0x") ? signature : `0x${signature}`;

  if (!/^0x[0-9a-fA-F]+$/.test(serializedTransaction)) {
    throw new Error("tcx-wasm returned an invalid serialized Ethereum transaction.");
  }

  return serializedTransaction as Hex;
}

export async function signEthereumTransfer(input: {
  keystoreJson: string;
  key: string;
  derivationPath: string;
  preview: NativeTransferPreview;
}): Promise<EthereumSignResult> {
  await initTcx();

  const result = JSON.parse(
    sign_tx(
      JSON.stringify({
        keystoreJson: input.keystoreJson,
        key: input.key,
        derivationPath: input.derivationPath,
        input: {
          nonce: requiredBigInt(input.preview.nonce, "Nonce"),
          gasLimit: requiredBigInt(input.preview.gasLimit, "Gas limit"),
          to: input.preview.to,
          value: input.preview.amountWei.toString(),
          chainId: input.preview.chainId.toString(),
          txType: "02",
          maxFeePerGas: requiredBigInt(input.preview.maxFeePerGas, "Max fee per gas"),
          maxPriorityFeePerGas: requiredBigInt(input.preview.maxPriorityFeePerGas, "Max priority fee per gas"),
          accessList: []
        }
      })
    )
  ) as EthereumSignResult;

  if (!result.signature || !result.txHash) {
    throw new Error("tcx-wasm did not return an Ethereum signature and transaction hash.");
  }

  return {
    ...result,
    serializedTransaction: normalizeSerializedTransaction(result.signature)
  };
}

export const signNativeTokenTransfer = signEthereumTransfer;
