import { runMigrationSource, productionMigrationSourceDependencies, type MigrationPort } from "./desktop-migration";
import type { MigrationHello, MigrationWireMessage } from "./migration-transport";

type SourceBridge = {
  getDesktopMigrationRequest: () => Promise<MigrationHello | null>;
  sendDesktopMigrationMessage: (message: MigrationWireMessage) => Promise<void>;
  onDesktopMigrationMessage: (listener: (message: MigrationWireMessage) => void) => () => void;
  finishDesktopMigration: () => Promise<void>;
};

/** Called only for the native Electron preload contract; never from a URL. */
export async function initElectronMigrationSource(): Promise<() => void> {
  const bridge = window.hushWindow as unknown as Partial<SourceBridge> | undefined;
  if (!bridge?.getDesktopMigrationRequest || !bridge.sendDesktopMigrationMessage
      || !bridge.onDesktopMigrationMessage || !bridge.finishDesktopMigration) return () => {};
  const native = bridge as SourceBridge;
  const seen = new Set<string>();
  let active = true, running = false, cancelled = false;
  let queue: MigrationWireMessage[] = [];
  let waiting: { resolve: (message: MigrationWireMessage) => void; reject: (error: Error) => void } | undefined;
  const interrupt = () => {
    cancelled = true;
    waiting?.reject(new Error("Trasferimento di Hush interrotto.")); waiting = undefined; queue = [];
  };
  const port: MigrationPort = {
    send: message => native.sendDesktopMigrationMessage(message),
    receive: () => {
      if (!active || cancelled) return Promise.reject(new Error("Client originale chiuso."));
      const message = queue.shift();
      if (message) return Promise.resolve(message);
      if (waiting) return Promise.reject(new Error("Lettura di migrazione già in corso."));
      return new Promise((resolve, reject) => { waiting = { resolve, reject }; });
    },
  };
  const start = (hello: MigrationHello) => {
    if (!active || running || seen.has(hello.id)) return;
    seen.add(hello.id); running = true; cancelled = false;
    void (async () => {
      try {
        // Keep an existing live call untouched. The launcher can retry the
        // handoff after that call ends; it never forcibly closes this client.
        if (hasActiveMigrationCall(document)) {
          throw new Error("Concludi la chiamata prima del trasferimento a Hush.");
        }
        const dependencies = await productionMigrationSourceDependencies();
        await runMigrationSource(hello, port, dependencies);
        await native.finishDesktopMigration();
      } catch {
        await native.sendDesktopMigrationMessage({ kind: "cancel" }).catch(() => {});
        if (active) document.dispatchEvent(new CustomEvent("hush:native-error", { detail:
          "Il trasferimento non è stato completato. I dati del client originale sono stati mantenuti." }));
      } finally { running = false; interrupt(); }
    })();
  };
  const unsubscribe = native.onDesktopMigrationMessage(message => {
    if (!active) return;
    if (message.kind === "request") { start(message.hello); return; }
    if (!running) return;
    if (message.kind === "cancel") { interrupt(); return; }
    if (waiting) { const receiver = waiting; waiting = undefined; receiver.resolve(message); }
    else if (queue.length < 4) queue.push(message);
    else { interrupt(); void native.sendDesktopMigrationMessage({ kind: "cancel" }).catch(() => {}); }
  });
  try {
    const request = await native.getDesktopMigrationRequest();
    if (request) start(request);
  } catch { /* The ordinary client remains usable when no handoff is available. */ }
  return () => { active = false; unsubscribe(); interrupt(); };
}

export function hasActiveMigrationCall(root: Pick<Document, "querySelector">): boolean {
  return Boolean(root.querySelector(".desktop-call-widget,.media-stage,.incoming-call-card"));
}
