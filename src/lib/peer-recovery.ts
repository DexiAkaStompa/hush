type Options = {
  restart: () => Promise<void>;
  onState: (state: RTCPeerConnectionState) => void;
  onClosed: () => void;
  onExhausted: () => void;
  recoveryTarget?: EventTarget;
};

// A transient ICE disconnect does not end receiver tracks. Removing the media
// elements then loses playback permanently because WebRTC will not fire ontrack again.
export function monitorPeerRecovery(peer: RTCPeerConnection, options: Options) {
  let disposed = false, attempts = 0, restarting = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const target = options.recoveryTarget ?? (typeof window !== "undefined" ? window : undefined);
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const needsRecovery = () => peer.connectionState === "failed" || peer.connectionState === "disconnected";
  const schedule = (delay: number) => {
    if (disposed || timer !== undefined || restarting || !needsRecovery()) return;
    if (attempts >= 2) { options.onExhausted(); return; }
    timer = setTimeout(() => { timer = undefined; void restart(); }, delay);
  };
  const restart = async () => {
    if (disposed || !needsRecovery()) return;
    restarting = true;
    attempts++;
    try { await options.restart(); }
    catch { /* The next bounded retry can recover a signaling interruption too. */ }
    finally { restarting = false; if (!disposed && needsRecovery()) schedule(8000); }
  };
  const stateChanged = () => {
    if (disposed) return;
    options.onState(peer.connectionState);
    if (peer.connectionState === "connected") { clear(); attempts = 0; }
    else if (peer.connectionState === "closed") { clear(); options.onClosed(); }
    else if (needsRecovery()) {
      if (peer.connectionState === "failed") clear();
      schedule(peer.connectionState === "failed" ? 0 : 4000);
    }
  };
  const online = () => { if (!disposed && needsRecovery()) { clear(); attempts = 0; schedule(0); } };
  peer.addEventListener("connectionstatechange", stateChanged);
  target?.addEventListener("online", online);
  return () => { disposed = true; clear(); peer.removeEventListener("connectionstatechange", stateChanged); target?.removeEventListener("online", online); };
}
