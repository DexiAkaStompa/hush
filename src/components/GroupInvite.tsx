import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Modal } from "./Modal";
import { ProfileImage } from "./ProfileImage";
import { initialsFor, readableError, type Conversation, type Profile } from "../lib/workspace";

export function GroupInvite({ conversation, friends, members, onInvite, onClose }: { conversation: Conversation; friends: Profile[]; members: Profile[]; onInvite: (usernames: string[]) => Promise<void>; onClose: () => void }) {
  const [query, setQuery] = useState(""), [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const existing = new Set(members.map(member => member.username));
  const available = friends.filter(friend => !existing.has(friend.username) && `${friend.username} ${friend.display_name}`.toLocaleLowerCase().includes(query.replace(/^@/, "").toLocaleLowerCase()));
  const entered = query.split(/[\s,]+/).map(value => value.trim().replace(/^@/, "").toLowerCase()).filter(Boolean);
  const recipients = [...new Set([...selected, ...entered.filter(name => !existing.has(name))])];
  return <Modal title="Invita al gruppo" description={`Aggiungi persone a ${conversation.name}. I nuovi membri potranno leggere anche la cronologia condivisa del gruppo.`} onClose={() => { if (!busy) onClose(); }}><form className="modal-form group-invite" onSubmit={event => {
    event.preventDefault(); setBusy(true); setError("");
    // Search text only becomes a recipient when no friends were explicitly selected.
    void onInvite(selected.length ? selected : recipients).then(onClose).catch(cause => setError(readableError(cause))).finally(() => setBusy(false));
  }}><label>Cerca un amico o inserisci gli username<input autoFocus value={query} disabled={busy} onChange={event => setQuery(event.target.value)} placeholder="@nome, @altro_nome" maxLength={600}/></label>
    <div className="group-invite-list">{available.map(friend => <label key={friend.id} className="group-invite-person"><span className="avatar" style={{ backgroundColor: friend.avatar_color }}>{initialsFor(friend.display_name)}<ProfileImage path={friend.avatar_path} alt=""/></span><span><strong>{friend.display_name}</strong><small>@{friend.username}</small></span><input type="checkbox" checked={selected.includes(friend.username)} disabled={busy} onChange={event => setSelected(current => event.target.checked ? [...current, friend.username] : current.filter(name => name !== friend.username))}/></label>)}{!available.length && <p className="sidebar-empty">Puoi invitare anche chi non è nella tua lista amici: inserisci il suo username esatto.</p>}</div>
    {selected.length > 0 && <div className="group-invite-selected">{selected.map(name => <button key={name} type="button" disabled={busy} onClick={() => setSelected(current => current.filter(item => item !== name))}>@{name} ×</button>)}</div>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    <button className="modal-primary" disabled={busy || !(selected.length || recipients.length)}><UserPlus size={17}/>{busy ? "Aggiunta…" : `Aggiungi ${selected.length || recipients.length || "persone"}`}</button>
  </form></Modal>;
}
