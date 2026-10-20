/// <reference path="./env.d.ts" />

async function readJson(response: Response | Request, maxBytes: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty_body");
  let bytes = 0, text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new Error("body_too_large"); }
      text += decoder.decode(next.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}

type IceServer = { urls: string[]; username?: string; credential?: string };
export function safeIceServers(value: unknown): IceServer[] {
  if (!value || typeof value !== "object" || !("iceServers" in value) || !Array.isArray(value.iceServers)) throw new Error("invalid_credentials");
  const servers: IceServer[] = [];
  for (const item of value.iceServers.slice(0, 8)) {
    if (!item || typeof item !== "object") continue;
    const urls = (Array.isArray(item.urls) ? item.urls : [item.urls]).filter((url: unknown): url is string => typeof url === "string" && /^(stun:stun|turns?:turn)\.cloudflare\.com:(3478|443|80|5349)(\?transport=(udp|tcp))?$/.test(url));
    if (!urls.length) continue;
    if (urls.some((url: string) => /^turns?:/.test(url))) {
      if (typeof item.username !== "string" || !item.username || item.username.length > 2048 || typeof item.credential !== "string" || !item.credential || item.credential.length > 2048) continue;
      servers.push({ urls, username: item.username, credential: item.credential });
    } else servers.push({ urls });
  }
  if (!servers.some(server => server.credential)) throw new Error("invalid_credentials");
  return servers;
}

export async function handleTurnRequest(request: Request, env: TurnEnv, network: typeof fetch = fetch): Promise<Response> {
  const origin = request.headers.get("Origin");
  const allowed = new Set(env.ALLOWED_ORIGINS.split(",").map(value => value.trim()));
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "private, no-store", "Vary": "Origin", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, content-type", "X-Content-Type-Options": "nosniff" });
  if (origin && allowed.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (origin && !allowed.has(origin)) return json({ error: "origin_not_allowed" }, 403);
  if (new URL(request.url).pathname !== "/credentials") return json({ error: "not_found" }, 404);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ") || authorization.length > 8192) return json({ error: "unauthorized" }, 401);
  let payload: unknown;
  try { payload = await readJson(request, 1024); }
  catch { return json({ error: "invalid_body" }, 400); }
  if (!payload || typeof payload !== "object" || !("conversationId" in payload) || typeof payload.conversationId !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(payload.conversationId)) return json({ error: "invalid_conversation" }, 400);
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN || !env.SUPABASE_PUBLISHABLE_KEY) return json({ error: "relay_not_configured" }, 503);
  try {
    const authHeaders = { Authorization: authorization, apikey: env.SUPABASE_PUBLISHABLE_KEY };
    const auth = await network(`${env.SUPABASE_URL}/auth/v1/user`, { headers: authHeaders, signal: AbortSignal.timeout(5000) });
    if (!auth.ok) { await auth.body?.cancel(); return json({ error: "unauthorized" }, 401); }
    const user = await readJson(auth, 32768);
    if (!user || typeof user !== "object" || !("id" in user) || typeof user.id !== "string") return json({ error: "unauthorized" }, 401);
    const access = await network(`${env.SUPABASE_URL}/rest/v1/rpc/claim_turn_credentials`, {
      method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ p_conversation_id: payload.conversationId }), signal: AbortSignal.timeout(5000),
    });
    if (!access.ok) { await access.body?.cancel(); return json({ error: access.status === 403 ? "voice_connect_forbidden" : "authorization_unavailable" }, access.status === 403 ? 403 : 503); }
    if (await readJson(access, 1024) !== true) return json({ error: "rate_limited" }, 429);
    const ttl = 3600;
    const generated = await network(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`, {
      method: "POST", headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl, customIdentifier: user.id }), signal: AbortSignal.timeout(7000),
    });
    if (!generated.ok) { await generated.body?.cancel(); return json({ error: "relay_unavailable" }, 503); }
    return json({ iceServers: safeIceServers(await readJson(generated, 16384)), expiresAt: Date.now() + ttl * 1000 });
  } catch { return json({ error: "relay_unavailable" }, 503); }
}

export default { fetch(request: Request, env: TurnEnv) { return handleTurnRequest(request, env); } };
