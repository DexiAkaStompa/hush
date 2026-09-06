/// <reference types="vite/client" />

interface HushWindowControls {
  copyText: (text: string) => Promise<void>;
  getUpdateStatus: () => Promise<HushUpdateStatus>;
  checkForUpdates: () => Promise<HushUpdateStatus>;
  installUpdate: () => Promise<void>;
  onUpdateStatus: (listener: (status: HushUpdateStatus) => void) => () => void;
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (listener: (maximized: boolean) => void) => () => void;
  searchMusic: (query: string, provider?: "youtube" | "spotify") => Promise<Array<{
    title: string;
    author: string;
    url: string;
    artworkUrl: string | null;
    length: number;
  }>>;
  isGDriveConfigured?: () => Promise<boolean>;
  uploadGDriveMedia?: (payload: { name: string; data: number[] | Uint8Array; mimeType?: string }) => Promise<{
    fileId: string;
    downloadUrl: string;
  }>;
  downloadGDriveMedia?: (payload: { fileId: string; downloadUrl?: string }) => Promise<number[] | Uint8Array>;
  getGDriveSetupCode?: () => Promise<string>;
  importGDriveSetupCode?: (code: string) => Promise<boolean>;
}

interface Window {
  hushWindow?: HushWindowControls;
}

interface ImportMetaEnv {
  readonly VITE_MUSIC_BRIDGE_URL?: string;
}

interface HushUpdateStatus {
  status: "disabled" | "idle" | "checking" | "available" | "current" | "downloading" | "downloaded" | "error";
  currentVersion: string;
  version?: string;
  percent?: number;
  message?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
