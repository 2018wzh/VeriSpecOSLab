import { expect,test } from "bun:test";
import { EnvelopeEncryption } from "../storage/envelope.ts";

test("AES-GCM envelope binds ciphertext to its provider context",async()=>{const key=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");const envelope=await EnvelopeEncryption.fromBase64Url(key);const sealed=await envelope.seal("client-secret","provider-a");expect(await envelope.open(sealed.cipher,sealed.iv,"provider-a")).toBe("client-secret");await expect(envelope.open(sealed.cipher,sealed.iv,"provider-b")).rejects.toThrow();});
test("master key format fails fast",async()=>{await expect(EnvelopeEncryption.fromBase64Url("not-a-key")).rejects.toThrow("base64url");});
