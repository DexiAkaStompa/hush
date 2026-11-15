import type { DeviceIdentity } from "./device-crypto";
import { pendingMigrationAccount } from "./migration-auth-storage";
import {
  createMigrationReceiver, createMigrationSource, migrationBase64, migrationBytes,
  MIGRATION_LIFETIME_MS,
  type MigrationChannel, type MigrationHello, type MigrationWireMessage,
} from "./migration-transport";

export const MIGRATION_SOUND_CHUNK_BYTES = 256 * 1024;
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const MAX_PREFERENCE_BYTES = 512 * 1024;
const MAX_CONVERSATIONS = 20_000;
const PREFERENCE_KEYS = new Set([
  "hush-theme", "hush:media:v1", "hush_user_audio_prefs", "hush:user-status",
  "hush:muted-chats", "hush:recent_emojis", "hush:room-music-volume:v1", "hush:active_space",
]);
type Preferences = Record<string, string>;
export type MigrationStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
export type MigrationSession = { access_token: string; refresh_token: string };
export type MigrationSoundId = "notification" | "ringtone";
type SoundDescriptor = { id: MigrationSoundId; name: string; type: string; size: number };
export type MigrationSound = SoundDescriptor & { data: Blob };
export type MigrationDevice = { deviceId: string; label: string; kind: string };
type Snapshot = { kind: "snapshot"; version: 1; userId: string; session: MigrationSession;
  preferences: Preferences; sounds: SoundDescriptor[]; mediaDevices: MigrationDevice[] };
