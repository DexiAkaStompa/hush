import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  profilePopoverPosition,
  loadSharedProfileSpaces,
} from "./profile-details";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./supabase", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ in: mocks.query }) }) }),
  },
}));
const spaces = [
  { id: "a", name: "Studio", owner_id: "o" },
  { id: "b", name: "Amici", owner_id: "o" },
];
describe("profile details", () => {
  beforeEach(() => vi.clearAllMocks());
  it("opens next to a user when there is room and flips at the right edge", () => {
    expect(
      profilePopoverPosition(
        { left: 100, right: 140, top: 80, bottom: 120 },
        320,
        400,
        1200,
        800,
      ),
    ).toEqual({ left: 152, top: 80 });
    expect(
      profilePopoverPosition(
        { left: 1100, right: 1140, top: 700, bottom: 740 },
        320,
        400,
        1200,
        800,
      ),
    ).toEqual({ left: 768, top: 388 });
  });
  it("keeps a full-width card inside a small viewport", () => {
    const p = profilePopoverPosition(
      { left: 200, right: 240, top: 10, bottom: 50 },
      320,
      700,
      344,
      720,
    );
    expect(p).toEqual({ left: 12, top: 12 });
  });
  it("shows only server memberships returned for this user", async () => {
    mocks.query.mockResolvedValue({
      data: [{ space_id: "b", joined_at: "2026-10-18" }],
      error: null,
    });
    expect(await loadSharedProfileSpaces("u", spaces)).toEqual([
      { space: spaces[1], joinedAt: "2026-10-18" },
    ]);
    expect(mocks.query).toHaveBeenCalledWith("space_id", ["a", "b"]);
  });
  it("does not query an empty workspace and reports data errors", async () => {
    expect(await loadSharedProfileSpaces("u", [])).toEqual([]);
    expect(mocks.query).not.toHaveBeenCalled();
    mocks.query.mockResolvedValue({
      data: null,
      error: new Error("unavailable"),
    });
    await expect(loadSharedProfileSpaces("u", spaces)).rejects.toThrow(
      "unavailable",
    );
  });
});
