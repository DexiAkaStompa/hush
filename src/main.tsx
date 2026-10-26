import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { WindowControls } from "./components/WindowControls";
import { readTheme } from "./lib/themes";
import "./styles.css";
import "./ambient-light.css";
import "./apple-polish.css";
import "./chat-experience.css";
import "./mobile.css";
import "./liquid-glass.css";
import { Capacitor } from '@capacitor/core';

// Apply the saved palette before React's first paint, without changing that choice.
document.documentElement.dataset.theme = readTheme();

if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('native-app');
  void import('./lib/native-runtime').then(({ initNativeRuntime }) => initNativeRuntime()).catch(() => console.error('Avvio integrazione mobile non riuscito.'));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary><WindowControls /><App /></AppErrorBoundary>
  </StrictMode>,
);