export type MigrationPort = {
  send: (message: MigrationWireMessage) => Promise<void>;
  receive: () => Promise<MigrationWireMessage>;
};
export type MigrationProgress = (stage: "preferences" | "sounds" | "keys", completed: number, total: number) => void;
export type MigrationSourceDependencies = {
  storage: MigrationStorage;
  getSession: () => Promise<(MigrationSession & { user: { id: string } }) | null>;
  getUserId: (accessToken: string) => Promise<string>;
  readIdentity: (userId: string) => Promise<DeviceIdentity | null>;
  listConversationIds: (identity: DeviceIdentity, expiresAt?: number) => Promise<string[]>;
  verifyTargetDevice: (userId: string, deviceId: string) => Promise<boolean>;
  shareKeyRing: (conversationId: string, identity: DeviceIdentity) => Promise<void>;
  loadSounds: () => Promise<MigrationSound[]>;
  enumerateDevices?: () => Promise<MigrationDevice[]>;
  stopAutoRefresh?: () => void | Promise<void>;
  resumeAutoRefresh?: () => void | Promise<void>;
  updateOriginalSession?: (session: MigrationSession) => Promise<string>;
};
export type MigrationTargetDependencies = {
  storage: MigrationStorage;
  currentUserId: () => Promise<string | null>;
  getUserId: (accessToken: string) => Promise<string>;
  importSession: (session: MigrationSession) => Promise<string>;
  createIdentity: (userId: string) => Promise<DeviceIdentity>;
  verifyKeyRing: (conversationId: string, identity: DeviceIdentity) => Promise<boolean>;
  saveSound: (sound: MigrationSound) => Promise<void>;
  enumerateDevices?: () => Promise<MigrationDevice[]>;
  currentSession?: () => Promise<MigrationSession>;
  recordExpectedUser?: (userId: string) => void;
  stopAutoRefresh?: () => void | Promise<void>;
  resumeAutoRefresh?: () => void | Promise<void>;
};
function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function userId(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
function token(value: unknown): value is string {
  // Refresh tokens are opaque provider data, including shorter legacy values.
  // Identity/authorization is verified with Supabase rather than guessed from length.
  return typeof value === "string" && value.length > 0 && value.length <= 16_384 && !/[\r\n\0]/.test(value);
}
function migrationSession(value: unknown): MigrationSession {
  if (!object(value) || !token(value.access_token) || !token(value.refresh_token)) {
    throw new Error("Sessione del trasferimento non valida.");
  }
  return { access_token: value.access_token, refresh_token: value.refresh_token };
}
export function isMigrationPreferenceKey(key: string): boolean {
  if (PREFERENCE_KEYS.has(key)) return true;
  return ["hush:workspace:", "hush:active_conv:"].some(prefix => key.startsWith(prefix) && UUID.test(key.slice(prefix.length)));
}
function validatedPreferences(value: unknown): Preferences {
  if (!object(value) || Object.keys(value).length > 2048) throw new Error("Preferenze di migrazione non valide.");
  const result: Preferences = {};
  let bytes = 0;
  for (const [key, entry] of Object.entries(value)) {
    if (!isMigrationPreferenceKey(key) || typeof entry !== "string" || entry.length > 256 * 1024) {
      throw new Error("Preferenza di migrazione non consentita.");
    }
    bytes += new TextEncoder().encode(key + entry).length;
    if (bytes > MAX_PREFERENCE_BYTES) throw new Error("Le preferenze da trasferire sono troppo grandi.");
    result[key] = entry;
  }
  return result;
}
export function collectMigrationPreferences(storage: MigrationStorage): Preferences {
  const result: Preferences = {};
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key || !isMigrationPreferenceKey(key)) continue;
    const value = storage.getItem(key);
    if (value !== null) result[key] = value;
  }
  return validatedPreferences(result);
}
/** Only approved preference keys are touched. A quota failure restores prior values. */
export function applyMigrationPreferences(storage: MigrationStorage, input: unknown): string[] {
  const values = validatedPreferences(input), previous = new Map<string, string | null>();
  try {
    for (const [key, value] of Object.entries(values)) {
      previous.set(key, storage.getItem(key)); storage.setItem(key, value);
    }
  } catch (error) {
    for (const [key, value] of previous) {
      try { if (value === null) storage.removeItem(key); else storage.setItem(key, value); } catch { /* Preserve everything the browser can restore. */ }
    }
    throw error;
  }
  return Object.keys(values);
}
function devices(value: unknown): MigrationDevice[] {
  if (!Array.isArray(value) || value.length > 128) throw new Error("Dispositivi audio di migrazione non validi.");
  return value.map(device => {
    if (!object(device) || typeof device.deviceId !== "string" || device.deviceId.length > 512
        || typeof device.label !== "string" || device.label.length > 512
        || !["audioinput", "audiooutput", "videoinput"].includes(String(device.kind))) {
      throw new Error("Dispositivo audio di migrazione non valido.");
    }
    return { deviceId: device.deviceId, label: device.label, kind: String(device.kind) };
  });
}
/** Optional hardware labels must never block a hidden migration-only window. */
export async function bestEffortMigrationDevices(
  enumerate: (() => Promise<MigrationDevice[]>) | undefined,
  visibility = typeof document === "undefined" ? "visible" : document.visibilityState,
): Promise<MigrationDevice[]> {
  if (!enumerate || visibility !== "visible") return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(enumerate).then(devices).catch(() => []),
      new Promise<MigrationDevice[]>(resolve => { timer = setTimeout(() => resolve([]), 750); }),
    ]);
    return result;
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
/** Media device IDs are origin-scoped; retain the chosen hardware by label. */
export function remapMigrationMediaDevices(preferences: Preferences, source: MigrationDevice[], target: MigrationDevice[]): Preferences {
  if (!preferences["hush:media:v1"]) return preferences;
  let media: unknown;
  try { media = JSON.parse(preferences["hush:media:v1"]); } catch { return preferences; }
  if (!object(media)) return preferences;
  for (const [key, kind] of [["inputId", "audioinput"], ["outputId", "audiooutput"], ["cameraId", "videoinput"]]) {
    const saved = media[key];
    if (typeof saved !== "string" || !saved || target.some(device => device.deviceId === saved && device.kind === kind)) continue;
    const original = source.find(device => device.deviceId === saved && device.kind === kind);
    media[key] = original?.label ? target.find(device => device.kind === kind && device.label === original.label)?.deviceId ?? "" : "";
  }
  return { ...preferences, "hush:media:v1": JSON.stringify(media) };
}
function soundDescriptor(value: unknown): SoundDescriptor {
  if (!object(value) || !["notification", "ringtone"].includes(String(value.id))
      || typeof value.name !== "string" || !value.name || value.name.length > 512
      || typeof value.type !== "string" || value.type.length > 128
      || typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 0
      || value.size > (value.id === "notification" ? 10 : 15) * 1024 * 1024) {
    throw new Error("Suono personalizzato di migrazione non valido.");
  }
  return { id: value.id as MigrationSoundId, name: value.name, type: value.type, size: value.size };
}
function snapshot(value: unknown): Snapshot {
  if (!object(value) || value.kind !== "snapshot" || value.version !== 1 || !userId(value.userId)
      || !object(value.session) || !token(value.session.access_token) || !token(value.session.refresh_token)
      || !Array.isArray(value.sounds) || value.sounds.length > 2) {
    throw new Error("Account di migrazione non valido.");
  }
  const sounds = value.sounds.map(soundDescriptor);
  if (new Set(sounds.map(sound => sound.id)).size !== sounds.length) throw new Error("Suoni di migrazione duplicati.");
  return { kind: "snapshot", version: 1, userId: value.userId,
    session: { access_token: value.session.access_token, refresh_token: value.session.refresh_token },
    preferences: validatedPreferences(value.preferences), sounds, mediaDevices: devices(value.mediaDevices) };
}
async function send(port: MigrationPort, channel: MigrationChannel, payload: unknown) {
  await port.send({ kind: "frame", frame: await channel.seal(payload) });
}
async function receive(port: MigrationPort, channel: MigrationChannel): Promise<Record<string, unknown>> {
  const message = await port.receive();
  if (message.kind !== "frame") throw new Error("Trasferimento di Hush interrotto.");
  const value = await channel.open(message.frame);
  if (!object(value)) throw new Error("Messaggio di migrazione non valido.");
  return value;
}

