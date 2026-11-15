// The native current-user pipe authenticates the peer processes. This channel
// additionally keeps account/session data opaque to native relays and binds
// every message to one short-lived, ordered migration exchange.
export const MIGRATION_FRAME_BYTES = 1024 * 1024;
export const MIGRATION_LIFETIME_MS = 5 * 60 * 1000;

export type MigrationHello = {
  version: 1;
  id: string;
  challenge: string;
  expiresAt: number;
  publicKey: JsonWebKey;
};
export type MigrationFrame = {
  version: 1;
  transferId: string;
  sequence: number;
  nonce: string;
  ciphertext: string;
};
export type MigrationWireMessage =
  | { kind: "request"; hello: MigrationHello }
  | { kind: "sender-key"; publicKey: JsonWebKey }
  | { kind: "frame"; frame: MigrationFrame }
  | { kind: "cancel" };
export type MigrationChannel = {
  seal: (payload: unknown) => Promise<MigrationFrame>;
  open: (frame: unknown) => Promise<unknown>;
  dispose: () => void;
};
const encoder = new TextEncoder();
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const URL_BASE64_32 = /^[a-zA-Z\d_-]{43}$/;

export function migrationBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}
export function migrationBytes(value: unknown, maximum: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || value.length > Math.ceil(maximum / 3) * 4
      || !/^[A-Za-z\d+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error("Dati di migrazione non validi.");
  }
  const binary = atob(value);
  if (binary.length > maximum) throw new Error("Blocco di migrazione troppo grande.");
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
export function migrationPublicKey(value: unknown): JsonWebKey {
  if (!record(value) || value.kty !== "EC" || value.crv !== "P-256"
      || typeof value.x !== "string" || !URL_BASE64_32.test(value.x)
      || typeof value.y !== "string" || !URL_BASE64_32.test(value.y)
      || "d" in value) {
    throw new Error("Chiave pubblica di migrazione non valida.");
  }
  return { kty: "EC", crv: "P-256", x: value.x, y: value.y, ext: true, key_ops: [] };
}
export function validateMigrationHello(value: unknown, now = Date.now()): MigrationHello {
  if (!record(value) || value.version !== 1 || typeof value.id !== "string" || !UUID.test(value.id)
      || typeof value.challenge !== "string" || !URL_BASE64_32.test(value.challenge)
      || typeof value.expiresAt !== "number" || !Number.isSafeInteger(value.expiresAt)
      || value.expiresAt <= now || value.expiresAt > now + MIGRATION_LIFETIME_MS + 1000) {
    throw new Error("Richiesta di migrazione scaduta o non valida.");
  }
  return { version: 1, id: value.id, challenge: value.challenge, expiresAt: value.expiresAt,
    publicKey: migrationPublicKey(value.publicKey) };
}

async function channelFor(
  hello: MigrationHello,
  privateKey: CryptoKey,
  peer: JsonWebKey,
  source: boolean,
): Promise<MigrationChannel> {
  const publicKey = await crypto.subtle.importKey("jwk", migrationPublicKey(peer),
    { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  let outboundKey: CryptoKey | undefined, inboundKey: CryptoKey | undefined;
  try {
    const hkdf = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
    const derive = (direction: string) => crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256",
      salt: encoder.encode(`${hello.id}:${hello.challenge}`), info: encoder.encode(`hush:desktop-migration:v1:${direction}`) },
      hkdf, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const [sourceToTarget, targetToSource] = await Promise.all([derive("source-to-target"), derive("target-to-source")]);
    outboundKey = source ? sourceToTarget : targetToSource;
    inboundKey = source ? targetToSource : sourceToTarget;
  } finally {
    new Uint8Array(shared).fill(0);
  }
  let outbound = 0, inbound = 0, writing = false, reading = false;
  const check = () => {
    if (!outboundKey || !inboundKey || Date.now() >= hello.expiresAt) {
      throw new Error("Il trasferimento di Hush è scaduto o è stato chiuso.");
    }
  };
  const aad = (sequence: number, outbound: boolean) => encoder.encode(JSON.stringify({
    id: hello.id, challenge: hello.challenge, expiresAt: hello.expiresAt, sequence,
    direction: source === outbound ? "source-to-target" : "target-to-source",
  }));
  return {
    async seal(payload) {
      check();
      if (writing || !Number.isSafeInteger(outbound)) throw new Error("Invio di migrazione già in corso.");
      writing = true;
      let plain: Uint8Array<ArrayBuffer> | undefined;
      try {
        const json = JSON.stringify(payload);
        if (json === undefined) throw new Error("Messaggio di migrazione non valido.");
        plain = encoder.encode(json);
        if (plain.length > MIGRATION_FRAME_BYTES) throw new Error("Blocco di migrazione troppo grande.");
        const nonce = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce,
          additionalData: aad(outbound, true), tagLength: 128 }, outboundKey!, plain);
        check();
        return { version: 1, transferId: hello.id, sequence: outbound++, nonce: migrationBase64(nonce),
          ciphertext: migrationBase64(new Uint8Array(ciphertext)) };
      } finally {
        plain?.fill(0); writing = false;
      }
    },
    async open(value) {
      check();
      if (reading) throw new Error("Lettura di migrazione già in corso.");
      if (!record(value) || value.version !== 1 || value.transferId !== hello.id
          || value.sequence !== inbound || !Number.isSafeInteger(inbound)) {
        throw new Error("Sequenza del trasferimento di Hush non valida.");
      }
      reading = true;
      let plain: ArrayBuffer | undefined;
      try {
        const nonce = migrationBytes(value.nonce, 12);
        const ciphertext = migrationBytes(value.ciphertext, MIGRATION_FRAME_BYTES + 16);
        if (nonce.length !== 12 || ciphertext.length < 16) throw new Error("Blocco cifrato non valido.");
        plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce,
          additionalData: aad(inbound, false), tagLength: 128 }, inboundKey!, ciphertext);
        check();
        const decoded: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain));
        inbound++;
        return decoded;
      } finally {
        if (plain) new Uint8Array(plain).fill(0);
        reading = false;
      }
    },
    dispose() { outboundKey = undefined; inboundKey = undefined; },
  };
}

export async function createMigrationReceiver() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const challenge = migrationBase64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const hello: MigrationHello = { version: 1, id: crypto.randomUUID(), challenge,
    expiresAt: Date.now() + MIGRATION_LIFETIME_MS, publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey) };
  let used = false;
  return {
    hello,
    async connect(publicKey: unknown) {
      if (used) throw new Error("Il destinatario della migrazione è già collegato.");
      validateMigrationHello(hello);
      const peer = migrationPublicKey(publicKey);
      used = true;
      return channelFor(hello, pair.privateKey, peer, false);
    },
  };
}

export async function createMigrationSource(value: unknown) {
  const hello = validateMigrationHello(value);
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  return { publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey),
    channel: await channelFor(hello, pair.privateKey, hello.publicKey, true) };
}
