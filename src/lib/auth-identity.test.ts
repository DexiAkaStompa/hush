import { describe, expect, it } from "vitest";
import {
  isStrongEnoughPassword,
  isValidUsername,
  normalizeUsername,
  usernameToInternalEmail,
} from "./auth-identity";

describe("username auth identity", () => {
  it("normalizes usernames consistently", () => {
    expect(normalizeUsername("  Username ")).toBe("username");
    expect(usernameToInternalEmail("Username")).toBe("username@users.hush.invalid");
  });

  it("accepts only predictable usernames", () => {
    expect(isValidUsername("luca_22")).toBe(true);
    expect(isValidUsername("ab")).toBe(false);
    expect(isValidUsername("luca@example.com")).toBe(false);
    expect(() => usernameToInternalEmail("../admin")).toThrow("Username non valido");
  });

  it("requires long passwords", () => {
    expect(isStrongEnoughPassword("short-pass")).toBe(false);
    expect(isStrongEnoughPassword("una-password-lunga")).toBe(true);
  });
});
