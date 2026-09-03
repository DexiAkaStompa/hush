import { createUISFX, type CueName } from "uisfx";

type CallSound = "join" | "enabled" | "disabled" | "share" | "leave";
type MusicSound = "play" | "pause" | "seek" | "volume" | "skipNext";
type ChatSound = "typing" | "send" | "receive" | "reaction" | "mention";

const zenSfx = createUISFX({
  pack: "zen",
  volume: 0.32,
  preferences: { key: "hush-interface-sfx" },
});

const callCue = {
  join: "start",
  enabled: "toggle-on",
  disabled: "toggle-off",
  share: "complete",
  leave: "skip-previous",
} as const;

const musicCue = {
  play: "play",
  pause: "pause",
  seek: "seek",
  volume: "volume-change",
  skipNext: "skip-next",
} as const;

const chatCue = {
  typing: "typing",
  send: "send",
  receive: "receive",
  reaction: "reaction",
  mention: "mention",
} as const;

async function playZenSound(cue: CueName, cooldownMs = 90) {
  try {
    if (await zenSfx.unlock()) zenSfx.play(cue, { cooldownMs });
  } catch {
    // Audio is optional: unavailable output must never block an action.
  }
}

/** Local-only acknowledgement; it is never inserted into the WebRTC stream. */
export const playCallSound = (kind: CallSound) => playZenSound(callCue[kind]);
export const playMusicSound = (kind: MusicSound) => playZenSound(musicCue[kind], kind === "volume" ? 220 : 90);
export const playChatSound = (kind: ChatSound) => playZenSound(chatCue[kind], kind === "typing" ? 280 : 120);
