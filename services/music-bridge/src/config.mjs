import "dotenv/config";

function integer(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const secure = process.env.LAVALINK_SECURE !== "false";

export const config = Object.freeze({
  host: process.env.BRIDGE_HOST || "127.0.0.1",
  port: integer("BRIDGE_PORT", 8787),
  sharedSecret: process.env.BRIDGE_SHARED_SECRET || "",
  allowedOrigins: (process.env.BRIDGE_ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean),
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
