type Connection = {
  read: (bytes: Uint8Array) => Promise<number | null>;
  write: (bytes: Uint8Array) => Promise<number>;
  close: () => void;
};
export type NetworkRuntime = {
  connect: (options: {
    hostname: string;
    port: number;
    transport: "tcp";
  }) => Promise<Connection>;
  startTls: (
    connection: Connection,
    options: { hostname: string; alpnProtocols: string[] },
  ) => Promise<Connection>;
};
export type PublicResponse = {
  status: number;
  location?: string;
  type: string;
  body: Uint8Array;
};
class WireReader {
  private bytes = new Uint8Array(0);
  private offset = 0;
  constructor(private connection: Connection) {}
  async fill() {
    if (this.offset < this.bytes.length) return true;
    const next = new Uint8Array(16384),
      n = await this.connection.read(next);
    this.offset = 0;
    this.bytes = n ? next.subarray(0, n) : new Uint8Array(0);
    return !!n;
  }
  async line() {
    let result = "";
    while (await this.fill()) {
      const byte = this.bytes[this.offset++];
      if (byte === 10)
        return result.endsWith("\r") ? result.slice(0, -1) : result;
      result += String.fromCharCode(byte);
      if (result.length > 8192) throw Error("header_too_large");
    }
    throw Error("unexpected_eof");
  }
  async take(max: number) {
    if (!(await this.fill())) return null;
    const part = this.bytes.slice(
      this.offset,
      Math.min(this.bytes.length, this.offset + max),
    );
    this.offset += part.length;
    return part;
  }
  async exact(count: number) {
    const out = new Uint8Array(count);
    let offset = 0;
    while (offset < count) {
      const next = await this.take(count - offset);
      if (!next) throw Error("unexpected_eof");
      out.set(next, offset);
      offset += next.length;
    }
    return out;
  }
}
export async function fetchPinnedWire(
  runtime: NetworkRuntime,
  url: URL,
  ip: string,
  limit: number,
  truncate: boolean,
): Promise<PublicResponse> {
  let connection: Connection | undefined,
    expired = false;
  let rejectTimeout: (error: Error) => void = () => {};
  const timeout = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimeout(() => {
    expired = true;
    try {
      connection?.close();
    } catch {}
    rejectTimeout(Error("upstream_timeout"));
  }, 10000);
  const operation = async () => {
    connection = await runtime.connect({
      hostname: ip,
      port: 443,
      transport: "tcp",
    });
    if (expired) {
      connection.close();
      throw Error("upstream_timeout");
    }
    connection = await runtime.startTls(connection, {
      hostname: url.hostname,
      alpnProtocols: ["http/1.1"],
    });
    if (expired) {
      connection.close();
      throw Error("upstream_timeout");
    }
    const request = new TextEncoder().encode(
      `GET ${url.pathname + url.search} HTTP/1.1\r\nHost: ${url.hostname}\r\nConnection: close\r\nUser-Agent: Hush-LinkPreview/1.0\r\nAccept: text/html,application/json,image/*\r\nAccept-Encoding: identity\r\n\r\n`,
    );
    let written = 0;
    while (written < request.length) {
      const n = await connection.write(request.subarray(written));
      if (n <= 0) throw Error("write_failed");
      written += n;
    }
    const reader = new WireReader(connection),
      statusLine = await reader.line();
    const match = statusLine.match(/^HTTP\/1\.[01] (\d{3})\b/);
    if (!match) throw Error("invalid_response");
    const status = Number(match[1]),
      headers = new Map<string, string>();
    let headerSize = statusLine.length;
    while (true) {
      const line = await reader.line();
      if (!line) break;
      headerSize += line.length;
      if (headerSize > 32768) throw Error("header_too_large");
      const colon = line.indexOf(":");
      if (colon < 1) throw Error("invalid_response");
      const name = line.slice(0, colon).toLowerCase();
      if (
        headers.has(name) &&
        ["content-length", "transfer-encoding"].includes(name)
      )
        throw Error("ambiguous_response");
      headers.set(name, line.slice(colon + 1).trim());
    }
    if (status >= 300 && status < 400)
      return {
        status,
        location: headers.get("location"),
        type: "",
        body: new Uint8Array(),
      };
    if (status !== 200) throw Error("upstream_unavailable");
    if (
      headers.has("content-encoding") &&
      headers.get("content-encoding") !== "identity"
    )
      throw Error("unsupported_encoding");
    const chunks: Uint8Array[] = [];
    let size = 0;
    const append = (bytes: Uint8Array) => {
      chunks.push(bytes);
      size += bytes.length;
    };
    if (headers.get("transfer-encoding")?.toLowerCase() === "chunked") {
      while (true) {
        const line = (await reader.line()).split(";")[0];
        if (!/^[\da-f]{1,8}$/i.test(line)) throw Error("invalid_chunk");
        const length = parseInt(line, 16);
        if (length === 0) break;
        if (length > limit - size) {
          if (!truncate) throw Error("too_large");
          append(await reader.exact(limit - size));
          break;
        }
        append(await reader.exact(length));
        const ending = await reader.exact(2);
        if (ending[0] !== 13 || ending[1] !== 10) throw Error("invalid_chunk");
      }
    } else if (headers.has("transfer-encoding"))
      throw Error("unsupported_encoding");
    else if (headers.has("content-length")) {
      const raw = headers.get("content-length")!;
      if (!/^\d{1,10}$/.test(raw)) throw Error("invalid_length");
      const length = Number(raw);
      if (length > limit && !truncate) throw Error("too_large");
      append(await reader.exact(Math.min(limit, length)));
    } else {
      while (true) {
        const part = await reader.take(Math.min(16384, limit - size + 1));
        if (!part) break;
        if (part.length > limit - size) {
          if (!truncate) throw Error("too_large");
          append(part.slice(0, limit - size));
          break;
        }
        append(part);
      }
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
    return { status, type: headers.get("content-type") ?? "", body };
  };
  try {
    return await Promise.race([operation(), timeout]);
  } finally {
    clearTimeout(timer);
    try {
      connection?.close();
    } catch {}
  }
}
