export type ConversationMusicState = {
  conversation_id: string;
  source_url: string | null;
  title: string | null;
  is_playing: boolean;
  position_seconds: number;
  anchor_at: string;
  revision: number;
  updated_by: string;
  updated_at: string;
};

export const musicTopic = (conversationId: string) => `music:${conversationId}`;

export type MusicProvider = "direct" | "youtube" | "spotify";

export function musicProvider(value: string | null | undefined): MusicProvider {
  if (!value) return "direct";
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === "youtu.be" || host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) return "youtube";
    if (host === "open.spotify.com" || host.endsWith("spotify.com")) return "spotify";
  } catch { /* direct URL */ }
  return "direct";
}

export function providerEmbedUrl(value: string, provider: Exclude<MusicProvider, "direct">, position = 0, playing = false, muted = false) {
  try {
    const url = new URL(value);
    if (provider === "youtube") {
      const id = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v") || url.pathname.split("/").filter(Boolean).at(-1);
      if (!id) return null;
      const params = new URLSearchParams({ autoplay: playing ? "1" : "0", controls: "1", playsinline: "1", rel: "0", origin: "https://hush.app", widget_referrer: "https://hush.app/" });
      if (position > 0) params.set("start", String(Math.floor(position)));
      if (muted) params.set("mute", "1");
      return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params}`;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return `https://open.spotify.com/embed/${parts[0]}/${parts[1]}?utm_source=hush&theme=0`;
  } catch {
    return null;
  }
}

export function isDirectMusicUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "0.0.0.0") return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (/^(fc|fd|fe8|fe9|fea|feb)[0-9a-f]*:/i.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

export function normalizeMusicState(value: unknown): ConversationMusicState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ConversationMusicState>;
  if (
    typeof candidate.conversation_id !== "string"
    || (candidate.source_url !== null && typeof candidate.source_url !== "string")
    || (candidate.title !== null && typeof candidate.title !== "string")
    || typeof candidate.is_playing !== "boolean"
    || typeof candidate.position_seconds !== "number"
    || typeof candidate.anchor_at !== "string"
    || typeof candidate.revision !== "number"
    || typeof candidate.updated_by !== "string"
    || typeof candidate.updated_at !== "string"
  ) return null;
  return candidate as ConversationMusicState;
}

export function extractMusicBroadcast(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const wrapper = payload as Record<string, unknown>;
  const inner = wrapper.payload && typeof wrapper.payload === "object"
    ? wrapper.payload as Record<string, unknown>
    : wrapper;
  return normalizeMusicState(inner.new ?? inner.record ?? inner);
}

export function synchronizedMusicPosition(state: ConversationMusicState, now = Date.now()) {
  if (!state.is_playing) return state.position_seconds;
  const anchor = Date.parse(state.anchor_at);
  if (!Number.isFinite(anchor)) return state.position_seconds;
  return Math.max(0, state.position_seconds + (now - anchor) / 1000);
}

export function formatMusicTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const whole = Math.floor(value);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}
