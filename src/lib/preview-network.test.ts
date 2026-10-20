import { afterEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ resolve4: vi.fn() }));
vi.mock("node:dns/promises", () => ({ resolve4: mocks.resolve4 }));
import { fetchPublic } from "../../supabase/functions/link-preview/network";
import { fetchPinnedWire } from "../../supabase/functions/link-preview/wire";
function runtime(response: string) {
  const bytes = new TextEncoder().encode(response);
  let offset = 0;
  const connection = {
    read: async (out: Uint8Array) => {
      if (offset >= bytes.length) return null;
      const n = Math.min(3, out.length, bytes.length - offset);
      out.set(bytes.subarray(offset, offset + n));
      offset += n;
      return n;
    },
    write: vi.fn(async (out: Uint8Array) => out.length),
    close: vi.fn(),
  };
  return {
    connection,
    connect: vi.fn(async () => connection),
    startTls: vi.fn(async () => connection),
  };
}
afterEach(() => {
  delete (globalThis as { Deno?: unknown }).Deno;
  vi.clearAllMocks();
});
test("pins the TCP destination and verifies TLS against the original hostname without re-resolving", async () => {
  const wire = runtime(
    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 5\r\n\r\nHello",
  );
  Object.assign(globalThis, { Deno: wire });
  mocks.resolve4
    .mockResolvedValueOnce(["8.8.8.8"])
    .mockResolvedValueOnce(["127.0.0.1"]);
  const result = await fetchPublic("https://example.com/");
  expect(new TextDecoder().decode(result.body)).toBe("Hello");
  expect(wire.connect).toHaveBeenCalledWith({
    hostname: "8.8.8.8",
    port: 443,
    transport: "tcp",
  });
  expect(wire.startTls).toHaveBeenCalledWith(wire.connection, {
    hostname: "example.com",
    alpnProtocols: ["http/1.1"],
  });
  expect(mocks.resolve4).toHaveBeenCalledTimes(1);
  expect(wire.connection.close).toHaveBeenCalled();
});
test("decodes chunked bodies split across arbitrary socket reads and enforces image byte budgets", async () => {
  const wire = runtime(
    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nWiki\r\n5\r\npedia\r\n0\r\n\r\n",
  );
  const result = await fetchPinnedWire(
    wire,
    new URL("https://example.com"),
    "8.8.8.8",
    20,
    false,
  );
  expect(new TextDecoder().decode(result.body)).toBe("Wikipedia");
  const tooBig = runtime("HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n");
  await expect(
    fetchPinnedWire(
      tooBig,
      new URL("https://example.com"),
      "8.8.8.8",
      20,
      false,
    ),
  ).rejects.toThrow("too_large");
  expect(tooBig.connection.close).toHaveBeenCalled();
});
test("truncates large HTML safely and rejects truncated content or ambiguous framing", async () => {
  const wire = runtime(
    "HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\n0123456789",
  );
  expect(
    new TextDecoder().decode(
      (
        await fetchPinnedWire(
          wire,
          new URL("https://example.com"),
          "8.8.8.8",
          4,
          true,
        )
      ).body,
    ),
  ).toBe("0123");
  const short = runtime("HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nHi");
  await expect(
    fetchPinnedWire(
      short,
      new URL("https://example.com"),
      "8.8.8.8",
      20,
      false,
    ),
  ).rejects.toThrow("unexpected_eof");
  const ambiguous = runtime(
    "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nContent-Length: 9\r\n\r\n",
  );
  await expect(
    fetchPinnedWire(
      ambiguous,
      new URL("https://example.com"),
      "8.8.8.8",
      20,
      false,
    ),
  ).rejects.toThrow("ambiguous_response");
});
test("rejects redirects to local destinations and mixed public/private DNS results", async () => {
  const wire = runtime(
    "HTTP/1.1 302 Found\r\nLocation: https://127.0.0.1/secret\r\n\r\n",
  );
  Object.assign(globalThis, { Deno: wire });
  mocks.resolve4.mockReset().mockResolvedValue(["8.8.8.8"]);
  await expect(fetchPublic("https://example.com")).rejects.toThrow(
    "invalid_url",
  );
  expect(wire.connect).toHaveBeenCalledTimes(1);
  mocks.resolve4.mockResolvedValue(["8.8.8.8", "10.0.0.1"]);
  await expect(fetchPublic("https://example.org")).rejects.toThrow(
    "private_address",
  );
  expect(wire.connect).toHaveBeenCalledTimes(1);
});
