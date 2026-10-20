import { useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  ImageOff,
  Loader2,
  Volume2,
  Users,
  X,
} from "lucide-react";
import {
  extractPreviewLinks,
  loadLinkPreview,
  loadPreviewImage,
  type LinkPreview,
  invalidateLinkPreview,
} from "../lib/link-previews";
import { safeCommunityImage } from "../lib/community-identity";
import { observeVoicePreview } from "../lib/voice-preview";
import "../link-embeds.css";
export function LinkEmbeds({
  text,
  onHushLink,
}: {
  text: string;
  onHushLink?: (url: string) => Promise<void>;
}) {
  return (
    <div className="link-embeds">
      {extractPreviewLinks(text).map((url) => (
        <LinkEmbed key={url} url={url} onHushLink={onHushLink} />
      ))}
    </div>
  );
}
function LinkEmbed({
  url,
  onHushLink,
}: {
  url: string;
  onHushLink?: (url: string) => Promise<void>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [occupancy, setOccupancy] = useState<number | null>(null);
  const [near, setNear] = useState(false),
    [data, setData] = useState<LinkPreview | null>(null),
    [image, setImage] = useState<string | null>(null),
    [failed, setFailed] = useState(false),
    [hidden, setHidden] = useState(false),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0),
    [actionError, setActionError] = useState("");
  useEffect(() => {
    const node = root.current;
    if (!node || hidden) return;
    const observer = new IntersectionObserver(
      (entries) => setNear(entries[0].isIntersecting),
      { rootMargin: "250px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hidden]);
  useEffect(() => {
    if (!near || hidden || data) return;
    const controller = new AbortController();
    setFailed(false);
    void loadLinkPreview(url, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [url, near, hidden, data, retry]);
  useEffect(() => {
    if (!near || hidden || !data?.image) return;
    const controller = new AbortController();
    let local: string | undefined;
    void loadPreviewImage(data.image, controller.signal)
      .then((value) => {
        local = value;
        if (controller.signal.aborted) URL.revokeObjectURL(value);
        else setImage(value);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      setImage(null);
      if (local) URL.revokeObjectURL(local);
    };
  }, [data?.image, near, hidden]);
  useEffect(() => {
    setOccupancy(null);
    if (!near || hidden || data?.kind !== "hush-voice" || data.unavailable)
      return;
    return observeVoicePreview(new URL(url).pathname.slice(1), setOccupancy);
  }, [near, hidden, data?.kind, data?.unavailable, url]);
  if (hidden) return null;
  const invite = data?.kind && data.kind !== "link",
    voice = data?.kind === "voice-invite" || data?.kind === "hush-voice";
  const open = async () => {
    if (!onHushLink || busy) return;
    setBusy(true);
    setActionError("");
    try {
      await onHushLink(url);
      invalidateLinkPreview(url);
      setData(null);
    } catch {
      setActionError(
        "Impossibile aprire questo invito o canale. Potrebbe essere scaduto o non accessibile.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div ref={root} className={`link-embed ${invite ? "link-invite" : ""}`}>
      <button
        className="link-embed-dismiss"
        aria-label="Nascondi anteprima del link"
        title="Nascondi anteprima"
        onClick={() => setHidden(true)}
      >
        <X size={14} />
      </button>
      {!data ? (
        <div className="link-embed-loading">
          <span>{new URL(url).hostname}</span>
          {failed ? (
            <button onClick={() => setRetry((v) => v + 1)}>
              Riprova anteprima
            </button>
          ) : (
            <span>
              <Loader2 size={14} className="attachment-spinner" /> Caricamento
              anteprima…
            </span>
          )}
        </div>
      ) : (
        <>
          <div className="link-embed-content">
            {(invite || data.siteName !== data.title) && (
              <small>
                {voice ? (
                  <Volume2 size={14} />
                ) : invite ? (
                  <Users size={14} />
                ) : null}
                {data.siteName}
              </small>
            )}
            {safeCommunityImage(data.icon) && (
              <img className="link-invite-icon" src={data.icon} alt="" />
            )}
            {invite && data.image && (
              <span className="link-invite-icon">
                {image ? <img src={image} alt="" /> : <Users size={20} />}
              </span>
            )}
            {url.startsWith("hush:") ? (
              <strong>{data.title}</strong>
            ) : (
              <a
                className="link-embed-title"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {data.title}
              </a>
            )}
            {data.description && <p>{data.description}</p>}
            {occupancy !== null && (
              <p className="link-voice-occupancy">
                {occupancy === 0
                  ? "Non c’è nessuno nel canale vocale in questo momento."
                  : `${occupancy} ${occupancy === 1 ? "persona" : "persone"} nel canale vocale`}
              </p>
            )}
            {data.members !== undefined && (
              <p className="link-invite-counts">
                {data.members} membri
                {data.online !== undefined
                  ? ` · ${data.online} online nel server`
                  : ""}
              </p>
            )}
            {data.image && !invite && (
              <a
                className="link-embed-image"
                href={url.startsWith("https:") ? url : undefined}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Apri ${data.title}`}
              >
                {image ? (
                  <img src={image} alt="" decoding="async" />
                ) : (
                  <ImageOff size={22} aria-hidden="true" />
                )}
              </a>
            )}
            {invite &&
              !data.unavailable &&
              (url.startsWith("hush:") ? (
                <button
                  className="link-invite-join"
                  disabled={busy || !onHushLink}
                  onClick={() => void open()}
                >
                  {busy ? (
                    <Loader2 size={15} className="attachment-spinner" />
                  ) : voice ? (
                    <Volume2 size={15} />
                  ) : (
                    <Users size={15} />
                  )}{" "}
                  {voice
                    ? "Unisciti alla chat vocale"
                    : data.kind === "hush-channel"
                      ? "Apri canale"
                      : data.isMember
                        ? "Apri server"
                        : "Unisciti al server"}
                </button>
              ) : (
                <a
                  className="link-invite-join"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {voice ? <Volume2 size={15} /> : <ExternalLink size={15} />}{" "}
                  {voice ? "Unisciti alla chat vocale" : "Apri invito Discord"}
                </a>
              ))}
            {actionError && <p role="alert">{actionError}</p>}
          </div>
          {voice && (
            <p className="link-invite-private">
              {url.startsWith("hush:")
                ? "Solo i membri autorizzati possono entrare nel canale."
                : "Apri Discord per vedere chi è nel canale e partecipare."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
