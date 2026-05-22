import { toAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { signEthereumTransaction } from "./tcx";
import { unlockPasskeyPrf } from "./webauthn";
import type { WalletRecord } from "../lib/storage";

// A viem custom account whose signTransaction runs the wallet's passkey/tcx
// signing path. Passed into a viem WalletClient so the Puffer SDK can send
// transactions through this wallet. Each signTransaction call triggers a
// WebAuthn passkey ceremony.
export function createTcxViemAccount(walletRecord: WalletRecord) {
  return toAccount({
    address: walletRecord.address as Address,
    async signTransaction(transaction) {
      if (!transaction.to) {
        throw new Error("Transaction is missing a recipient.");
      }
      if (transaction.maxFeePerGas == null || transaction.maxPriorityFeePerGas == null) {
        throw new Error("Transaction is missing EIP-1559 fee fields.");
      }
      if (transaction.gas == null || transaction.nonce == null) {
        throw new Error("Transaction is missing gas or nonce.");
      }

      const prfKey = await unlockPasskeyPrf(walletRecord.credentialId);
      const result = await signEthereumTransaction({
        keystoreJson: walletRecord.keystoreJson,
        key: prfKey,
        derivationPath: walletRecord.derivationPath,
        tx: {
          nonce: transaction.nonce,
          gasLimit: transaction.gas,
          to: transaction.to,
          value: transaction.value ?? 0n,
          data: (transaction.data ?? "0x") as Hex,
          chainId: transaction.chainId ?? 1,
          maxFeePerGas: transaction.maxFeePerGas,
          maxPriorityFeePerGas: transaction.maxPriorityFeePerGas
        }
      });

      return result.serializedTransaction;
    },
    async signMessage() {
      throw new Error("Message signing is not supported by the passkey wallet.");
    },
    async signTypedData() {
      throw new Error("Typed-data signing is not supported by the passkey wallet.");
    }
  });
}
