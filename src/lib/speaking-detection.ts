import { useEffect, useRef, useState } from "react";

export function calculateAudioLevel(data: Uint8Array): number {
  if (data.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
  }
  return sum / data.length;
}

export function isSpeakingLevel(level: number, threshold = 14): boolean {
  return level >= threshold;
}

let sharedAudioContext: AudioContext | null = null;

function getSharedAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    try {
      sharedAudioContext = new AudioCtx();
    } catch {
      return null;
    }
  }

  if (sharedAudioContext.state === "suspended") {
    void sharedAudioContext.resume().catch(() => {});
  }

  return sharedAudioContext;
}

export type SpeakingDetectorOptions = {
  threshold?: number;
  hangMs?: number;
};

export function useSpeakingDetector(
  stream: MediaStream | null,
  enabled = true,
  options?: SpeakingDetectorOptions
): boolean {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const threshold = options?.threshold ?? 14;
  const hangMs = options?.hangMs ?? 350;
  const lastSpokeRef = useRef(0);

  useEffect(() => {
    if (!enabled || !stream) {
      setIsSpeaking(false);
      return;
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      setIsSpeaking(false);
      return;
    }

    const ctx = getSharedAudioContext();
    if (!ctx) return;

    let sourceNode: MediaStreamAudioSourceNode | null = null;
    let analyserNode: AnalyserNode | null = null;
    let timerId: number | null = null;
    let active = true;

    try {
      sourceNode = ctx.createMediaStreamSource(stream);
      analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 256;
      analyserNode.smoothingTimeConstant = 0.3;
      sourceNode.connect(analyserNode);

      const bufferLength = analyserNode.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkAudio = () => {
        if (!active || !analyserNode) return;

        const tracks = stream.getAudioTracks();
        const hasLiveEnabledTrack = tracks.some((t) => t.enabled && t.readyState === "live");
        if (!hasLiveEnabledTrack) {
          setIsSpeaking((prev) => (prev ? false : prev));
          return;
        }

        analyserNode.getByteFrequencyData(dataArray);
        const level = calculateAudioLevel(dataArray);
        const now = Date.now();

        if (isSpeakingLevel(level, threshold)) {
          lastSpokeRef.current = now;
          setIsSpeaking((prev) => (prev ? prev : true));
        } else if (now - lastSpokeRef.current > hangMs) {
          setIsSpeaking((prev) => (prev ? false : prev));
        }
      };

      timerId = window.setInterval(checkAudio, 75);
    } catch {
      setIsSpeaking(false);
    }

    return () => {
      active = false;
      if (timerId !== null) window.clearInterval(timerId);
      try {
        sourceNode?.disconnect();
        analyserNode?.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      setIsSpeaking(false);
    };
  }, [stream, enabled, threshold, hangMs]);

  return isSpeaking;
}

