import { base64UrlToBytes, bytesToBase64Url, bytesToHex, randomBytes, toArrayBuffer } from "../lib/encoding";

interface PrfClientExtensionResults {
  prf?: {
    enabled?: boolean;
    results?: {
      first?: BufferSource;
      second?: BufferSource;
    };
  };
}

type PublicKeyCredentialWithPrf = PublicKeyCredential & {
  getClientExtensionResults(): PrfClientExtensionResults;
};

export interface PasskeyPrfResult {
  credentialId: string;
  prfKeyHex: string;
  rpId: string;
  userId: string;
}

const PRF_LABEL = new TextEncoder().encode("my-passkey-wallet:tcx-wasm:v1");

export async function createPasskeyPrf(displayName: string): Promise<PasskeyPrfResult> {
  if (!window.PublicKeyCredential || !navigator.credentials?.create) {
    throw new Error("This browser does not expose WebAuthn credential creation.");
  }

  const userIdBytes = randomBytes(16);
  const challenge = randomBytes(32);
  const salt = new Uint8Array(32);
  salt.set(PRF_LABEL.slice(0, 32));

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: toArrayBuffer(challenge),
      rp: {
        name: "Orchard Wallet"
      },
      user: {
        id: toArrayBuffer(userIdBytes),
        name: displayName,
        displayName
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 }
      ],
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required"
      },
      timeout: 60_000,
      extensions: {
        prf: {
          eval: {
            first: toArrayBuffer(salt)
          }
        }
      } as AuthenticationExtensionsClientInputs
    }
  })) as PublicKeyCredentialWithPrf | null;

  if (!credential) {
    throw new Error("Passkey creation was cancelled.");
  }

  const prfResult = credential.getClientExtensionResults().prf;

  if (!prfResult?.enabled || !prfResult.results?.first) {
    throw new Error("This authenticator did not return a WebAuthn PRF output.");
  }

  return {
    credentialId: bytesToBase64Url(credential.rawId),
    prfKeyHex: bytesToHex(new Uint8Array(prfResult.results.first as ArrayBuffer)),
    rpId: window.location.hostname || "chrome-extension",
    userId: bytesToBase64Url(userIdBytes)
  };
}

export async function unlockPasskeyPrf(credentialId: string): Promise<string> {
  if (!window.PublicKeyCredential || !navigator.credentials?.get) {
    throw new Error("This browser does not expose WebAuthn credential unlock.");
  }

  const salt = new Uint8Array(32);
  salt.set(PRF_LABEL.slice(0, 32));

  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: toArrayBuffer(randomBytes(32)),
      allowCredentials: [
        {
          type: "public-key",
          id: toArrayBuffer(base64UrlToBytes(credentialId))
        }
      ],
      userVerification: "required",
      timeout: 60_000,
      extensions: {
        prf: {
          eval: {
            first: toArrayBuffer(salt)
          }
        }
      } as AuthenticationExtensionsClientInputs
    }
  })) as PublicKeyCredentialWithPrf | null;

  if (!credential) {
    throw new Error("Passkey unlock was cancelled.");
  }

  const prfResult = credential.getClientExtensionResults().prf;

  if (!prfResult?.results?.first) {
    throw new Error("This authenticator did not return a WebAuthn PRF output.");
  }

  return bytesToHex(new Uint8Array(prfResult.results.first as ArrayBuffer));
}
