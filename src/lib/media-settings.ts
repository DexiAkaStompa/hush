import { useSyncExternalStore } from "react";

export type MediaSettings = {
  inputId: string;
  outputId: string;
  cameraId: string;
  inputVolume: number;
  outputVolume: number;
  noise: "standard" | "rnnoise" | "off";
  echoCancellation: boolean;
  autoGainControl: boolean;
};

export const DEFAULT_MEDIA_SETTINGS: MediaSettings = {
  inputId: "", outputId: "", cameraId: "", inputVolume: 100, outputVolume: 100,
  noise: "rnnoise", echoCancellation: true, autoGainControl: true,
};
const KEY = "hush:media:v1";
export function normalizeMediaSettings(value: unknown): MediaSettings {
  const data = value && typeof value === "object" ? value as Partial<MediaSettings> : {};
  const volume = (n: unknown, max: number) => typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 100;
  const device = (id: unknown) => typeof id === "string" ? id.slice(0, 512) : "";
  return {
    inputId: device(data.inputId), outputId: device(data.outputId), cameraId: device(data.cameraId),
    inputVolume: volume(data.inputVolume, 200), outputVolume: volume(data.outputVolume, 100),
    noise: data.noise === "off" || data.noise === "standard" ? data.noise : "rnnoise",
    echoCancellation: data.echoCancellation !== false, autoGainControl: data.autoGainControl !== false,
  };
}
function read(): MediaSettings {
  try { return normalizeMediaSettings(JSON.parse(localStorage.getItem(KEY) ?? "null")); }
  catch { return { ...DEFAULT_MEDIA_SETTINGS }; }
}
let current = read();
const listeners = new Set<() => void>();
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function updateMediaSettings(patch: Partial<MediaSettings>) {
  const next = normalizeMediaSettings({ ...current, ...patch });
  localStorage.setItem(KEY, JSON.stringify(next));
  current = next;
  listeners.forEach((listener) => listener());
}
if (typeof window !== "undefined") window.addEventListener("storage", (event) => {
  if (event.key !== KEY && event.key !== null) return;
  current = read();
  listeners.forEach((listener) => listener());
});
export function useMediaSettings() { return useSyncExternalStore(subscribe, () => current); }

export function microphoneConstraints(settings: MediaSettings): MediaTrackConstraints {
  return {
    deviceId: settings.inputId ? { exact: settings.inputId } : undefined,
    noiseSuppression: settings.noise === "standard",
    echoCancellation: settings.echoCancellation,
    autoGainControl: settings.autoGainControl,
    channelCount: 1,
  };
}
export async function routeAudio(element: HTMLMediaElement, settings: Pick<MediaSettings, "outputId" | "outputVolume">) {
  element.volume = settings.outputVolume / 100;
  if ("setSinkId" in element) await element.setSinkId(settings.outputId);
  else if (settings.outputId) throw new Error("La selezione dell’uscita audio non è supportata da questo browser.");
}
