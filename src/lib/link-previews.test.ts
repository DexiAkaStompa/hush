import { expect, test } from "vitest";
import { extractPreviewLinks } from "./link-previews";
import {
  publicUrl,
  publicIPv4,
  parseMetadata,
  discordInvite,
  validPreviewImage,
} from "../../supabase/functions/link-preview/metadata";
test('rejects non-raster payloads and excessive decoded dimensions',()=>{
  expect(validPreviewImage(new TextEncoder().encode('<svg onload="bad()"></svg>'),'image/png')).toBe(false);
  const png=new Uint8Array(24);png.set([137,80,78,71]);const view=new DataView(png.buffer);view.setUint32(16,1200);view.setUint32(20,630);expect(validPreviewImage(png,'image/png')).toBe(true);view.setUint32(16,50000);expect(validPreviewImage(png,'image/png')).toBe(false);
});
test("extracts at most three unique previews, trims punctuation and respects suppression/code", () => {
  expect(
    extractPreviewLinks(
      "https://example.com/a. https://example.com/a `https://hidden.com/` <https://suppressed.com/> https://example.org/a_(b) https://example.net/ https://ignored.org/",
    ),
  ).toEqual([
    "https://example.com/a",
    "https://example.org/a_(b)",
    "https://example.net/",
  ]);
  expect(
    extractPreviewLinks(
      "```https://hidden.com``` https://user:secret@example.com/",
    ),
  ).toEqual([]);
  expect(extractPreviewLinks("hush://invite/" + "a".repeat(48))).toHaveLength(
    1,
  );
});
test("accepts only public HTTPS destinations without credentials, custom ports or literal IPs", () => {
  for (const value of [
    "file:///tmp/test",
    "https://127.0.0.1/",
    "https://[::1]/",
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com:444",
    "https://a.internal",
    "https://localhost",
    "https://2130706433/",
  ])
    expect(() => publicUrl(value)).toThrow();
  expect(publicUrl("https://example.com/a#fragment").href).toBe(
    "https://example.com/a",
  );
});
test("rejects private, local, metadata and reserved DNS answers", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "198.18.0.1",
  ])
    expect(publicIPv4(ip)).toBe(false);
  expect(publicIPv4("8.8.8.8")).toBe(true);
});
test("parses Open Graph, Twitter fallbacks, entities and relative images as plain data", () => {
  const value = parseMetadata(
    `<meta content="A &amp; B" property="og:title"><meta name='description' content='A &quot;description&quot;'><meta property="og:image" content="/cover.png"><title>Fallback</title>`,
    "https://example.com/page",
  );
  expect(value.title).toBe("A & B");
  expect(value.description).toBe('A "description"');
  expect(value.image).toBe("https://example.com/cover.png");
  expect(
    parseMetadata(
      '<title>Plain title</title><meta name="twitter:image" content="http://127.0.0.1/x">',
      "https://example.com",
    ).image,
  ).toBeUndefined();
});
test("recognizes only official Discord invite URLs", () => {
  expect(discordInvite("https://discord.gg/abc123")).toBe("abc123");
  expect(discordInvite("https://discord.com/invite/abc123")).toBe("abc123");
  expect(discordInvite("https://discord.gg.evil.org/abc123")).toBeNull();
});
