import { loadRnnoise, RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";
import workletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import wasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import simdUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";

let binary: Promise<ArrayBuffer> | undefined;
export async function createNoiseFilter(context: AudioContext) {
  binary ??= loadRnnoise({ url: wasmUrl, simdUrl }).catch((error) => { binary = undefined; throw error; });
  const [wasmBinary] = await Promise.all([binary, context.audioWorklet.addModule(workletUrl)]);
  return new RnnoiseWorkletNode(context, { wasmBinary, maxChannels: 1 });
}
