import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Maximize2, Mic, MicOff, Minimize2, MonitorUp, PhoneOff, Video, VideoOff, Volume2, VolumeX } from "lucide-react";
import { callTopic, type WebRtcSignal } from "../lib/realtime";
import { supabase } from "../lib/supabase";
import { RoomMusic } from "./RoomMusic";
import { playCallSound } from "../lib/interaction-sound";
import { routeAudio, useMediaSettings } from "../lib/media-settings";
import { openMicrophone, type MicrophoneCapture } from "../lib/microphone";
import { ProfileImage } from "./ProfileImage";
import { useUserAudioPrefs } from "../lib/user-audio";
import type { Profile } from "../lib/workspace";

type MediaStageProps = {
  open: boolean;
  expanded: boolean;
  startWithVideo: boolean;
  conversationId: string | null;
  roomName: string;
  userId: string;
  displayName: string;
  memberNames: Record<string, string>;
  selfProfile?: Profile | null;
  memberProfiles?: Record<string, Profile>;
  onUserContextMenu?: (event: React.MouseEvent, user: Profile, inCall: boolean) => void;
  onMinimize: () => void;
  onClose: () => void;
};

type CallSignal = {
  senderId?: string;
  targetId?: string;
  signal?: WebRtcSignal;
};

function initialsFor(value: string) {
  return value.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "TU";
}

function StreamTile({
  stream,
  label,
  profile,
  muted = false,
  focused = false,
  onFocus,
  onContextMenu,
}: {
  stream: MediaStream | null;
  label: string;
  profile?: Pick<Profile, "id" | "display_name" | "avatar_color" | "avatar_path" | "banner_path"> | null;
  muted?: boolean;
  focused?: boolean;
  onFocus?: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const settings = useMediaSettings();
  const [outputError, setOutputError] = useState("");
  const [audioMuted, setAudioMuted] = useState(muted);
  const userPrefs = useUserAudioPrefs(profile?.id ?? "");
  const isMuted = muted || audioMuted || userPrefs.muted;

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (video.current) {
      video.current.muted = isMuted;
      video.current.volume = isMuted ? 0 : Math.min(1, userPrefs.volume / 100);
    }
  }, [isMuted, userPrefs.volume]);

  useEffect(() => {
    if (!video.current || isMuted) return;
    let active = true;
    void routeAudio(video.current, settings).then(() => { if (active) setOutputError(""); }).catch(() => { if (active) setOutputError("Uscita audio non disponibile: scegline un’altra nelle impostazioni."); });
    return () => { active = false; };
  }, [settings.outputId, settings.outputVolume, isMuted]);

  const toggleFullscreen = () => {
    const element = video.current;
    if (!element) return;
    if (document.fullscreenElement === element) void document.exitFullscreen();
    else void element.requestFullscreen?.();
  };

  const hasVideo = Boolean(stream && stream.getVideoTracks().length > 0 && !userPrefs.videoDisabled);
  const cleanName = (profile?.display_name || label).replace(/\s*\([^)]*\)/g, "").trim();
  const avatarColor = profile?.avatar_color || "#73b7ff";

  return (
    <div
      className={`video-tile ${focused ? "video-tile-focused" : ""}`}
      onContextMenu={(e) => {
        if (onContextMenu) {
          e.preventDefault();
          onContextMenu(e);
        }
      }}
    >
      <video
        ref={video}
        autoPlay
        playsInline
        muted={muted || audioMuted}
        style={{ display: hasVideo ? "block" : "none" }}
      />
      {!hasVideo ? (
        <>
          <div
            className="tile-backdrop"
            style={{ backgroundColor: avatarColor }}
          >
            {profile?.banner_path ? (
              <ProfileImage
                path={profile.banner_path}
                alt=""
                className="tile-backdrop-banner"
              />
            ) : null}
            <div className="tile-backdrop-dim" />
          </div>
          <div
            className="big-avatar"
            style={{ backgroundColor: avatarColor }}
          >
            <span className="big-avatar-initials">{initialsFor(cleanName)}</span>
            {profile?.avatar_path ? (
              <ProfileImage
                path={profile.avatar_path}
                alt={cleanName}
                className="big-avatar-img"
              />
            ) : null}
          </div>
        </>
      ) : null}
      <span className="tile-label">{label}{outputError ? <small role="alert"> · {outputError}</small> : null}</span>
      {hasVideo ? (
        <div className="tile-actions">
          {onFocus ? <button onClick={onFocus} aria-label={focused ? "Riduci condivisione" : "Ingrandisci condivisione"}>{focused ? <Minimize2 size={15} /> : <MonitorUp size={15} />}</button> : null}
          <button onClick={toggleFullscreen} aria-label="Apri a schermo intero"><Maximize2 size={15} /></button>
          {!muted ? <button onClick={() => setAudioMuted((value) => !value)} aria-label={audioMuted ? "Riattiva audio del riquadro" : "Muta audio del riquadro"}>{audioMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}</button> : null}
        </div>
      ) : null}
    </div>
  );
}

