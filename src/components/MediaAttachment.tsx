import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import { Download, FileAudio, FileVideo, Loader2, Play, X } from "lucide-react";
import { type ChatAttachmentMeta } from "../lib/chat-media";
import { readableError } from "../lib/workspace";
import {
  loadMediaPreview,
  MAX_INLINE_MEDIA_BYTES,
  type MediaPreview,
  type PlayableMedia,
} from "../lib/media-preview";
import { saveChatAttachment } from "../lib/media-download";
import "../media-attachment.css";
let activePlayer: { id: symbol; stop: () => void } | null = null;
export function MediaAttachment({
  attachment,
  conversationId,
  roomKey,
  format,
}: {
  attachment: ChatAttachmentMeta;
  conversationId: string;
  roomKey: CryptoKey | null;
  format: PlayableMedia;
}) {
  const [url, setUrl] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(""),
    [saving, setSaving] = useState<number | null>(null);
  const player = useRef<HTMLMediaElement | null>(null),
    preview = useRef<MediaPreview | null>(null),
    request = useRef<AbortController | null>(null),
    downloadRequest = useRef<AbortController | null>(null),
    generation = useRef(0),
    id = useRef(Symbol("media-player"));
  const dispose = useCallback(() => {
    generation.current++;
    request.current?.abort();
    request.current = null;
    const element = player.current;
    if (element) {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    preview.current?.dispose();
    preview.current = null;
    if (activePlayer?.id === id.current) activePlayer = null;
  }, []);
  const close = useCallback(() => {
    dispose();
    setUrl(null);
    setLoading(false);
    setProgress(0);
  }, [dispose]);
  useEffect(() => {
    close();
    setError("");
    return () => {
      dispose();
      downloadRequest.current?.abort();
    };
  }, [attachment, conversationId, roomKey, close, dispose]);
  useEffect(() => {
    if (url) player.current?.focus({ preventScroll: true });
  }, [url]);
  const open = async () => {
    if (!roomKey || loading || saving !== null) return;
    activePlayer?.stop();
    activePlayer = { id: id.current, stop: close };
    const controller = new AbortController(),
      current = ++generation.current;
    request.current = controller;
    setError("");
    setProgress(0);
    setLoading(true);
    try {
      const loaded = await loadMediaPreview(
        attachment,
        conversationId,
        roomKey,
        {
          signal: controller.signal,
          onProgress: (fraction) => {
            if (generation.current === current) setProgress(fraction);
          },
        },
      );
      if (generation.current !== current || controller.signal.aborted) {
        loaded.dispose();
        return;
      }
      preview.current = loaded;
      setUrl(loaded.url);
      setLoading(false);
    } catch (e) {
      if (generation.current === current && !controller.signal.aborted) {
        setError(readableError(e));
        setLoading(false);
        if (activePlayer?.id === id.current) activePlayer = null;
      }
    } finally {
      if (generation.current === current) request.current = null;
    }
  };
  const download = async () => {
    if (!roomKey || downloadRequest.current) return;
    const controller = new AbortController();
    downloadRequest.current = controller;
    setError("");
    setSaving(0);
    try {
      await saveChatAttachment(attachment, conversationId, roomKey, {
        signal: controller.signal,
        onProgress: (fraction) => {
          if (downloadRequest.current === controller) setSaving(fraction);
        },
      });
    } catch (e) {
      if (!controller.signal.aborted) setError(readableError(e));
    } finally {
      if (downloadRequest.current === controller) {
        downloadRequest.current = null;
        setSaving(null);
      }
    }
  };
  const Icon = format.kind === "audio" ? FileAudio : FileVideo,
    allowed = attachment.size <= MAX_INLINE_MEDIA_BYTES;
  const size =
    attachment.size < 1024 * 1024
      ? `${(attachment.size / 1024).toFixed(1)} KB`
      : `${(attachment.size / (1024 * 1024)).toFixed(1)} MB`;
  return (
    <section
      className={`media-attachment media-attachment-${format.kind}`}
      aria-label={`${format.kind === "audio" ? "Audio" : "Video"}: ${attachment.name}`}
    >
      <header className="media-attachment-header">
        <Icon size={21} />
        <div>
          <strong>{attachment.name}</strong>
          <span>
            {format.kind === "audio" ? "Audio" : "Video"} · {size}
          </span>
        </div>
        <div className="media-attachment-actions">
          {url ? (
            <a
              href={url}
              download={attachment.name}
              aria-label={`Scarica ${attachment.name}`}
            >
              <Download size={17} />
            </a>
          ) : (
            <button
              type="button"
              disabled={!roomKey || loading}
              onClick={() =>
                saving !== null
                  ? downloadRequest.current?.abort()
                  : void download()
              }
              aria-label={
                saving !== null
                  ? "Annulla download"
                  : `Scarica ${attachment.name}`
              }
            >
              {saving !== null ? <X size={17} /> : <Download size={17} />}
            </button>
          )}
          {(url || loading) && (
            <button
              type="button"
              onClick={close}
              aria-label={loading ? "Annulla anteprima" : "Chiudi player"}
            >
              <X size={17} />
            </button>
          )}
        </div>
      </header>
      {loading ? (
        <div className="media-attachment-loading" role="status">
          <Loader2 size={17} className="attachment-spinner" />
          <span>Caricamento e decifratura… {Math.round(progress * 100)}%</span>
        </div>
      ) : url ? (
        <div className="media-attachment-player">
          {format.kind === "audio" ? (
            <audio
              ref={player as Ref<HTMLAudioElement>}
              src={url}
              tabIndex={0}
              controls
              preload="metadata"
              controlsList="nodownload"
              aria-label={`Ascolta ${attachment.name}`}
              onError={() =>
                setError(
                  "Questo formato audio o codec non è supportato. Puoi scaricare il file.",
                )
              }
            />
          ) : (
            <video
              ref={player as Ref<HTMLVideoElement>}
              src={url}
              tabIndex={0}
              controls
              playsInline
              preload="metadata"
              controlsList="nodownload"
              aria-label={`Guarda ${attachment.name}`}
              onError={() =>
                setError(
                  "Questo formato video o codec non è supportato. Puoi scaricare il file.",
                )
              }
            />
          )}
        </div>
      ) : allowed ? (
        <button
          type="button"
          className="media-attachment-open"
          disabled={!roomKey || saving !== null}
          onClick={() => void open()}
        >
          <Play size={18} />
          {format.kind === "audio" ? "Apri player audio" : "Apri video"}
        </button>
      ) : (
        <p className="media-attachment-note">
          Scarica questo file di grandi dimensioni per riprodurlo.
        </p>
      )}
      {saving !== null && (
        <p className="media-attachment-note" role="status">
          Download {Math.round(saving * 100)}%
        </p>
      )}
      {error && (
        <p className="media-attachment-error" role="alert">
          {error}
          {!url && allowed && (
            <button
              type="button"
              disabled={loading || !roomKey}
              onClick={() => void open()}
            >
              Riprova
            </button>
          )}
        </p>
      )}
      <small className="media-attachment-retention">
        Pulizia annuale dopo 12 mesi
      </small>
    </section>
  );
}