export async function runMigrationSource(
  hello: MigrationHello, port: MigrationPort, deps: MigrationSourceDependencies, progress?: MigrationProgress,
) {
  const { channel, publicKey } = await createMigrationSource(hello);
  let committed = false, paused = false;
  try {
    const session = await deps.getSession();
    if (!session || !userId(session.user.id) || await deps.getUserId(session.access_token) !== session.user.id) {
      throw new Error("Accedi al tuo account nel client Hush originale prima del trasferimento.");
    }
    const identity = await deps.readIdentity(session.user.id);
    if (!identity || !userId(identity.id) || identity.userId !== session.user.id || identity.privateKey.extractable
        || identity.privateKey.algorithm.name !== "ECDH") {
      throw new Error("Le chiavi originali non sono disponibili. I dati del vecchio client sono stati mantenuti.");
    }
    paused = true; await deps.stopAutoRefresh?.();
    const sounds = await deps.loadSounds();
    for (const sound of sounds) {
      soundDescriptor(sound);
      if (!(sound.data instanceof Blob) || sound.data.size !== sound.size) throw new Error("Suono originale non leggibile.");
    }
    const state = snapshot({ kind: "snapshot", version: 1, userId: session.user.id,
      session: { access_token: session.access_token, refresh_token: session.refresh_token },
      preferences: collectMigrationPreferences(deps.storage), sounds: sounds.map(soundDescriptor),
      mediaDevices: await bestEffortMigrationDevices(deps.enumerateDevices) });
    await port.send({ kind: "sender-key", publicKey });
    await send(port, channel, state);
    progress?.("preferences", 1, 1);
    let soundIndex = 0;
    for (const sound of sounds) {
      let index = 0;
      for (let offset = 0; offset < sound.size; offset += MIGRATION_SOUND_CHUNK_BYTES) {
        const bytes = new Uint8Array(await sound.data.slice(offset, offset + MIGRATION_SOUND_CHUNK_BYTES).arrayBuffer());
        try {
          await send(port, channel, { kind: "sound-chunk", id: sound.id, index, data: migrationBase64(bytes) });
          const acknowledgement = await receive(port, channel);
          if (acknowledgement.kind !== "sound-ack" || acknowledgement.id !== sound.id || acknowledgement.index !== index) {
            throw new Error("Conferma del blocco audio non valida.");
          }
          index++;
        }
        finally { bytes.fill(0); }
      }
      await send(port, channel, { kind: "sound-complete", id: sound.id, chunks: index });
      progress?.("sounds", ++soundIndex, sounds.length);
    }
    await send(port, channel, { kind: "snapshot-ready", userId: state.userId });
    const target = await receive(port, channel);
    if (target.kind !== "target-ready" || target.userId !== state.userId || !userId(target.deviceId)
        || target.deviceId === identity.id || !await deps.verifyTargetDevice(state.userId, target.deviceId)) {
      throw new Error("Il dispositivo di destinazione non appartiene allo stesso account.");
    }
    if (deps.updateOriginalSession) {
      const checkpoint = migrationSession(target.session);
      if (await deps.getUserId(checkpoint.access_token) !== state.userId
          || await deps.updateOriginalSession(checkpoint) !== state.userId) {
        throw new Error("Aggiornamento dell’accesso originale non verificabile.");
      }
      await deps.stopAutoRefresh?.();
    }
    const conversationIds = [...new Set(await deps.listConversationIds(identity, hello.expiresAt))];
    if (conversationIds.length > MAX_CONVERSATIONS || conversationIds.some(id => !userId(id))) {
      throw new Error("Elenco delle conversazioni da trasferire non valido.");
    }
    let completed = 0;
    for (const conversationId of conversationIds) {
      if (Date.now() >= hello.expiresAt) throw new Error("Il trasferimento delle chiavi è scaduto.");
      await deps.shareKeyRing(conversationId, identity);
      progress?.("keys", ++completed, conversationIds.length);
    }
    await send(port, channel, { kind: "keys-ready", userId: state.userId, deviceId: target.deviceId, conversationIds });
    const confirmation = await receive(port, channel);
    if (confirmation.kind !== "commit" || confirmation.userId !== state.userId
        || confirmation.deviceId !== target.deviceId || confirmation.verifiedConversations !== conversationIds.length) {
      throw new Error("Conferma del trasferimento di Hush non valida.");
    }
    if (deps.updateOriginalSession) {
      const checkpoint = migrationSession(confirmation.session);
      if (await deps.getUserId(checkpoint.access_token) !== state.userId
          || await deps.updateOriginalSession(checkpoint) !== state.userId) {
        throw new Error("Conferma dell’accesso originale non verificabile.");
      }
      await deps.stopAutoRefresh?.();
    }
    await send(port, channel, { kind: "finished", userId: state.userId });
    committed = true;
    return { userId: state.userId, deviceId: target.deviceId, conversations: conversationIds.length };
  } catch (error) {
    await port.send({ kind: "cancel" }).catch(() => {});
    throw error;
  } finally {
    channel.dispose();
    if (paused && !committed) await deps.resumeAutoRefresh?.();
  }
}

