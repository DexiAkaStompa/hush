/// <reference types="vite/client" />

interface HushWindowControls {
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
}

interface Window {
  hushWindow?: HushWindowControls;
}
