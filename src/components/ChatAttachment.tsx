import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Eye, Image as ImageIcon, Loader2, X } from "lucide-react";
import { downloadAndDecryptChatImage, releaseChatMediaCacheEntry, type ChatAttachmentMeta } from "../lib/chat-media";

export function ChatAttachment({
  attachment,
  conversationId,
  roomKey,
}: {
  attachment: ChatAttachmentMeta;
  conversationId: string;
  roomKey: CryptoKey | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(entries => setNearViewport(entries[0].isIntersecting), {rootMargin: "300px"});
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => {
    if (!roomKey || !nearViewport) {setUrl(null); setLoading(true); return;}
    let active = true;
    let acquiredUrl: string | null = null;
    setLoading(true);
    setError(null);

    downloadAndDecryptChatImage(attachment, conversationId, roomKey)
      .then((decryptedUrl) => {
        acquiredUrl = decryptedUrl;
        if (active) {
          setUrl(decryptedUrl);
          setLoading(false);
        }
        if (!active) releaseChatMediaCacheEntry(attachment.path, decryptedUrl);
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Errore caricamento immagine");
          setLoading(false);
        }
      });

    return () => {
      active = false;
      if (acquiredUrl) releaseChatMediaCacheEntry(attachment.path, acquiredUrl);
    };
  }, [attachment, conversationId, roomKey, nearViewport]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="chat-attachment-container" ref={containerRef}>
      {loading ? (
        <div className="chat-attachment-loading">
          <Loader2 size={18} className="attachment-spinner" />
          <span>Decifratura allegato…</span>
        </div>
      ) : error ? (
        <div className="chat-attachment-error">
          <ImageIcon size={18} />
          <span>{error}</span>
        </div>
      ) : url ? (
        <>
          {!attachment.type.startsWith("image/") ? <div className="chat-file-card"><ImageIcon size={20}/><span>{attachment.name} · {formatSize(attachment.size)}</span><a href={url} download={attachment.name} aria-label={`Scarica ${attachment.name}`}><Download size={18}/></a></div> : <div
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
          </div>}

          {lightbox ? createPortal(
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
            </div>, document.body
          ) : null}
        </>
      ) : null}
    </div>
  );
}
