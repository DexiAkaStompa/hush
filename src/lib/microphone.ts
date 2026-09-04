import { microphoneConstraints, type MediaSettings } from "./media-settings";

export type MicrophoneCapture = { stream: MediaStream; close: () => void; setVolume: (volume: number) => void };
export async function openMicrophone(settings: MediaSettings): Promise<MicrophoneCapture> {
  const raw = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(settings) });
  let context: AudioContext | undefined;
  let filter: (AudioWorkletNode & { destroy: () => void }) | undefined;
  let output: MediaStream | undefined;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    raw.getTracks().forEach((track) => track.stop());
    output?.getTracks().forEach((track) => track.stop());
    filter?.destroy();
    filter?.disconnect();
    void context?.close().catch(() => undefined);
  };
  try {
    context = new AudioContext({ sampleRate: 48000 });
    await context.resume();
    const source = context.createMediaStreamSource(raw);
    const gain = context.createGain();
    gain.gain.value = settings.inputVolume / 100;
    const destination = context.createMediaStreamDestination();
    if (settings.noise === "rnnoise") {
      const { createNoiseFilter } = await import("./noise-filter");
      filter = await createNoiseFilter(context);
      source.connect(filter).connect(gain);
    } else source.connect(gain);
    gain.connect(destination);
    output = destination.stream;
    return { stream: output, close, setVolume: (volume) => { gain.gain.value = volume / 100; } };
  } catch (error) { close(); throw error; }
}
