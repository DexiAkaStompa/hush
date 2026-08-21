import Fastify from "fastify";
import cors from "@fastify/cors";
import { WebSocketServer } from "ws";
import { config } from "./config.mjs";
import { resolveTrack, searchTracks } from "./lavalink.mjs";
import { roomState, updateRoom } from "./rooms.mjs";

if (!config.sharedSecret) throw new Error("BRIDGE_SHARED_SECRET non configurato.");

const app = Fastify({ logger: true });
await app.register(cors, {
  origin: config.allowedOrigins.length ? config.allowedOrigins : false,
});

function authorized(request) {
  return request.headers.authorization === `Bearer ${config.sharedSecret}`;
}

app.addHook("onRequest", async (request, reply) => {
  if (request.url === "/health") return;
  if (!authorized(request)) return reply.code(401).send({ error: "unauthorized" });
});

app.get("/health", async () => ({ ok: true, service: "hush-music-bridge", timestamp: new Date().toISOString() }));

app.get("/v1/search", async (request, reply) => {
  const query = typeof request.query?.q === "string" ? request.query.q.trim() : "";
  const source = request.query?.source === "spotify" ? "spotify" : "youtube";
  if (query.length < 2) return reply.code(400).send({ error: "query_too_short" });
  try { return { source, tracks: await searchTracks(query, source) }; }
  catch (error) { return reply.code(502).send({ error: error instanceof Error ? error.message : "lavalink_unavailable" }); }
});

app.get("/v1/resolve", async (request, reply) => {
  const identifier = typeof request.query?.identifier === "string" ? request.query.identifier.trim() : "";
  if (!identifier || identifier.length > 2048) return reply.code(400).send({ error: "invalid_identifier" });
  try { return { track: await resolveTrack(identifier) }; }
  catch (error) { return reply.code(502).send({ error: error instanceof Error ? error.message : "lavalink_unavailable" }); }
});

const server = await app.listen({ host: config.host, port: config.port });
const wss = new WebSocketServer({ noServer: true });
const clients = new Map();

function broadcast(roomId, message) {
  for (const [socket, metadata] of clients) {
    if (metadata.roomId === roomId && socket.readyState === 1) socket.send(JSON.stringify(message));
  }
}

app.server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const match = url.pathname.match(/^\/v1\/rooms\/([^/]+)$/);
  if (!match || url.searchParams.get("token") !== config.sharedSecret) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, match[1]));
});

wss.on("connection", (socket, roomId) => {
  clients.set(socket, { roomId });
  socket.send(JSON.stringify({ type: "state", state: roomState(roomId) }));
  socket.on("message", (raw) => {
    try {
      const command = JSON.parse(raw.toString());
      if (!command || typeof command.type !== "string") throw new Error("invalid_command");
      if (!["load", "play", "pause", "seek", "stop"].includes(command.type)) throw new Error("unsupported_command");
      const state = updateRoom(roomId, command, typeof command.updatedBy === "string" ? command.updatedBy : null);
      broadcast(roomId, { type: "state", state });
    } catch (error) {
      socket.send(JSON.stringify({ type: "error", error: error instanceof Error ? error.message : "invalid_command" }));
    }
  });
  socket.on("close", () => clients.delete(socket));
});

app.log.info(`Music bridge listening on ${server}`);
