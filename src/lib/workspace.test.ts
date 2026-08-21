import { describe, expect, it } from "vitest";
import { initialsFor, readableError } from "./workspace";

describe("workspace helpers", () => {
  it("derives stable initials from real display names", () => {
    expect(initialsFor("Ada Lovelace")).toBe("AL");
    expect(initialsFor("  mattia  ")).toBe("M");
    expect(initialsFor("")).toBe("TU");
  });

  it("turns database exceptions into actionable Italian messages", () => {
    expect(readableError(new Error("P0001: unknown_username"))).toContain("username");
    expect(readableError(new Error("P0001: invalid_or_expired_invite"))).toContain("scaduto");
    expect(readableError(new Error("P0001: owner_cannot_leave"))).toContain("proprietario");
    expect(readableError({ code: "PGRST202", message: "Could not find the function" })).toContain("functional_mvp");
    expect(readableError({ code: "23505", message: "duplicate", details: "already exists" })).toContain("[23505]");
    expect(readableError({ code: "42883", message: "function gen_random_bytes(integer) does not exist" })).toContain("invite_pgcrypto_schema_fix");
  });
});
