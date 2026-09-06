import { describe, expect, it, vi } from "vitest";
import {
  applyTrackBitrate,
  optimizeSdpQuality,
  AUDIO_BITRATES,
  VIDEO_BITRATES,
  SCREEN_BITRATE,
} from "./webrtc-quality";
import { DEFAULT_MEDIA_SETTINGS, type MediaSettings } from "./media-settings";

describe("webrtc-quality module", () => {
  describe("applyTrackBitrate", () => {
    it("configures audio sender with high quality bitrate", async () => {
      const getParameters = vi.fn().mockReturnValue({ encodings: [{}] });
      const setParameters = vi.fn().mockResolvedValue(undefined);
      const sender = { getParameters, setParameters } as unknown as RTCRtpSender;

      await applyTrackBitrate(sender, "audio", DEFAULT_MEDIA_SETTINGS);

      expect(setParameters).toHaveBeenCalledWith({
        encodings: [
          expect.objectContaining({
            maxBitrate: 128000,
            priority: "high",
            networkPriority: "high",
          }),
        ],
      });
    });

    it("configures audio sender with ultra studio quality bitrate (256 kbps)", async () => {
      const getParameters = vi.fn().mockReturnValue({ encodings: [{}] });
      const setParameters = vi.fn().mockResolvedValue(undefined);
      const sender = { getParameters, setParameters } as unknown as RTCRtpSender;

      const ultraSettings: MediaSettings = {
        ...DEFAULT_MEDIA_SETTINGS,
        audioQuality: "ultra",
      };

      await applyTrackBitrate(sender, "audio", ultraSettings);

      expect(setParameters).toHaveBeenCalledWith({
        encodings: [
          expect.objectContaining({
            maxBitrate: 256000,
          }),
        ],
      });
    });

    it("configures camera sender with 1080p bitrate (3.5 Mbps)", async () => {
      const getParameters = vi.fn().mockReturnValue({ encodings: [{}] });
      const setParameters = vi.fn().mockResolvedValue(undefined);
      const sender = { getParameters, setParameters } as unknown as RTCRtpSender;

      await applyTrackBitrate(sender, "camera", DEFAULT_MEDIA_SETTINGS);

      expect(setParameters).toHaveBeenCalledWith({
        encodings: [
          expect.objectContaining({
            maxBitrate: 3500000,
            scaleResolutionDownBy: 1.0,
          }),
        ],
      });
    });

    it("configures screen share sender with 8 Mbps and 60 FPS", async () => {
      const track = { contentHint: "" };
      const getParameters = vi.fn().mockReturnValue({ encodings: [{}] });
      const setParameters = vi.fn().mockResolvedValue(undefined);
      const sender = { getParameters, setParameters, track } as unknown as RTCRtpSender;

      await applyTrackBitrate(sender, "screen", DEFAULT_MEDIA_SETTINGS);

      expect(track.contentHint).toBe("motion");
      expect(setParameters).toHaveBeenCalledWith({
        encodings: [
          expect.objectContaining({
            maxBitrate: 8000000,
            maxFramerate: 60,
            scaleResolutionDownBy: 1.0,
          }),
        ],
      });
    });
  });

  describe("optimizeSdpQuality", () => {
    const mockSdpWithFmtp = [
      "v=0",
      "o=- 12345 2 IN IP4 127.0.0.1",
      "s=-",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=rtpmap:111 opus/48000/2",
      "a=fmtp:111 minptime=10;useinbandfec=1",
      "",
    ].join("\r\n");

    const mockSdpWithoutFmtp = [
      "v=0",
      "o=- 12345 2 IN IP4 127.0.0.1",
      "s=-",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=rtpmap:111 opus/48000/2",
      "",
    ].join("\r\n");

    it("injects maxaveragebitrate and stereo into existing opus fmtp line", () => {
      const optimized = optimizeSdpQuality(mockSdpWithFmtp, DEFAULT_MEDIA_SETTINGS);

      expect(optimized).toContain("a=fmtp:111");
      expect(optimized).toContain("maxaveragebitrate=128000");
      expect(optimized).toContain("stereo=1");
      expect(optimized).toContain("sprop-stereo=1");
      expect(optimized).toContain("usedtx=0");
    });

    it("uses 256000 bps for ultra audio quality", () => {
      const ultraSettings: MediaSettings = {
        ...DEFAULT_MEDIA_SETTINGS,
        audioQuality: "ultra",
      };
      const optimized = optimizeSdpQuality(mockSdpWithFmtp, ultraSettings);

      expect(optimized).toContain("maxaveragebitrate=256000");
    });

    it("creates a new fmtp line if none exists after rtpmap line", () => {
      const optimized = optimizeSdpQuality(mockSdpWithoutFmtp, DEFAULT_MEDIA_SETTINGS);

      expect(optimized).toContain("a=fmtp:111");
      expect(optimized).toContain("maxaveragebitrate=128000");
    });

    it("returns original sdp if no opus codec is present", () => {
      const noOpusSdp = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 0\r\na=rtpmap:0 PCMU/8000";
      expect(optimizeSdpQuality(noOpusSdp, DEFAULT_MEDIA_SETTINGS)).toBe(noOpusSdp);
    });
  });
});
