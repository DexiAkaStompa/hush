import { googleToken, type SharedMediaConfig } from "../shared-media/handler.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.bin$/i;
type DriveFile = { id?: string; name?: string; mimeType?: string; parents?: string[]; createdTime?: string; appProperties?: Record<string, string>; trashed?: boolean };

export function retentionCutoff(now: Date): Date {
  const cutoff = new Date(now);
  const month = cutoff.getUTCMonth();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  // February 29 expires on February 28 in a non-leap year.
  if (cutoff.getUTCMonth() !== month) cutoff.setUTCDate(0);
  return cutoff;
}

export function eligibleForCleanup(file: DriveFile, folderId: string, cutoff: Date): boolean {
  const created = Date.parse(file.createdTime || "");
  return Boolean(file.id && /^[\w-]{10,256}$/.test(file.id) && file.mimeType === "application/octet-stream" && !file.trashed && file.parents?.includes(folderId) && Number.isFinite(created) && created < cutoff.getTime() &&
    ((UUID.test(file.appProperties?.conversationId || "") && UUID.test(file.appProperties?.attachmentId || "")) || LEGACY_NAME.test(file.name || "")));
}

async function authorized(value: string | null, secret: string): Promise<boolean> {
  if (!value || secret.length < 32 || value.length > 256) return false;
  const hashes = await Promise.all([value, secret].map(text => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
  const a = new Uint8Array(hashes[0]); const b = new Uint8Array(hashes[1]);
  let difference = 0; for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function boundedBody(request: Request): Promise<string> {
  const reader = request.body?.getReader(); if (!reader) return "";
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 4096) {await reader.cancel(); throw new Error("body_too_large");} parts.push(next.value); }
  } finally {reader.releaseLock();}
  const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) {bytes.set(part,offset);offset+=part.byteLength;}
  return new TextDecoder().decode(bytes);
}

async function validSignature(request: Request, body: string, secret: string, now: Date): Promise<boolean> {
  const timestamp = request.headers.get("x-hush-cleanup-timestamp") || "";
  const signature = request.headers.get("x-hush-cleanup-signature") || "";
  if (!/^\d{10}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature) || secret.length < 32 || Math.abs(now.getTime()/1000-Number(timestamp)) > 120) return false;
  const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
  const bytes = Uint8Array.from(signature.match(/../g)!,part=>parseInt(part,16));
  return crypto.subtle.verify("HMAC",key,bytes,new TextEncoder().encode(`hush-drive-cleanup:${timestamp}:${body}`));
}

export function createCleanupHandler(config: SharedMediaConfig, secret: string, fetchFn: typeof fetch = fetch, now: () => Date = () => new Date()) {
  return async (request: Request) => {
    const reply = (body: unknown, status = 200) => Response.json(body, {status, headers: {"Cache-Control": "no-store"}});
    if (request.method !== "POST") return reply({error: "method_not_allowed"}, 405);
    try {
      const direct = await authorized(request.headers.get("x-hush-cleanup-key"), secret);
      const timestamp = request.headers.get("x-hush-cleanup-timestamp") || "";
      const signature = request.headers.get("x-hush-cleanup-signature") || "";
      if (!direct && (!/^\d{10}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature) || Math.abs(now().getTime()/1000-Number(timestamp)) > 120)) return reply({error:"unauthorized"},401);
      const body = await boundedBody(request);
      if (!direct && !(await validSignature(request,body,secret,now()))) return reply({error:"unauthorized"},401);
      if (!/^[\w-]{10,256}$/.test(config.googleFolderId)) return reply({error: "storage_unconfigured"}, 503);
      const input = JSON.parse(body) as {dryRun?: boolean; cursor?: string};
      if (input.dryRun !== undefined && typeof input.dryRun !== "boolean") return reply({error: "invalid_request"}, 400);
      if (input.cursor !== undefined && (typeof input.cursor !== "string" || input.cursor.length > 2048 || !/^[\w+=/-]*$/.test(input.cursor))) return reply({error: "invalid_cursor"}, 400);
      const dryRun = input.dryRun !== false;
      const cutoff = retentionCutoff(now());
      const token = await googleToken(config, fetchFn);
      const headers = {Authorization: `Bearer ${token}`};
      const fields = "id,name,mimeType,parents,createdTime,appProperties,trashed";
      const query = new URLSearchParams({q: `'${config.googleFolderId}' in parents and trashed = false and mimeType = 'application/octet-stream' and createdTime < '${cutoff.toISOString()}'`, pageSize: "50", fields: `nextPageToken,files(${fields})`, ...(input.cursor ? {pageToken: input.cursor} : {})});
      const response = await fetchFn(`https://www.googleapis.com/drive/v3/files?${query}`, {headers, signal: AbortSignal.timeout(15_000)});
      if (!response.ok) return reply({error: "cleanup_list_failed"}, 502);
      const result = await response.json() as {files?: DriveFile[]; nextPageToken?: string};
      let eligible = 0; let deleted = 0; let skipped = 0;
      for (const listed of result.files || []) {
        if (!eligibleForCleanup(listed, config.googleFolderId, cutoff)) {skipped++; continue;}
        eligible++;
        if (dryRun) continue;
        // Recheck scope immediately before permanently deleting a managed file.
        const current = await fetchFn(`https://www.googleapis.com/drive/v3/files/${listed.id}?${new URLSearchParams({fields})}`, {headers, signal: AbortSignal.timeout(10_000)});
        if (current.status === 404) continue;
        if (!current.ok) return reply({error: "cleanup_validation_failed"}, 502);
        if (!eligibleForCleanup(await current.json(), config.googleFolderId, cutoff)) {skipped++; continue;}
        const removal = await fetchFn(`https://www.googleapis.com/drive/v3/files/${listed.id}`, {method: "DELETE", headers, signal: AbortSignal.timeout(10_000)});
        if (!removal.ok && removal.status !== 404) return reply({error: "cleanup_delete_failed"}, 502);
        deleted++;
      }
      return reply({dryRun, cutoff: cutoff.toISOString(), eligible, deleted, skipped, nextCursor: result.nextPageToken || null});
    } catch { return reply({error: "cleanup_failed"}, 502); }
  };
}
