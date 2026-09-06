import type { MediaSettings } from "./media-settings";

export const AUDIO_BITRATES: Record<string, number> = {
  standard: 64000,
  high: 128000,
  ultra: 256000,
};

export const VIDEO_BITRATES: Record<string, number> = {
  "720p": 2000000,
  "1080p": 3500000,
  "1440p": 6000000,
};

export const SCREEN_BITRATE = 8000000;

/**
 * Tunes the RTCRtpSender encodings for maximum bitrate and resolution retention.
 */
export async function applyTrackBitrate(
  sender: RTCRtpSender,
  kind: "audio" | "camera" | "screen",
  settings: MediaSettings
): Promise<void> {
  try {
    if (!sender || typeof sender.getParameters !== "function") return;
    const params = sender.getParameters();
    if (!params) return;
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    const enc = params.encodings[0];

    if (kind === "audio") {
      const bitrate = AUDIO_BITRATES[settings.audioQuality] || AUDIO_BITRATES.high;
      enc.maxBitrate = bitrate;
      enc.priority = "high";
      enc.networkPriority = "high";
    } else if (kind === "camera") {
      const bitrate = VIDEO_BITRATES[settings.videoQuality] || VIDEO_BITRATES["1080p"];
      enc.maxBitrate = bitrate;
      enc.maxFramerate = settings.videoQuality === "1440p" ? 60 : 30;
      enc.scaleResolutionDownBy = 1.0;
      enc.priority = "high";
    } else if (kind === "screen") {
      enc.maxBitrate = SCREEN_BITRATE;
      enc.maxFramerate = settings.screenFps || 60;
      enc.scaleResolutionDownBy = 1.0;
      enc.priority = "high";
      if (sender.track && "contentHint" in sender.track) {
        sender.track.contentHint = "motion";
      }
    }

    if (typeof sender.setParameters === "function") {
      await sender.setParameters(params);
    }
  } catch {
    // Non-fatal if browser/WebRTC stack restricts specific encoding parameters
  }
}

/**
 * Injects high-fidelity Opus parameters into the SDP session description:
 * - maxaveragebitrate (up to 256 kbps)
 * - stereo=1 & sprop-stereo=1 (high-fidelity dual-channel support)
 * - useinbandfec=1 (forward error correction against packet loss)
 * - usedtx=0 (continuous audio without silent cutting)
 */
export function optimizeSdpQuality(sdp: string, settings: MediaSettings): string {
  if (!sdp || typeof sdp !== "string") return sdp;

  const targetBitrate = AUDIO_BITRATES[settings.audioQuality] || AUDIO_BITRATES.high;

  // Find opus payload type: e.g. "a=rtpmap:111 opus/48000/2"
  const opusRtpMapMatch = sdp.match(/a=rtpmap:(\d+)\s+opus\/48000\/2/i);
  const opusPt = opusRtpMapMatch ? opusRtpMapMatch[1] : null;

  if (!opusPt || !opusRtpMapMatch) {
    return sdp;
  }

  const fmtpRegex = new RegExp(`a=fmtp:${opusPt}\\s+([^\\r\\n]+)`, "i");
  const fmtpMatch = sdp.match(fmtpRegex);

  const desiredParams = [
    `maxaveragebitrate=${targetBitrate}`,
    "stereo=1",
    "sprop-stereo=1",
    "useinbandfec=1",
    "usedtx=0",
  ];

  if (fmtpMatch) {
    let currentParams = fmtpMatch[1].split(";").map((p) => p.trim()).filter(Boolean);
    
    // Remove existing keys that we want to replace
    const keysToOverride = ["maxaveragebitrate", "stereo", "sprop-stereo", "useinbandfec", "usedtx"];
    currentParams = currentParams.filter((param) => {
      const key = param.split("=")[0].trim().toLowerCase();
      return !keysToOverride.includes(key);
    });

    const combined = [...currentParams, ...desiredParams].join(";");
    return sdp.replace(fmtpMatch[0], `a=fmtp:${opusPt} ${combined}`);
  }

  // If no fmtp line exists yet, inject it right after the rtpmap line
  const rtpMapLine = opusRtpMapMatch[0];
  const newFmtpLine = `\r\na=fmtp:${opusPt} ${desiredParams.join(";")}`;
  return sdp.replace(rtpMapLine, `${rtpMapLine}${newFmtpLine}`);
}
