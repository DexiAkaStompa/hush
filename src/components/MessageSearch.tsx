import { Search, X } from "lucide-react";
import "../message-search.css";

export function MessageSearch({
  name,
  query,
  onChange,
  onClose,
  onSearch,
  onStop,
  searching,
  ready,
  resultCount,
  notice,
}: {
  name: string;
  query: string;
  onChange: (query: string) => void;
  onClose: () => void;
  onSearch: () => void;
  onStop: () => void;
  searching: boolean;
  ready: boolean;
  resultCount: number;
  notice: string;
}) {
  return (
    <section
      className="message-search"
      id="message-search"
      aria-label="Ricerca nei messaggi"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim() && ready && !searching) onSearch();
        }}
      >
        <Search size={17} aria-hidden="true" />
        <input
          autoFocus
          type="search"
          aria-label={`Cerca nei messaggi di ${name}`}
          placeholder={`Cerca in ${name}`}
          value={query}
          onChange={(event) => onChange(event.target.value)}
        />
        {searching ? (
          <button type="button" onClick={onStop}>
            Ferma ricerca
          </button>
        ) : (
          <button type="submit" disabled={!query.trim() || !ready}>
            Cerca nella cronologia
          </button>
        )}
        <button
          type="button"
          className="message-search-close"
          onClick={onClose}
          aria-label="Chiudi ricerca e mostra tutti i messaggi"
          title="Chiudi ricerca · Esc"
        >
          <X size={17} />
        </button>
      </form>
      <div className="message-search-info">
        <span>from:nome · has:file · before:2026-10-01 · after:2026-01-01</span>
        <span role="status">
          {!ready
            ? "In attesa della chiave della chat…"
            : notice ||
              (query.trim()
                ? `${resultCount} risultati nei messaggi caricati`
                : "Cerca in questa chat · Invio per cercare anche nella cronologia")}
        </span>
      </div>
    </section>
  );
}
