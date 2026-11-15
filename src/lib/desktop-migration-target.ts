import { createMigrationReceiver, type MigrationHello, type MigrationWireMessage } from "./migration-transport";
import { productionMigrationTargetDependencies, runMigrationTarget, type MigrationPort, type MigrationProgress } from "./desktop-migration";

const COMPLETED_KEY = "hush:desktop-migrated:v1";
const PENDING_KEY = "hush:desktop-migration-pending:v1";
type TargetBridge = {
  hasDesktopMigrationSource: () => Promise<boolean>;
  beginDesktopMigration: (hello: MigrationHello) => Promise<boolean>;
  sendDesktopMigrationMessage: (message: MigrationWireMessage) => Promise<void>;
  onDesktopMigrationMessage: (listener: (message: MigrationWireMessage) => void) => () => void;
  finishDesktopMigration: () => Promise<void>;
};
export type DesktopMigrationResult = { status: "skipped" | "completed" | "failed"; message?: string };
let pending: Promise<DesktopMigrationResult> | undefined;

/** Run before React mounts; an incomplete history handoff must never look like a finished startup. */
export function initDesktopMigrationTarget(progress?: MigrationProgress): Promise<DesktopMigrationResult> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return Promise.resolve({ status: "skipped" });
  if (!pending) pending = initialize(progress).finally(() => { pending = undefined; });
  return pending;
}
async function initialize(progress?: MigrationProgress): Promise<DesktopMigrationResult> {
  const candidate = window.hushWindow as unknown as Partial<TargetBridge> | undefined;
  if (!candidate?.hasDesktopMigrationSource || !candidate.beginDesktopMigration || !candidate.sendDesktopMigrationMessage
      || !candidate.onDesktopMigrationMessage || !candidate.finishDesktopMigration) return { status: "skipped" };
  const native = candidate as TargetBridge;
  let unsubscribe: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false, began = false;
  const queue: MigrationWireMessage[] = [];
  let waiter: { resolve: (message: MigrationWireMessage) => void; reject: (error: Error) => void } | undefined;
  const interrupt = () => {
    cancelled = true;
    waiter?.reject(new Error("Trasferimento di Hush interrotto.")); waiter = undefined; queue.length = 0;
  };
  try {
    if (localStorage.getItem(COMPLETED_KEY)) return { status: "skipped" };
    const isRetry = Boolean(localStorage.getItem(PENDING_KEY));
    const { supabase } = await import("./supabase");
    if (!supabase) return { status: "skipped" };
    const session = await supabase.auth.getSession();
    if (session.error && !isRetry) throw session.error;
    if (session.data.session && !isRetry) return { status: "skipped" };
    if (!await native.hasDesktopMigrationSource()) {
      if (isRetry) throw new Error("Il trasferimento originale deve ancora essere completato.");
      return { status: "skipped" };
    }
    const dependencies = await productionMigrationTargetDependencies();
    const receiver = await createMigrationReceiver();
    const port: MigrationPort = {
      send: message => native.sendDesktopMigrationMessage(message),
      receive: () => {
        if (cancelled) return Promise.reject(new Error("Trasferimento di Hush interrotto."));
        const message = queue.shift();
        if (message) return Promise.resolve(message);
        if (waiter) return Promise.reject(new Error("Lettura di migrazione già in corso."));
        return new Promise((resolve, reject) => { waiter = { resolve, reject }; });
      },
    };
    unsubscribe = native.onDesktopMigrationMessage(message => {
      if (cancelled) return;
      if (message.kind === "cancel") { interrupt(); return; }
      if (waiter) { const current = waiter; waiter = undefined; current.resolve(message); }
      else if (queue.length < 4) queue.push(message);
      else { interrupt(); void native.sendDesktopMigrationMessage({ kind: "cancel" }).catch(() => {}); }
    });
    // A crash/closed window leaves only a non-sensitive retry marker. The
    // original Electron profile and identity remain the rollback source.
    localStorage.setItem(PENDING_KEY, "1");
    timer = setTimeout(() => {
      interrupt(); void native.sendDesktopMigrationMessage({ kind: "cancel" }).catch(() => {});
    }, Math.max(1, receiver.hello.expiresAt - Date.now()));
    began = await native.beginDesktopMigration(receiver.hello);
    if (!began) {
      throw new Error("Il client originale non ha avviato il trasferimento.");
    }
    const result = await runMigrationTarget(receiver, port, dependencies, progress);
    localStorage.setItem(COMPLETED_KEY, JSON.stringify({ version: 1, userId: result.userId, at: Date.now() }));
    localStorage.removeItem(PENDING_KEY);
    // Preferences were imported after some shared modules had initialized.
    // Notify their existing storage listeners before rendering the app.
    for (const key of result.preferenceKeys) {
      window.dispatchEvent(new StorageEvent("storage", { key, newValue: localStorage.getItem(key) }));
    }
    await native.finishDesktopMigration().catch(() => {});
    return { status: "completed" };
  } catch {
    if (began) await native.sendDesktopMigrationMessage({ kind: "cancel" }).catch(() => {});
    return { status: "failed", message:
      "Il trasferimento non è stato completato. Le chat e le impostazioni originali sono ancora nel vecchio client. Riprova il trasferimento prima di continuare." };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    unsubscribe?.(); interrupt();
  }
}
