import { Fragment } from "react";
// React escapes text. Only explicit http(s) URLs become links; no HTML rendering.
function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*|https?:\/\/[^\s<>]+)/g);
  return <>{parts.map((part,index) => part.startsWith("`") ? <code key={index}>{part.slice(1,-1)}</code> : part.startsWith("**") ? <strong key={index}>{part.slice(2,-2)}</strong> : part.startsWith("~~") ? <del key={index}>{part.slice(2,-2)}</del> : part.startsWith("*") ? <em key={index}>{part.slice(1,-1)}</em> : /^https?:\/\//.test(part) ? <a key={index} href={part} target="_blank" rel="noopener noreferrer">{part}</a> : <Fragment key={index}>{part}</Fragment>)}</>;
}
export function MessageText({ text }: { text: string }) {
  return <div className="message-text">{text.split(/(```[\s\S]*?```)/g).map((part,index) => part.startsWith("```") ? <pre key={index}><code>{part.slice(3,-3).replace(/^\w*\n/,"")}</code></pre> : part.split("\n").map((line,row) => line.startsWith("> ") ? <blockquote key={`${index}-${row}`}><Inline text={line.slice(2)} /></blockquote> : <div key={`${index}-${row}`}><Inline text={line} />{!line && <br />}</div>))}</div>;
}
