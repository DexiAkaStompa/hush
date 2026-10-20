function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}
export function messageDayLabel(value: string, now = new Date()): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  if (sameDay(date, now)) return "Oggi";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(date, yesterday)) return "Ieri";
  return date.toLocaleDateString("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
export function messageTimestamp(value: string, now = new Date()): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const day = messageDayLabel(value, now),
    time = date.toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
    });
  return day === "Oggi" || day === "Ieri"
    ? `${day.toLowerCase()} alle ${time}`
    : `${date.toLocaleDateString("it-IT")} ${time}`;
}
