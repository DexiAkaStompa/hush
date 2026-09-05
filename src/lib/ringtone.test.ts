import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startIncomingCallRingtone, stopIncomingCallRingtone } from "./ringtone";

describe("ringtone module", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopIncomingCallRingtone();
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
});
