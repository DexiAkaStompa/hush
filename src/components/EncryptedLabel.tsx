import { useEffect, useState } from "react";

const glyphs = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function EncryptedLabel({ text }: { text: string }) {
  const [visible, setVisible] = useState(text);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const timer = window.setInterval(() => {
      frame += 1;
      setVisible(
        text
          .split("")
          .map((character, index) => {
            if (character === " " || index < frame / 2) return character;
            return glyphs[Math.floor(Math.random() * glyphs.length)];
          })
          .join(""),
      );
      if (frame >= text.length * 2) window.clearInterval(timer);
    }, 28);
    return () => window.clearInterval(timer);
  }, [text]);

  return <span aria-label={text}>{visible}</span>;
}
