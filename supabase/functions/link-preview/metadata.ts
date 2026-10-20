export type LinkMetadata = {
  url: string;
  title: string;
  description: string;
  siteName: string;
  image?: string;
  kind?: "link" | "invite" | "voice-invite";
  members?: number;
  online?: number;
  unavailable?: boolean;
};
export function publicUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.href.length > 2048 ||
    !url.hostname.includes(".") ||
    /[\[\]:]/.test(url.hostname)
  )
    throw Error("invalid_url");
  if (
    /(^|\.)(localhost|local|internal|home|lan|test|invalid)$/.test(
      url.hostname,
    ) ||
    /^\d+(\.\d+){3}$/.test(url.hostname)
  )
    throw Error("invalid_url");
  url.hash = "";
  return url;
}
export function publicIPv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
  )
    return false;
  const [a, b] = parts;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || b === 2)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0)
  );
}
function text(value: string, max = 300): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,
      (_, entity: string) => {
        if (entity[0] === "#") {
          const code =
            entity[1].toLowerCase() === "x"
              ? parseInt(entity.slice(2), 16)
              : parseInt(entity.slice(1), 10);
          return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
        }
        return (
          (
            {
              amp: "&",
              quot: '"',
              apos: "'",
              lt: "<",
              gt: ">",
              nbsp: " ",
            } as Record<string, string>
          )[entity.toLowerCase()] ?? ""
        );
      },
    )
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
export function parseMetadata(html: string, url: string): LinkMetadata {
  const values = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]{0,8192}>/gi) ?? []) {
    const attrs = new Map<string, string>();
    for (const a of tag.matchAll(
      /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
    ))
      attrs.set(a[1].toLowerCase(), a[2] ?? a[3] ?? a[4]);
    const name = (
        attrs.get("property") ??
        attrs.get("name") ??
        ""
      ).toLowerCase(),
      content = attrs.get("content");
    if (content && !values.has(name)) values.set(name, content);
  }
  const title = text(
    values.get("og:title") ??
      values.get("twitter:title") ??
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
      new URL(url).hostname,
    200,
  );
  const imageValue =
    values.get("og:image:secure_url") ??
    values.get("og:image") ??
    values.get("twitter:image");
  let image: string | undefined;
  if (imageValue)
    try {
      image = publicUrl(new URL(text(imageValue, 2048), url).href).href;
    } catch {}
  return {
    url,
    title,
    description: text(
      values.get("og:description") ??
        values.get("description") ??
        values.get("twitter:description") ??
        "",
      500,
    ),
    siteName: text(values.get("og:site_name") ?? new URL(url).hostname, 80),
    image,
    kind: "link",
  };
}
export function discordInvite(url: string): string | null {
  const u = new URL(url);
  return /^(www\.)?(discord\.gg|discord\.com)$/.test(u.hostname)
    ? (u.pathname.match(
        u.hostname.endsWith("discord.gg")
          ? /^\/([\w-]{2,100})\/?$/
          : /^\/invite\/([\w-]{2,100})\/?$/,
      )?.[1] ?? null)
    : null;
}
export function validPreviewImage(bytes: Uint8Array, type: string): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0,
    height = 0;
  const ascii = (start: number, n: number) =>
    String.fromCharCode(...bytes.subarray(start, start + n));
  if (
    type === "image/png" &&
    bytes.length >= 24 &&
    bytes[0] === 137 &&
    ascii(1, 3) === "PNG"
  ) {
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (
    type === "image/gif" &&
    bytes.length >= 10 &&
    /^GIF8[79]a$/.test(ascii(0, 6))
  ) {
    width = view.getUint16(6, true);
    height = view.getUint16(8, true);
  } else if (type === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        break;
      }
      offset += length;
    }
  } else if (
    type === "image/webp" &&
    bytes.length >= 30 &&
    ascii(0, 4) === "RIFF" &&
    ascii(8, 4) === "WEBP"
  ) {
    const uint24 = (start: number) =>
      bytes[start] + (bytes[start + 1] << 8) + (bytes[start + 2] << 16);
    const kind = ascii(12, 4);
    if (kind === "VP8X") {
      width = uint24(24) + 1;
      height = uint24(27) + 1;
    } else if (kind === "VP8 ") {
      width = view.getUint16(26, true) & 16383;
      height = view.getUint16(28, true) & 16383;
    } else if (kind === "VP8L" && bytes[20] === 47) {
      const bits = view.getUint32(21, true);
      width = (bits & 16383) + 1;
      height = ((bits >>> 14) & 16383) + 1;
    }
  }
  return (
    width > 0 &&
    height > 0 &&
    width <= 4096 &&
    height <= 4096 &&
    width * height <= 4_000_000
  );
}
