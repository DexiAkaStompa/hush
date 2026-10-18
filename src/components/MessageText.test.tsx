import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageText } from "./MessageText";
import { extractMentions, type MentionTarget } from "../lib/mentions";
const targets: MentionTarget[] = [
  {
    kind: "role",
    id: "staff",
    label: "HEAD ADMIN",
    name: "Staff",
    color: "#aabbcc",
  },
  { kind: "user", id: "user", label: "anna", name: "Anna" },
];
describe("MessageText mentions", () => {
  it("preserves formatting, quotes and offsets across multiple lines", () => {
    const text =
      "Ciao **@HEAD ADMIN**\n> @anna\n`@anna`\n```\n@HEAD ADMIN\n```";
    const html = renderToStaticMarkup(
      <MessageText
        text={text}
        mentions={extractMentions(text, targets)}
        targets={targets}
      />,
    );
    expect(html.match(/class="message-mention"/g)).toHaveLength(2);
    expect(html).toContain("<strong><span");
    expect(html).toContain("<blockquote><span");
    expect(html).toContain("<code>@anna</code>");
  });
  it("escapes text and never interprets an HTML tag as markup", () => {
    const text = "<img src=x onerror=alert(1)> @anna";
    const html = renderToStaticMarkup(
      <MessageText
        text={text}
        mentions={extractMentions(text, targets)}
        targets={targets}
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