export async function runMigrationTarget(
  receiver: Awaited<ReturnType<typeof createMigrationReceiver>>, port: MigrationPort,
  deps: MigrationTargetDependencies, progress?: MigrationProgress,
) {
  let channel: MigrationChannel | undefined;
  let committed = false;
  try {
    const sender = await port.receive();
    if (sender.kind !== "sender-key") throw new Error("Client originale di Hush non disponibile.");
    channel = await receiver.connect(sender.publicKey);
    const state = snapshot(await receive(port, channel));
    const existing = await deps.currentUserId();
    if ((existing && existing !== state.userId) || await deps.getUserId(state.session.access_token) !== state.userId) {
      throw new Error("L’account di origine non corrisponde al destinatario del trasferimento.");
    }
    deps.recordExpectedUser?.(state.userId);
    if (await deps.importSession(state.session) !== state.userId) throw new Error("Sessione di destinazione non valida.");
    await deps.stopAutoRefresh?.();
    for (const sound of state.sounds) {
      const parts: Blob[] = [];
      let index = 0, size = 0;
      for (;;) {
        const message = await receive(port, channel);
        if (message.kind === "sound-complete") {
          if (message.id !== sound.id || message.chunks !== index || size !== sound.size) {
            throw new Error("Suono personalizzato trasferito solo in parte.");
          }
          break;
        }
        if (message.kind !== "sound-chunk" || message.id !== sound.id || message.index !== index++) {
          throw new Error("Ordine dei blocchi audio non valido.");
        }
        const bytes = migrationBytes(message.data, MIGRATION_SOUND_CHUNK_BYTES);
        size += bytes.length;
        if (!bytes.length || size > sound.size) throw new Error("Dimensione del suono trasferito non valida.");
        parts.push(new Blob([bytes])); bytes.fill(0);
        await send(port, channel, { kind: "sound-ack", id: sound.id, index: index - 1 });
      }
      await deps.saveSound({ ...sound, data: new Blob(parts, { type: sound.type }) });
      parts.length = 0;
    }
    const snapshotReady = await receive(port, channel);
    if (snapshotReady.kind !== "snapshot-ready" || snapshotReady.userId !== state.userId) {
      throw new Error("Trasferimento delle preferenze incompleto.");
    }
    const targetDevices = await bestEffortMigrationDevices(deps.enumerateDevices);
    const preferences = remapMigrationMediaDevices(state.preferences, state.mediaDevices, targetDevices);
    const changed = applyMigrationPreferences(deps.storage, preferences);
    progress?.("preferences", 1, 1);
    const identity = await deps.createIdentity(state.userId);
    if (identity.userId !== state.userId || identity.privateKey.extractable || !userId(identity.id)) {
      throw new Error("Identità del nuovo dispositivo non valida.");
    }
    await send(port, channel, { kind: "target-ready", userId: state.userId, deviceId: identity.id,
      ...(deps.currentSession ? { session: migrationSession(await deps.currentSession()) } : {}) });
    const keysReady = await receive(port, channel);
    if (keysReady.kind !== "keys-ready" || keysReady.userId !== state.userId || keysReady.deviceId !== identity.id
        || !Array.isArray(keysReady.conversationIds) || keysReady.conversationIds.length > MAX_CONVERSATIONS
        || keysReady.conversationIds.some(id => !userId(id))) {
      throw new Error("Elenco delle chiavi trasferite non valido.");
    }
    const conversationIds = keysReady.conversationIds as string[];
    if (new Set(conversationIds).size !== conversationIds.length) throw new Error("Conversazioni di migrazione duplicate.");
    let completed = 0;
    for (const conversationId of conversationIds) {
      if (Date.now() >= receiver.hello.expiresAt) throw new Error("La verifica delle chiavi è scaduta.");
      if (!await deps.verifyKeyRing(conversationId, identity)) {
        throw new Error("Una chiave di cronologia non è ancora disponibile. Il client originale è stato mantenuto.");
      }
      progress?.("keys", ++completed, conversationIds.length);
    }
    await send(port, channel, { kind: "commit", userId: state.userId, deviceId: identity.id,
      verifiedConversations: conversationIds.length,
      ...(deps.currentSession ? { session: migrationSession(await deps.currentSession()) } : {}) });
    const finished = await receive(port, channel);
    if (finished.kind !== "finished" || finished.userId !== state.userId) throw new Error("Conferma finale di migrazione mancante.");
    committed = true;
    return { userId: state.userId, deviceId: identity.id, conversations: conversationIds.length, preferenceKeys: changed };
  } catch (error) {
    await port.send({ kind: "cancel" }).catch(() => {});
    throw error;
  } finally { channel?.dispose(); if (committed) await deps.resumeAutoRefresh?.(); }
}

