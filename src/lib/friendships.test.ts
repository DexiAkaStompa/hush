import { expect, test } from "vitest";
import {
  friendshipError,
  friendshipKind,
  type Friendship,
} from "./friendships";
const row = {
  id: "r",
  requester_id: "a",
  recipient_id: "b",
  status: "pending",
  created_at: "",
  updated_at: "",
} satisfies Friendship;
test("friendships distinguish incoming, outgoing and accepted", () => {
  expect(friendshipKind(row, "a")).toBe("outgoing");
  expect(friendshipKind(row, "b")).toBe("incoming");
  expect(friendshipKind({ ...row, status: "accepted" }, "a")).toBe("friend");
});
test("request errors explain recovery without leaking backend details", () => {
  expect(friendshipError({ code: "23505" })).toContain("Esiste già");
  expect(friendshipError({ message: "unknown_username" })).toContain(
    "username",
  );
  expect(friendshipError({ message: "cannot_friend_yourself" })).toContain(
    "te stesso",
  );
  expect(friendshipError({ message: "too_many_friend_requests" })).toContain(
    "100",
  );
  expect(friendshipError({ message: "secret backend details" })).not.toContain(
    "secret",
  );
});
