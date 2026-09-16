import { AUTH_SIGN_PREFIX } from "./limits.ts"
import { fromBase64Url, toBase64Url } from "./base64url.ts"

/** An identity as stored on disk: both keys base64url. */
export interface IdentityKeys {
  publicKey: string
  /** PKCS#8 DER, base64url. */
  privateKey: string
}

const ALG = { name: "Ed25519" } as const
const enc = new TextEncoder()

export async function generateIdentity(): Promise<IdentityKeys> {
  const pair = (await crypto.subtle.generateKey(ALG, true, ["sign", "verify"])) as CryptoKeyPair
  const publicKey = toBase64Url(await crypto.subtle.exportKey("raw", pair.publicKey))
  const privateKey = toBase64Url(await crypto.subtle.exportKey("pkcs8", pair.privateKey))
  return { publicKey, privateKey }
}

export async function importPrivateKey(privateKeyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", fromBase64Url(privateKeyB64), ALG, false, ["sign"])
}

export async function importPublicKey(userId: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromBase64Url(userId), ALG, false, ["verify"])
}

export async function signAuth(privateKey: CryptoKey, nonce: string): Promise<string> {
  const sig = await crypto.subtle.sign(ALG, privateKey, enc.encode(AUTH_SIGN_PREFIX + nonce))
  return toBase64Url(sig)
}

export async function verifyAuth(userId: string, nonce: string, sigB64: string): Promise<boolean> {
  try {
    const key = await importPublicKey(userId)
    return await crypto.subtle.verify(ALG, key, fromBase64Url(sigB64), enc.encode(AUTH_SIGN_PREFIX + nonce))
  } catch {
    return false
  }
}

/** Short, human-comparable form of a userId for disambiguating same-named users. */
export function fingerprint(userId: string): string {
  return userId.slice(0, 6)
}

export function randomNonce(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
}
