import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_MEDIA_BYTES, createHandler, resetTokenCacheForTests, type SharedMediaConfig } from "./handler";

const userId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const attachmentId = "33333333-3333-4333-8333-333333333333";
const folderId = "folder_123456789";
const fileId = "file_123456789";
const config: SharedMediaConfig = { supabaseUrl: "https://supabase.example", supabasePublishableKey: "public", googleClientId: "client", googleClientSecret: "secret", googleRefreshToken: "refresh", googleFolderId: folderId, allowedOrigins: new Set(["hush://app"]) };

function mockFetch(options: { member?: boolean; metadata?: Record<string, unknown> | null; media?: Uint8Array } = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: userId }), { status: 200 });
    if (url.includes("/rest/v1/conversation_members")) return new Response(JSON.stringify(options.member === false ? [] : [{ user_id: userId }]), { status: 200 });
    if (url === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "access", expires_in: 3600 }), { status: 200 });
    if (url.includes("/upload/drive/v3/files")) return new Response(JSON.stringify({ id: fileId }), { status: 200 });
    if (url.includes("/drive/v3/files/") && url.includes("fields=")) return new Response(JSON.stringify(options.metadata === undefined ? { id: fileId, size: "17", parents: [folderId], appProperties: { conversationId, attachmentId } } : options.metadata), { status: options.metadata === null ? 404 : 200 });
    if (url.includes("alt=media")) return new Response(options.media || new Uint8Array(17).fill(1), { status: 200 });
    throw new Error(`unexpected URL ${url}`);
  }) as typeof fetch;
}

function request(method: "GET" | "POST", path: string, body?: BodyInit) { return new Request(`https://functions.example/shared-media${path}`, { method, body, headers: { authorization: "Bearer user-token", apikey: "public", origin: "hush://app", ...(body ? { "content-type": "application/octet-stream" } : {}) } }); }

afterEach(() => resetTokenCacheForTests());

describe("shared media handler", () => {
  it("rejects unauthenticated requests before membership or Google calls", async () => {
    const fetchMock = vi.fn(async () => new Response("no", { status: 401 })) as typeof fetch;
    const response = await createHandler(config, fetchMock)(request("GET", `?conversationId=${conversationId}&fileId=${fileId}`));
    expect(response.status).toBe(401); expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects non-members before Google token exchange", async () => {
    const fetchMock = mockFetch({ member: false });
    const response = await createHandler(config, fetchMock)(request("GET", `?conversationId=${conversationId}&fileId=${fileId}`));
    expect(response.status).toBe(403); expect(fetchMock).not.toHaveBeenCalledWith("https://oauth2.googleapis.com/token", expect.anything());
  });

  it("rejects an oversized streamed upload", async () => {
    const fetchMock = mockFetch();
    const body = new Uint8Array(MAX_MEDIA_BYTES + 1);
    const response = await createHandler(config, fetchMock)(request("POST", `?conversationId=${conversationId}&attachmentId=${attachmentId}`, body));
    expect(response.status).toBe(413); expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("upload/drive"), expect.anything());
  });

  it("rejects a Drive file from another folder or conversation", async () => {
    const fetchMock = mockFetch({ metadata: { id: fileId, size: "17", parents: ["other_folder"], appProperties: { conversationId, attachmentId } } });
    const response = await createHandler(config, fetchMock)(request("GET", `?conversationId=${conversationId}&fileId=${fileId}`));
    expect(response.status).toBe(404); expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("alt=media"), expect.anything());
  });

  it("uploads encrypted bytes and downloads only validated private files", async () => {
    const fetchMock = mockFetch(); const handler = createHandler(config, fetchMock);
    const upload = await handler(request("POST", `?conversationId=${conversationId}&attachmentId=${attachmentId}`, new Uint8Array(17).fill(7)));
    expect(upload.status).toBe(200); expect(await upload.json()).toEqual({ fileId });
    const download = await handler(request("GET", `?conversationId=${conversationId}&fileId=${fileId}`));
    expect(download.status).toBe(200); expect(Array.from(new Uint8Array(await download.arrayBuffer()))).toEqual(Array(17).fill(1));
    const uploadCall = fetchMock.mock.calls.find(([url]) => String(url).includes("upload/drive"));
    expect(String(uploadCall?.[1]?.headers && new Headers(uploadCall[1]?.headers).get("content-type"))).toContain("multipart/related");
  });
});

it("never caches authenticated private responses", async () => {
  const response = await createHandler(config, mockFetch())(request("GET", `?conversationId=${conversationId}&fileId=${fileId}`));
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Origin");
});
it("rejects truncated ciphertext and inconsistent download sizes", async () => {
  const upload = await createHandler(config, mockFetch())(request("POST", `?conversationId=${conversationId}&attachmentId=${attachmentId}`, new Uint8Array(16)));
  expect(upload.status).toBe(413);
  const download = await createHandler(config, mockFetch({ media: new Uint8Array(18) }))(request("GET", `?conversationId=${conversationId}&fileId=${fileId}`));
  expect(download.status).toBe(502);
});
it("limits concurrent requests before allocating upload bodies", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const base = mockFetch();
  const held = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/auth/v1/user")) await gate;
    return base(input, init);
  }) as typeof fetch;
  const handler = createHandler(config, held);
  const first = handler(request("GET", "?status=1"));
  const second = handler(request("GET", "?status=1"));
  try { expect((await handler(request("GET", "?status=1"))).status).toBe(429); }
  finally { release(); await Promise.all([first, second]); }
});
