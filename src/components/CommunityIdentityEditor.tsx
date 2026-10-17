import { useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ImagePlus, RotateCcw } from "lucide-react";
import { Modal } from "./Modal";
import {
  IDENTITY_COLORS,
  identityColor,
  prepareCommunityImage,
  safeCommunityImage,
  type CommunityIdentity,
} from "../lib/community-identity";
import { initialsFor, readableError } from "../lib/workspace";
import "../community-identity.css";

export function CommunityIdentityEditor({
  value,
  label,
  readOnly = false,
  onSave,
  onClose,
}: {
  value: CommunityIdentity;
  label: string;
  readOnly?: boolean;
  onSave: (identity: CommunityIdentity) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState({ ...value });
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const iconInput = useRef<HTMLInputElement>(null),
    bannerInput = useRef<HTMLInputElement>(null);
  const baseline = useRef(JSON.stringify(value));
  const dirty = JSON.stringify(draft) !== baseline.current;
  const update = (patch: Partial<CommunityIdentity>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSaved(false);
  };
  const loadImage = async (file: File | undefined, kind: "icon" | "banner") => {
    if (!file) return;
    setProcessing(true);
    setError("");
    try {
      const image = await prepareCommunityImage(file, kind);
      update(kind === "icon" ? { icon_data: image } : { banner_data: image });
    } catch (e) {
      setError(readableError(e));
    } finally {
      setProcessing(false);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || processing || readOnly) return;
    setBusy(true);
    setError("");
    try {
      await onSave(draft);
      baseline.current = JSON.stringify(draft);
      setSaved(true);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`${readOnly ? "Informazioni" : "Personalizza"} ${label}`}
      description={
        readOnly
          ? "Le modifiche sono riservate agli amministratori del server."
          : "Dai uno stile riconoscibile a questo spazio. Le modifiche saranno visibili a tutti i membri."
      }
      className="community-editor"
      onClose={() => {
        if (busy || processing) return;
        if (dirty && !readOnly) setConfirmDiscard(true);
        else onClose();
      }}
    >
      <form onSubmit={submit}>
        <div
          className="community-preview"
          style={
            {
              "--identity-accent": identityColor(draft.accent_color),
            } as CSSProperties
          }
        >
          <div className="community-cover">
            {safeCommunityImage(draft.banner_data) && (
              <img src={draft.banner_data!} alt="Anteprima copertina" />
            )}
            <span>ANTEPRIMA</span>
          </div>
          <div className="community-preview-body">
            <span className="community-avatar">
              {safeCommunityImage(draft.icon_data) ? (
                <img src={draft.icon_data!} alt="Icona dello spazio" />
              ) : (
                initialsFor(draft.name || "Hush")
              )}
            </span>
            <strong>{draft.name || "Il tuo spazio"}</strong>
            <p>{draft.description || "Un posto tutto vostro."}</p>
          </div>
        </div>
        <fieldset hidden={readOnly} disabled={readOnly || busy || processing}>
          <div className="identity-image-actions">
            <button type="button" onClick={() => iconInput.current?.click()}>
              <ImagePlus size={16} />
              Cambia icona
            </button>
            <button type="button" onClick={() => bannerInput.current?.click()}>
              <ImagePlus size={16} />
              Cambia copertina
            </button>
            {draft.icon_data && (
              <button type="button" onClick={() => update({ icon_data: null })}>
                <RotateCcw size={15} />
                Rimuovi icona
              </button>
            )}
            {draft.banner_data && (
              <button
                type="button"
                onClick={() => update({ banner_data: null })}
              >
                <RotateCcw size={15} />
                Rimuovi copertina
              </button>
            )}
          </div>
          <input
            hidden
            ref={iconInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Immagine icona"
            onChange={(e) => {
              void loadImage(e.target.files?.[0], "icon");
              e.target.value = "";
            }}
          />
          <input
            hidden
            ref={bannerInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Immagine copertina"
            onChange={(e) => {
              void loadImage(e.target.files?.[0], "banner");
              e.target.value = "";
            }}
          />
          <label>
            Nome
            <input
              autoFocus
              value={draft.name}
              required
              maxLength={80}
              onChange={(e) => update({ name: e.target.value })}
            />
          </label>
          <label>
            Descrizione
            <textarea
              value={draft.description || ""}
              maxLength={500}
              rows={3}
              placeholder="Di cosa parlate? Cosa rende speciale questo spazio?"
              onChange={(e) => update({ description: e.target.value })}
            />
            <small>{draft.description?.length || 0}/500</small>
          </label>
          <div
            className="identity-colors"
            role="group"
            aria-label="Colore dello spazio"
          >
            <span>Colore</span>
            {IDENTITY_COLORS.map((color) => (
              <button
                type="button"
                key={color}
                style={{ backgroundColor: color }}
                aria-label={`Colore ${color}`}
                aria-pressed={identityColor(draft.accent_color) === color}
                onClick={() => update({ accent_color: color })}
              />
            ))}
            <label className="identity-custom-color">
              Personalizzato
              <input
                type="color"
                value={identityColor(draft.accent_color)}
                onChange={(e) => update({ accent_color: e.target.value })}
              />
            </label>
          </div>
        </fieldset>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        {confirmDiscard && (
          <div className="identity-discard" role="alert">
            <p>Vuoi chiudere senza salvare le modifiche?</p>
            <button type="button" onClick={() => setConfirmDiscard(false)}>
              Continua a modificare
            </button>
            <button type="button" onClick={onClose}>
              Scarta e chiudi
            </button>
          </div>
        )}
        <footer className="identity-save-bar">
          <span role="status">
            {processing
              ? "Ottimizzazione immagine…"
              : saved
                ? "Modifiche salvate"
                : dirty
                  ? "Hai modifiche non salvate"
                  : ""}
          </span>
          <button type="button" onClick={onClose} disabled={busy || processing}>
            {dirty ? "Annulla" : "Chiudi"}
          </button>
          {!readOnly && (
            <button
              className="modal-primary"
              disabled={!dirty || !draft.name.trim() || busy || processing}
            >
              {busy ? "Salvataggio…" : "Salva modifiche"}
            </button>
          )}
        </footer>
      </form>
    </Modal>
  );
}
