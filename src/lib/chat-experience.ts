import type { DecryptedMessage } from "./workspace";
export type ReadState = Record<string, { unread: number; lastReadAt: string }>;
export function matchesMessage(message: Pick<DecryptedMessage, "body" | "author" | "attachment" | "createdAt">, query: string) {
  const filters = [...query.matchAll(/(from|before|after|has):("[^"]+"|\S+)/g)];
  const text = query.replace(/(from|before|after|has):("[^"]+"|\S+)/g, "").trim().toLocaleLowerCase();
  if (text && !`${message.author} ${message.body} ${message.attachment?.name ?? ""}`.toLocaleLowerCase().includes(text)) return false;
  return filters.every(([, key, raw]) => {
    const value = raw.replace(/^"|"$/g, "").toLocaleLowerCase();
    if (key === "from") return message.author.toLocaleLowerCase().includes(value);
    if (key === "has") return value === "file" ? Boolean(message.attachment) : value === "image" ? Boolean(message.attachment?.type.startsWith("image/")) : value === "link" ? /https?:\/\//.test(message.body) : false;
    const date = Date.parse(value);
    if (!Number.isFinite(date)) return false;
    return key === "before" ? Date.parse(message.createdAt) < date : Date.parse(message.createdAt) >= date;
  });
}
export function mergeMessages(current: DecryptedMessage[], incoming: DecryptedMessage[]) {
  const entries = new Map(current.map(message => [message.id, message]));
  incoming.forEach(message => entries.set(message.id, message));
  return [...entries.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
}
