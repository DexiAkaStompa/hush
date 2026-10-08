export const MAX_MEDIA_BYTES = 16 * 1024 * 1024 + 16;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FILE_ID = /^[A-Za-z0-9_-]{10,256}$/;

export type SharedMediaConfig = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  googleClientId: string;
  googleClientSecret: string;
  googleRefreshToken: string;
  googleFolderId: string;
  allowedOrigins: Set<string>;
};

type FetchLike = typeof fetch;
type TokenState = { value: string; expiresAt: number };
let tokenState: TokenState | null = null;
let tokenFlight: Promise<string> | null = null;
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 2;

export function configFromEnv(env: Record<string, string | undefined> = readEnv()): SharedMediaConfig {
  const allowed = (env.SHARED_MEDIA_ALLOWED_ORIGINS || "hush://app,http://127.0.0.1:5173,http://localhost:5173")
    .split(",").map((value) => value.trim()).filter(Boolean);
  return {
    supabaseUrl: env.SUPABASE_URL || "",
    supabasePublishableKey: env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || "",
    googleClientId: env.GDRIVE_CLIENT_ID || "",
    googleClientSecret: env.GDRIVE_CLIENT_SECRET || "",
    googleRefreshToken: env.GDRIVE_REFRESH_TOKEN || "",
    googleFolderId: env.GDRIVE_FOLDER_ID || "",
    allowedOrigins: new Set(allowed),
  };
}

function readEnv(): Record<string, string | undefined> {
  const deno = (globalThis as { Deno?: { env: { toObject(): Record<string, string> } } }).Deno;
  return deno?.env.toObject() || {};
}

function corsHeaders(request: Request, config: SharedMediaConfig): Headers {
  const headers = new Headers({ "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Cache-Control": "private, no-store", "Vary": "Origin" });
  const origin = request.headers.get("origin");
  if (origin && config.allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function json(data: unknown, status: number, headers: Headers): Response {
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { status, headers });
}

function bad(status: number, code: string, headers: Headers): Response { return json({ error: code }, status, headers); }

function validUuid(value: string | null): value is string { return Boolean(value && UUID.test(value)); }
function requireFileId(value: string | null): value is string { return Boolean(value && FILE_ID.test(value)); }

async function readBoundedStream(stream: ReadableStream<Uint8Array> | null): Promise<Uint8Array<ArrayBuffer> | null> {
  if (stream) {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > MAX_MEDIA_BYTES) { await reader.cancel("too large"); return null; }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
    return output;
  }
  return null;
}

async function readBounded(request: Request): Promise<Uint8Array<ArrayBuffer> | null> {
  if (request.body) return readBoundedStream(request.body);
  const bytes = new Uint8Array(await request.arrayBuffer());
  return bytes.byteLength <= MAX_MEDIA_BYTES ? bytes : null;
}

