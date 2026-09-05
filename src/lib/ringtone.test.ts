import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCustomRingtone,
  removeCustomRingtone,
  saveCustomRingtone,
  startIncomingCallRingtone,
  stopIncomingCallRingtone,
} from "./ringtone";

describe("ringtone module", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await removeCustomRingtone();
  });

  afterEach(async () => {
    stopIncomingCallRingtone();
    await removeCustomRingtone();
    vi.useRealTimers();
  });

  it("triggers onEnd callback after specified duration", () => {
    const onEnd = vi.fn();
    startIncomingCallRingtone({ durationMs: 1000, onEnd });

    expect(onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("cancels ringtone when stop function is invoked", () => {
    const onEnd = vi.fn();
    const stop = startIncomingCallRingtone({ durationMs: 5000, onEnd });

    stop();
    vi.advanceTimersByTime(5000);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("saves a valid custom MP3 file and updates custom ringtone state", async () => {
    const file = new File(["fake-mp3-binary-content"], "custom-bell.mp3", {
      type: "audio/mpeg",
    });

    const record = await saveCustomRingtone(file);
    expect(record.name).toBe("custom-bell.mp3");
    expect(record.type).toBe("audio/mpeg");
    expect(getCustomRingtone()?.name).toBe("custom-bell.mp3");

    await removeCustomRingtone();
    expect(getCustomRingtone()).toBeNull();
  });

  it("rejects non-audio files", async () => {
    const file = new File(["text data"], "document.txt", {
      type: "text/plain",
    });

    await expect(saveCustomRingtone(file)).rejects.toThrow("Seleziona un file audio valido");
  });

  it("rejects audio files exceeding 15 MB", async () => {
    const largeBlob = new Blob([new Uint8Array(16 * 1024 * 1024)]);
    const file = new File([largeBlob], "large-music.mp3", {
      type: "audio/mpeg",
    });

    await expect(saveCustomRingtone(file)).rejects.toThrow("non può superare 15 MB");
  });
});

