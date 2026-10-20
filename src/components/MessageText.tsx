import { Fragment, type ReactNode } from "react";
import type { MessageMention, MentionTarget } from "../lib/mentions";
type Props = {
  text: string;
  mentions?: MessageMention[];
  targets?: MentionTarget[];
  offset?: number;
  edited?: boolean;
  onHushLink?: (url: string) => Promise<void>;
};
function Plain({ text, offset = 0, mentions = [], targets = [] }: Props) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const m of mentions.filter(
    (m) => m.start >= offset && m.end <= offset + text.length,
  )) {
    const start = m.start - offset,
      end = m.end - offset,
      target = targets.find((t) => t.kind === m.kind && t.id === m.id);
    if (start < cursor) continue;
    nodes.push(
      text.slice(cursor, start),
      <span
        key={`${m.kind}-${m.start}`}
        className="message-mention"
        style={target?.color ? { color: target.color } : undefined}
        title={
          m.kind === "role"
            ? `Ruolo: ${m.label}`
            : m.kind === "everyone"
              ? "Tutti i membri"
              : m.kind === "here"
                ? "Membri online"
                : (target?.name ?? m.label)
        }
      >
        {text.slice(start, end)}
      </span>,
    );
    cursor = end;
  }
  nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}
// React escapes all text. Only explicit HTTP(S) links are navigable.
function Inline({ text, offset = 0, ...props }: Props) {
  let cursor = offset;
  return (
    <>
      {text
        .split(
          /(`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*|(?:https?:\/\/|hush:\/\/)[^\s<>]+)/g,
        )
        .map((part, index) => {
          const start = cursor;
          cursor += part.length;
          const inner = (n: number) => (
            <Inline {...props} text={part.slice(n, -n)} offset={start + n} />
          );
          return (
            <Fragment key={index}>
              {part.startsWith("`") ? (
                <code>{part.slice(1, -1)}</code>
              ) : part.startsWith("**") ? (
                <strong>{inner(2)}</strong>
              ) : part.startsWith("~~") ? (
                <del>{inner(2)}</del>
              ) : part.startsWith("*") ? (
                <em>{inner(1)}</em>
              ) : props.onHushLink &&
                /^hush:\/\/(?:invite\/[a-f0-9]{48}|channel\/[a-f0-9-]{36})$/i.test(
                  part,
                ) ? (
                <a
                  href={part}
                  onClick={(event) => {
                    event.preventDefault();
                    void props.onHushLink?.(part);
                  }}
                >
                  {part}
                </a>
              ) : /^https?:\/\//.test(part) ? (
                <a href={part} target="_blank" rel="noopener noreferrer">
                  {part}
                </a>
              ) : (
                <Plain {...props} text={part} offset={start} />
              )}
            </Fragment>
          );
        })}
    </>
  );
}
export function MessageText({ text, edited, ...props }: Props) {
  let cursor = 0;
  return (
    <div className="message-text">
      {text.split(/(```[\s\S]*?```)/g).map((part, index) => {
        const start = cursor;
        cursor += part.length;
        if (part.startsWith("```"))
          return (
            <pre key={index}>
              <code>{part.slice(3, -3).replace(/^\w*\n/, "")}</code>
            </pre>
          );
        let lineStart = start;
        return part.split("\n").map((line, row) => {
          const offset = lineStart;
          lineStart += line.length + 1;
          return line.startsWith("> ") ? (
            <blockquote key={`${index}-${row}`}>
              <Inline {...props} text={line.slice(2)} offset={offset + 2} />
            </blockquote>
          ) : (
            <div key={`${index}-${row}`}>
              <Inline {...props} text={line} offset={offset} />
              {!line && <br />}
            </div>
          );
        });
      })}
      {edited && <small className="message-edited-label"> (modificato)</small>}
    </div>
  );
}