async function authenticatedUser(request: Request, config: SharedMediaConfig, fetchFn: FetchLike): Promise<string | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.match(/^Bearer\s+\S+$/i) || !config.supabaseUrl || !config.supabasePublishableKey) return null;
  const response = await fetchFn(`${config.supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: config.supabasePublishableKey },
  });
  if (!response.ok) return null;
  const user = await response.json() as { id?: unknown };
  return typeof user.id === "string" && validUuid(user.id) ? user.id : null;
}

async function isMember(userId: string, conversationId: string, authorization: string, config: SharedMediaConfig, fetchFn: FetchLike): Promise<boolean> {
  const base = `${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/conversation_members`;
  const query = new URLSearchParams({ conversation_id: `eq.${conversationId}`, user_id: `eq.${userId}`, left_at: "is.null", select: "user_id", limit: "1" });
  const response = await fetchFn(`${base}?${query}`, { headers: { Authorization: authorization, apikey: config.supabasePublishableKey } });
  if (!response.ok) return false;
  const rows = await response.json() as unknown;
  return Array.isArray(rows) && rows.length > 0;
}

async function googleToken(config: SharedMediaConfig, fetchFn: FetchLike): Promise<string> {
  if (tokenState && tokenState.expiresAt > Date.now() + 30_000) return tokenState.value;
  if (tokenFlight) return tokenFlight;
  tokenFlight = (async () => {
    const response = await fetchFn("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.googleClientId, client_secret: config.googleClientSecret, refresh_token: config.googleRefreshToken, grant_type: "refresh_token" }) });
    if (!response.ok) throw new Error("google_token_failed");
    const payload = await response.json() as { access_token?: unknown; expires_in?: unknown };
    if (typeof payload.access_token !== "string") throw new Error("google_token_failed");
    tokenState = { value: payload.access_token, expiresAt: Date.now() + (typeof payload.expires_in === "number" ? payload.expires_in : 3600) * 1000 };
    return payload.access_token;
  })().finally(() => { tokenFlight = null; });
  return tokenFlight;
}

async function driveMetadata(fileId: string, token: string, fetchFn: FetchLike): Promise<{ id?: string; size?: string; parents?: string[]; appProperties?: Record<string, string>; trashed?: boolean } | null> {
  const response = await fetchFn(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,size,parents,appProperties,trashed`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  return await response.json();
}

export function createHandler(config: SharedMediaConfig, fetchFn: FetchLike = fetch): (request: Request) => Promise<Response> {
  return async (request) => {
    const headers = corsHeaders(request, config);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "GET" && request.method !== "POST") return bad(405, "method_not_allowed", headers);
    if (activeRequests >= MAX_CONCURRENT_REQUESTS) return bad(429, "busy", headers);
    activeRequests++;
    try {
      const userId = await authenticatedUser(request, config, fetchFn);
      if (!userId) return bad(401, "unauthorized", headers);
      const url = new URL(request.url);
      if (url.searchParams.get("status") === "1" && request.method === "GET") return json({ configured: Boolean(config.googleClientId && config.googleClientSecret && config.googleRefreshToken && config.googleFolderId) }, 200, headers);
      if (!config.googleClientId || !config.googleClientSecret || !config.googleRefreshToken || !config.googleFolderId) return bad(503, "storage_unconfigured", headers);
      const conversationId = url.searchParams.get("conversationId");
      if (!validUuid(conversationId)) return bad(400, "invalid_conversation", headers);
      if (!(await isMember(userId, conversationId, request.headers.get("authorization") || "", config, fetchFn))) return bad(403, "forbidden", headers);
      if (request.method === "POST") {
        const attachmentId = url.searchParams.get("attachmentId");
        if (!validUuid(attachmentId)) return bad(400, "invalid_attachment", headers);
        if (request.headers.get("content-type") !== "application/octet-stream") return bad(415, "unsupported_media_type", headers);
        const bytes = await readBounded(request);
        if (!bytes || bytes.byteLength < 17) return bad(413, "media_too_large", headers);
        if (!config.googleFolderId) return bad(503, "storage_unconfigured", headers);
        const token = await googleToken(config, fetchFn);
        const boundary = `hush-${crypto.randomUUID()}`;
        const metadata = JSON.stringify({ name: `${conversationId}-${attachmentId}.bin`, parents: [config.googleFolderId], mimeType: "application/octet-stream", appProperties: { conversationId, attachmentId } });
        const body = new Uint8Array(new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`).byteLength + bytes.byteLength + (`\r\n--${boundary}--`).length);
        let offset = 0; const put = (part: Uint8Array) => { body.set(part, offset); offset += part.byteLength; };
        put(new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`)); put(bytes); put(new TextEncoder().encode(`\r\n--${boundary}--`));
        const response = await fetchFn("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body });
        if (!response.ok) return bad(502, "storage_upload_failed", headers);
        const result = await response.json() as { id?: unknown };
        return typeof result.id === "string" && requireFileId(result.id) ? json({ fileId: result.id }, 200, headers) : bad(502, "storage_upload_failed", headers);
      }
      const fileId = url.searchParams.get("fileId");
      if (!requireFileId(fileId)) return bad(400, "invalid_file", headers);
      const token = await googleToken(config, fetchFn);
      const metadata = await driveMetadata(fileId, token, fetchFn);
      if (!metadata || metadata.trashed || !metadata.parents?.includes(config.googleFolderId) || metadata.appProperties?.conversationId !== conversationId) return bad(404, "file_not_found", headers);
      const size = Number(metadata.size);
      if (!Number.isSafeInteger(size) || size < 17 || size > MAX_MEDIA_BYTES) return bad(413, "media_too_large", headers);
      const response = await fetchFn(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok || !response.body) return bad(502, "storage_download_failed", headers);
      const bytes = await readBoundedStream(response.body);
      if (!bytes) return bad(413, "media_too_large", headers);
      if (bytes.byteLength !== size) return bad(502, "storage_download_failed", headers);
      headers.set("Content-Type", "application/octet-stream"); headers.set("Content-Length", String(bytes.byteLength));
      return new Response(bytes, { status: 200, headers });
    } catch {
      console.error("shared-media request failed");
      return bad(502, "storage_unavailable", headers);
    } finally { activeRequests--; }
  };
}

export function resetTokenCacheForTests() { tokenState = null; tokenFlight = null; }
