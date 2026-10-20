import { playPackSound } from "./sound-pack";

const callCue = {
  join: "user_join", enabled: "unmute", disabled: "mute",
  deafen: "deafen", undeafen: "undeafen", cameraOn: "camera_on", cameraOff: "camera_off",
  share: "stream_started", shareEnd: "stream_ended", leave: "disconnect",
} as const;
const musicCue = {
  play: "activity_launch", pause: "activity_end", seek: "checkpoint_popup_press_HYP",
  volume: "ptt_start", skipNext: "checkpoint_popup_press_HYP",
} as const;
const chatCue = {
  typing: "ptt_start", send: "message2", receive: "message1", reaction: "success", mention: "mention1",
} as const;

const lastPlayed = new Map<string, number>();
function playSound(cue: string, cooldownMs = 90) {
  const now = Date.now();
  const previous = lastPlayed.get(cue);
  if (previous !== undefined && now - previous < cooldownMs) return;
  lastPlayed.set(cue, now);
  playPackSound(cue);
}

/** Local-only acknowledgement; it is never inserted into the WebRTC stream. */
export const playCallSound = (kind: keyof typeof callCue) => playSound(callCue[kind]);
export const playMusicSound = (kind: keyof typeof musicCue) => playSound(musicCue[kind], kind === "volume" ? 220 : 90);
export const playChatSound = (kind: keyof typeof chatCue) => playSound(chatCue[kind], kind === "typing" ? 280 : 120);
