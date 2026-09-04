import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MEDIA_SETTINGS, microphoneConstraints, normalizeMediaSettings, routeAudio } from "./media-settings";
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
