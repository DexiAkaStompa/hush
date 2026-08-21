import { supabase } from "./supabase";

const bridgeUrl = (import.meta.env.VITE_MUSIC_BRIDGE_URL as string | undefined)?.trim().replace(/\/$/, "") || "";

export const isMusicBridgeConfigured = Boolean(bridgeUrl);

async function bridgeRequest(path: string, params: Record<string, string>) {
  if (!bridgeUrl || !supabase) throw new Error("Music bridge non configurato.");
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("Sessione Supabase scaduta.");
  const query = new URLSearchParams(params);
  const response = await fetch(`${bridgeUrl}${path}?${query}`, {
    headers: { Authorization: `Bearer ${data.session.access_token}` },
  });
  const payload = await response.json().catch(() => null) as { error?: string; url?: string } | null;
  if (!response.ok) throw new Error(payload?.error || `Music bridge ${response.status}.`);
  return payload;
}

export async function requestMusicStream(source: string, position = 0) {
  const payload = await bridgeRequest("/v1/stream-ticket", {
    source,
    position: String(Math.max(0, position)),
  });
  if (!payload?.url) throw new Error("Il bridge non ha restituito uno stream.");
  return payload.url;
}

export async function searchMusicBridge(query: string, provider: "youtube" | "spotify") {
  const payload = await bridgeRequest("/v1/search", { q: query, source: provider }) as {
    tracks?: Array<{ title: string; author: string; url: string; artworkUrl: string | null; length: number }>;
  };
  return Array.isArray(payload.tracks) ? payload.tracks : [];
}
