import { randomUUID } from "node:crypto";

const rooms = new Map();

function emptyRoom(roomId) {
  return {
    roomId,
    revision: 0,
    source: null,
    isPlaying: false,
    positionSeconds: 0,
    anchorAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: null,
  };
}

export function roomState(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, emptyRoom(roomId));
  return rooms.get(roomId);
}

export function updateRoom(roomId, command, updatedBy = null) {
  const previous = roomState(roomId);
  const next = { ...previous, revision: previous.revision + 1, updatedAt: new Date().toISOString(), updatedBy: updatedBy || randomUUID() };
  if (command.type === "play" || command.type === "pause") {
    next.isPlaying = command.type === "play";
    next.positionSeconds = Number.isFinite(command.positionSeconds) ? Math.max(0, command.positionSeconds) : previous.positionSeconds;
  } else if (command.type === "seek") {
    next.positionSeconds = Math.max(0, Number(command.positionSeconds) || 0);
  } else if (command.type === "load") {
    next.source = command.source;
    next.positionSeconds = 0;
    next.isPlaying = true;
  } else if (command.type === "stop") {
    next.source = null;
    next.positionSeconds = 0;
    next.isPlaying = false;
  }
  next.anchorAt = new Date().toISOString();
  rooms.set(roomId, next);
  return next;
}
