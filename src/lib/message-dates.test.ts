import { expect, test } from "vitest";
import { messageDayLabel, messageTimestamp } from "./message-dates";
const now = new Date("2026-10-20T12:00:00");
test("formats today, yesterday and older dates without crossing calendar boundaries", () => {
  expect(messageDayLabel("2026-10-20T01:00:00", now)).toBe("Oggi");
  expect(messageDayLabel("2026-10-19T23:59:00", now)).toBe("Ieri");
  expect(messageDayLabel("2026-10-15T12:00:00", now)).toBe("15 ottobre 2026");
  expect(messageTimestamp("2026-10-19T23:24:00", now)).toBe("ieri alle 23:24");
  expect(messageTimestamp("invalid", now)).toBe("");
});
