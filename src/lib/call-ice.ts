import { supabase } from "./supabase";

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" }];
export type CallIceConfig = { iceServers: RTCIceServer[]; relayAvailable: boolean; expiresAt: number };
const cached = new Map<string, CallIceConfig>();

export function parseCallIceConfig(value: unknown): CallIceConfig {
  if (!value || typeof value !== "object" || !("iceServers" in value) || !Array.isArray(value.iceServers) || !("expiresAt" in value) || typeof value.expiresAt !== "number" || value.expiresAt < Date.now() + 60000 || value.expiresAt > Date.now() + 3700000) throw new Error("invalid_relay_response");
  const iceServers: RTCIceServer[] = [];
  for (const item of value.iceServers.slice(0, 8)) {
    if (!item || typeof item !== "object") continue;
    const urls = (Array.isArray(item.urls) ? item.urls : [item.urls]).filter((url: unknown): url is string => typeof url === "string" && /^(stun:stun|turns?:turn)\.cloudflare\.com:(3478|443|80|5349)(\?transport=(udp|tcp))?$/.test(url));
    if (!urls.length) continue;
    if (urls.some((url: string) => /^turns?:/.test(url))) {
      if (typeof item.username !== "string" || !item.username || item.username.length > 2048 || typeof item.credential !== "string" || !item.credential || item.credential.length > 2048) continue;
      iceServers.push({ urls, username: item.username, credential: item.credential });
    } else iceServers.push({ urls });
  }
  if (!iceServers.some(server => server.credential)) throw new Error("invalid_relay_response");
  return { iceServers, relayAvailable: true, expiresAt: value.expiresAt };
}

export async function loadCallIceConfig(conversationId: string, signal?: AbortSignal, refresh = false): Promise<CallIceConfig> {
  const fallback = { iceServers: DEFAULT_ICE_SERVERS, relayAvailable: false, expiresAt: 0 };
  const endpoint = import.meta.env.VITE_TURN_URL?.trim();
  if (!endpoint || !supabase) return fallback;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") throw new Error("insecure_relay_endpoint");
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) return fallback;
    const cacheKey = `${data.session.user.id}:${conversationId}`;
    const previous = cached.get(cacheKey);
    if (!refresh && previous && previous.expiresAt > Date.now() + 120000) return previous;
    const response = await fetch(url, {
      method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ conversationId }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });
    if (!response.ok) { await response.body?.cancel(); return previous && previous.expiresAt > Date.now() + 60000 ? previous : fallback; }
    const config = parseCallIceConfig(await response.json());
    // Keep credentials in memory only; never persist them with chat or account data.
    for (const [key, item] of cached) if (item.expiresAt <= Date.now()) cached.delete(key);
    if (cached.size >= 64) cached.delete(cached.keys().next().value!);
    cached.set(cacheKey, config);
    return config;
  } catch (error) { if (signal?.aborted) throw error; return fallback; }
}
