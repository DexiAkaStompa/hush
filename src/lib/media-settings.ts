import { useSyncExternalStore } from "react";

export type VideoQuality = "720p" | "1080p" | "1440p";
export type AudioQuality = "standard" | "high" | "ultra";

export type MediaSettings = {
  inputId: string;
  outputId: string;
  cameraId: string;
  inputVolume: number;
  outputVolume: number;
  noise: "standard" | "rnnoise" | "off";
  echoCancellation: boolean;
  autoGainControl: boolean;
  videoQuality: VideoQuality;
  audioQuality: AudioQuality;
  screenFps: 30 | 60;
};

export const DEFAULT_MEDIA_SETTINGS: MediaSettings = {
  inputId: "", outputId: "", cameraId: "", inputVolume: 100, outputVolume: 100,
  noise: "rnnoise", echoCancellation: true, autoGainControl: true,
  videoQuality: "1080p", audioQuality: "high", screenFps: 60,
};
const KEY = "hush:media:v1";
export function normalizeMediaSettings(value: unknown): MediaSettings {
  const data = value && typeof value === "object" ? value as Partial<MediaSettings> : {};
  const volume = (n: unknown, max: number) => typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 100;
  const device = (id: unknown) => typeof id === "string" ? id.slice(0, 512) : "";
  const videoQuality: VideoQuality =
    data.videoQuality === "720p" || data.videoQuality === "1440p" ? data.videoQuality : "1080p";
  const audioQuality: AudioQuality =
    data.audioQuality === "standard" || data.audioQuality === "ultra" ? data.audioQuality : "high";
  const screenFps = data.screenFps === 30 ? 30 : 60;
  return {
    inputId: device(data.inputId), outputId: device(data.outputId), cameraId: device(data.cameraId),
    inputVolume: volume(data.inputVolume, 200), outputVolume: volume(data.outputVolume, 100),
    noise: data.noise === "off" || data.noise === "standard" ? data.noise : "rnnoise",
    echoCancellation: data.echoCancellation !== false, autoGainControl: data.autoGainControl !== false,
    videoQuality, audioQuality, screenFps,
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
    sampleRate: { ideal: 48000 },
    sampleSize: { ideal: 16 },
  };
}

export function cameraConstraints(settings: MediaSettings): MediaTrackConstraints {
  const quality = settings.videoQuality;
  const resolutions: Record<VideoQuality, { width: number; height: number; idealFps: number }> = {
    "720p": { width: 1280, height: 720, idealFps: 30 },
    "1080p": { width: 1920, height: 1080, idealFps: 30 },
    "1440p": { width: 2560, height: 1440, idealFps: 60 },
  };
  const target = resolutions[quality] || resolutions["1080p"];

  return {
    deviceId: settings.cameraId ? { exact: settings.cameraId } : undefined,
    width: { ideal: target.width, min: 640 },
    height: { ideal: target.height, min: 480 },
    frameRate: { ideal: target.idealFps, max: 60 },
  };
}

export function screenConstraints(settings: MediaSettings): DisplayMediaStreamOptions {
  return {
    video: {
      width: { ideal: 2560, max: 3840 },
      height: { ideal: 1440, max: 2160 },
      frameRate: { ideal: settings.screenFps || 60, max: 60 },
    },
    audio: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
      channelCount: 2,
    },
  };
}
export async function routeAudio(element: HTMLMediaElement, settings: Pick<MediaSettings, "outputId" | "outputVolume">, effectiveVolume?: number) {
  element.volume = typeof effectiveVolume === "number" ? Math.max(0, Math.min(1, effectiveVolume)) : (settings.outputVolume / 100);
  if ("setSinkId" in element) await element.setSinkId(settings.outputId);
  else if (settings.outputId) throw new Error("La selezione dell’uscita audio non è supportata da questo browser.");
}
