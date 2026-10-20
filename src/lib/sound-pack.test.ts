import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playCallSound, playChatSound } from "./interaction-sound";
import { playMessageNotificationSound, previewNotificationSound, removeCustomNotificationSound, saveCustomNotificationSound } from "./notification-sound";
import { removeCustomRingtone, saveCustomRingtone, startIncomingCallRingtone, stopIncomingCallRingtone } from "./ringtone";

const instances: MockAudio[] = [];
class MockAudio {
  volume = 1;
  loop = false;
  currentTime = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
  setSinkId = vi.fn().mockResolvedValue(undefined);
  constructor(public src: string) { instances.push(this); }
}

describe("bundled sound playback", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20"));
    instances.length = 0;
    vi.stubGlobal("Audio", MockAudio);
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ outputVolume: 40, outputId: "speakers" }) });
    await removeCustomNotificationSound();
    await removeCustomRingtone();
  });
  afterEach(() => {
    stopIncomingCallRingtone();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("routes the default message sound to the selected output at the configured volume", () => {
    playMessageNotificationSound();
    expect(instances[0].src).toMatch(/sounds\/message1\.mp3$/);
    expect(instances[0].volume).toBe(0.4);
    expect(instances[0].setSinkId).toHaveBeenCalledWith("speakers");
    expect(instances[0].play).toHaveBeenCalledOnce();
  });

  it("stops the default notification preview", () => {
    const stop = previewNotificationSound();
    const audio = instances[0];
    expect(audio.src).toMatch(/sounds\/message1\.mp3$/);
    stop();
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.src).toBe("");
  });

  it("loops and stops the default ringtone when its duration expires", () => {
    const onEnd = vi.fn();
    startIncomingCallRingtone({ durationMs: 1000, volumeMultiplier: 0.5, onEnd });
    const audio = instances[0];
    expect(audio.src).toMatch(/sounds\/call_ringing\.mp3$/);
    expect(audio.loop).toBe(true);
    expect(audio.volume).toBeCloseTo(0.15);
    vi.advanceTimersByTime(1000);
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("preserves custom notification and ringtone overrides", async () => {
    const file = new File(["audio"], "custom.mp3", { type: "audio/mpeg" });
    await saveCustomNotificationSound(file);
    await saveCustomRingtone(file);
    playMessageNotificationSound();
    startIncomingCallRingtone();
    expect(instances[0].src).toMatch(/^blob:/);
    expect(instances[1].src).toMatch(/^blob:/);
    instances[0].onended?.();
    await removeCustomNotificationSound();
    await removeCustomRingtone();
  });

  it("uses distinct voice controls and throttles repeated chat cues", () => {
    playCallSound("cameraOn");
    playCallSound("deafen");
    playChatSound("receive");
    playChatSound("receive");
    expect(instances.map(audio => audio.src.split("/").pop())).toEqual(["camera_on.mp3", "deafen.mp3", "message1.mp3"]);
    vi.advanceTimersByTime(150);
    playChatSound("receive");
    expect(instances).toHaveLength(4);
  });
});
