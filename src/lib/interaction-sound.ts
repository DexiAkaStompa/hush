import { createUISFX } from "uisfx";

type CallSound = "enabled" | "disabled" | "leave";

const callSfx = createUISFX({
  pack: "glass",
  volume: 0.32,
  preferences: { key: "hush-call-sfx" },
});

const callCue = {
  enabled: "toggle-on",
  disabled: "toggle-off",
  leave: "disconnect",
} as const;

/** A local-only acknowledgement; it is never inserted into the WebRTC stream. */
export async function playCallSound(kind: CallSound) {
  try {
    if (await callSfx.unlock()) callSfx.play(callCue[kind], { cooldownMs: 90 });
  } catch {
    // Audio is optional: unavailable output must never block a call control.
  }
}
