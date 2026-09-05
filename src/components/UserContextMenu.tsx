import { useEffect, useRef, useState } from "react";
import {
  AtSign,
  Copy,
  MessageSquare,
  Settings,
  User,
  VideoOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { ProfileImage } from "./ProfileImage";
import { copyText } from "../lib/clipboard";
import {
  setUserMuted,
  setUserVideoDisabled,
  setUserVolume,
  useUserAudioPrefs,
} from "../lib/user-audio";
import type { Profile } from "../lib/workspace";

export type ContextMenuTarget = {
  x: number;
  y: number;
  user: Profile;
  inCall?: boolean;
};

type UserContextMenuProps = {
  target: ContextMenuTarget;
  currentUserId: string;
  onClose: () => void;
  onViewProfile?: (user: Profile) => void;
  onOpenDm?: (user: Profile) => void;
  onMention?: (user: Profile) => void;
  onOpenSettings?: () => void;
  onToast?: (message: string) => void;
};

function initialsFor(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return words.length === 0 ? "U" : words.slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

export function UserContextMenu({
  target,
  currentUserId,
  onClose,
  onViewProfile,
  onOpenDm,
  onMention,
  onOpenSettings,
  onToast,
}: UserContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const isSelf = target.user.id === currentUserId;
  const prefs = useUserAudioPrefs(target.user.id);

  // Position clamping to prevent overflow outside viewport
  const [position, setPosition] = useState({ x: target.x, y: target.y });

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 12;
    const x = Math.max(margin, Math.min(target.x, window.innerWidth - rect.width - margin));
    const y = Math.max(margin, Math.min(target.y, window.innerHeight - rect.height - margin));
    setPosition((prev) => (prev.x === x && prev.y === y ? prev : { x, y }));
  }, [target.x, target.y]);

  useEffect(() => {
    const handleDown = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("mousedown", handleDown);
    window.addEventListener("touchstart", handleDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleDown);
      window.removeEventListener("touchstart", handleDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const handleCopy = async (text: string, label: string) => {
    try {
      await copyText(text);
      setCopiedLabel(label);
      onToast?.(`${label} copiato`);
      setTimeout(() => setCopiedLabel(null), 1500);
    } catch {
      onToast?.(`Errore durante la copia di ${label.toLowerCase()}`);
    }
  };

  return (
    <div
      ref={menuRef}
      className="user-context-menu"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      role="menu"
      aria-label={`Opzioni per ${target.user.display_name}`}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Header with user info */}
      <div className="user-context-header">
        <div
          className="user-context-avatar"
          style={{ backgroundColor: target.user.avatar_color || "#73b7ff" }}
        >
          {initialsFor(target.user.display_name)}
          {target.user.avatar_path ? (
            <ProfileImage path={target.user.avatar_path} alt="" />
          ) : null}
        </div>
        <div className="user-context-identity">
          <strong className="user-context-name">{target.user.display_name}</strong>
          <span className="user-context-handle">@{target.user.username}</span>
        </div>
      </div>

      <div className="user-context-divider" />

      {/* Main navigation actions */}
      <button
        type="button"
        className="user-context-item"
        onClick={() => {
          onViewProfile?.(target.user);
          onClose();
        }}
      >
        <User size={15} />
        <span>Profilo</span>
      </button>

      {!isSelf && onOpenDm ? (
        <button
          type="button"
          className="user-context-item"
          onClick={() => {
            onOpenDm(target.user);
            onClose();
          }}
        >
          <MessageSquare size={15} />
          <span>Invia messaggio</span>
        </button>
      ) : null}

      {!isSelf && onMention ? (
        <button
          type="button"
          className="user-context-item"
          onClick={() => {
            onMention(target.user);
            onClose();
          }}
        >
          <AtSign size={15} />
          <span>Menziona</span>
        </button>
      ) : null}

      {isSelf && onOpenSettings ? (
        <button
          type="button"
          className="user-context-item"
          onClick={() => {
            onOpenSettings();
            onClose();
          }}
        >
          <Settings size={15} />
          <span>Impostazioni profilo</span>
        </button>
      ) : null}

      {/* Audio & Video in-call controls */}
      {target.inCall && !isSelf ? (
        <>
          <div className="user-context-divider" />

          <div className="user-context-section-label">
            <span>Audio & Video</span>
          </div>

          <div className="user-context-slider-row">
            <div className="user-context-slider-header">
              <span>Volume utente</span>
              <button
                type="button"
                className="user-context-volume-reset"
                title="Ripristina al 100%"
                onClick={() => setUserVolume(target.user.id, 100)}
              >
                {prefs.volume}%
              </button>
            </div>
            <div className="user-context-slider-track">
              {prefs.muted || prefs.volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
              <input
                type="range"
                min={0}
                max={200}
                step={1}
                value={prefs.volume}
                onChange={(e) => setUserVolume(target.user.id, Number(e.target.value))}
                aria-label={`Volume per ${target.user.display_name}`}
              />
            </div>
          </div>

          <label className="user-context-checkbox-item">
            <div className="user-context-checkbox-label">
              <VolumeX size={15} />
              <span>Silenzia per me</span>
            </div>
            <input
              type="checkbox"
              checked={prefs.muted}
              onChange={(e) => setUserMuted(target.user.id, e.target.checked)}
            />
          </label>

          <label className="user-context-checkbox-item">
            <div className="user-context-checkbox-label">
              <VideoOff size={15} />
              <span>Disabilita video</span>
            </div>
            <input
              type="checkbox"
              checked={prefs.videoDisabled}
              onChange={(e) => setUserVideoDisabled(target.user.id, e.target.checked)}
            />
          </label>
        </>
      ) : null}

      <div className="user-context-divider" />

      {/* Copy utilities */}
      <button
        type="button"
        className="user-context-item"
        onClick={() => void handleCopy(`@${target.user.username}`, "Username")}
      >
        <Copy size={15} />
        <span>{copiedLabel === "Username" ? "Username copiato!" : "Copia Username"}</span>
      </button>

      <button
        type="button"
        className="user-context-item"
        onClick={() => void handleCopy(target.user.id, "ID Utente")}
      >
        <Copy size={15} />
        <span>{copiedLabel === "ID Utente" ? "ID copiato!" : "Copia ID utente"}</span>
      </button>
    </div>
  );
}