export function MediaStage({
  open,
  expanded,
  startWithVideo,
  conversationId,
  roomName,
  userId,
  displayName,
  memberNames,
  selfProfile,
  memberProfiles,
  onUserContextMenu,
  onMinimize,
  onClose,
}: MediaStageProps) {
  const settings = useMediaSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const micEnabled = useRef(true);
  const callGeneration = useRef(0);
  const [micRetry, setMicRetry] = useState(0);
  const [mic, setMic] = useState(false);
  const [camera, setCamera] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState("Connessione diretta in preparazione…");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [participants, setParticipants] = useState<string[]>([]);
  const [focusedTile, setFocusedTile] = useState<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const microphoneRef = useRef<MicrophoneCapture | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!open || !conversationId || !supabase) return;
    let active = true;
    callGeneration.current++;
    micEnabled.current = true;
    let channel: RealtimeChannel | null = null;
    const peers = peersRef.current;
    const client = supabase;
    const pendingIce = new Map<string, RTCIceCandidateInit[]>();

    const reportCallError = (message: string) => {
      if (active) setNotice(message);
    };

    const sendSignal = async (targetId: string, signal: WebRtcSignal) => {
      if (!channel) throw new Error("Canale di signaling non pronto");
      const response = await channel.send({
        type: "broadcast",
        event: "webrtc.call.signal",
        payload: { senderId: userId, targetId, signal },
      });
      if (response !== "ok") throw new Error("Signaling WebRTC non consegnato");
    };

    const negotiate = async (peerId: string, peer: RTCPeerConnection) => {
      if (peer.signalingState !== "stable") return;
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (offer.sdp) await sendSignal(peerId, { kind: "offer", sdp: offer.sdp });
    };

    const ensurePeer = (peerId: string) => {
      const existing = peers.get(peerId);
      if (existing) return existing;
      const peer = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.cloudflare.com:3478" },
          { urls: "stun:stun.l.google.com:19302" },
        ],
      });
      localStreamRef.current?.getTracks().forEach((track) => peer.addTrack(track, localStreamRef.current!));
      peer.onicecandidate = (event) => {
        if (!event.candidate) return;
        void sendSignal(peerId, {
          kind: "ice",
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        }).catch(() => reportCallError("Connessione diretta interrotta durante la negoziazione."));
      };
      peer.ontrack = (event) => {
        setRemoteStreams((current) => {
          const stream = current[peerId] ?? new MediaStream();
          if (!stream.getTrackById(event.track.id)) stream.addTrack(event.track);
          return { ...current, [peerId]: stream };
        });
      };
      peer.onconnectionstatechange = () => {
        if (!["failed", "closed", "disconnected"].includes(peer.connectionState)) return;
        setRemoteStreams((current) => {
          const next = { ...current };
          delete next[peerId];
          return next;
        });
      };
      peers.set(peerId, peer);
      return peer;
    };

    const flushPendingIce = async (peerId: string, peer: RTCPeerConnection) => {
      const candidates = pendingIce.get(peerId) ?? [];
      pendingIce.delete(peerId);
      for (const candidate of candidates) await peer.addIceCandidate(candidate);
    };

    const handleSignal = async (payload: CallSignal) => {
      if (payload.targetId !== userId || !payload.senderId || !payload.signal) return;
      const peer = ensurePeer(payload.senderId);
      if (payload.signal.kind === "offer") {
        await peer.setRemoteDescription({ type: "offer", sdp: payload.signal.sdp });
        await flushPendingIce(payload.senderId, peer);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        if (answer.sdp) await sendSignal(payload.senderId, { kind: "answer", sdp: answer.sdp });
        return;
      }
      if (payload.signal.kind === "answer") {
        await peer.setRemoteDescription({ type: "answer", sdp: payload.signal.sdp });
        await flushPendingIce(payload.senderId, peer);
        return;
      }
      const candidate: RTCIceCandidateInit = {
        candidate: payload.signal.candidate,
        sdpMid: payload.signal.sdpMid,
        sdpMLineIndex: payload.signal.sdpMLineIndex,
      };
      if (peer.remoteDescription) await peer.addIceCandidate(candidate);
      else pendingIce.set(payload.senderId, [...(pendingIce.get(payload.senderId) ?? []), candidate]);
    };

    const syncPresence = () => {
      if (!channel) return;
      const state = channel.presenceState() as Record<string, Array<{ userId?: string; inCall?: boolean }>>;
      const peerIds = [...new Set(Object.values(state).flat()
        .filter((entry) => entry.inCall && entry.userId && entry.userId !== userId)
        .map((entry) => entry.userId!))];
      const activePeerIds = new Set(peerIds);
      for (const [peerId, peer] of peers) {
        if (activePeerIds.has(peerId)) continue;
        peer.close();
        peers.delete(peerId);
        setRemoteStreams((current) => {
          const next = { ...current };
          delete next[peerId];
          return next;
        });
      }
      setParticipants(peerIds);
      for (const peerId of peerIds) {
        const peer = ensurePeer(peerId);
        if (userId.localeCompare(peerId) < 0 && !peer.remoteDescription) {
          void negotiate(peerId, peer).catch(() => reportCallError("Impossibile contattare un partecipante."));
        }
      }
    };

    const startSignaling = async () => {
      await client.realtime.setAuth();
      if (!active) return;
      const topic = callTopic(conversationId);
      const staleChannels = client.getChannels().filter((candidate) => candidate.topic === `realtime:${topic}`);
      await Promise.all(staleChannels.map((candidate) => client.removeChannel(candidate)));
      if (!active) return;

      channel = client.channel(topic, {
        config: { private: true, broadcast: { self: false, ack: true }, presence: { key: userId } },
      });
      channelRef.current = channel;
      channel
        .on("broadcast", { event: "webrtc.call.signal" }, (event) => {
          void handleSignal(event.payload as CallSignal)
            .catch(() => reportCallError("Negoziazione della chiamata non riuscita. Riprova."));
        })
        .on("presence", { event: "sync" }, syncPresence)
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            void channel?.track({ userId, inCall: true, joinedAt: new Date().toISOString() })
              .then(() => setNotice("Chiamata WebRTC cifrata. In attesa degli altri membri…"))
              .catch(() => reportCallError("Presence non disponibile per questa chiamata."));
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            reportCallError("Realtime non raggiungibile: controlla la migrazione dei canali vocali.");
          }
        });
    };

    void startSignaling().catch(() => {
      reportCallError("Impossibile aprire il canale della chiamata. Controlla la configurazione Supabase.");
    });

    if (startWithVideo) void navigator.mediaDevices.getUserMedia({ video: settingsRef.current.cameraId ? { deviceId: { exact: settingsRef.current.cameraId } } : true })
      .then((stream) => {
        if (!active) { stream.getTracks().forEach((track) => track.stop()); return; }
        const local = localStreamRef.current ?? new MediaStream();
        stream.getTracks().forEach((track) => local.addTrack(track));
        localStreamRef.current = local;
        setLocalStream(new MediaStream(local.getTracks()));
        setCamera(true);
        peers.forEach((peer, peerId) => {
          stream.getTracks().forEach((track) => peer.addTrack(track, local));
          void negotiate(peerId, peer).catch(() => reportCallError("Impossibile collegare la videocamera."));
        });
      }).catch(() => reportCallError("Videocamera non disponibile. Controlla dispositivo e permessi nelle impostazioni."));

    return () => {
      active = false;
      callGeneration.current++;
      if (channel) {
        void channel.untrack();
        void client.removeChannel(channel);
      }
      channelRef.current = null;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      screenStreamRef.current = null;
      peers.forEach((peer) => peer.close());
      peers.clear();
      pendingIce.clear();
      setRemoteStreams({});
      setParticipants([]);
      setLocalStream(null);
      setMic(false);
      setCamera(false);
      setSharing(false);
      setFocusedTile(null);
    };
  }, [conversationId, open, startWithVideo, userId]);

  useEffect(() => {
    if (!open || !conversationId) return;
    let active = true;
    let capture: MicrophoneCapture | undefined;
    void openMicrophone(settingsRef.current).then(async (opened) => {
      capture = opened;
      if (!active) { opened.close(); return; }
      microphoneRef.current = opened;
      opened.setVolume(settingsRef.current.inputVolume);
      const local = localStreamRef.current ?? new MediaStream();
      const previous = local.getAudioTracks();
      previous.forEach((track) => local.removeTrack(track));
      const track = opened.stream.getAudioTracks()[0];
      track.enabled = micEnabled.current;
      local.addTrack(track);
      localStreamRef.current = local;
      setMic(track.enabled);
      if (!screenStreamRef.current) setLocalStream(new MediaStream(local.getTracks()));
      await Promise.all([...peersRef.current.values()].map(async (peer) => {
        const sender = peer.getSenders().find((candidate) => candidate.track?.kind === "audio" && !screenStreamRef.current?.getTrackById(candidate.track.id));
        if (sender) await sender.replaceTrack(track);
        else peer.addTrack(track, local);
      }));
      if (!active) return;
      await renegotiatePeers();
      setNotice("Microfono pronto · " + (settingsRef.current.noise === "rnnoise" ? "riduzione del rumore RNNoise" : settingsRef.current.noise === "standard" ? "riduzione standard" : "riduzione disattivata"));
    }).catch(() => {
      capture?.close();
      if (active) { setMic(false); setNotice("Microfono o filtro non disponibile. Controlla i permessi, scegli un dispositivo collegato o prova la riduzione standard nelle impostazioni, poi riattiva il microfono."); }
    });
    return () => { active = false; capture?.close(); if (microphoneRef.current === capture) microphoneRef.current = null; };
  }, [open, conversationId, startWithVideo, userId, settings.inputId, settings.noise, settings.echoCancellation, settings.autoGainControl, micRetry]);

  useEffect(() => { microphoneRef.current?.setVolume(settings.inputVolume); }, [settings.inputVolume]);

  if (!open || !conversationId) return null;

  const renegotiatePeers = async () => {
    const channel = channelRef.current;
    if (!channel) return;
    for (const [peerId, peer] of peersRef.current) {
      if (peer.signalingState !== "stable") continue;
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (offer.sdp) {
        await channel.send({
          type: "broadcast",
          event: "webrtc.call.signal",
          payload: { senderId: userId, targetId: peerId, signal: { kind: "offer", sdp: offer.sdp } },
        });
      }
    }
  };

  const toggleMic = async () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track || track.readyState === "ended") { micEnabled.current = true; setMicRetry((value) => value + 1); return; }
    track.enabled = !track.enabled;
    micEnabled.current = track.enabled;
    setMic(track.enabled);
    void playCallSound(track.enabled ? "enabled" : "disabled");
  };

  const toggleCamera = async () => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (sharing) return;
    if (videoTrack?.enabled && videoTrack.readyState === "live") {
      videoTrack.enabled = !videoTrack.enabled;
      setCamera(videoTrack.enabled);
      void playCallSound(videoTrack.enabled ? "enabled" : "disabled");
      return;
    }
    try {
      const generation = callGeneration.current;
      const stream = await navigator.mediaDevices.getUserMedia({ video: settings.cameraId ? { deviceId: { exact: settings.cameraId } } : true });
      if (generation !== callGeneration.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      const track = stream.getVideoTracks()[0];
      if (!track) return;
      const nextStream = localStreamRef.current ?? new MediaStream();
      const old = nextStream.getVideoTracks();
      old.forEach((previous) => { previous.stop(); nextStream.removeTrack(previous); });
      nextStream.addTrack(track);
      localStreamRef.current = nextStream;
      await Promise.all([...peersRef.current.values()].map(async (peer) => {
        const sender = peer.getSenders().find((candidate) => candidate.track?.kind === "video");
        if (sender) await sender.replaceTrack(track); else peer.addTrack(track, nextStream);
      }));
      setLocalStream(new MediaStream(nextStream.getTracks()));
      setCamera(true);
      await renegotiatePeers();
      void playCallSound("enabled");
    } catch {
      setNotice("Permesso videocamera non concesso.");
    }
  };

  const toggleShare = async () => {
    if (sharing) {
      const screenStream = screenStreamRef.current;
      const screenAudioTracks = screenStream?.getAudioTracks() ?? [];
      screenStream?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      const cameraTrack = localStreamRef.current?.getVideoTracks()[0] ?? null;
      peersRef.current.forEach((peer) => {
        const sender = peer.getSenders().find((candidate) => candidate.track?.kind === "video");
        if (sender) void sender.replaceTrack(cameraTrack);
        screenAudioTracks.forEach((track) => {
          const audioSender = peer.getSenders().find((candidate) => candidate.track?.id === track.id);
          if (audioSender) peer.removeTrack(audioSender);
        });
      });
      setSharing(false);
      setFocusedTile(null);
      setLocalStream(localStreamRef.current ? new MediaStream(localStreamRef.current.getTracks()) : null);
      await renegotiatePeers();
      void playCallSound("disabled");
      return;
    }
    try {
      const generation = callGeneration.current;
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      if (generation !== callGeneration.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      screenStreamRef.current = stream;
      const screenTrack = stream.getVideoTracks()[0];
      peersRef.current.forEach((peer) => {
        const sender = peer.getSenders().find((candidate) => candidate.track?.kind === "video");
        if (sender) void sender.replaceTrack(screenTrack);
        else peer.addTrack(screenTrack, stream);
        stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));
      });
      setLocalStream(stream);
      setSharing(true);
      setFocusedTile("local");
      setNotice("Schermo condiviso direttamente con i peer della chiamata.");
      screenTrack.addEventListener("ended", () => {
        if (screenStreamRef.current !== stream) return;
        stream.getTracks().forEach((track) => track.stop());
        const screenAudioTracks = screenStreamRef.current?.getAudioTracks() ?? [];
        screenStreamRef.current = null;
        const cameraTrack = localStreamRef.current?.getVideoTracks()[0] ?? null;
        peersRef.current.forEach((peer) => {
          const sender = peer.getSenders().find((candidate) => candidate.track?.kind === "video");
          if (sender) void sender.replaceTrack(cameraTrack);
          screenAudioTracks.forEach((track) => {
            const audioSender = peer.getSenders().find((candidate) => candidate.track?.id === track.id);
            if (audioSender) peer.removeTrack(audioSender);
          });
        });
        setSharing(false);
        setFocusedTile(null);
        setLocalStream(localStreamRef.current ? new MediaStream(localStreamRef.current.getTracks()) : null);
        void renegotiatePeers();
      }, { once: true });
      await renegotiatePeers();
      void playCallSound("share");
    } catch {
      setNotice("Condivisione schermo annullata.");
    }
  };

  return (
    <section className={`media-stage ${expanded ? "stage-expanded" : "stage-minimized"}`} aria-label="Chiamata in corso" aria-hidden={!expanded}>
      <header className="stage-header">
        <div><span className="eyebrow"><span className="live-dot" /> {roomName}</span><h2>{participants.length + 1} partecipanti</h2></div>
        <button className="icon-button" onClick={onMinimize} aria-label="Riduci chiamata"><Minimize2 size={18} /></button>
      </header>
      <RoomMusic conversationId={conversationId} />
      <div className="stage-grid call-grid">
        <StreamTile
          stream={localStream}
          label={`${displayName} (tu)${sharing ? " · schermo" : ""}`}
          profile={selfProfile}
          muted
          focused={focusedTile === "local"}
          onFocus={sharing ? () => setFocusedTile((value) => value === "local" ? null : "local") : undefined}
          onContextMenu={(e) => selfProfile && onUserContextMenu?.(e, selfProfile, true)}
        />
        {participants.map((participantId) => {
          const user = memberProfiles?.[participantId] ?? {
            id: participantId,
            username: memberNames[participantId] ?? "membro",
            display_name: memberNames[participantId] ?? "Membro",
            avatar_color: "#73b7ff",
          };
          return (
            <StreamTile
              key={participantId}
              stream={remoteStreams[participantId] ?? null}
              label={memberNames[participantId] ?? user.display_name ?? "Membro"}
              profile={user}
              focused={focusedTile === participantId}
              onFocus={() => setFocusedTile((value) => value === participantId ? null : participantId)}
              onContextMenu={(e) => onUserContextMenu?.(e, user, true)}
            />
          );
        })}
      </div>
      <p className="media-notice" role="status">{notice}</p>
      <div className="call-controls">
        <button className={mic ? "control mic active" : "control mic"} onClick={() => { void toggleMic(); }} aria-pressed={mic} aria-label={mic ? "Disattiva microfono" : "Attiva microfono"}>{mic ? <Mic size={19} /> : <MicOff size={19} />}</button>
        <button className={camera ? "control camera active" : "control camera"} onClick={() => { void toggleCamera(); }} disabled={sharing} aria-pressed={camera} aria-label={camera ? "Disattiva videocamera" : "Attiva videocamera"}>{camera ? <Video size={19} /> : <VideoOff size={19} />}</button>
        <button className={sharing ? "control share active" : "control share"} onClick={() => { void toggleShare(); }} aria-pressed={sharing}><MonitorUp size={19} /><span>{sharing ? "Interrompi" : "Condividi"}</span></button>
        <button className="control hangup" onClick={onClose} aria-label="Lascia chiamata"><PhoneOff size={19} /></button>
      </div>
    </section>
  );
}
