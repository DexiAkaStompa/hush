import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { WindowControls } from "./components/WindowControls";
import "./styles.css";
import "./ambient-light.css";
import "./apple-polish.css";
import "./chat-experience.css";
import "./mobile.css";
import { Capacitor } from '@capacitor/core';

if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('native-app');
  void import('./lib/native-runtime').then(({ initNativeRuntime }) => initNativeRuntime()).catch(() => console.error('Avvio integrazione mobile non riuscito.'));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary><WindowControls /><App /></AppErrorBoundary>
  </StrictMode>,
);
