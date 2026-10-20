import { expect, test } from "vitest";
import { voiceOccupancy } from "./voice-preview";
test("voice preview counts real participants once across tabs and devices", () => {
  expect(
    voiceOccupancy({
      one: [
        { userId: "alice", inCall: true },
        { userId: "alice", inCall: true },
      ],
      two: [
        { userId: "bob", inCall: true },
        { userId: "carol", inCall: false },
      ],
      three: [{ inCall: true }],
    }),
  ).toBe(2);
  expect(voiceOccupancy({})).toBe(0);
});
