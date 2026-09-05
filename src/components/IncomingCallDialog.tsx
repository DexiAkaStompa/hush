import { useEffect } from "react";
import { Phone, PhoneOff, Video } from "lucide-react";
import { ProfileImage } from "./ProfileImage";
import type { IncomingCallPayload } from "../lib/realtime";

type IncomingCallDialogProps = {
  call: IncomingCallPayload;
  onAccept: () => void;
  onDecline: () => void;
};

function initialsFor(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return words.length === 0 ? "U" : words.slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

export function IncomingCallDialog({ call, onAccept, onDecline }: IncomingCallDialogProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onDecline();
      } else if (e.key === "Enter") {
        onAccept();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onAccept, onDecline]);

  return (
    <div className="incoming-call-overlay" role="dialog" aria-modal="true" aria-label="Chiamata in arrivo">
      <div className="incoming-call-card">
        <div
          className="incoming-call-avatar"
          style={{ backgroundColor: call.caller.avatar_color || "#73b7ff" }}
        >
          <span className="incoming-call-initials">{initialsFor(call.caller.display_name)}</span>
          {call.caller.avatar_path ? (
            <ProfileImage path={call.caller.avatar_path} alt="" className="incoming-call-avatar-img" />
          ) : null}
          <div className="incoming-call-pulse-ring" />
        </div>

        <div className="incoming-call-info">
          <span className="incoming-call-eyebrow">
            {call.isVideo ? <Video size={14} /> : <Phone size={14} />}
            <span>Chiamata in arrivo…</span>
          </span>
          <h3 className="incoming-call-name">{call.caller.display_name}</h3>
          <p className="incoming-call-room">{call.conversationName}</p>
        </div>

        <div className="incoming-call-actions">
          <button
            type="button"
            className="incoming-call-btn incoming-call-decline"
            onClick={onDecline}
            aria-label="Rifiuta chiamata"
            title="Rifiuta (Esc)"
          >
            <PhoneOff size={22} />
            <span>Rifiuta</span>
          </button>

          <button
            type="button"
            className="incoming-call-btn incoming-call-accept"
            onClick={onAccept}
            aria-label="Accetta chiamata"
            title="Accetta (Invio)"
            autoFocus
          >
            {call.isVideo ? <Video size={22} /> : <Phone size={22} />}
            <span>Accetta</span>
          </button>
        </div>
      </div>
    </div>
  );
}

