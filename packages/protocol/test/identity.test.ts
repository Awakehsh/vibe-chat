import { describe, expect, test } from "bun:test"
import { fingerprint, generateIdentity, importPrivateKey, randomNonce, signAuth, verifyAuth } from "../src/index.ts"

describe("identity", () => {
  test("round-trips a signature", async () => {
    const id = await generateIdentity()
    expect(id.publicKey).toHaveLength(43)
    const key = await importPrivateKey(id.privateKey)
    const nonce = randomNonce()
    const sig = await signAuth(key, nonce)
    expect(await verifyAuth(id.publicKey, nonce, sig)).toBe(true)
    expect(await verifyAuth(id.publicKey, randomNonce(), sig)).toBe(false)
  })

  test("rejects a signature from another key", async () => {
    const a = await generateIdentity()
    const b = await generateIdentity()
    const nonce = randomNonce()
    const sig = await signAuth(await importPrivateKey(a.privateKey), nonce)
    expect(await verifyAuth(b.publicKey, nonce, sig)).toBe(false)
  })

  test("rejects garbage without throwing", async () => {
    expect(await verifyAuth("not-a-key", "n", "s")).toBe(false)
  })

  test("fingerprint is the first six chars", () => {
    expect(fingerprint("abcdefghij")).toBe("abcdef")
  })
})
