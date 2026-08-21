import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const serviceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: join(serviceRoot, ".env") });

function integer(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const secure = process.env.LAVALINK_SECURE !== "false";
const sourceHosts = (process.env.BRIDGE_SOURCE_HOSTS || "youtube.com,youtu.be,spotify.com,soundcloud.com")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

export const config = Object.freeze({
  host: process.env.BRIDGE_HOST || "127.0.0.1",
  port: integer("BRIDGE_PORT", 8787),
  sharedSecret: process.env.BRIDGE_SHARED_SECRET || "",
  allowedOrigins: (process.env.BRIDGE_ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean),
  publicUrl: (process.env.BRIDGE_PUBLIC_URL || "").replace(/\/$/, ""),
  sourceHosts,
  allowDirectSources: process.env.BRIDGE_ALLOW_DIRECT_SOURCES === "true",
  supabase: {
    url: process.env.SUPABASE_URL || "",
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || "",
  },
  media: {
    ytDlpPath: process.env.YTDLP_PATH || "yt-dlp.exe",
    ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg.exe",
    ticketTtlSeconds: integer("BRIDGE_TICKET_TTL_SECONDS", 300),
  },
  lavalink: {
    host: process.env.LAVALINK_HOST || "lavalink.jirayu.net",
    port: integer("LAVALINK_PORT", 443),
    secure,
    password: process.env.LAVALINK_PASSWORD || "youshallnotpass",
  },
});

export function lavalinkBaseUrl() {
  const scheme = config.lavalink.secure ? "https" : "http";
  return `${scheme}://${config.lavalink.host}:${config.lavalink.port}`;
}
