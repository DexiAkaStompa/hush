export type MentionKind = "user" | "role" | "everyone" | "here";
export type MentionTarget = {
  kind: MentionKind;
  id: string;
  label: string;
  name: string;
  color?: string;
  allowed?: boolean;
};
export type MessageMention = {
  kind: MentionKind;
  id: string;
  label: string;
  start: number;
  end: number;
};
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function extractMentions(
  text: string,
  targets: MentionTarget[],
): MessageMention[] {
  const excluded = [
    ...text.matchAll(/```[\s\S]*?```|`[^`\n]*`|https?:\/\/[^\s<>]+/g),
  ].map((m) => [m.index!, m.index! + m[0].length]);
  const mentions: MessageMention[] = [];
  for (const target of [...targets]
    .filter((t) => t.allowed !== false)
    .sort((a, b) => b.label.length - a.label.length)) {
    if (!target.label || target.label.length > 80) continue;
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}_@])@${escape(target.label)}(?![\\p{L}\\p{N}_-])`,
      "giu",
    );
    for (const m of text.matchAll(pattern)) {
      const start = m.index! + m[1].length,
        end = start + target.label.length + 1;
      if (
        excluded.some(([a, b]) => start < b && end > a) ||
        mentions.some((r) => start < r.end && end > r.start)
      )
        continue;
      mentions.push({
        kind: target.kind,
        id: target.id,
        label: text.slice(start + 1, end),
        start,
        end,
      });
      if (mentions.length >= 100)
        return mentions.sort((a, b) => a.start - b.start);
    }
  }
  return mentions.sort((a, b) => a.start - b.start);
}
export function parseMentions(
  value: unknown,
  text: string,
): MessageMention[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .slice(0, 100)
    .filter(
      (item): item is MessageMention =>
        !!item &&
        typeof item === "object" &&
        ["user", "role", "everyone", "here"].includes(item.kind) &&
        typeof item.id === "string" &&
        item.id.length <= 100 &&
        typeof item.label === "string" &&
        item.label.length <= 80 &&
        Number.isInteger(item.start) &&
        Number.isInteger(item.end) &&
        item.start >= 0 &&
        item.end <= text.length &&
        text.slice(item.start, item.end) === `@${item.label}`,
    )
    .sort((a, b) => a.start - b.start)
    .filter((m, i, all) => i === 0 || m.start >= all[i - 1].end);
}
export function resolveMentions(
  text: string,
  stored: MessageMention[] | undefined,
  targets: MentionTarget[],
) {
  return stored === undefined
    ? extractMentions(text, targets)
    : (parseMentions(stored, text) ?? []).filter((m) =>
        targets.some(
          (t) => t.kind === m.kind && t.id === m.id && t.allowed !== false,
        ),
      );
}
export function mentionsRecipient(
  mentions: MessageMention[],
  selfId: string,
  roleIds: string[],
  online: boolean,
) {
  return mentions.some(
    (m) =>
      m.kind === "everyone" ||
      (m.kind === "here" && online) ||
      (m.kind === "user" && m.id === selfId) ||
      (m.kind === "role" && roleIds.includes(m.id)),
  );
}
export function mentionQuery(text: string, cursor = text.length) {
  const prefix = text.slice(0, cursor);
  const match = prefix.match(/(?:^|\s)@([^@\n]{0,80})$/);
  return match
    ? {
        start: cursor - match[1].length - 1,
        end: cursor,
        query: match[1].toLocaleLowerCase("it"),
      }
    : null;
}
