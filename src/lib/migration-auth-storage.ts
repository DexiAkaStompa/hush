const PENDING = "hush:desktop-migration-pending:v1";
const COMPLETED = "hush:desktop-migrated:v1";
type AuthStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

export function pendingMigrationAccount(storage: Pick<Storage, "getItem">): string | null {
  try {
    const marker = JSON.parse(storage.getItem(PENDING) ?? "null");
    return marker && typeof marker.expectedUserId === "string" && UUID.test(marker.expectedUserId)
      ? marker.expectedUserId : null;
  } catch { return null; }
}

/**
 * A failed target may hold an obsolete copy of the source's rotating refresh
 * token. Hide/discard only that uncommitted target auth entry BEFORE creating
 * Supabase, whose constructor otherwise schedules an immediate refresh tick.
 * This never signs out/revokes the source session or touches its profile.
 */
export function preparePendingMigrationAuth(projectUrl: string | undefined,
  options: { isTauri?: boolean; storage?: AuthStorage } = {}): AuthStorage | undefined {
  const isTauri = options.isTauri ?? (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window);
  if (!isTauri || !projectUrl) return undefined;
  let storage = options.storage;
  if (!storage) { try { storage = window.localStorage; } catch { /* Use a gated memory store below. */ } }
  try {
    if (storage?.getItem(COMPLETED)) return undefined;
    if (storage && !storage.getItem(PENDING)) return undefined;
  } catch { /* Unknown/blocked marker state must not expose a possibly stale token. */ }
  let authKey: string;
  try { authKey = `sb-${new URL(projectUrl).hostname.split(".")[0]}-auth-token`; }
  catch { throw new Error("Configurazione dell’accesso a Hush non valida."); }
  try { storage?.removeItem(authKey); } catch { /* The read gate still prevents token reuse. */ }
  let unlocked = false;
  const memory = new Map<string, string>();
  const freshSession = (value: string) => {
    try {
      const session = JSON.parse(value);
      const expected = storage ? pendingMigrationAccount(storage) : null;
      return typeof session?.access_token === "string" && session.access_token.length > 0 && session.access_token.length <= 16_384
        && typeof session.refresh_token === "string" && session.refresh_token.length > 0 && session.refresh_token.length <= 16_384
        && typeof session.user?.id === "string" && UUID.test(session.user.id)
        && (!expected || expected === session.user.id);
    } catch { return false; }
  };
  return {
    getItem(key) {
      if (key === authKey && !unlocked) return null;
      if (memory.has(key)) return memory.get(key)!;
      try { return storage?.getItem(key) ?? null; } catch { return null; }
    },
    setItem(key, value) {
      // Supabase calls this after its authenticated setSession/sign-in flow.
      // Merely writing unrelated storage or invalid JSON does not open the gate.
      const release = key === authKey && freshSession(value);
      if (key === authKey && !release) return;
      try { storage?.setItem(key, value); if (!storage) memory.set(key, value); else memory.delete(key); }
      catch { memory.set(key, value); }
      if (release) unlocked = true;
    },
    removeItem(key) {
      memory.delete(key);
      if (key === authKey) unlocked = false;
      try { storage?.removeItem(key); } catch { /* Never reopen an old disk value after a failed remove. */ }
    },
  };
}
