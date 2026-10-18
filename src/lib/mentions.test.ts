import { describe, it, expect } from "vitest";
import {
  extractMentions,
  parseMentions,
  resolveMentions,
  mentionsRecipient,
  mentionQuery,
  type MentionTarget,
} from "./mentions";
import { packMessageContent, unpackMessageContent } from "./workspace";
const targets: MentionTarget[] = [
  { kind: "user", id: "a", label: "anna", name: "Anna" },
  {
    kind: "role",
    id: "r",
    label: "HEAD ADMIN",
    name: "Staff",
    color: "#aabbcc",
  },
  { kind: "everyone", id: "s", label: "everyone", name: "Tutti" },
  { kind: "here", id: "s", label: "here", name: "Online" },
];
describe("encrypted mentions", () => {
  it("matches users, multiword roles and mass mentions without partial usernames, email or code", () => {
    const text =
      "Ciao @anna @HEAD ADMIN @everyone @here; @annabelle a@anna `@anna` ```@everyone``` https://example.com/@anna";
    const m = extractMentions(text, targets);
    expect(m.map((m) => m.kind)).toEqual(["user", "role", "everyone", "here"]);
    expect(m.every((m) => text.slice(m.start, m.end) === "@" + m.label)).toBe(
      true,
    );
  });
  it("preserves the typed casing when mention metadata is decrypted again", () => {
    const text = "@ANNA @head admin",
      mentions = extractMentions(text, targets);
    expect(mentions).toHaveLength(2);
    expect(parseMentions(mentions, text)).toEqual(mentions);
  });
  it("handles unicode, regex metacharacters and longest overlapping role names", () => {
    const t: MentionTarget[] = [
      { kind: "role", id: "1", label: "A+", name: "A" },
      { kind: "role", id: "2", label: "A+ team", name: "Team" },
      { kind: "user", id: "3", label: "màtti", name: "Matt" },
    ];
    expect(extractMentions("🙂 @A+ team e @màtti", t).map((m) => m.id)).toEqual(
      ["2", "3"],
    );
  });
  it("rejects disallowed targets and malformed offsets and preserves explicit empty metadata", () => {
    expect(
      extractMentions(
        "@everyone",
        targets.map((t) => ({ ...t, allowed: false })),
      ),
    ).toEqual([]);
    expect(
      parseMentions(
        [{ kind: "user", id: "a", label: "anna", start: 0, end: 999 }],
        "@anna",
      ),
    ).toEqual([]);
    expect(resolveMentions("@anna", [], targets)).toEqual([]);
    expect(resolveMentions("@anna", undefined, targets)).toHaveLength(1);
    expect(
      unpackMessageContent(packMessageContent("@everyone", null, null, []))
        .mentions,
    ).toEqual([]);
  });
  it("roundtrips tags inside the encrypted payload and identifies recipients", () => {
    const text = "@HEAD ADMIN @here",
      mentions = extractMentions(text, targets),
      unpacked = unpackMessageContent(
        packMessageContent(text, null, null, mentions),
      );
    expect(unpacked.mentions).toEqual(mentions);
    expect(mentionsRecipient(mentions, "b", ["r"], false)).toBe(true);
    expect(mentionsRecipient(mentions, "b", [], false)).toBe(false);
    expect(mentionsRecipient(mentions, "b", [], true)).toBe(true);
  });
  it("completes a multiword role at the caret without using text after the caret", () => {
    expect(mentionQuery("ciao @HEAD AD resto", 13)).toEqual({
      start: 5,
      end: 13,
      query: "head ad",
    });
    expect(mentionQuery("mail@anna")).toBeNull();
  });
});
