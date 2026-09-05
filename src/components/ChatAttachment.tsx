import { useEffect, useState } from "react";
import { Download, Eye, Image as ImageIcon, Loader2, X } from "lucide-react";
import { downloadAndDecryptChatImage, type ChatAttachmentMeta } from "../lib/chat-media";

export function ChatAttachment({
  attachment,
  conversationId,
  roomKey,
}: {
  attachment: ChatAttachmentMeta;
  conversationId: string;
  roomKey: CryptoKey | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => {
    if (!roomKey) return;
    let active = true;
    setLoading(true);
    setError(null);

    downloadAndDecryptChatImage(attachment, conversationId, roomKey)
      .then((decryptedUrl) => {
        if (active) {
          setUrl(decryptedUrl);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Errore caricamento immagine");
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [attachment, conversationId, roomKey]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="chat-attachment-container">
      {loading ? (
        <div className="chat-attachment-loading">
          <Loader2 size={18} className="attachment-spinner" />
          <span>Decifratura immagine…</span>
        </div>
      ) : error ? (
        <div className="chat-attachment-error">
          <ImageIcon size={18} />
          <span>{error}</span>
        </div>
      ) : url ? (
        <>
          <div
            className="chat-attachment-preview"
            onClick={() => setLightbox(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setLightbox(true);
            }}
            aria-label={`Ingrandisci ${attachment.name}`}
          >
            <img src={url} alt={attachment.name} loading="lazy" />
            <div className="chat-attachment-overlay">
              <span>{attachment.name} · {formatSize(attachment.size)}</span>
              <Eye size={16} />
            </div>
          </div>

          {lightbox ? (
            <div className="lightbox-backdrop" onClick={() => setLightbox(false)} role="dialog" aria-modal="true">
              <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
                <div className="lightbox-header">
                  <span>{attachment.name} ({formatSize(attachment.size)})</span>
                  <div className="lightbox-actions">
                    <a
                      href={url}
                      download={attachment.name}
                      className="lightbox-btn"
                      title="Scarica immagine"
                      aria-label="Scarica immagine"
                    >
                      <Download size={18} />
                    </a>
                    <button
                      type="button"
                      className="lightbox-btn"
                      onClick={() => setLightbox(false)}
                      aria-label="Chiudi"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>
                <div className="lightbox-body">
                  <img src={url} alt={attachment.name} />
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}