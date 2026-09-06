import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MEDIA_SETTINGS,
  cameraConstraints,
  microphoneConstraints,
  normalizeMediaSettings,
  routeAudio,
  screenConstraints,
} from "./media-settings";
import { validateProfileImage } from "./profile-media";

describe("media preferences", () => {
  it("recovers from missing or invalid saved settings", () => {
    expect(normalizeMediaSettings(null)).toEqual(DEFAULT_MEDIA_SETTINGS);
    expect(normalizeMediaSettings({ inputVolume: Infinity, outputVolume: -20, inputId: 42, noise: "unknown" }))
      .toEqual({ ...DEFAULT_MEDIA_SETTINGS, outputVolume: 0 });
    expect(normalizeMediaSettings({ inputVolume: 500, outputVolume: 900 }).inputVolume).toBe(200);
  });
  it("uses the chosen microphone and never stacks browser noise suppression on RNNoise", () => {
    expect(microphoneConstraints({ ...DEFAULT_MEDIA_SETTINGS, inputId: "usb-mic" }))
      .toMatchObject({ deviceId: { exact: "usb-mic" }, noiseSuppression: false, channelCount: 1 });
    expect(microphoneConstraints({ ...DEFAULT_MEDIA_SETTINGS, noise: "standard" }).noiseSuppression).toBe(true);
    expect(microphoneConstraints({ ...DEFAULT_MEDIA_SETTINGS, noise: "off" }).noiseSuppression).toBe(false);
  });
  it("routes playback to the selected output including restoring the system default", async () => {
    const element = { volume: 1, setSinkId: vi.fn().mockResolvedValue(undefined) };
    await routeAudio(element as unknown as HTMLMediaElement, { outputId: "headset", outputVolume: 25 });
    expect(element.volume).toBe(0.25);
    expect(element.setSinkId).toHaveBeenCalledWith("headset");
    await routeAudio(element as unknown as HTMLMediaElement, { outputId: "", outputVolume: 100 });
    expect(element.setSinkId).toHaveBeenLastCalledWith("");
  });
  it("normalizes video quality, audio quality, and screen fps settings", () => {
    expect(normalizeMediaSettings({ videoQuality: "1440p", audioQuality: "ultra", screenFps: 60 })).toMatchObject({
      videoQuality: "1440p",
      audioQuality: "ultra",
      screenFps: 60,
    });
    expect(normalizeMediaSettings({ videoQuality: "invalid", audioQuality: "invalid", screenFps: 120 })).toMatchObject({
      videoQuality: "1080p",
      audioQuality: "high",
      screenFps: 60,
    });
  });
  it("generates camera constraints tailored to selected video quality", () => {
    const hdConstraints = cameraConstraints({ ...DEFAULT_MEDIA_SETTINGS, videoQuality: "1080p", cameraId: "webcam-1" });
    expect(hdConstraints).toMatchObject({
      deviceId: { exact: "webcam-1" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    });
  });
  it("generates high-definition 60fps screen sharing constraints with stereo audio", () => {
    const constraints = screenConstraints(DEFAULT_MEDIA_SETTINGS);
    expect(constraints).toMatchObject({
      video: {
        width: { ideal: 2560 },
        height: { ideal: 1440 },
        frameRate: { ideal: 60, max: 60 },
      },
      audio: {
        channelCount: 2,
      },
    });
  });
});

describe("profile image validation", () => {
  it("accepts animation formats without re-encoding them", () => {
    expect(() => validateProfileImage({ type: "image/gif", size: 8192 })).not.toThrow();
    expect(() => validateProfileImage({ type: "image/webp", size: 8192 })).not.toThrow();
  });
  it("rejects active content, empty files, and oversized uploads", () => {
    expect(() => validateProfileImage({ type: "image/svg+xml", size: 1024 })).toThrow();
    expect(() => validateProfileImage({ type: "image/png", size: 0 })).toThrow();
    expect(() => validateProfileImage({ type: "image/gif", size: 8388609 })).toThrow();
  });
});
