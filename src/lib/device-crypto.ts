import { createRoomKey, registerRoomKeyRing, roomKeyCandidates } from "./crypto";
import { supabase } from "./supabase";

const encoder = new TextEncoder();
const DATABASE_NAME = "hush-device-keys";
const STORE_NAME = "identities";

export type DeviceIdentity = {
  id: string;
  userId: string;
  privateKey: CryptoKey;
  publicKey: JsonWebKey;
};

type PublicDevice = {
  id: string;
  user_id: string;
  hpke_public_key: string;
};

type KeyEnvelope = {
  conversation_id: string;
  recipient_device_id: string;
  sender_device_id: string;
  key_epoch: number;
  ephemeral_public_key: JsonWebKey;
  nonce: string;
  ciphertext: string;
};
const loadedKeys = new WeakMap<DeviceIdentity, Map<string, { revision: string; key: CryptoKey }>>();

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "userId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readIdentity(userId: string) {
  const database = await openDatabase();
  return new Promise<DeviceIdentity | undefined>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(userId);
    request.onsuccess = () => resolve(request.result as DeviceIdentity | undefined);
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
}

async function writeIdentity(identity: DeviceIdentity) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(identity);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Salvataggio della chiave del dispositivo interrotto"));
  }).finally(() => database.close());
}

async function generateIdentity(userId: string): Promise<DeviceIdentity> {
  const extractablePair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const [publicKey, privatePkcs8] = await Promise.all([
    crypto.subtle.exportKey("jwk", extractablePair.publicKey),
    crypto.subtle.exportKey("pkcs8", extractablePair.privateKey),
  ]);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privatePkcs8,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  return { id: crypto.randomUUID(), userId, privateKey, publicKey };
}

const identityLoads = new Map<string, Promise<DeviceIdentity>>();
export function ensureDeviceIdentity(userId: string) {
  const pending = identityLoads.get(userId);
  if (pending) return pending;
  const task = (navigator.locks
    ? navigator.locks.request(`hush:device-identity:${userId}`, () => loadDeviceIdentity(userId))
    : loadDeviceIdentity(userId)).finally(() => identityLoads.delete(userId));
  identityLoads.set(userId, task);
  return task;
}

async function loadDeviceIdentity(userId: string) {
  if (!supabase) throw new Error("Supabase non è configurato");
  let identity = await readIdentity(userId);
  if (!identity) {
    identity = await generateIdentity(userId);
    await writeIdentity(identity);
  }

  const publicKey = JSON.stringify(identity.publicKey);
  const { error } = await supabase.from("devices").upsert({
    id: identity.id,
    user_id: userId,
    label: navigator.platform || "Dispositivo Hush",
    signature_public_key: publicKey,
    hpke_public_key: publicKey,
    credential: { algorithm: "ECDH-P256+HKDF-SHA256", version: 1 },
    last_seen_at: new Date().toISOString(),
    revoked_at: null,
  }, { onConflict: "id" });
  if (error) throw error;
  return identity;
}

