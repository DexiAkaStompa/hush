import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { WindowControls } from "./components/WindowControls";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary><WindowControls /><App /></AppErrorBoundary>
  </StrictMode>,
);
