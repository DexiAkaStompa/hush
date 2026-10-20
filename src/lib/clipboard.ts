import { Capacitor } from '@capacitor/core';

export async function copyText(text: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { Clipboard } = await import('@capacitor/clipboard');
    await Clipboard.write({ string: text });
    return;
  }
  if (window.hushWindow) {
    await window.hushWindow.copyText(text);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Older browsers and contexts without clipboard permission.
    const previous = document.activeElement as HTMLElement | null;
    const field = document.createElement("textarea");
    field.value = text;
    field.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.append(field);
    field.select();
    try {
      if (!document.execCommand("copy")) throw new Error("Seleziona il testo e premi Ctrl+C per copiarlo.");
    } finally {
      field.remove();
      previous?.focus();
    }
  }
}
