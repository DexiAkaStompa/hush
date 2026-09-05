const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(payload.iv),
      additionalData: encoder.encode(context),
      tagLength: 128,
    },
    key,
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
  return crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(iv),
      additionalData: encoder.encode(context),
      tagLength: 128,
    },
    key,
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
