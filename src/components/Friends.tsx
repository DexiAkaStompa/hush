import { useState, type FormEvent } from "react";
import {
  Check,
  MessageCircle,
  RefreshCw,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { ProfileImage } from "./ProfileImage";
import { friendshipError, friendshipKind } from "../lib/friendships";
import type { FriendshipsController } from "../lib/use-friendships";
import { initialsFor, type Profile } from "../lib/workspace";
import "../friends.css";

export function FriendActions({
  user,
  friendships,
}: {
  user: Profile;
  friendships: FriendshipsController;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false);
  const row = friendships.entries.find((row) => row.user.id === user.id);
  const kind = row ? friendshipKind(row, friendships.selfId) : null;
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      setConfirm(false);
    } catch (e) {
      setError(friendshipError(e));
    } finally {
      setBusy(false);
    }
  };
  if (user.id === friendships.selfId) return null;
  return (
    <div className="friend-actions-wrap">
      <div className="friend-actions">
        {friendships.loading ? (
          <span role="status">Caricamento amicizia…</span>
        ) : friendships.error ? (
          <button onClick={() => void friendships.refresh()}>
            Ricarica amicizie
          </button>
        ) : kind === "friend" ? (
          <>
            <span className="friend-confirmed">
              <Check size={14} /> Amici
            </span>
            <button
              disabled={busy}
              onClick={() =>
                confirm
                  ? void run(() => friendships.remove(row!.id))
                  : setConfirm(true)
              }
            >
              {confirm ? "Conferma rimozione" : "Rimuovi amico"}
            </button>
            {confirm && (
              <button disabled={busy} onClick={() => setConfirm(false)}>
                Annulla
              </button>
            )}
          </>
        ) : kind === "incoming" ? (
          <>
            <button
              className="friend-primary"
              disabled={busy}
              onClick={() => void run(() => friendships.accept(row!.id))}
            >
              <Check size={15} /> Accetta
            </button>
            <button
              disabled={busy}
              onClick={() => void run(() => friendships.remove(row!.id))}
            >
              <X size={15} /> Rifiuta
            </button>
          </>
        ) : kind === "outgoing" ? (
          <button
            disabled={busy}
            onClick={() => void run(() => friendships.remove(row!.id))}
          >
            <X size={15} /> Annulla richiesta
          </button>
        ) : (
          <button
            className="friend-primary"
            disabled={busy}
            onClick={() => void run(() => friendships.send(user.username))}
          >
            <UserPlus size={15} /> {busy ? "Invio…" : "Aggiungi amico"}
          </button>
        )}
      </div>
      {error && (
        <p className="friends-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function FriendsPanel({
  friendships,
  onMessage,
  onProfile,
}: {
  friendships: FriendshipsController;
  onMessage: (user: Profile) => void;
  onProfile: (user: Profile, anchor: HTMLElement) => void;
}) {
  const [tab, setTab] = useState<"friends" | "pending" | "add">("friends"),
    [query, setQuery] = useState(""),
    [username, setUsername] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [sendError, setSendError] = useState("");
  const friends = friendships.entries.filter(
    (row) => row.status === "accepted",
  );
  const incoming = friendships.entries.filter(
    (row) => friendshipKind(row, friendships.selfId) === "incoming",
  );
  const outgoing = friendships.entries.filter(
    (row) => friendshipKind(row, friendships.selfId) === "outgoing",
  );
  const filter = (rows: typeof friends) =>
    rows
      .filter((row) =>
        `${row.user.display_name} ${row.user.username}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
      )
      .sort((a, b) =>
        a.user.display_name.localeCompare(b.user.display_name, "it"),
      );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !username.trim()) return;
    setBusy(true);
    setNotice("");
    setSendError("");
    try {
      await friendships.send(username);
      setNotice(
        `Richiesta inviata a @${username.trim().replace(/^@+/, "").toLowerCase()}.`,
      );
      setUsername("");
    } catch (e) {
      setSendError(friendshipError(e));
    } finally {
      setBusy(false);
    }
  };
  const list = (rows: typeof friends) =>
    filter(rows).map((row) => (
      <article className="friend-row" key={row.id}>
        <button
          className="friend-person"
          onClick={(event) => onProfile(row.user, event.currentTarget)}
          aria-label={`Apri profilo di ${row.user.display_name}`}
        >
          <span
            className="friend-avatar"
            style={{ backgroundColor: row.user.avatar_color }}
          >
            {initialsFor(row.user.display_name)}
            <ProfileImage path={row.user.avatar_path} alt="" />
          </span>
          <span>
            <strong>{row.user.display_name}</strong>
            <small>@{row.user.username}</small>
          </span>
        </button>
        <div className="friend-row-controls">
          {row.status === "accepted" && (
            <button
              className="friend-message"
              aria-label={`Scrivi a ${row.user.display_name}`}
              title="Invia messaggio"
              onClick={() => onMessage(row.user)}
            >
              <MessageCircle size={18} />
            </button>
          )}
          <FriendActions user={row.user} friendships={friendships} />
        </div>
      </article>
    ));
  return (
    <section className="friends-panel" aria-label="Amici e richieste">
      <div className="friends-heading">
        <div>
          <span className="eyebrow">le tue persone</span>
          <h1>
            <Users size={25} /> Amici
          </h1>
          <p>Ritrovatevi qui, anche senza un server in comune.</p>
        </div>
        <button
          className="friends-refresh"
          aria-label="Aggiorna amicizie"
          onClick={() => void friendships.refresh()}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      <div className="friends-tabs" role="group" aria-label="Sezioni amicizie">
        <button
          aria-pressed={tab === "friends"}
          onClick={() => setTab("friends")}
        >
          Tutti · {friends.length}
        </button>
        <button
          aria-pressed={tab === "pending"}
          onClick={() => setTab("pending")}
        >
          Richieste
          {incoming.length + outgoing.length > 0
            ? ` · ${incoming.length + outgoing.length}`
            : ""}
        </button>
        <button
          className="friends-add"
          aria-pressed={tab === "add"}
          onClick={() => setTab("add")}
        >
          <UserPlus size={15} /> Aggiungi amico
        </button>
      </div>
      {friendships.error && (
        <p className="friends-error" role="alert">
          {friendships.error}{" "}
          <button onClick={() => void friendships.refresh()}>Riprova</button>
        </p>
      )}
      {tab === "add" ? (
        <form className="friends-add-form" onSubmit={submit}>
          <h2>Aggiungi un amico</h2>
          <p>
            Inserisci il suo username esatto. Riceverà una richiesta da
            accettare.
          </p>
          <label htmlFor="friend-username">Username</label>
          <div>
            <input
              id="friend-username"
              autoComplete="off"
              placeholder="@username"
              maxLength={33}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setNotice("");
                setSendError("");
              }}
            />
            <button disabled={busy || !username.trim()}>
              {busy ? "Invio…" : "Invia richiesta"}
            </button>
          </div>
          {notice && (
            <p className="friends-success" role="status">
              {notice}
            </p>
          )}
          {sendError && (
            <p className="friends-error" role="alert">
              {sendError}
            </p>
          )}
        </form>
      ) : (
        <>
          <label className="friends-filter">
            Cerca {tab === "friends" ? "tra gli amici" : "nelle richieste"}
            <input
              type="search"
              placeholder="Nome o username"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {friendships.loading ? (
            <p role="status">Caricamento amicizie…</p>
          ) : tab === "friends" ? (
            <>
              {friends.length ? (
                list(friends)
              ) : (
                <div className="friends-empty">
                  <Users size={32} />
                  <h2>Le amicizie iniziano da un saluto</h2>
                  <p>
                    Invia una richiesta usando lo username o il pulsante nel
                    profilo.
                  </p>
                  <button onClick={() => setTab("add")}>
                    Aggiungi il primo amico
                  </button>
                </div>
              )}
              {friends.length > 0 && !filter(friends).length && (
                <p>Nessun amico corrisponde alla ricerca.</p>
              )}
            </>
          ) : (
            <>
              <h2 className="friends-list-title">
                Ricevute · {incoming.length}
              </h2>
              {list(incoming)}
              {!filter(incoming).length && (
                <p className="friends-muted">
                  Nessuna richiesta ricevuta
                  {query ? " corrisponde alla ricerca" : " in attesa"}.
                </p>
              )}
              <h2 className="friends-list-title">
                Inviate · {outgoing.length}
              </h2>
              {list(outgoing)}
              {!filter(outgoing).length && (
                <p className="friends-muted">
                  Nessuna richiesta inviata
                  {query ? " corrisponde alla ricerca" : " in attesa"}.
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
