import type { DecryptedMessage } from "./workspace";
type LayoutMessage = Pick<
  DecryptedMessage,
  "senderId" | "createdAt" | "replyId"
>;

export function isMessageContinuation(
  previous: LayoutMessage | undefined,
  current: LayoutMessage,
): boolean {
  if (
    !previous?.senderId ||
    previous.senderId !== current.senderId ||
    previous.replyId ||
    current.replyId
  )
    return false;
  const first = new Date(previous.createdAt),
    next = new Date(current.createdAt);
  const elapsed = next.getTime() - first.getTime();
  return (
    elapsed >= 0 &&
    elapsed < 5 * 60 * 1000 &&
    first.toDateString() === next.toDateString()
  );
}
