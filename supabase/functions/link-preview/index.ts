import { fetchPublic } from "./network.ts";
import {
  discordInvite,
  parseMetadata,
  publicUrl,
  validPreviewImage,
  type LinkMetadata,
} from "./metadata.ts";
const env = Deno.env.toObject();
const origins = new Set(
  (
    env.SHARED_MEDIA_ALLOWED_ORIGINS ??
    "hush://app,http://127.0.0.1:5173,http://localhost:5173"
  )
    .split(",")
    .map((v) => v.trim()),
);
// Capacitor serves bundled, trusted Android assets from this secure origin.
origins.add("https://localhost");
const rates = new Map<string, { count: number; until: number }>();
let active = 0;
Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  const headers = new Headers({
    "Access-Control-Allow-Headers": "authorization,apikey,content-type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Cache-Control": "private, no-store",
    Vary: "Origin",
  });
  if (origin && origins.has(origin))
    headers.set("Access-Control-Allow-Origin", origin);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: new Headers([...headers, ["Content-Type", "application/json"]]),
    });
  if (origin && !origins.has(origin))
    return json({ error: "origin_not_allowed" }, 403);
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405);
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer "))
    return json({ error: "unauthorized" }, 401);
  try {
    const auth = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
      headers: {
        Authorization: authorization,
        apikey: env.SUPABASE_ANON_KEY ?? env.SUPABASE_PUBLISHABLE_KEY ?? "",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!auth.ok) return json({ error: "unauthorized" }, 401);
    const user = await auth.json();
    const now = Date.now();
    for (const [key, r] of rates) if (r.until < now) rates.delete(key);
    if (rates.size > 2000 && !rates.has(user.id))
      return json({ error: "busy" }, 429);
    const rate = rates.get(user.id) ?? { count: 0, until: now + 60000 };
    if (++rate.count > 60 || active >= 6)
      return json({ error: "rate_limited" }, 429);
    rates.set(user.id, rate);
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "invalid_body" }, 400);
    let raw = "";
    const decoder = new TextDecoder();
    let bytes = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        bytes += item.value.length;
        if (bytes > 4096) {
          await reader.cancel();
          return json({ error: "too_large" }, 413);
        }
        raw += decoder.decode(item.value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const payload = JSON.parse(raw);
    if (
      typeof payload.url !== "string" ||
      !["metadata", "image"].includes(payload.mode)
    )
      return json({ error: "invalid_body" }, 400);
    const url = publicUrl(payload.url).href;
    active++;
    try {
      if (payload.mode === "image") {
        const image = await fetchPublic(url, 2 * 1024 * 1024);
        const type = image.type.split(";")[0].toLowerCase();
        if (!validPreviewImage(image.body, type))
          return json({ error: "unsupported_image" }, 415);
        headers.set("Content-Type", type);
        headers.set("X-Content-Type-Options", "nosniff");
        return new Response(image.body, { headers });
      }
      const code = discordInvite(url);
      let metadata: LinkMetadata;
      if (code) {
        try {
          const response = await fetchPublic(
            `https://discord.com/api/v10/invites/${encodeURIComponent(code)}?with_counts=true`,
            128 * 1024,
          );
          const data = JSON.parse(new TextDecoder().decode(response.body)),
            voice = [2, 13].includes(data.channel?.type);
          metadata = {
            url,
            title: String(
              (voice ? data.channel?.name : data.guild?.name) ??
                "Invito Discord",
            ).slice(0, 200),
            description: String(data.guild?.name ?? "Discord").slice(0, 200),
            siteName: "Discord",
            kind: voice ? "voice-invite" : "invite",
            members: data.approximate_member_count,
            online: data.approximate_presence_count,
            image: data.guild?.icon
              ? `https://cdn.discordapp.com/icons/${data.guild.id}/${data.guild.icon}.png?size=256`
              : undefined,
          };
        } catch {
          metadata = {
            url,
            title: "Invito Discord",
            description: "Invito non disponibile o scaduto.",
            siteName: "Discord",
            kind: "invite",
            unavailable: true,
          };
        }
      } else {
        const source =
          new URL(url).hostname === "aistudio.google.com"
            ? "https://ai.google.dev/aistudio"
            : url;
        const result = await fetchPublic(source, 512 * 1024, 0, true);
        if (!/text\/html|application\/xhtml\+xml/.test(result.type))
          return json({ error: "not_html" }, 415);
        metadata = parseMetadata(
          new TextDecoder().decode(result.body),
          result.url,
        );
        metadata.url = url;
        if (source !== url) {
          metadata.title = "Google AI Studio";
          metadata.siteName = "Google AI Studio";
        }
      }
      return json(metadata);
    } finally {
      active--;
    }
  } catch {
    return json({ error: "preview_unavailable" }, 422);
  }
});
