/**
 * Web Audio API synthesizer for incoming call ringtone.
 * Generates a modern, gentle, recurring chime loop without external asset dependencies.
 */

let activeRingtoneContext: AudioContext | null = null;
let ringtoneInterval: number | null = null;
let ringtoneTimeout: number | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  if (!activeRingtoneContext || activeRingtoneContext.state === "closed") {
    try {
      activeRingtoneContext = new AudioCtx();
    } catch {
      return null;
    }
  }

  if (activeRingtoneContext.state === "suspended") {
    void activeRingtoneContext.resume().catch(() => {});
  }

  return activeRingtoneContext;
}

function playChime(ctx: AudioContext) {
  try {
    const now = ctx.currentTime;

    // First note (523.25 Hz - C5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(523.25, now);
    osc1.frequency.exponentialRampToValueAtTime(587.33, now + 0.15); // Slide slightly to D5
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.18, now + 0.04);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.5);

    // Second note (659.25 Hz - E5)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(659.25, now + 0.18);
    osc2.frequency.exponentialRampToValueAtTime(783.99, now + 0.35); // Slide to G5
    gain2.gain.setValueAtTime(0, now + 0.18);
    gain2.gain.linearRampToValueAtTime(0.22, now + 0.22);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.18);
    osc2.stop(now + 0.8);

    // Soft harmonizing overtone (1046.5 Hz - C6)
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = "sine";
    osc3.frequency.setValueAtTime(1046.5, now + 0.2);
    gain3.gain.setValueAtTime(0, now + 0.2);
    gain3.gain.linearRampToValueAtTime(0.08, now + 0.24);
    gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    osc3.connect(gain3);
    gain3.connect(ctx.destination);
    osc3.start(now + 0.2);
    osc3.stop(now + 0.75);
  } catch {
    // Audio synthesis failure should not crash
  }
}

export type RingtoneOptions = {
  durationMs?: number; // default ~30000ms (30s)
  intervalMs?: number; // default 2200ms
  onEnd?: () => void;
};

/**
 * Starts the incoming call ringtone.
 * Returns a function to cancel/stop the ringtone immediately.
 */
export function startIncomingCallRingtone(options?: RingtoneOptions): () => void {
  // Stop any previously playing ringtone first
  stopIncomingCallRingtone();

  const duration = options?.durationMs ?? 30000;
  const interval = options?.intervalMs ?? 2200;

  const ctx = getAudioContext();
  if (ctx) {
    playChime(ctx);
    ringtoneInterval = globalThis.setInterval(() => {
      if (activeRingtoneContext && activeRingtoneContext.state !== "closed") {
        playChime(activeRingtoneContext);
      }
    }, interval) as unknown as number;
  }

  ringtoneTimeout = globalThis.setTimeout(() => {
    stopIncomingCallRingtone();
    options?.onEnd?.();
  }, duration) as unknown as number;

  return stopIncomingCallRingtone;
}

export function stopIncomingCallRingtone() {
  if (ringtoneInterval !== null) {
    globalThis.clearInterval(ringtoneInterval);
    ringtoneInterval = null;
  }
  if (ringtoneTimeout !== null) {
    globalThis.clearTimeout(ringtoneTimeout);
    ringtoneTimeout = null;
  }
}
