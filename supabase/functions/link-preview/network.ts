import { request } from "node:https";
import { resolve4 } from "node:dns/promises";
import { publicIPv4, publicUrl } from "./metadata.ts";
import {
  fetchPinnedWire,
  type NetworkRuntime,
  type PublicResponse,
} from "./wire.ts";
// Connect to the validated IP itself, preserving TLS SNI and certificate checks
// for the original hostname. A second DNS answer cannot redirect this connection.
export async function fetchPublic(
  value: string,
  limit = 512 * 1024,
  redirects = 0,
  truncate = false,
): Promise<{ body: Uint8Array; type: string; url: string }> {
  const url = publicUrl(value);
  const addresses = await Promise.race([
    resolve4(url.hostname),
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(Error("dns_timeout")), 4000);
      timer.unref?.();
    }),
  ]);
  if (!addresses.length || addresses.some((ip) => !publicIPv4(ip)))
    throw Error("private_address");
  const runtime = (globalThis as { Deno?: NetworkRuntime }).Deno;
  const response = runtime?.startTls
    ? await fetchPinnedWire(runtime, url, addresses[0], limit, truncate)
    : await new Promise<PublicResponse>((resolve, reject) => {
        const chunks: Uint8Array[] = [];
        let size = 0;
        const req = request(
          {
            hostname: addresses[0],
            servername: url.hostname,
            port: 443,
            path: url.pathname + url.search,
            method: "GET",
            headers: {
              Host: url.hostname,
              "User-Agent": "Hush-LinkPreview/1.0",
              Accept: "text/html,application/json,image/*",
              "Accept-Encoding": "identity",
            },
            agent: false,
          },
          (res) => {
            const status = res.statusCode ?? 500,
              location = res.headers.location;
            if (status >= 300 && status < 400) {
              res.destroy();
              resolve({ status, location, type: "", body: new Uint8Array() });
              return;
            }
            if (status !== 200) {
              res.destroy();
              reject(Error("upstream_unavailable"));
              return;
            }
            if (
              !truncate &&
              Number(res.headers["content-length"] ?? 0) > limit
            ) {
              res.destroy();
              reject(Error("too_large"));
              return;
            }
            const finish = () => {
              const body = new Uint8Array(size);
              let offset = 0;
              for (const chunk of chunks) {
                body.set(chunk, offset);
                offset += chunk.length;
              }
              resolve({
                status,
                type: String(res.headers["content-type"] ?? ""),
                body,
              });
            };
            res.on("data", (chunk: Uint8Array) => {
              if (size + chunk.length > limit) {
                if (truncate) {
                  chunks.push(chunk.slice(0, limit - size));
                  size = limit;
                  finish();
                  res.destroy();
                } else req.destroy(Error("too_large"));
                return;
              }
              size += chunk.length;
              chunks.push(chunk);
            });
            res.on("error", reject);
            res.on("end", finish);
          },
        );
        const timer = setTimeout(
          () => req.destroy(Error("upstream_timeout")),
          8000,
        );
        req.on("close", () => clearTimeout(timer));
        req.on("error", reject);
        req.end();
      });
  if (response.location) {
    if (redirects >= 3) throw Error("too_many_redirects");
    return fetchPublic(
      new URL(response.location, url).href,
      limit,
      redirects + 1,
      truncate,
    );
  }
  return { body: response.body, type: response.type, url: url.href };
}
