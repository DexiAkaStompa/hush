import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import {
  acceptFriendRequest,
  friendshipError,
  loadFriendships,
  removeFriendship,
  sendFriendRequest,
  type FriendEntry,
} from "./friendships";

export function useFriendships(selfId: string) {
  const [entries, setEntries] = useState<FriendEntry[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const generation = useRef(0),
    alive = useRef(true),
    current = useRef(entries);
  current.current = entries;
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const rows = await loadFriendships(selfId);
      if (alive.current && generation.current === request) {
        setEntries(rows);
        setError("");
      }
    } catch (e) {
      if (alive.current && generation.current === request)
        setError(friendshipError(e));
    } finally {
      if (alive.current && generation.current === request) setLoading(false);
    }
  }, [selfId]);
  useEffect(() => {
    alive.current = true;
    setLoading(true);
    setEntries([]);
    void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 150);
    };
    const channel = supabase
      ?.channel(`friendships:${selfId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "friendships" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const id = payload.old.id;
            if (current.current.some((row) => row.id === id)) {
              setEntries((rows) => rows.filter((row) => row.id !== id));
              schedule();
            }
          } else if (
            payload.new.requester_id === selfId ||
            payload.new.recipient_id === selfId
          )
            schedule();
        },
      )
      .subscribe();
    const focus = () => {
      if (!document.hidden) void refresh();
    };
    const poll = setInterval(focus, 30000);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      alive.current = false;
      generation.current++;
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
      if (channel) void supabase?.removeChannel(channel);
    };
  }, [selfId, refresh]);
  const send = async (username: string) => {
    await sendFriendRequest(username);
    await refresh();
  };
  const accept = async (id: string) => {
    await acceptFriendRequest(id);
    await refresh();
  };
  const remove = async (id: string) => {
    await removeFriendship(id);
    setEntries((rows) => rows.filter((row) => row.id !== id));
    await refresh();
  };
  return { entries, loading, error, refresh, send, accept, remove, selfId };
}
export type FriendshipsController = ReturnType<typeof useFriendships>;