async function deriveWrappingKey(privateKey: CryptoKey, publicKey: CryptoKey, conversationId: string) {
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: publicKey },
    privateKey,
    256,
  );
  const hkdfKey = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(conversationId),
      info: encoder.encode("hush:key-envelope:v1"),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function wrapRoomKey(
  conversationId: string,
  roomKey: CryptoKey,
  recipient: PublicDevice,
  senderDeviceId: string,
  keyEpoch = 0,
): Promise<KeyEnvelope> {
  const recipientJwk = JSON.parse(recipient.hpke_public_key) as JsonWebKey;
  const recipientPublicKey = await crypto.subtle.importKey(
    "jwk",
    recipientJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ephemeralPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const wrappingKey = await deriveWrappingKey(ephemeralPair.privateKey, recipientPublicKey, conversationId);
  const [rawRoomKey, ephemeralPublicKey] = await Promise.all([
    crypto.subtle.exportKey("raw", roomKey),
    crypto.subtle.exportKey("jwk", ephemeralPair.publicKey),
  ]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, wrappingKey, rawRoomKey);
  return {
    conversation_id: conversationId,
    recipient_device_id: recipient.id,
    sender_device_id: senderDeviceId,
    key_epoch: keyEpoch,
    ephemeral_public_key: ephemeralPublicKey,
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

async function devicesForConversation(conversationId: string) {
  if (!supabase) throw new Error("Supabase non è configurato");
  const { data: memberships, error: membershipError } = await supabase
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .is("left_at", null);
  if (membershipError) throw membershipError;
  const userIds = [...new Set((memberships ?? []).map((membership) => membership.user_id as string))];
  if (userIds.length === 0) return [];
  const { data, error } = await supabase
    .from("devices")
    .select("id, user_id, hpke_public_key")
    .in("user_id", userIds)
    .is("revoked_at", null);
  if (error) throw error;
  return (data ?? []) as PublicDevice[];
}

export async function initializeConversationKey(conversationId: string, identity: DeviceIdentity) {
  if (!supabase) throw new Error("Supabase non è configurato");
  const existing = await loadConversationKey(conversationId, identity);
  if (existing) return existing;
  const roomKey = await createRoomKey();
  const devices = await devicesForConversation(conversationId);
  if (!devices.some((device) => device.id === identity.id)) {
    throw new Error("Il dispositivo corrente non risulta membro della conversazione");
  }
  const envelopes = await Promise.all(
    devices.map((device) => wrapRoomKey(conversationId, roomKey, device, identity.id)),
  );
  const { error } = await supabase.rpc("initialize_conversation_key_envelopes", { p_conversation_id: conversationId, p_envelopes: envelopes });
  if (error) throw error;
  // Never use a generated key unless this device can read it back from storage.
  return loadConversationKey(conversationId, identity);
}

export async function loadConversationKey(conversationId: string, identity: DeviceIdentity) {
  if (!supabase) throw new Error("Supabase non è configurato");
  const { data, error } = await supabase
    .from("conversation_key_envelopes")
    .select("conversation_id, recipient_device_id, sender_device_id, key_epoch, ephemeral_public_key, nonce, ciphertext")
    .eq("conversation_id", conversationId)
    .eq("recipient_device_id", identity.id)
    .order("key_epoch");
  if (error) throw error;
  if (!data?.length) return null;
  const revision = JSON.stringify(data);
  let cache = loadedKeys.get(identity);
  if (!cache) { cache = new Map(); loadedKeys.set(identity, cache); }
  const previous = cache.get(conversationId);
  if (previous?.revision === revision) return previous.key;
  const recovered: { key: CryptoKey; id: number }[] = [];
  for (const envelope of data) {
    try {
      const ephemeralPublicKey = await crypto.subtle.importKey(
        "jwk", envelope.ephemeral_public_key as JsonWebKey,
        { name: "ECDH", namedCurve: "P-256" }, false, [],
      );
      const wrappingKey = await deriveWrappingKey(identity.privateKey, ephemeralPublicKey, conversationId);
      const raw = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(envelope.nonce) }, wrappingKey, base64ToBytes(envelope.ciphertext),
      );
      const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
      const id = await recoveryKeyId(key);
      if (!recovered.some(item => item.id === id)) recovered.push({ key, id });
    } catch { /* An unusable envelope must not hide other valid historical keys. */ }
  }
  if (!recovered.length) throw new Error("Le chiavi di questo dispositivo non sono leggibili. Non cancellare i dati dell'app.");
  recovered.sort((a, b) => a.id - b.id);
  const key = registerRoomKeyRing(recovered[0].key, recovered.map(item => item.key), recovered.map(item => item.id).join(","));
  cache.set(conversationId, { revision, key });
  return key;
}

// Recovery slots identify key material, not the message epoch (legacy messages stay at epoch 0).
async function recoveryKeyId(key: CryptoKey) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", await crypto.subtle.exportKey("raw", key)));
  return parseInt([...hash.slice(0, 6)].map(byte => byte.toString(16).padStart(2, "0")).join(""), 16) + 1;
}

export async function requestConversationKey(conversationId: string, identity: DeviceIdentity) {
  if (!supabase) throw new Error("Supabase non è configurato");
  const { error } = await supabase.from("conversation_key_requests").upsert({
    conversation_id: conversationId,
    requester_device_id: identity.id,
  }, { onConflict: "conversation_id,requester_device_id", ignoreDuplicates: true });
  if (error) throw error;
}

export async function fulfillPendingKeyRequests(
  conversationId: string,
  roomKey: CryptoKey,
  identity: DeviceIdentity,
) {
  if (!supabase) throw new Error("Supabase non è configurato");
  const keys = await Promise.all(roomKeyCandidates(roomKey).map(async key => ({ key, id: await recoveryKeyId(key) })));
  keys.push({ key: roomKey, id: 0 }); // Continue serving clients using the original envelope slot.
  // Only wrap missing slots: no repeated ECDH work for devices already synchronized.
  const { data: missing, error: missingError } = await supabase.rpc("missing_conversation_key_envelopes", {
    p_conversation_id: conversationId, p_key_ids: keys.map(item => item.id),
  });
  if (missingError) throw missingError;
  if (!missing?.length) return 0;
  const devices = await devicesForConversation(conversationId);
  const envelopes: KeyEnvelope[] = [];
  for (const slot of missing as { recipient_device_id: string; key_epoch: number }[]) {
    const device = devices.find(item => item.id === slot.recipient_device_id);
    const source = keys.find(item => item.id === Number(slot.key_epoch));
    if (device && source) envelopes.push(await wrapRoomKey(conversationId, source.key, device, identity.id, source.id));
  }
  if (!envelopes.length) return 0;
  const { error } = await supabase.rpc("store_conversation_key_envelopes", { p_envelopes: envelopes });
  if (error) throw error;
  return envelopes.length;
}
