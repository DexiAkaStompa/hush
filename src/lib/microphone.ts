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

    // Isolate channel 0 (primary mic) to avoid hardware/driver stereo imbalance
    const splitter = context.createChannelSplitter(2);
    source.connect(splitter);

    const monoSource = context.createGain();
    monoSource.channelCount = 1;
    monoSource.channelCountMode = "explicit";
    splitter.connect(monoSource, 0, 0);

    const gain = context.createGain();
    gain.channelCount = 1;
    gain.channelCountMode = "explicit";
    gain.gain.value = settings.inputVolume / 100;

    if (settings.noise === "rnnoise") {
      const { createNoiseFilter } = await import("./noise-filter");
      filter = await createNoiseFilter(context);
      monoSource.connect(filter).connect(gain);
    } else {
      monoSource.connect(gain);
    }

    // Duplicate the clean mono voice signal into BOTH Left and Right channels
    // so listeners hear the voice centered equally in both earphones
    const merger = context.createChannelMerger(2);
    gain.connect(merger, 0, 0);
    gain.connect(merger, 0, 1);

    const destination = context.createMediaStreamDestination();
    merger.connect(destination);
    output = destination.stream;
    return { stream: output, close, setVolume: (volume) => { gain.gain.value = volume / 100; } };
  } catch (error) { close(); throw error; }
}
