import { createHmac, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { config } from "./config.mjs";
import { resolvePlaybackSource } from "./lavalink.mjs";

function sourceUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error("La sorgente deve usare HTTPS.");
  const host = parsed.hostname.toLowerCase();
  const allowed = config.sourceHosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
  if (!allowed && !config.allowDirectSources) throw new Error("Dominio sorgente non autorizzato dal bridge.");
  return parsed.toString();
}

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

function decode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signature(payload) {
  return createHmac("sha256", config.sharedSecret).update(payload).digest("base64url");
}

export function createStreamTicket(source, positionSeconds = 0) {
  const normalizedSource = sourceUrl(source);
  const payload = JSON.stringify({
    source: normalizedSource,
    position: Math.max(0, Math.min(604800, Number(positionSeconds) || 0)),
    expiresAt: Math.floor(Date.now() / 1000) + config.media.ticketTtlSeconds,
  });
  const encoded = encode(payload);
  return `${encoded}.${signature(encoded)}`;
}

export function verifyStreamTicket(ticket) {
  if (typeof ticket !== "string") throw new Error("Ticket audio mancante.");
  const [encoded, provided] = ticket.split(".");
  if (!encoded || !provided) throw new Error("Ticket audio non valido.");
  const expected = signature(encoded);
  const actualBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error("Ticket audio non valido.");
  }
  const payload = JSON.parse(decode(encoded));
  if (!payload.source || payload.expiresAt < Math.floor(Date.now() / 1000)) throw new Error("Ticket audio scaduto.");
  return { source: sourceUrl(payload.source), position: Number(payload.position) || 0 };
}

function commandOutput(command, args, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Risoluzione audio scaduta."));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(stderr.trim().slice(-500) || `Comando audio terminato con ${code}.`));
      else resolve(stdout.trim());
    });
  });
}

export function requiresLavalinkResolution(source) {
  const host = new URL(source).hostname.toLowerCase();
  return host === "spotify.com" || host.endsWith(".spotify.com");
}

async function resolveSource(source) {
  const normalized = sourceUrl(source);
  const isSpotify = requiresLavalinkResolution(normalized);
  // yt-dlp accepts YouTube, SoundCloud and approved direct streams as-is.
  // Only Spotify needs Lavalink to find a playable YouTube counterpart.
  if (!isSpotify) return normalized;
  return (await resolvePlaybackSource(normalized)).url;
}

async function directAudioUrl(source) {
  const resolvedSource = await resolveSource(source);
  const output = await commandOutput(config.media.ytDlpPath, [
    "--no-playlist",
    "--quiet",
    "--no-warnings",
    "--format", "bestaudio[ext=m4a]/bestaudio/best",
    "--get-url",
    resolvedSource,
  ]);
  const url = output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("https://")).at(-1);
  if (!url) throw new Error("yt-dlp non ha restituito uno stream audio.");
  return url;
}

export async function streamAudio(source, positionSeconds, request, reply) {
  const directUrl = await directAudioUrl(source);
  const position = Math.max(0, Number(positionSeconds) || 0);
  const args = ["-hide_banner", "-loglevel", "error", "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"];
  if (position > 0) args.push("-ss", String(position));
  args.push(
    "-i", directUrl,
    "-vn", "-f", "mp3", "-codec:a", "libmp3lame", "-b:a", "160k", "-ar", "48000", "-ac", "2", "pipe:1",
  );
  const ffmpeg = spawn(config.media.ffmpegPath, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  ffmpeg.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  ffmpeg.once("error", (error) => {
    if (!reply.raw.headersSent) reply.raw.writeHead(502, { "Content-Type": "application/json" });
    if (!reply.raw.destroyed) reply.raw.end(JSON.stringify({ error: error.message }));
  });
  ffmpeg.once("close", (code) => {
    if (code !== 0 && !reply.raw.destroyed) reply.raw.destroy(new Error(stderr.trim().slice(-500) || "FFmpeg audio error."));
  });
  const cleanup = () => { if (!ffmpeg.killed) ffmpeg.kill(); };
  request.raw.once("close", cleanup);
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "audio/mpeg",
    "Cache-Control": "no-store",
    "Accept-Ranges": "none",
    "Access-Control-Allow-Origin": request.headers.origin || "*",
  });
  ffmpeg.stdout.pipe(reply.raw);
}
