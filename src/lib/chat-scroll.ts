export type ChatScrollAnchor = { element: HTMLElement; offset: number };

// Measure a visible message, rather than the total height: the browser may
// already have anchored the scroll position when older messages are inserted.
export function captureChatScrollAnchor(container: HTMLElement): ChatScrollAnchor | null {
  const top = container.getBoundingClientRect().top;
  const element = Array.from(container.querySelectorAll<HTMLElement>('[id^="message-"]'))
    .find(message => message.getBoundingClientRect().bottom > top);
  return element ? { element, offset: element.getBoundingClientRect().top - top } : null;
}

export function restoreChatScrollAnchor(container: HTMLElement, anchor: ChatScrollAnchor) {
  if (!container.contains(anchor.element)) return;
  const offset = anchor.element.getBoundingClientRect().top - container.getBoundingClientRect().top;
  container.scrollTop += offset - anchor.offset;
}
