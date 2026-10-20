import { describe, expect, it, vi } from "vitest";
import { createPeerNegotiator } from "./peer-negotiation";

class Peer extends EventTarget {
  signalingState = "stable";
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  createOffer = vi.fn(async () => ({ type: "offer" as const, sdp: "offer" }));
  createAnswer = vi.fn(async () => ({ type: "answer" as const, sdp: "answer" }));
  addIceCandidate = vi.fn(async () => {});
  async setLocalDescription(value: RTCSessionDescriptionInit) { this.localDescription = value; this.signalingState = value.type === "offer" ? "have-local-offer" : "stable"; this.dispatchEvent(new Event("signalingstatechange")); }
  async setRemoteDescription(value: RTCSessionDescriptionInit) { this.remoteDescription = value; this.signalingState = value.type === "offer" ? "have-remote-offer" : "stable"; this.dispatchEvent(new Event("signalingstatechange")); }
}
function setup(polite = true) {
  const peer = new Peer(), send = vi.fn(async () => {});
  const negotiation = createPeerNegotiator(peer as unknown as RTCPeerConnection, { polite, send, prepareSdp: sdp => sdp, onError: vi.fn() });
  return { peer, send, negotiation };
}
describe("peer negotiation", () => {
  it("queues track changes while awaiting an answer", async () => {
    const { peer, send, negotiation } = setup();
    await negotiation.negotiate();
    await negotiation.negotiate();
    expect(send).toHaveBeenCalledTimes(1);
    await negotiation.receive({ kind: "answer", sdp: "remote answer" });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(peer.createOffer).toHaveBeenCalledTimes(2);
    negotiation.dispose();
  });
  it("accepts a colliding offer on the polite side", async () => {
    const { peer, send, negotiation } = setup();
    await negotiation.negotiate();
    await negotiation.receive({ kind: "offer", sdp: "remote offer" });
    expect(peer.remoteDescription?.sdp).toBe("remote offer");
    expect(send).toHaveBeenLastCalledWith({ kind: "answer", sdp: "answer" });
    negotiation.dispose();
  });
  it("ignores colliding offers and their ICE on the impolite side", async () => {
    const { peer, negotiation } = setup(false);
    await negotiation.negotiate();
    await negotiation.receive({ kind: "offer", sdp: "collision" });
    await negotiation.receive({ kind: "ice", candidate: "ignored", sdpMid: "0", sdpMLineIndex: 0 });
    expect(peer.remoteDescription).toBeNull();
    expect(peer.addIceCandidate).not.toHaveBeenCalled();
    await negotiation.receive({ kind: "answer", sdp: "accepted" });
    expect(peer.remoteDescription?.sdp).toBe("accepted");
    negotiation.dispose();
  });
  it("buffers early ICE until the remote description is set", async () => {
    const { peer, negotiation } = setup();
    await negotiation.receive({ kind: "ice", candidate: "early", sdpMid: "0", sdpMLineIndex: 0 });
    expect(peer.addIceCandidate).not.toHaveBeenCalled();
    await negotiation.receive({ kind: "offer", sdp: "remote" });
    expect(peer.addIceCandidate).toHaveBeenCalledWith({ candidate: "early", sdpMid: "0", sdpMLineIndex: 0 });
    negotiation.dispose();
  });
});