/** Read the original identity without generating a replacement or upgrading its database. */
export async function readOriginalMigrationIdentity(user: string): Promise<DeviceIdentity | null> {
  if (!userId(user)) throw new Error("Account originale non valido.");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("hush-device-keys");
    let absent = false;
    request.onupgradeneeded = () => { absent = true; request.transaction?.abort(); };
    request.onerror = () => { if (absent) resolve(null); else reject(new Error("Chiavi originali non leggibili.")); };
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("identities")) { database.close(); resolve(null); return; }
      const transaction = database.transaction("identities", "readonly"), query = transaction.objectStore("identities").get(user);
      query.onsuccess = () => resolve(query.result ?? null);
      query.onerror = () => reject(new Error("Identità originale non leggibile."));
      transaction.oncomplete = transaction.onabort = () => database.close();
    };
  });
}

export async function productionMigrationSourceDependencies(): Promise<MigrationSourceDependencies> {
  const [{ supabase }, crypto, notification, ringtone] = await Promise.all([
    import("./supabase"), import("./device-crypto"), import("./notification-sound"), import("./ringtone"),
  ]);
  if (!supabase) throw new Error("Servizio Hush non configurato.");
  const backend = supabase;
  return {
    storage: localStorage,
    getSession: async () => {
      const result = await backend.auth.getSession();
      if (result.error) throw result.error;
      let session = result.data.session;
      const expiresAt = (session?.expires_at ?? 0) * 1000;
      // Hand off a token that remains valid for the entire bounded exchange.
      // Refresh in the original client first, so its rollback session is saved.
      if (session && expiresAt <= Date.now() + MIGRATION_LIFETIME_MS + 60_000) {
        const refreshed = await backend.auth.refreshSession();
        if (refreshed.error) throw refreshed.error;
        session = refreshed.data.session;
      }
      return session;
    },
    getUserId: async accessToken => { const result = await backend.auth.getUser(accessToken); if (result.error || !result.data.user) throw new Error("Sessione originale scaduta."); return result.data.user.id; },
    readIdentity: readOriginalMigrationIdentity,
    stopAutoRefresh: () => backend.auth.stopAutoRefresh(), resumeAutoRefresh: () => backend.auth.startAutoRefresh(),
    updateOriginalSession: async session => {
      const result = await backend.auth.setSession(session);
      if (result.error || !result.data.user) throw new Error("Accesso originale non aggiornabile.");
      return result.data.user.id;
    },
    async listConversationIds(identity, expiresAt = Date.now() + MIGRATION_LIFETIME_MS) {
      const result = new Set<string>();
      for (let offset = 0; ; offset += 200) {
        if (Date.now() >= expiresAt) throw new Error("Il trasferimento delle conversazioni è scaduto.");
        const response = await backend.from("conversation_key_envelopes").select("conversation_id")
          .eq("recipient_device_id", identity.id).order("conversation_id").order("key_epoch").range(offset, offset + 199);
        if (response.error) throw response.error;
        for (const row of response.data ?? []) result.add(row.conversation_id);
        if (result.size > MAX_CONVERSATIONS) throw new Error("Troppe conversazioni da trasferire in una sola volta.");
        if ((response.data?.length ?? 0) < 200) return [...result];
      }
    },
    async verifyTargetDevice(user, deviceId) {
      const response = await backend.from("devices").select("id").eq("id", deviceId).eq("user_id", user).is("revoked_at", null).maybeSingle();
      if (response.error) throw response.error;
      return Boolean(response.data);
    },
    async shareKeyRing(conversationId, identity) {
      const key = await crypto.loadConversationKey(conversationId, identity);
      if (!key) throw new Error("Chiave di una conversazione originale non disponibile.");
      await crypto.fulfillPendingKeyRequests(conversationId, key, identity);
    },
    async loadSounds() {
      const [messageSound, callSound] = await Promise.all([notification.loadCustomNotificationSound(), ringtone.loadCustomRingtone()]);
      const result: MigrationSound[] = [];
      if (messageSound) result.push({ id: "notification", name: messageSound.name, type: messageSound.type, size: messageSound.data.size, data: messageSound.data });
      if (callSound) result.push({ id: "ringtone", name: callSound.name, type: callSound.type, size: callSound.data.size, data: callSound.data });
      return result;
    },
    enumerateDevices: () => bestEffortMigrationDevices(async () => navigator.mediaDevices?.enumerateDevices ? navigator.mediaDevices.enumerateDevices() : []),
  };
}

