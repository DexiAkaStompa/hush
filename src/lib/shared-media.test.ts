import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { auth: { getSession: mocks.session } } }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_SHARED_MEDIA_URL", "https://example.supabase.co/functions/v1/shared-media");
  mocks.session.mockResolvedValue({ data: { session: { access_token: "test-user-jwt" } }, error: null });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

test("shared upload sends ciphertext with user auth and accepts a private file ID", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ fileId: "private-file-id" }));
  vi.stubGlobal("fetch", fetchMock);
  const { uploadSharedMedia } = await import("./shared-media");
  expect(await uploadSharedMedia("conversation", "attachment", new Uint8Array([1, 2, 3]).buffer)).toBe("private-file-id");
  const [url, init] = fetchMock.mock.calls[0];
  expect(url.searchParams.get("conversationId")).toBe("conversation");
  expect(init.headers.Authorization).toBe("Bearer test-user-jwt");
  expect([...new Uint8Array(await init.body.arrayBuffer())]).toEqual([1, 2, 3]);
});

test("shared download uses authenticated service only and returns binary", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([4, 5])));
  vi.stubGlobal("fetch", fetchMock);
  const { downloadSharedMedia } = await import("./shared-media");
  expect([...new Uint8Array(await downloadSharedMedia("conversation", "private-file-id"))]).toEqual([4, 5]);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0][0].hostname).toBe("example.supabase.co");
});

test("missing session prevents network requests", async () => {
  mocks.session.mockResolvedValue({ data: { session: null }, error: null });
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  const { downloadSharedMedia } = await import("./shared-media");
  await expect(downloadSharedMedia("conversation", "file")).rejects.toThrow("Accedi");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("credentials are never sent to an insecure remote endpoint", async () => {
  vi.stubEnv("VITE_SHARED_MEDIA_URL", "http://example.com/media");
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  const { downloadSharedMedia } = await import("./shared-media");
  await expect(downloadSharedMedia("conversation", "file")).rejects.toThrow("HTTPS");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("shared storage errors are sanitized and never fall back to public URLs", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("secret upstream details", { status: 403 }));
  vi.stubGlobal("fetch", fetchMock);
  const { downloadSharedMedia } = await import("./shared-media");
  await expect(downloadSharedMedia("conversation", "file")).rejects.toThrow("Non hai accesso");
  expect(fetchMock).toHaveBeenCalledOnce();
});

test("status reports the actual server configuration", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ configured: false })));
  const { checkSharedMedia } = await import("./shared-media");
  expect(await checkSharedMedia()).toBe(false);
});

test("invalid upload IDs are rejected", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ fileId: "https://public.example/file" })));
  const { uploadSharedMedia } = await import("./shared-media");
  await expect(uploadSharedMedia("conversation", "attachment", new ArrayBuffer(1))).rejects.toThrow("non valida");
});

test("temporary failures retry the same encrypted chunk", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response("busy", {status:429})).mockResolvedValueOnce(Response.json({fileId:"private-file-id"}));
  vi.stubGlobal("fetch",fetchMock);
  const {uploadSharedMedia} = await import("./shared-media");
  const result = uploadSharedMedia("conversation","attachment",new Uint8Array([1,2,3]).buffer,0);
  await vi.advanceTimersByTimeAsync(1100);
  expect(await result).toBe("private-file-id");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
});
