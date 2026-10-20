const encoder = new TextEncoder();
const decoder = new TextDecoder();
const roomKeyRings = new WeakMap<CryptoKey, CryptoKey[]>();
const roomKeySignatures = new WeakMap<CryptoKey, string>();

// Historical keys stay local and are only exchanged in device-encrypted envelopes.
export function registerRoomKeyRing(primary: CryptoKey, keys: CryptoKey[], signature: string) {
  roomKeyRings.set(primary, [primary, ...keys.filter(key => key !== primary)]);
  roomKeySignatures.set(primary, signature);
  return primary;
}

export function roomKeyCandidates(key: CryptoKey) { return roomKeyRings.get(key) ?? [key]; }
export function roomKeySignature(key: CryptoKey) { return roomKeySignatures.get(key) ?? ""; }

async function decryptWithRoomKeys(key: CryptoKey, algorithm: AesGcmParams, ciphertext: BufferSource) {
  let failure: unknown;
  for (const candidate of roomKeyCandidates(key)) {
    try { return await crypto.subtle.decrypt(algorithm, candidate, ciphertext); }
    catch (error) { failure = error; }
  }
  throw failure;
}

export type EncryptedPayload = {
  v: 1;
  iv: string;
  ciphertext: string;
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const base64ToBytes = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

export async function createRoomKey() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptText(
  plaintext: string,
  key: CryptoKey,
  context: string,
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(context),
      tagLength: 128,
    },
    key,
    encoder.encode(plaintext),
  );

  return {
    v: 1,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptText(
  payload: EncryptedPayload,
  key: CryptoKey,
  context: string,
) {
  if (payload.v !== 1) throw new Error("Versione del messaggio non supportata");

  const plaintext = await decryptWithRoomKeys(key,
    {
      name: "AES-GCM",
      iv: base64ToBytes(payload.iv),
      additionalData: encoder.encode(context),
      tagLength: 128,
    },
    base64ToBytes(payload.ciphertext),
  );

  return decoder.decode(plaintext);
}

export async function encryptBinary(
  data: ArrayBuffer,
  key: CryptoKey,
  context: string,
): Promise<{ iv: string; ciphertext: ArrayBuffer }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(context),
      tagLength: 128,
    },
    key,
    data,
  );

  return {
    iv: bytesToBase64(iv),
    ciphertext,
  };
}

export async function decryptBinary(
  ciphertext: ArrayBuffer,
  iv: string,
  key: CryptoKey,
  context: string,
): Promise<ArrayBuffer> {
  return decryptWithRoomKeys(key,
    {
      name: "AES-GCM",
      iv: base64ToBytes(iv),
      additionalData: encoder.encode(context),
      tagLength: 128,
    },
    ciphertext,
  );
}

export async function getKeyFingerprint(key: CryptoKey) {
  const rawKey = await crypto.subtle.exportKey("raw", key);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", rawKey));
  return [...digest.slice(0, 10)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .match(/.{1,4}/g)!
    .join(" ")
    .toUpperCase();
}
