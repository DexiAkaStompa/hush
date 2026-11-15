import { expect, it, vi } from "vitest";
import { hasActiveMigrationCall } from "./desktop-migration-source";

it("recognizes folded desktop calls, expanded/mobile call stages and ringing calls", () => {
  for (const mounted of [".desktop-call-widget", ".media-stage", ".incoming-call-card"]) {
    const root = { querySelector: vi.fn(selector => selector.split(",").includes(mounted) ? {} : null) };
    expect(hasActiveMigrationCall(root as Pick<Document, "querySelector">)).toBe(true);
  }
  expect(hasActiveMigrationCall({ querySelector: () => null })).toBe(false);
});
