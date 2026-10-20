import { expect, test } from "vitest";
import { isMessageContinuation } from "./message-layout";
const first = { senderId: "alice", createdAt: "2026-10-20T12:00:00" };
test("groups consecutive messages from the same account within five minutes", () => {
  expect(
    isMessageContinuation(first, {
      ...first,
      createdAt: "2026-10-20T12:04:59",
    }),
  ).toBe(true);
  expect(
    isMessageContinuation(first, {
      ...first,
      createdAt: "2026-10-20T12:05:00",
    }),
  ).toBe(false);
});
test("keeps different or unavailable senders separate", () => {
  expect(isMessageContinuation(undefined, first)).toBe(false);
  expect(isMessageContinuation(first, { ...first, senderId: "bob" })).toBe(
    false,
  );
  expect(
    isMessageContinuation(
      { ...first, senderId: null },
      { ...first, senderId: null },
    ),
  ).toBe(false);
});
test("does not group replies, date boundaries or invalid/reversed times", () => {
  expect(isMessageContinuation({ ...first, replyId: "r" }, first)).toBe(true);
  expect(isMessageContinuation(first, { ...first, replyId: "r" })).toBe(false);
  expect(
    isMessageContinuation(
      { ...first, createdAt: "2026-10-20T23:59:00" },
      { ...first, createdAt: "2026-10-21T00:00:00" },
    ),
  ).toBe(false);
  expect(
    isMessageContinuation(first, {
      ...first,
      createdAt: "2026-10-20T11:59:00",
    }),
  ).toBe(false);
  expect(isMessageContinuation(first, { ...first, createdAt: "invalid" })).toBe(
    false,
  );
});
