/// <reference types="vite/client" />

interface HushWindowControls {
  hasDesktopMigrationSource?: () => Promise<boolean>;
  getDesktopMigrationSourceState?: () => Promise<'ready' | 'update-required' | 'none'>;
  beginDesktopMigration?: (hello: import('./lib/migration-transport').MigrationHello) => Promise<boolean>;
  getDesktopMigrationRequest?: () => Promise<import('./lib/migration-transport').MigrationHello | null>;
  sendDesktopMigrationMessage?: (message: import('./lib/migration-transport').MigrationWireMessage) => Promise<void>;
  onDesktopMigrationMessage?: (listener: (message: import('./lib/migration-transport').MigrationWireMessage) => void) => () => void;
  finishDesktopMigration?: () => Promise<void>;
  setCallActive?: (active: boolean, workspaceReady?: boolean) => Promise<void>;
  copyText: (text: string) => Promise<void>;
  getUpdateStatus: () => Promise<HushUpdateStatus>;
  checkForUpdates: () => Promise<HushUpdateStatus>;
  installUpdate: () => Promise<void>;
  onUpdateStatus: (listener: (status: HushUpdateStatus) => void) => () => void;
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  setMaterial?: (enabled: boolean) => Promise<boolean>;
  onMaximizedChange: (listener: (maximized: boolean) => void) => () => void;
  requestCallRelay?: (accessToken: string, conversationId: string) => Promise<unknown>;
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
  beginAttachmentSave?: (name: string) => Promise<string | null>;
  writeAttachmentSave?: (token: string, index: number, bytes: Uint8Array) => Promise<void>;
  finishAttachmentSave?: (token: string) => Promise<void>;
  abortAttachmentSave?: (token: string) => Promise<void>;
  getGDriveSetupCode?: () => Promise<string>;
  importGDriveSetupCode?: (code: string) => Promise<boolean>;
}

interface Window {
  hushWindow?: HushWindowControls;
}

interface ImportMetaEnv {
  readonly VITE_SHARED_MEDIA_URL?: string;
  readonly VITE_MUSIC_BRIDGE_URL?: string;
}

interface HushUpdateStatus {
  status: "disabled" | "idle" | "checking" | "available" | "current" | "downloading" | "downloaded" | "installing" | "error";
  currentVersion: string;
  target?: "rust";
  version?: string;
  percent?: number;
  message?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
