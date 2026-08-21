import Fastify from "fastify";
import cors from "@fastify/cors";
import { WebSocketServer } from "ws";
import { config } from "./config.mjs";
import { resolveTrack, searchTracks } from "./lavalink.mjs";
import { authenticateRequest, authenticateToken } from "./auth.mjs";
import { createStreamTicket, streamAudio, verifyStreamTicket } from "./media.mjs";
import { roomState, updateRoom } from "./rooms.mjs";

if (!config.sharedSecret) throw new Error("BRIDGE_SHARED_SECRET non configurato.");

const app = Fastify({ logger: true });
await app.register(cors, {
  origin: config.allowedOrigins.length ? config.allowedOrigins : false,
});

app.addHook("onRequest", async (request, reply) => {
  if (request.url.split("?", 1)[0] === "/health" || request.url.split("?", 1)[0] === "/v1/stream") return;
  if (!await authenticateRequest(request)) return reply.code(401).send({ error: "unauthorized" });
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

app.get("/v1/stream-ticket", async (request, reply) => {
  const source = typeof request.query?.source === "string" ? request.query.source.trim() : "";
  const position = Number(request.query?.position || 0);
  if (!source || source.length > 2048) return reply.code(400).send({ error: "invalid_source" });
  try {
    const ticket = createStreamTicket(source, position);
    const base = config.publicUrl || `http://${request.headers.host}`;
    return { url: `${base}/v1/stream?ticket=${encodeURIComponent(ticket)}`, expiresIn: config.media.ticketTtlSeconds };
  } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "invalid_source" }); }
});

app.get("/v1/stream", async (request, reply) => {
  try {
    const ticket = verifyStreamTicket(request.query?.ticket);
    await streamAudio(ticket.source, ticket.position, request, reply);
  } catch (error) {
    return reply.code(502).send({ error: error instanceof Error ? error.message : "audio_unavailable" });
  }
});

const server = await app.listen({ host: config.host, port: config.port });
const wss = new WebSocketServer({ noServer: true });
const clients = new Map();

function broadcast(roomId, message) {
  for (const [socket, metadata] of clients) {
    if (metadata.roomId === roomId && socket.readyState === 1) socket.send(JSON.stringify(message));
  }
}

app.server.on("upgrade", async (request, socket, head) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const match = url.pathname.match(/^\/v1\/rooms\/([^/]+)$/);
  if (!match || !await authenticateToken(url.searchParams.get("token"))) {
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
