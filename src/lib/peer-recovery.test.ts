import { afterEach, describe, expect, it, vi } from "vitest";
import { monitorPeerRecovery } from "./peer-recovery";

class Peer extends EventTarget {
  connectionState: RTCPeerConnectionState = "connected";
  state(value: RTCPeerConnectionState) { this.connectionState = value; this.dispatchEvent(new Event("connectionstatechange")); }
}
function setup() {
  vi.useFakeTimers();
  const peer = new Peer(), recoveryTarget = new EventTarget();
  const options = { restart: vi.fn().mockResolvedValue(undefined), onState: vi.fn(), onClosed: vi.fn(), onExhausted: vi.fn(), recoveryTarget };
  const stop = monitorPeerRecovery(peer as unknown as RTCPeerConnection, options);
  return { peer, options, stop, recoveryTarget };
}
afterEach(() => { vi.useRealTimers(); });
describe("peer recovery", () => {
  it("keeps receiver playback alive through a transient disconnect", async () => {
    const { peer, options, stop } = setup();
    peer.state("disconnected");
    await vi.advanceTimersByTimeAsync(2000);
    peer.state("connected");
    await vi.advanceTimersByTimeAsync(20000);
    expect(options.onClosed).not.toHaveBeenCalled();
    expect(options.restart).not.toHaveBeenCalled();
    stop();
  });
  it("bounds failed ICE retries and recovers again when the network returns", async () => {
    const { peer, options, stop, recoveryTarget } = setup();
    peer.state("failed");
    await vi.advanceTimersByTimeAsync(30000);
    expect(options.restart).toHaveBeenCalledTimes(2);
    expect(options.onExhausted).toHaveBeenCalledTimes(1);
    recoveryTarget.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(1);
    expect(options.restart).toHaveBeenCalledTimes(3);
    peer.state("connected");
    await vi.advanceTimersByTimeAsync(30000);
    expect(options.restart).toHaveBeenCalledTimes(3);
    stop();
  });
  it("cancels delayed restarts and listeners on disposal", async () => {
    const { peer, options, stop, recoveryTarget } = setup();
    peer.state("disconnected"); stop();
    recoveryTarget.dispatchEvent(new Event("online"));
    peer.state("closed");
    await vi.advanceTimersByTimeAsync(30000);
    expect(options.restart).not.toHaveBeenCalled();
    expect(options.onClosed).not.toHaveBeenCalled();
  });
});
