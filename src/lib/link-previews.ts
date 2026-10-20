import { supabase } from "./supabase";
export type LinkPreview = {
  url: string;
  title: string;
  description: string;
  siteName: string;
  image?: string;
  kind?:
    | "link"
    | "invite"
    | "voice-invite"
    | "hush-invite"
    | "hush-voice"
    | "hush-channel";
  members?: number;
  online?: number;
  unavailable?: boolean;
  isMember?: boolean;
  spaceId?: string;
  icon?: string;
};
const cache = new Map<string, { value: LinkPreview; until: number }>();
export function invalidateLinkPreview(url: string) {
  for (const key of cache.keys())
    if (key.endsWith(":" + url)) cache.delete(key);
}
let active = 0;
const waiting: Array<{ start: () => void; cancel: () => void }> = [];
async function slot(signal: AbortSignal) {
  signal.throwIfAborted();
  if (active < 2) {
    active++;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const entry = {
      start: () => {
        signal.removeEventListener("abort", entry.cancel);
        active++;
        resolve();
      },
      cancel: () => {
        const index = waiting.indexOf(entry);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal.reason);
      },
    };
    waiting.push(entry);
    signal.addEventListener("abort", entry.cancel, { once: true });
  });
}
function release() {
  active--;
  waiting.shift()?.start();
}
export function extractPreviewLinks(text: string): string[] {
  const visible = text.replace(
    /```[\s\S]*?```|`[^`\n]*`|<https?:\/\/[^>]+>/g,
    "",
  );
  const result: string[] = [];
  for (const match of visible.matchAll(
    /(?:https?:\/\/|hush:\/\/(?:invite|channel)\/)[^\s<>]+/gi,
  )) {
    let value = match[0].replace(/[.,!?:;]+$/, "");
    while (
      value.endsWith(")") &&
      (value.match(/\)/g)?.length ?? 0) > (value.match(/\(/g)?.length ?? 0)
    )
      value = value.slice(0, -1);
    try {
      const url = new URL(value);
      if (url.username || url.password || value.length > 2048) continue;
      if (url.protocol === "http:") url.protocol = "https:";
      if (
        url.protocol === "hush:" &&
        !(
          /^hush:\/\/invite\/[a-f0-9]{48}$/i.test(value) ||
          /^hush:\/\/channel\/[a-f0-9-]{36}$/i.test(value)
        )
      )
        continue;
      url.hash = "";
      if (!result.includes(url.href)) result.push(url.href);
      if (result.length === 3) break;
    } catch {}
  }
  return result;
}
async function request(url: string, mode: string, signal: AbortSignal) {
  if (!supabase) throw Error("not_configured");
  await slot(signal);
  try {
    signal.throwIfAborted();
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw Error("unauthorized");
    const base = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
    const response = await fetch(base + "/functions/v1/link-preview", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, mode }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    });
    if (!response.ok) throw Error("preview_unavailable");
    return response;
  } finally {
    release();
  }
}
export async function loadLinkPreview(
  url: string,
  signal: AbortSignal,
): Promise<LinkPreview> {
  const { data: session } = await supabase!.auth.getSession();
  if (!session.session) throw Error("unauthorized");
  const key = session.session.user.id + ":" + url;
  const cached = cache.get(key);
  if (cached && cached.until > Date.now()) return cached.value;
  let value: LinkPreview;
  if (url.startsWith("hush://invite/")) {
    const { data, error } = await supabase!.rpc("get_space_invite_preview", {
      p_token: new URL(url).pathname.slice(1),
    });
    if (error) throw error;
    value = data
      ? {
          url,
          title: data.name,
          description: `${data.member_count} membri`,
          siteName: "Hush",
          kind: "hush-invite",
          isMember: data.is_member,
          spaceId: data.id,
          icon: data.icon_data,
        }
      : {
          url,
          title: "Invito Hush",
          description: "Questo invito è scaduto o non è disponibile.",
          siteName: "Hush",
          kind: "hush-invite",
          unavailable: true,
        };
  } else if (url.startsWith("hush://channel/")) {
    const { data, error } = await supabase!
      .from("conversations")
      .select("id,name,kind")
      .eq("id", new URL(url).pathname.slice(1))
      .maybeSingle();
    if (error) throw error;
    value = data
      ? {
          url,
          title: data.name,
          description:
            data.kind === "voice_channel"
              ? "Entra per parlare con gli altri membri."
              : "Apri il canale in Hush.",
          siteName: "Hush",
          kind: data.kind === "voice_channel" ? "hush-voice" : "hush-channel",
        }
      : {
          url,
          title: "Canale Hush",
          description:
            "Solo i membri autorizzati possono aprire questo canale.",
          siteName: "Hush",
          kind: "hush-channel",
          unavailable: true,
        };
  } else value = await (await request(url, "metadata", signal)).json();
  signal.throwIfAborted();
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  cache.set(key, {
    value,
    until: Date.now() + (url.startsWith("hush:") ? 60000 : 30 * 60000),
  });
  return value;
}
export async function loadPreviewImage(
  url: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await request(url, "image", signal),
    blob = await response.blob();
  if (
    blob.size > 2 * 1024 * 1024 ||
    !/^image\/(png|jpeg|webp|gif)$/.test(blob.type)
  )
    throw Error("invalid_image");
  signal.throwIfAborted();
  return URL.createObjectURL(blob);
}
