import { supabase } from "./supabase";
import type { Profile } from "./workspace";

export type Friendship = {
  id: string;
  requester_id: string;
  recipient_id: string;
  status: "pending" | "accepted";
  created_at: string;
  updated_at: string;
};
export type FriendEntry = Friendship & { user: Profile };
export function friendshipKind(row: Friendship, selfId: string) {
  return row.status === "accepted"
    ? "friend"
    : row.recipient_id === selfId
      ? "incoming"
      : "outgoing";
}
export function friendshipError(error: unknown): string {
  const e = error as { code?: string; message?: string };
  if (e?.code === "23505")
    return "Esiste già un’amicizia o una richiesta tra voi. Controlla le richieste ricevute e inviate.";
  if (e?.message?.includes("unknown_username"))
    return "Nessun utente con questo username. Controlla di averlo scritto esattamente.";
  if (e?.message?.includes("cannot_friend_yourself"))
    return "Non puoi inviare una richiesta a te stesso.";
  if (e?.message?.includes("too_many_friend_requests"))
    return "Hai già 100 richieste in attesa. Annullane alcune prima di inviarne altre.";
  return "Operazione non riuscita. Riprova tra poco.";
}
function client() {
  if (!supabase) throw new Error("Supabase non configurato");
  return supabase;
}
export async function loadFriendships(selfId: string): Promise<FriendEntry[]> {
  const rows: Friendship[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await client()
      .from("friendships")
      .select("*")
      .or(`requester_id.eq.${selfId},recipient_id.eq.${selfId}`)
      .order("id")
      .range(start, start + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as Friendship[]));
    if ((data?.length ?? 0) < 1000) break;
  }
  const ids = [
    ...new Set(
      rows.map((row) =>
        row.requester_id === selfId ? row.recipient_id : row.requester_id,
      ),
    ),
  ];
  const profiles = new Map<string, Profile>();
  for (let start = 0; start < ids.length; start += 100) {
    const { data, error } = await client()
      .from("profiles")
      .select(
        "id,username,display_name,avatar_color,avatar_path,banner_path,bio,created_at",
      )
      .in("id", ids.slice(start, start + 100));
    if (error) throw error;
    for (const user of (data ?? []) as Profile[]) profiles.set(user.id, user);
  }
  return rows.flatMap((row) => {
    const user = profiles.get(
      row.requester_id === selfId ? row.recipient_id : row.requester_id,
    );
    return user ? [{ ...row, user }] : [];
  });
}
export async function sendFriendRequest(username: string) {
  const { error } = await client().rpc("send_friend_request", {
    p_username: username.trim(),
  });
  if (error) throw error;
}
export async function acceptFriendRequest(id: string) {
  const { data, error } = await client()
    .from("friendships")
    .update({ status: "accepted" })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("request_no_longer_pending");
}
export async function removeFriendship(id: string) {
  const { error } = await client().from("friendships").delete().eq("id", id);
  if (error) throw error;
}
