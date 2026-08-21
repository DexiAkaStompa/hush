export {};

declare global {
  interface Window {
    hushPicker: {
      onSources: (callback: (sources: Array<{ id: string; name: string; thumbnail: string }>) => void) => void;
      select: (sourceId: string) => void;
      cancel: () => void;
    };
  }
}
