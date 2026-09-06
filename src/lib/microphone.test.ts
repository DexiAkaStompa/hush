import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openMicrophone } from "./microphone";
import { DEFAULT_MEDIA_SETTINGS } from "./media-settings";

describe("openMicrophone dual-channel routing", () => {
  const originalNavigator = globalThis.navigator;
  const originalAudioContext = globalThis.AudioContext;

  type MockNode = {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    channelCount?: number;
    channelCountMode?: string;
    gain?: { value: number };
  };

  let mockTracks: Array<{ stop: ReturnType<typeof vi.fn> }>;
  let mockDestinationStream: { getTracks: () => Array<{ stop: ReturnType<typeof vi.fn> }> };
  let mockSplitter: MockNode;
  let mockMerger: MockNode;
  let mockGain: MockNode;
  let mockMonoSource: MockNode;
  let mockSource: MockNode;
  let mockDestination: MockNode & { stream: unknown };
  let mockContext: {
    resume: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    createMediaStreamSource: ReturnType<typeof vi.fn>;
    createChannelSplitter: ReturnType<typeof vi.fn>;
    createChannelMerger: ReturnType<typeof vi.fn>;
    createGain: ReturnType<typeof vi.fn>;
    createMediaStreamDestination: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockTracks = [{ stop: vi.fn() }];
    mockDestinationStream = { getTracks: () => [{ stop: vi.fn() }] };

    const createNode = (): MockNode => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
    });

    mockSource = createNode();
    mockSplitter = createNode();
    mockMerger = createNode();
    mockMonoSource = { ...createNode(), channelCount: 1, channelCountMode: "explicit" };
    mockGain = { ...createNode(), gain: { value: 1 } };
    mockDestination = { ...createNode(), stream: mockDestinationStream };

    let gainCallCount = 0;
    mockContext = {
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      createMediaStreamSource: vi.fn().mockReturnValue(mockSource),
      createChannelSplitter: vi.fn().mockReturnValue(mockSplitter),
      createChannelMerger: vi.fn().mockReturnValue(mockMerger),
      createGain: vi.fn().mockImplementation(() => {
        gainCallCount++;
        return gainCallCount === 1 ? mockMonoSource : mockGain;
      }),
      createMediaStreamDestination: vi.fn().mockReturnValue(mockDestination),
    };

    Object.defineProperty(globalThis, "AudioContext", {
      value: vi.fn().mockImplementation(function () { return mockContext; }),
      configurable: true,
      writable: true,
    });

    Object.defineProperty(globalThis, "navigator", {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn().mockResolvedValue({
            getTracks: () => mockTracks,
          }),
        },
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "AudioContext", {
      value: originalAudioContext,
      configurable: true,
      writable: true,
    });
  });

  it("isolates primary channel and routes audio equally to both Left and Right stereo channels", async () => {
    const capture = await openMicrophone({
      ...DEFAULT_MEDIA_SETTINGS,
      inputVolume: 80,
      noise: "off",
    });

    // Verify source is split into channels
    expect(mockContext.createChannelSplitter).toHaveBeenCalledWith(2);
    expect(mockSource.connect).toHaveBeenCalledWith(mockSplitter);

    // Verify primary mic channel 0 is isolated to monoSource
    expect(mockSplitter.connect).toHaveBeenCalledWith(mockMonoSource, 0, 0);

    // Verify volume gain is configured
    expect(mockGain.gain?.value).toBe(0.8);

    // Verify channel merger duplicates mono signal to both Left (0) and Right (1)
    expect(mockContext.createChannelMerger).toHaveBeenCalledWith(2);
    expect(mockGain.connect).toHaveBeenCalledWith(mockMerger, 0, 0);
    expect(mockGain.connect).toHaveBeenCalledWith(mockMerger, 0, 1);

    // Verify merger feeds stereo destination stream
    expect(mockMerger.connect).toHaveBeenCalledWith(mockDestination);
    expect(capture.stream).toBe(mockDestinationStream);

    // Test volume update
    capture.setVolume(150);
    expect(mockGain.gain?.value).toBe(1.5);

    // Test cleanup
    capture.close();
    expect(mockTracks[0].stop).toHaveBeenCalled();
    expect(mockContext.close).toHaveBeenCalled();
  });
});
