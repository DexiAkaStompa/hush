import type { WebRtcSignal } from "./realtime";

type Options = {
  polite: boolean;
  send: (signal: WebRtcSignal) => Promise<void>;
  prepareSdp: (sdp: string) => string;
  onError: (error: unknown) => void;
};

// Keep track changes queued while an offer is pending. Both sides may renegotiate,
// so the polite side yields on collisions instead of losing the audio update.
export function createPeerNegotiator(peer: RTCPeerConnection, options: Options) {
  let disposed = false, makingOffer = false, applyingDescription = false, requested = false, ignoreOffer = false;
  let incoming = Promise.resolve();
  const pendingIce: RTCIceCandidateInit[] = [];

  const negotiate = async () => {
    requested = true;
    if (disposed || makingOffer || applyingDescription || peer.signalingState !== "stable") return;
    requested = false;
    makingOffer = true;
    try {
      const offer = await peer.createOffer();
      if (disposed) return;
      if (applyingDescription || peer.signalingState !== "stable") { requested = true; return; }
      await peer.setLocalDescription({ type: "offer", sdp: options.prepareSdp(offer.sdp ?? "") });
      if (!disposed && peer.localDescription?.sdp) await options.send({ kind: "offer", sdp: peer.localDescription.sdp });
    } finally {
      makingOffer = false;
      if (!disposed && requested && peer.signalingState === "stable" && !applyingDescription) queueMicrotask(() => { void negotiate().catch(options.onError); });
    }
  };
  const stable = () => { if (requested && peer.signalingState === "stable") void negotiate().catch(options.onError); };
  const changed = () => { void negotiate().catch(options.onError); };
  peer.addEventListener("signalingstatechange", stable);
  peer.addEventListener("negotiationneeded", changed);

  const accept = async (signal: WebRtcSignal) => {
    if (disposed) return;
    if (signal.kind === "ice") {
      if (ignoreOffer) return;
      const candidate = { candidate: signal.candidate, sdpMid: signal.sdpMid, sdpMLineIndex: signal.sdpMLineIndex };
      if (!peer.remoteDescription) { if (pendingIce.length < 128) pendingIce.push(candidate); }
      else await peer.addIceCandidate(candidate);
      return;
    }
    const collision = signal.kind === "offer" && (makingOffer || peer.signalingState !== "stable");
    ignoreOffer = collision && !options.polite;
    if (ignoreOffer) return;
    if (signal.kind === "answer" && peer.signalingState !== "have-local-offer") return;
    applyingDescription = true;
    try {
      // Modern Chromium implements implicit rollback when accepting a colliding offer.
      await peer.setRemoteDescription({ type: signal.kind, sdp: signal.sdp });
      if (disposed) return;
      for (const candidate of pendingIce.splice(0)) await peer.addIceCandidate(candidate);
      if (signal.kind === "offer") {
        const answer = await peer.createAnswer();
        if (disposed) return;
        await peer.setLocalDescription({ type: "answer", sdp: options.prepareSdp(answer.sdp ?? "") });
        if (!disposed && peer.localDescription?.sdp) await options.send({ kind: "answer", sdp: peer.localDescription.sdp });
      }
    } finally {
      applyingDescription = false;
      stable();
    }
  };
  return {
    negotiate,
    receive(signal: WebRtcSignal) {
      const next = incoming.then(() => accept(signal));
      incoming = next.catch(() => undefined);
      return next;
    },
    dispose() { disposed = true; requested = false; pendingIce.length = 0; peer.removeEventListener("signalingstatechange", stable); peer.removeEventListener("negotiationneeded", changed); },
  };
}
