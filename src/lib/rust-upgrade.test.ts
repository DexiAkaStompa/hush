import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const { selectPackage, verifyInstaller } = createRequire(import.meta.url)("../../electron/rust-upgrade.cjs");
const version = "0.5.68";
const url = `https://github.com/DexiAkaStompa/hush/releases/download/rust-preview/Hush-Rust-Setup-${version}-x64.exe`;

function signedInstaller() {
  const pair = generateKeyPairSync("ed25519");
  const key = pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const keyId = Buffer.from("11223344aabbccdd", "hex");
  const digest = createHash("blake2b512").update("Windows installer fixture").digest();
  const payloadSignature = sign(null, digest, pair.privateKey);
  const comment = `timestamp:1\tfile:Hush.exe\tversion:${version}`;
  const commentSignature = sign(null, Buffer.concat([payloadSignature, Buffer.from(comment)]), pair.privateKey);
  const publicKeyLine = Buffer.concat([Buffer.from("Ed"), keyId, key]).toString("base64");
  const signatureLine = Buffer.concat([Buffer.from("ED"), keyId, payloadSignature]).toString("base64");
  const signatureText = `untrusted comment: signature\n${signatureLine}\ntrusted comment: ${comment}\n${commentSignature.toString("base64")}\n`;
  return {
    digest,
    publicKey: Buffer.from(`untrusted comment: public key\n${publicKeyLine}\n`).toString("base64"),
    signature: Buffer.from(signatureText).toString("base64"),
    signatureText,
  };
}

describe("Windows update from Electron to Rust", () => {
  it("accepts the Windows x64 package from the signed channel and prevents rollbacks", () => {
    const manifest = { version, platforms: { "windows-x86_64": { url, signature: "signature" } } };
    expect(selectPackage(manifest, "0.5.68")).toEqual({ version, url, signature: "signature" });
    expect(selectPackage(manifest, "0.5.69")).toBeNull();
    manifest.platforms["windows-x86_64"].url = url.replace("github.com", "example.com");
    expect(() => selectPackage(manifest, "0.5.68")).toThrow();
  });

  it("requires matching installer bytes and a signed version", () => {
    const { digest, publicKey, signature, signatureText } = signedInstaller();
    expect(() => verifyInstaller(digest, { version, signature }, publicKey)).not.toThrow();
    expect(() => verifyInstaller(Buffer.alloc(64), { version, signature }, publicKey)).toThrow();
    expect(() => verifyInstaller(digest, { version: "0.5.69", signature }, publicKey)).toThrow();
    const tampered = Buffer.from(signatureText.replace("version:0.5.68", "version:0.5.69")).toString("base64");
    expect(() => verifyInstaller(digest, { version: "0.5.69", signature: tampered }, publicKey)).toThrow();
  });
});
