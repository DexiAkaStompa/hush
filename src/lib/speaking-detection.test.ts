import { describe, expect, it } from "vitest";
import { calculateAudioLevel, isSpeakingLevel } from "./speaking-detection";

describe("speaking detection logic", () => {
  it("calculates audio level correctly", () => {
    expect(calculateAudioLevel(new Uint8Array([]))).toBe(0);

    const silent = new Uint8Array([0, 0, 0, 0]);
    expect(calculateAudioLevel(silent)).toBe(0);

    const active = new Uint8Array([10, 20, 30, 40]);
    expect(calculateAudioLevel(active)).toBe(25);
  });

  it("determines speaking status based on threshold", () => {
    // Default threshold is 14
    expect(isSpeakingLevel(0)).toBe(false);
    expect(isSpeakingLevel(13)).toBe(false);
    expect(isSpeakingLevel(14)).toBe(true);
    expect(isSpeakingLevel(50)).toBe(true);

    // Custom threshold
    expect(isSpeakingLevel(20, 25)).toBe(false);
    expect(isSpeakingLevel(25, 25)).toBe(true);
  });
});

