/** Relative to Vite's base, including the desktop file build. */
export function soundPackUrl(name: string): string {
  return `${import.meta.env.BASE_URL}sounds/${name}.mp3`;
}

export function configureSoundOutput(audio: HTMLAudioElement, volume = 1): void {
  let outputVolume = 100;
  let outputId = "";
  try {
    const settings = JSON.parse(localStorage.getItem("hush:media:v1") ?? "null");
    if (Number.isFinite(settings?.outputVolume)) outputVolume = settings.outputVolume;
    if (typeof settings?.outputId === "string") outputId = settings.outputId;
  } catch {}
  audio.volume = Math.min(1, Math.max(0, outputVolume / 100 * volume));
  if (outputId && "setSinkId" in audio) void audio.setSinkId(outputId).catch(() => {});
}

export function playPackSound(name: string, volume = 0.32): () => void {
  if (typeof Audio === "undefined") return () => {};
  try {
    const audio = new Audio(soundPackUrl(name));
    configureSoundOutput(audio, volume);
    void audio.play().catch(() => {});
    return () => { audio.pause(); audio.src = ""; };
  } catch { return () => {}; }
}
