import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { WindowControls } from "./components/WindowControls";
import { BrandMark } from "./components/BrandMark";
import { readTheme, setThemeAttributes } from "./lib/themes";
import "./styles.css";
import "./ambient-light.css";
import "./apple-polish.css";
import "./chat-experience.css";
import "./mobile.css";
import "./liquid-glass.css";
import "./design-themes.css";
import "./linea-layout.css";
import { Capacitor } from '@capacitor/core';

// Install the Rust bridge before any component captures window.hushWindow.
// Electron and Android keep their existing native integration.
if ('__TAURI_INTERNALS__' in window) {
  const { initTauriRuntime } = await import('./lib/tauri-runtime');
  await initTauriRuntime();
}

// Apply the saved palette before React's first paint, without changing that choice.
setThemeAttributes(readTheme());
const root = createRoot(document.getElementById("root")!);
let migrationFailure: string | undefined;
let pendingMigration = false;
let completedMigration = false;
try {
  pendingMigration = Boolean(localStorage.getItem('hush:desktop-migration-pending:v1'));
  completedMigration = Boolean(localStorage.getItem('hush:desktop-migrated:v1'));
} catch { /* Migration storage guards fail closed independently. */ }
let legacyState: 'ready' | 'update-required' | 'none' = 'none';
if ('__TAURI_INTERNALS__' in window && !completedMigration) {
  legacyState = await window.hushWindow?.getDesktopMigrationSourceState?.().catch(() => undefined)
    ?? (await window.hushWindow?.hasDesktopMigrationSource?.().catch(() => false) ? 'ready' : 'none');
  if (legacyState === 'update-required') {
    const { supabase } = await import('./lib/supabase');
    const session = await supabase?.auth.getSession();
    if (pendingMigration || !session?.data.session) {
      migrationFailure = 'Aggiorna e riavvia prima l’app Hush attuale. Poi riapri questa versione: le chat e le impostazioni saranno trasferite automaticamente.';
    }
  }
}
if ('__TAURI_INTERNALS__' in window && !completedMigration && !migrationFailure && (pendingMigration || legacyState === 'ready')) {
  const preparing = (text: string) => root.render(<StrictMode><WindowControls /><main className="app-loading"><BrandMark size={48} title="Hush" /><span>{text}</span></main></StrictMode>);
  preparing("Preparazione delle tue chat…");
  const { initDesktopMigrationTarget } = await import('./lib/desktop-migration-target');
  const result = await initDesktopMigrationTarget((stage) => preparing(stage === 'keys' ? "Trasferimento sicuro delle chat…" : "Trasferimento delle tue impostazioni…"));
  if (result.status === 'failed') migrationFailure = result.message;
  setThemeAttributes(readTheme());
}

if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('native-app');
  void import('./lib/native-runtime').then(({ initNativeRuntime }) => initNativeRuntime()).catch(() => console.error('Avvio integrazione mobile non riuscito.'));
}

root.render(
  <StrictMode>
    <AppErrorBoundary><WindowControls />{migrationFailure ? <main className="app-loading" role="alert"><BrandMark size={48} title="Hush" /><span>{migrationFailure}</span><button type="button" className="modal-primary" onClick={() => window.location.reload()}>Riprova il trasferimento</button></main> : <App />}</AppErrorBoundary>
  </StrictMode>,
);

// Ordinary Electron startup only subscribes to a lightweight native event.
// The transfer code is parsed only when a verified native request exists.
if (window.hushWindow?.getDesktopMigrationRequest && window.hushWindow.onDesktopMigrationMessage) {
  const native = window.hushWindow;
  let sourceLoading = false;
  let unsubscribe: (() => void) | undefined;
  const startSource = () => {
    if (sourceLoading) return;
    sourceLoading = true;
    void import('./lib/desktop-migration-source').then(({ initElectronMigrationSource }) => initElectronMigrationSource())
      .then(dispose => { unsubscribe?.(); window.addEventListener('beforeunload', dispose, { once: true }); }).catch(() => { sourceLoading = false; });
  };
  unsubscribe = native.onDesktopMigrationMessage!(message => { if (message.kind === 'request') startSource(); });
  void native.getDesktopMigrationRequest!().then(request => { if (request) startSource(); }).catch(() => {});
  window.addEventListener('beforeunload', () => unsubscribe?.(), { once: true });
}
