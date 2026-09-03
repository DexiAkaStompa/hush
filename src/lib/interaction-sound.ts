type CallSound = "enabled" | "disabled" | "leave";

/**
 * A small local-only confirmation sound. It deliberately uses Web Audio rather
 * than an audio file so calls do not fetch assets or send anything to peers.
 */
export function playCallSound(kind: CallSound) {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextClass) return;

  try {
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    const [from, to, duration] = kind === "enabled"
      ? [620, 860, 0.075]
      : kind === "disabled"
        ? [420, 300, 0.075]
        : [360, 220, 0.12];

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(to, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.045, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
    oscillator.addEventListener("ended", () => void context.close(), { once: true });
  } catch {
    // Audio is an optional acknowledgement; an unavailable device must not block a call action.
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