export async function productionMigrationTargetDependencies(): Promise<MigrationTargetDependencies> {
  const [{ supabase }, crypto, notification, ringtone] = await Promise.all([
    import("./supabase"), import("./device-crypto"), import("./notification-sound"), import("./ringtone"),
  ]);
  if (!supabase) throw new Error("Servizio Hush non configurato.");
  const backend = supabase;
  return {
    storage: localStorage,
    currentUserId: async () => pendingMigrationAccount(localStorage) ?? (await backend.auth.getSession()).data.session?.user.id ?? null,
    getUserId: async accessToken => { const result = await backend.auth.getUser(accessToken); if (result.error || !result.data.user) throw new Error("Account di origine non verificabile."); return result.data.user.id; },
    importSession: async session => { const result = await backend.auth.setSession(session); if (result.error || !result.data.user) throw new Error("Impossibile importare l’accesso a Hush."); return result.data.user.id; },
    currentSession: async () => { const result = await backend.auth.getSession(); if (result.error || !result.data.session) throw new Error("Accesso di destinazione non disponibile."); return migrationSession(result.data.session); },
    stopAutoRefresh: () => backend.auth.stopAutoRefresh(), resumeAutoRefresh: () => backend.auth.startAutoRefresh(),
    recordExpectedUser: userId => localStorage.setItem("hush:desktop-migration-pending:v1", JSON.stringify({ version: 1, expectedUserId: userId })),
    createIdentity: crypto.ensureDeviceIdentity,
    verifyKeyRing: async (conversationId, identity) => Boolean(await crypto.loadConversationKey(conversationId, identity)),
    async saveSound(sound) {
      const file = new File([sound.data], sound.name, { type: sound.type });
      if (sound.id === "notification") await notification.saveCustomNotificationSound(file);
      else await ringtone.saveCustomRingtone(file);
    },
    enumerateDevices: () => bestEffortMigrationDevices(async () => navigator.mediaDevices?.enumerateDevices ? navigator.mediaDevices.enumerateDevices() : []),
  };
}
