import { describe, expect, it } from "vitest";
import { EMOJI_CATEGORIES, type EmojiItem } from "./EmojiPicker";

describe("EmojiPicker module", () => {
  it("contains all main emoji categories", () => {
    const categoryIds = EMOJI_CATEGORIES.map((c) => c.id);
    expect(categoryIds).toContain("smileys");
    expect(categoryIds).toContain("gestures");
    expect(categoryIds).toContain("hearts");
    expect(categoryIds).toContain("objects");
  });

  it("has valid emoji characters and keywords for each item", () => {
    for (const category of EMOJI_CATEGORIES) {
      expect(category.emojis.length).toBeGreaterThan(0);
      for (const emoji of category.emojis) {
        expect(typeof emoji.char).toBe("string");
        expect(emoji.char.length).toBeGreaterThan(0);
        expect(typeof emoji.name).toBe("string");
        expect(Array.isArray(emoji.keywords)).toBe(true);
        expect(emoji.keywords.length).toBeGreaterThan(0);
      }
    }
  });

  it("finds emojis by italian or english keywords", () => {
    const allEmojis: EmojiItem[] = EMOJI_CATEGORIES.flatMap((c) => c.emojis);

    const heartMatches = allEmojis.filter(
      (e) => e.name.includes("heart") || e.keywords.some((k) => k.includes("cuore"))
    );
    expect(heartMatches.length).toBeGreaterThan(0);
    expect(heartMatches.some((e) => e.char === "❤️")).toBe(true);

    const fireMatches = allEmojis.filter(
      (e) => e.name.includes("fire") || e.keywords.some((k) => k.includes("fuoco"))
    );
    expect(fireMatches.length).toBeGreaterThan(0);
    expect(fireMatches.some((e) => e.char === "🔥")).toBe(true);
  });
});
