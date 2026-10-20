import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { supabase } from "./supabase";
type Observer = (count: number | null) => void;
let client: SupabaseClient | null = null;
const rooms = new Map<
  string,
  { channel: RealtimeChannel; observers: Set<Observer>; count: number | null }
>();
export function voiceOccupancy(
  state: Record<string, Array<{ userId?: string; inCall?: boolean }>>,
): number {
  return new Set(
    Object.values(state)
      .flat()
      .filter((entry) => entry.inCall && entry.userId)
      .map((entry) => entry.userId!),
  ).size;
}
// Observe presence on a separate, shared connection. Never track a presence
// here: merely viewing an embed must not join or disturb an existing call.
export function observeVoicePreview(
  id: string,
  observer: Observer,
): () => void {
  const existing = rooms.get(id);
  if (existing) {
    existing.observers.add(observer);
    observer(existing.count);
    return () => release(id, observer);
  }
  if (!supabase || rooms.size >= 3) return () => {};
  if (!client)
    client = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        accessToken: async () =>
          (await supabase!.auth.getSession()).data.session?.access_token ??
          null,
      },
    );
  const channel = client.channel(`call:${id}`, { config: { private: true } }),
    entry = {
      channel,
      observers: new Set([observer]),
      count: null as number | null,
    };
  rooms.set(id, entry);
  const emit = (count: number | null) => {
    entry.count = count;
    entry.observers.forEach((fn) => fn(count));
  };
  channel
    .on("presence", { event: "sync" }, () =>
      emit(
        voiceOccupancy(
          channel.presenceState<{ userId?: string; inCall?: boolean }>(),
        ),
      ),
    )
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") emit(null);
    });
  return () => release(id, observer);
}
function release(id: string, observer: Observer) {
  const entry = rooms.get(id);
  if (!entry) return;
  entry.observers.delete(observer);
  if (entry.observers.size) return;
  rooms.delete(id);
  if (client) void client.removeChannel(entry.channel);
  if (!rooms.size && client) {
    const previous = client;
    client = null;
    void previous.removeAllChannels();
  }
}
