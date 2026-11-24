type Unlisten = () => void;
type NativeNotification = { title: string; body: string; tag?: string };
type DesktopBridge = HushWindowControls & {
  showNotification: (options: NativeNotification) => Promise<void>;
  onNotificationClick: (listener: () => void) => Unlisten;
};

const DRAG_REGION = ".chat-header, .auth-brand, .app-shell";
const NO_DRAG_REGION = [
  "button", "input", "textarea", "select", "a", "label", "iframe",
  "[role=button]", "[role=slider]", "[role=separator]", "[contenteditable]:not([contenteditable=false])",
  ".window-controls", ".sidebar-scroll", ".messages", ".chat-content",
  ".member-sidebar", ".media-stage", ".room-music", ".composer", ".modal-card",
].join(", ");
const MAX_WRITE_BYTES = 8 * 1024 * 1024;

export function validTauriLink(value: unknown): boolean {
  return typeof value === "string" && /^hush:\/\/(invite\/[a-f0-9]{48}|channel\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/?$/i.test(value);
}

export function isWindowDragTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(DRAG_REGION)) && !target.closest(NO_DRAG_REGION);
}

let initialization: Promise<Unlisten | null> | undefined;

/** Install the existing desktop contract before React renders; other runtimes are untouched. */
export function initTauriRuntime(): Promise<Unlisten | null> {
  if (typeof window === "undefined" || window.hushWindow) return Promise.resolve(null);
  if (!initialization) {
    initialization = initialize().catch(error => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}

async function initialize(): Promise<Unlisten | null> {
  const { isTauri, invoke } = await import("@tauri-apps/api/core");
  if (!isTauri()) {
    initialization = undefined;
    return null;
  }
  const [{ getCurrentWindow }, { listen }] = await Promise.all([
    import("@tauri-apps/api/window"), import("@tauri-apps/api/event"),
  ]);
  const currentWindow = getCurrentWindow();
  const unlisteners: Unlisten[] = [];
  const maximizeListeners = new Set<(maximized: boolean) => void>();
  const notificationListeners = new Set<() => void>();
  const updateListeners = new Set<(status: HushUpdateStatus) => void>();
  const migrationListeners = new Set<(message: import('./migration-transport').MigrationWireMessage) => void>();
  const downloads = new Set<AbortController>();
  let active = true;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let resizeRevision = 0;
  let lastMaximized: boolean | undefined;
  let receivedLiveLink = false;
  let bridge: DesktopBridge | undefined;

  const nativeError = (message: string) => {
    if (active) document.dispatchEvent(new CustomEvent("hush:native-error", { detail: message }));
  };
  const fire = (operation: Promise<unknown>) => { void operation.catch(() => nativeError("Impossibile completare l’operazione della finestra.")); };
  const receiveLink = (url: unknown) => {
    if (!active || typeof url !== "string" || !validTauriLink(url)) return;
    sessionStorage.setItem("hush:pending-link", url.replace(/\/$/, ""));
    document.dispatchEvent(new Event("hush:link"));
  };
  const updateMaximized = () => {
    const revision = ++resizeRevision;
    void currentWindow.isMaximized().then(maximized => {
      if (!active || revision !== resizeRevision || lastMaximized === maximized) return;
      lastMaximized = maximized;
      for (const callback of maximizeListeners) callback(maximized);
    }).catch(() => { /* A closing window has no state left to publish. */ });
  };
  const onMouseDown = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || !isWindowDragTarget(event.target)) return;
    event.preventDefault();
    // Tauri does not interpret Electron's CSS app-region property.
    fire(event.detail === 2 ? currentWindow.toggleMaximize() : currentWindow.startDragging());
  };
  const saveBlob = async (anchor: HTMLAnchorElement) => {
    const controller = new AbortController();
    downloads.add(controller);
    let token: string | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let finished = false;
    try {
      // Acquire the blob before the dialog; its URL may be revoked while the
      // user chooses a destination. The body is consumed one block at a time.
      const response = await fetch(anchor.href, { signal: controller.signal });
      if (!response.ok || !response.body) throw new Error("Allegato non disponibile.");
      reader = response.body.getReader();
      token = await bridge!.beginAttachmentSave!(anchor.download || "allegato");
      if (!token) return;
      controller.signal.throwIfAborted();
      let index = 0;
      for (;;) {
        controller.signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        for (let offset = 0; offset < value.byteLength; offset += MAX_WRITE_BYTES) {
          controller.signal.throwIfAborted();
          await bridge!.writeAttachmentSave!(token, index++, value.subarray(offset, offset + MAX_WRITE_BYTES));
        }
      }
      controller.signal.throwIfAborted();
      await bridge!.finishAttachmentSave!(token);
      finished = true;
    } catch (error) {
      if (!controller.signal.aborted) nativeError(error instanceof Error ? error.message : "Impossibile salvare il file.");
    } finally {
      await reader?.cancel().catch(() => undefined);
      if (token && !finished) await bridge!.abortAttachmentSave!(token).catch(() => undefined);
      downloads.delete(controller);
    }
  };
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    const anchor = event.target.closest<HTMLAnchorElement>("a");
    if (!anchor) return;
    if (validTauriLink(anchor.href)) {
      event.preventDefault();
      receiveLink(anchor.href);
    } else if (anchor.hasAttribute("download") && anchor.href.startsWith("blob:")) {
      event.preventDefault();
      void saveBlob(anchor);
    }
  };
  const dispose = () => {
    if (!active) return;
    active = false;
    if (resizeTimer !== undefined) clearTimeout(resizeTimer);
    for (const controller of downloads) controller.abort();
    for (const unlisten of unlisteners.splice(0)) unlisten();
    maximizeListeners.clear();
    notificationListeners.clear();
    updateListeners.clear();
    migrationListeners.clear();
    document.removeEventListener("mousedown", onMouseDown);
    document.removeEventListener("click", onClick);
    window.removeEventListener("beforeunload", dispose);
    if (window.hushWindow === bridge) delete window.hushWindow;
    initialization = undefined;
  };

  try {
    await invoke<string>("native_version");
    bridge = {
      hasDesktopMigrationSource: () => invoke<boolean>("native_migration_has_source"),
      getDesktopMigrationSourceState: () => invoke('native_migration_source_status'),
      beginDesktopMigration: hello => invoke<boolean>("native_migration_begin", { hello }),
      sendDesktopMigrationMessage: message => invoke<void>("native_migration_send", { message }),
      finishDesktopMigration: () => invoke<void>("native_migration_finish"),
      onDesktopMigrationMessage: callback => { migrationListeners.add(callback); return () => { migrationListeners.delete(callback); }; },
      copyText: text => invoke<void>("native_copy_text", { text }),
      setCallActive: active => invoke<void>("native_set_call_active", { active }),
      minimize: () => fire(currentWindow.minimize()),
      toggleMaximize: () => fire(currentWindow.toggleMaximize()),
      close: () => fire(currentWindow.close()),
      isMaximized: () => currentWindow.isMaximized(),
      setMaterial: enabled => invoke<boolean>("native_set_material", { enabled }),
      onMaximizedChange: callback => { maximizeListeners.add(callback); return () => { maximizeListeners.delete(callback); }; },
      getUpdateStatus: () => invoke<HushUpdateStatus>("native_updates_get_status"),
      checkForUpdates: () => invoke<HushUpdateStatus>("native_updates_check"),
      installUpdate: () => invoke<void>("native_updates_install"),
      onUpdateStatus: callback => { updateListeners.add(callback); return () => { updateListeners.delete(callback); }; },
      searchMusic: (query, provider = "youtube") => invoke("native_search_music", { query, provider }),
      requestCallRelay: (accessToken, conversationId) => invoke<unknown>("native_call_relay", { accessToken, conversationId }),
      showNotification: options => invoke<void>("native_show_notification", { options }),
      onNotificationClick: callback => { notificationListeners.add(callback); return () => { notificationListeners.delete(callback); }; },
      beginAttachmentSave: name => invoke<string | null>("attachment_save_begin", { name }),
      writeAttachmentSave: (token, index, bytes) => invoke<void>("attachment_save_write", bytes, {
        headers: { "x-hush-token": token, "x-hush-index": String(index) },
      }),
      finishAttachmentSave: token => invoke<void>("attachment_save_finish", { token }),
      abortAttachmentSave: token => invoke<void>("attachment_save_abort", { token }),
      // Drive credentials remain on the shared service, never in this webview.
      isGDriveConfigured: async () => false,
      getGDriveSetupCode: async () => { throw new Error("Il collegamento Google Drive è gestito dall’archiviazione condivisa."); },
      importGDriveSetupCode: async () => { throw new Error("L’importazione di credenziali è disattivata. Usa l’archiviazione condivisa di Hush."); },
    };
    unlisteners.push(await currentWindow.onResized(() => {
      if (resizeTimer !== undefined) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(updateMaximized, 32);
    }));
    unlisteners.push(await listen("native_notification_clicked", () => {
      if (active) for (const callback of notificationListeners) callback();
    }));
    unlisteners.push(await listen<HushUpdateStatus>("native_update_status", event => {
      if (active) for (const callback of updateListeners) callback(event.payload);
    }));
    unlisteners.push(await listen<import('./migration-transport').MigrationWireMessage>("native_migration_message", event => {
      if (active) for (const callback of migrationListeners) callback(event.payload);
    }));
    unlisteners.push(await listen<string>("hush:deep-link", event => {
      if (validTauriLink(event.payload)) receivedLiveLink = true;
      receiveLink(event.payload);
    }));
    // Subscribe first so a second-instance link cannot be lost during startup.
    const pendingLink = await invoke<string | null>("native_pending_link");
    window.hushWindow = bridge;
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("click", onClick);
    window.addEventListener("beforeunload", dispose, { once: true });
    if (!receivedLiveLink) receiveLink(pendingLink);
    return dispose;
  } catch (error) {
    dispose();
    throw error;
  }
}
