import { expect, it, vi } from "vitest";
import { pendingMigrationAccount, preparePendingMigrationAuth } from "./migration-auth-storage";

const PROJECT = "https://abcdefgh.supabase.co", AUTH = "sb-abcdefgh-auth-token";
const USER = "11111111-2222-4333-8444-555555555555", OTHER = "22222222-2222-4333-8444-555555555555";
const PENDING = "hush:desktop-migration-pending:v1", COMPLETED = "hush:desktop-migrated:v1";
function store(entries: Record<string, string>) {
  const values = new Map(Object.entries(entries));
  return { values, getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }) };
}
const session = (userId = USER) => JSON.stringify({ access_token: "fresh-access-token-value", refresh_token: "fresh-refresh-token-value", user: { id: userId } });
it("does not change browser, Electron, Android or ordinary/completed Rust auth storage", () => {
  for (const options of [
    { isTauri: false, storage: store({ [PENDING]: "1", [AUTH]: "old" }) },
    { isTauri: true, storage: store({ [AUTH]: "normal" }) },
    { isTauri: true, storage: store({ [PENDING]: "1", [COMPLETED]: "1", [AUTH]: "completed" }) },
  ]) {
    expect(preparePendingMigrationAuth(PROJECT, options)).toBeUndefined();
    expect(options.storage.removeItem).not.toHaveBeenCalled();
  }
});
it("removes only the uncommitted target auth entry for this exact project before SDK creation", () => {
  const storage = store({ [PENDING]: "1", [AUTH]: "stale-copy", "sb-otherproject-auth-token": "other", "hush-theme": "nord" });
  const guarded = preparePendingMigrationAuth(PROJECT, { isTauri: true, storage })!;
  expect(storage.removeItem).toHaveBeenCalledWith(AUTH);
  expect(storage.values.get("sb-otherproject-auth-token")).toBe("other");
  expect(storage.values.get("hush-theme")).toBe("nord");
  expect(guarded.getItem(AUTH)).toBeNull();
  guarded.setItem(AUTH, session());
  expect(guarded.getItem(AUTH)).toBe(session());
});
it("fails closed if disk removal or reads are blocked, then accepts a fresh verified in-memory handoff", () => {
  const storage = store({ [PENDING]: "1", [AUTH]: "stale-copy" });
  storage.removeItem.mockImplementation(() => { throw new Error("blocked"); });
  storage.setItem.mockImplementation(() => { throw new Error("blocked"); });
  const guarded = preparePendingMigrationAuth(PROJECT, { isTauri: true, storage })!;
  expect(storage.values.get(AUTH)).toBe("stale-copy");
  expect(guarded.getItem(AUTH)).toBeNull();
  guarded.setItem(AUTH, session());
  expect(guarded.getItem(AUTH)).toBe(session());
  guarded.removeItem(AUTH);
  expect(guarded.getItem(AUTH)).toBeNull();
});
it("does not expose a copied token when marker reads fail but auth storage can still be read", () => {
  const storage = store({ [AUTH]: "stale-copy" });
  storage.getItem.mockImplementation(key => { if (key !== AUTH) throw new Error("blocked marker"); return "stale-copy"; });
  storage.removeItem.mockImplementation(() => { throw new Error("blocked"); });
  expect(preparePendingMigrationAuth(PROJECT, { isTauri: true, storage })!.getItem(AUTH)).toBeNull();
});
it("replaces an in-memory fallback when a later fresh session can be persisted", () => {
  const storage = store({ [PENDING]: "1" });
  const guarded = preparePendingMigrationAuth(PROJECT, { isTauri: true, storage })!;
  storage.setItem.mockImplementationOnce(() => { throw new Error("temporarily blocked"); });
  guarded.setItem(AUTH, session());
  const latest = JSON.stringify({ access_token: "later-access-token-value", refresh_token: "later-refresh-token-value", user: { id: USER } });
  guarded.setItem(AUTH, latest);
  expect(guarded.getItem(AUTH)).toBe(latest);
  expect(storage.values.get(AUTH)).toBe(latest);
});
it("keeps the gate closed for malformed writes or another account than the pending migration", () => {
  const storage = store({ [PENDING]: JSON.stringify({ version: 1, expectedUserId: USER }) });
  const guarded = preparePendingMigrationAuth(PROJECT, { isTauri: true, storage })!;
  guarded.setItem(AUTH, "not-a-session"); expect(guarded.getItem(AUTH)).toBeNull();
  guarded.setItem(AUTH, session(OTHER)); expect(guarded.getItem(AUTH)).toBeNull();
  guarded.setItem(AUTH, session(USER)); expect(guarded.getItem(AUTH)).toBe(session(USER));
  expect(pendingMigrationAccount(storage)).toBe(USER);
  expect(pendingMigrationAccount(store({ [PENDING]: "1" }))).toBeNull();
});
it("accepts server-verified legacy opaque refresh tokens shorter than sixteen characters", () => {
  const storage = store({ [PENDING]: JSON.stringify({ version: 1, expectedUserId: USER }) });
  const guarded = preparePendingMigrationAuth(PROJECT, { isTauri: true, storage })!;
  const value = JSON.stringify({ access_token: "server-verified-access-token", refresh_token: "0123456789ab", user: { id: USER } });
  guarded.setItem(AUTH, value);
  expect(guarded.getItem(AUTH)).toBe(value);
});
