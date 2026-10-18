import { useEffect, useState } from "react";
import { GripVertical, Hash, Volume2 } from "lucide-react";
import { readableError } from "../lib/workspace";
import { Modal } from "./Modal";
import {
  assignSpaceChannel,
  createManagedChannel,
  createSpaceCategory,
  deleteSpaceCategory,
  kickSpaceMember,
  loadSpaceManagement,
  manageSpaceMember,
  renameSpaceCategory,
  renameSpaceChannel,
  reorderSpaceCategory,
  revokeSpaceInvite,
  setSpaceBan,
  setConversationSendPermission,
} from "../lib/space-management";
import {
  SERVER_PERMISSIONS,
  deleteSpaceRole,
  reorderChannels,
  saveChannelOverride,
  saveSpaceRole,
  setMemberRoles,
  type ServerPermission,
  type SpaceRole,
} from "../lib/server-roles";
import "../space-management.css";
type State = Awaited<ReturnType<typeof loadSpaceManagement>>;
type Act = (action: () => Promise<unknown>) => Promise<void>;
type PanelProps = { state: State; spaceId: string; busy: boolean; act: Act };
type Tab = "channels" | "roles" | "members" | "invites" | "bans";
export function SpaceManagement({
  spaceId,
  currentUserId,
  onChanged,
  onClose,
  onCustomize,
}: {
  spaceId: string;
  currentUserId: string;
  onChanged: () => void;
  onClose: () => void;
  onCustomize?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("channels"),
    [state, setState] = useState<State | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    loadSpaceManagement(spaceId)
      .then((value) => {
        if (active) setState(value);
      })
      .catch((e) => {
        if (active) setError(readableError(e));
      });
    return () => {
      active = false;
    };
  }, [spaceId]);
  const act: Act = async (action) => {
    setBusy(true);
    setError("");
    try {
      await action();
      setState(await loadSpaceManagement(spaceId));
      onChanged();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  };
  const names: Record<Tab, string> = {
    channels: "Canali",
    roles: "Ruoli",
    members: "Membri",
    invites: "Inviti",
    bans: "Ban",
  };
  const props = state ? { state, spaceId, busy, act } : null;
  return (
    <Modal
      title="Gestisci server"
      description="Canali, ruoli e comunità"
      onClose={() => {
        if (!busy) onClose();
      }}
      className="space-management"
    >
      {onCustomize && (
        <button className="identity-settings-entry" onClick={onCustomize}>
          <span>
            <strong>Identità e aspetto</strong>
            <small>Nome, descrizione, icona, copertina e colore</small>
          </span>
        </button>
      )}
      <nav className="space-management-tabs" aria-label="Impostazioni server">
        {(Object.keys(names) as Tab[]).map((t) => (
          <button
            key={t}
            disabled={busy}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {names[t]}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="space-management-error">
          {error}
        </p>
      )}
      {!state || !props ? (
        <p>Caricamento…</p>
      ) : !["owner", "admin"].includes(
          state.members.find((m) => m.user_id === currentUserId)?.role ?? "",
        ) ? (
        <p>La gestione è riservata agli amministratori.</p>
      ) : tab === "channels" ? (
        <Channels {...props} />
      ) : tab === "roles" ? (
        <Roles {...props} />
      ) : tab === "members" ? (
        <Members {...props} currentUserId={currentUserId} />
      ) : (
        <div className="space-management-list">
          {tab === "invites" ? (
            state.invites.length ? (
              state.invites.map((i) => (
                <div className="space-management-row" key={i.id}>
                  <span>
                    {i.use_count}/{i.max_uses} utilizzi ·{" "}
                    {i.revoked_at
                      ? "Revocato"
                      : `Scade ${new Date(i.expires_at).toLocaleDateString("it")}`}
                  </span>
                  {!i.revoked_at && (
                    <button
                      disabled={busy}
                      onClick={() => void act(() => revokeSpaceInvite(i.id))}
                    >
                      Revoca
                    </button>
                  )}
                </div>
              ))
            ) : (
              <p>Nessun invito.</p>
            )
          ) : state.bans.length ? (
            state.bans.map((b) => (
              <div className="space-management-row" key={b.user_id}>
                <span>{b.user_id}</span>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(() => setSpaceBan(spaceId, b.user_id, false))
                  }
                >
                  Rimuovi ban
                </button>
              </div>
            ))
          ) : (
            <p>Nessun membro bannato.</p>
          )}
        </div>
      )}
    </Modal>
  );
}
function InlineRename({
  value,
  busy,
  onSave,
}: {
  value: string;
  busy: boolean;
  onSave: (name: string) => Promise<unknown>;
}) {
  const [name, setName] = useState(value);
  useEffect(() => setName(value), [value]);
  return (
    <form
      className="management-inline"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(name);
      }}
    >
      <input
        aria-label="Nome"
        maxLength={80}
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
      />
      <button disabled={busy || !name.trim() || name.trim() === value}>
        Salva nome
      </button>
    </form>
  );
}
function Channels({ state, spaceId, busy, act }: PanelProps) {
  const [category, setCategory] = useState(""),
    [name, setName] = useState(""),
    [voice, setVoice] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [dragging, setDragging] = useState<string | null>(null);
  const channels = [...state.channels].sort(
    (a, b) => a.position - b.position || a.id.localeCompare(b.id),
  );
  const move = (id: string, index: number) => {
    const ids = channels.map((c) => c.id),
      from = ids.indexOf(id);
    if (from < 0 || from === index) return;
    ids.splice(from, 1);
    ids.splice(index, 0, id);
    void act(() => reorderChannels(spaceId, ids));
  };
  const channel = channels.find((c) => c.id === selected);
  return (
    <div className="management-section">
      <form
        className="management-create"
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await createManagedChannel(spaceId, name, voice);
            setName("");
          });
        }}
      >
        <input
          aria-label="Nuovo canale"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome del nuovo canale"
        />
        <select
          aria-label="Tipo canale"
          value={voice ? "voice" : "text"}
          onChange={(e) => setVoice(e.target.value === "voice")}
        >
          <option value="text">Testuale</option>
          <option value="voice">Vocale</option>
        </select>
        <button disabled={busy || !name.trim()}>Crea canale</button>
      </form>
      <details className="management-categories">
        <summary>Categorie · {state.categories.length}</summary>
        <form
          className="management-create"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await createSpaceCategory(spaceId, category);
              setCategory("");
            });
          }}
        >
          <input
            aria-label="Nuova categoria"
            maxLength={80}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Nuova categoria"
          />
          <button disabled={busy || !category.trim()}>Crea categoria</button>
        </form>
        {state.categories.map((c, index) => (
          <div className="management-category" key={c.id}>
            <InlineRename
              value={c.name}
              busy={busy}
              onSave={(n) => act(() => renameSpaceCategory(c.id, n))}
            />
            <button
              aria-label={`Sposta ${c.name} su`}
              disabled={busy || index === 0}
              onClick={() =>
                void act(() =>
                  reorderSpaceCategory(
                    c.id,
                    state.categories[index - 1].position,
                  ),
                )
              }
            >
              ↑
            </button>
            <button
              aria-label={`Sposta ${c.name} giù`}
              disabled={busy || index === state.categories.length - 1}
              onClick={() =>
                void act(() =>
                  reorderSpaceCategory(
                    c.id,
                    state.categories[index + 1].position,
                  ),
                )
              }
            >
              ↓
            </button>
            <button
              disabled={busy}
              onClick={() => void act(() => deleteSpaceCategory(c.id))}
            >
              Rimuovi categoria
            </button>
          </div>
        ))}
      </details>
      <p className="management-hint">
        Trascina i canali oppure usa le frecce per cambiarne l’ordine.
      </p>
      <div className="management-channel-list">
        {channels.map((c, index) => (
          <div
            key={c.id}
            className={`management-channel ${dragging === c.id ? "is-dragging" : ""}`}
            draggable={!busy}
            onDragStart={(e) => {
              setDragging(c.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", c.id);
            }}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => {
              if (dragging) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging) move(dragging, index);
              setDragging(null);
            }}
          >
            <GripVertical size={15} className="management-grip" />
            {c.kind === "voice_channel" ? (
              <Volume2 size={16} />
            ) : (
              <Hash size={16} />
            )}
            <span className="management-channel-name">
              <strong>{c.name}</strong>
              <small>
                {state.categories.find((cat) => cat.id === c.category_id)
                  ?.name ?? "Senza categoria"}
              </small>
            </span>
            <button
              disabled={busy || index === 0}
              aria-label={`Sposta ${c.name} su`}
              onClick={() => move(c.id, index - 1)}
            >
              ↑
            </button>
            <button
              disabled={busy || index === channels.length - 1}
              aria-label={`Sposta ${c.name} giù`}
              onClick={() => move(c.id, index + 1)}
            >
              ↓
            </button>
            <button
              disabled={busy}
              aria-expanded={selected === c.id}
              onClick={() => setSelected(selected === c.id ? null : c.id)}
            >
              Modifica
            </button>
          </div>
        ))}
      </div>
      {channel && (
        <ChannelSettings
          key={channel.id}
          {...{ state, spaceId, busy, act }}
          channelId={channel.id}
        />
      )}
    </div>
  );
}
function ChannelSettings({
  state,
  busy,
  act,
  channelId,
}: PanelProps & { channelId: string }) {
  const channel = state.channels.find((c) => c.id === channelId)!;
  const [roleId, setRoleId] = useState(
      state.roles.find((r) => r.is_default)?.id ?? "",
    ),
    [values, setValues] = useState<Record<string, string>>({});
  const override = state.overrides.find(
    (o) => o.conversation_id === channelId && o.role_id === roleId,
  );
  useEffect(
    () =>
      setValues(
        Object.fromEntries(
          SERVER_PERMISSIONS.map((p) => [
            p.id,
            override?.allow_permissions.includes(p.id)
              ? "allow"
              : override?.deny_permissions.includes(p.id)
                ? "deny"
                : "inherit",
          ]),
        ),
      ),
    [roleId, override],
  );
  return (
    <section
      className="management-detail"
      aria-label={`Impostazioni ${channel.name}`}
    >
      <h3>{channel.name}</h3>
      <InlineRename
        value={channel.name}
        busy={busy}
        onSave={(n) => act(() => renameSpaceChannel(channel.id, n))}
      />
      <label>
        Categoria
        <select
          value={channel.category_id ?? ""}
          disabled={busy}
          onChange={(e) =>
            void act(() =>
              assignSpaceChannel(
                channel.id,
                e.target.value || null,
                channel.position,
              ),
            )
          }
        >
          <option value="">Senza categoria</option>
          {state.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Scrittura
        <select
          disabled={busy}
          value={channel.send_permission}
          onChange={(e) =>
            void act(() =>
              setConversationSendPermission(
                channel.id,
                e.target.value as "members" | "admins",
              ),
            )
          }
        >
          <option value="members">Segui i permessi dei ruoli</option>
          <option value="admins">Solo proprietario e amministratori</option>
        </select>
      </label>
      <h4>Permessi del canale</h4>
      <p className="management-hint">
        I canali restano visibili ai membri. Proprietario e amministratori
        mantengono tutti i permessi.
      </p>
      <label>
        Ruolo
        <select
          value={roleId}
          disabled={busy}
          onChange={(e) => setRoleId(e.target.value)}
        >
          {state.roles.map((r) => (
            <option key={r.id} value={r.id}>
              @{r.name}
            </option>
          ))}
        </select>
      </label>
      {SERVER_PERMISSIONS.map((p) => (
        <label className="management-permission-row" key={p.id}>
          <span>{p.label}</span>
          <select
            aria-label={p.label}
            disabled={busy}
            value={values[p.id] ?? "inherit"}
            onChange={(e) =>
              setValues((v) => ({ ...v, [p.id]: e.target.value }))
            }
          >
            <option value="inherit">Eredita</option>
            <option value="allow">Consenti</option>
            <option value="deny">Nega</option>
          </select>
        </label>
      ))}
      <button
        disabled={busy || !roleId}
        onClick={() =>
          void act(() =>
            saveChannelOverride(
              channelId,
              roleId,
              SERVER_PERMISSIONS.filter((p) => values[p.id] === "allow").map(
                (p) => p.id,
              ),
              SERVER_PERMISSIONS.filter((p) => values[p.id] === "deny").map(
                (p) => p.id,
              ),
            ),
          )
        }
      >
        Salva permessi del canale
      </button>
      <p className="management-hint">
        Si applica prima @everyone, poi i ruoli assegnati. Fra questi, un
        consenso prevale su un divieto.
      </p>
    </section>
  );
}
function Roles({ state, spaceId, busy, act }: PanelProps) {
  const [id, setId] = useState<string | null>(state.roles[0]?.id ?? null);
  const role = state.roles.find((r) => r.id === id);
  return (
    <div className="management-roles">
      <nav className="management-role-list" aria-label="Ruoli">
        <button
          disabled={busy}
          className={!role ? "active" : ""}
          onClick={() => setId(null)}
        >
          + Nuovo ruolo
        </button>
        {state.roles.map((r) => (
          <button
            key={r.id}
            disabled={busy}
            className={id === r.id ? "active" : ""}
            onClick={() => setId(r.id)}
          >
            <span
              className="management-role-color"
              style={{ background: r.color }}
            />
            @{r.name}
          </button>
        ))}
      </nav>
      <RoleEditor
        key={role?.id ?? "new"}
        role={role}
        busy={busy}
        onSave={(r) =>
          act(async () => {
            setId(await saveSpaceRole(spaceId, r));
          })
        }
        onDelete={() =>
          act(async () => {
            if (role) await deleteSpaceRole(role.id);
            setId(state.roles.find((r) => r.is_default)?.id ?? null);
          })
        }
      />
    </div>
  );
}
function RoleEditor({
  role,
  busy,
  onSave,
  onDelete,
}: {
  role?: SpaceRole;
  busy: boolean;
  onSave: (
    r: Pick<SpaceRole, "name" | "color" | "permissions" | "mentionable"> & {
      id?: string;
    },
  ) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(role?.name ?? ""),
    [color, setColor] = useState(role?.color ?? "#b8bbc2"),
    [permissions, setPermissions] = useState<ServerPermission[]>(
      role?.permissions ?? [],
    ),
    [mentionable, setMentionable] = useState(role?.mentionable ?? true),
    [confirm, setConfirm] = useState(false);
  return (
    <form
      className="management-role-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({ id: role?.id, name, color, permissions, mentionable });
      }}
    >
      <h3>{role ? `@${role.name}` : "Nuovo ruolo"}</h3>
      <label>
        Nome
        <input
          maxLength={48}
          required
          disabled={busy || role?.is_default}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="management-color-field">
        Colore
        <input
          type="color"
          disabled={busy}
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
        <span className="member-role-tag" style={{ color }}>
          @{name || "Ruolo"}
        </span>
      </label>
      {!role?.is_default && (
        <label className="management-permission-check">
          <input
            type="checkbox"
            disabled={busy}
            checked={mentionable}
            onChange={(e) => setMentionable(e.target.checked)}
          />
          <span>Menzionabile da tutti</span>
        </label>
      )}
      <p className="management-hint">
        I permessi dei ruoli si sommano a @everyone. Per negare un’azione, usa i
        permessi del singolo canale.
      </p>
      <div className="management-role-permissions">
        {SERVER_PERMISSIONS.map((p) => (
          <label key={p.id} className="management-permission-check">
            <input
              type="checkbox"
              disabled={busy}
              checked={permissions.includes(p.id)}
              onChange={(e) =>
                setPermissions((v) =>
                  e.target.checked ? [...v, p.id] : v.filter((x) => x !== p.id),
                )
              }
            />
            <span>
              {p.label}
              <small>{p.description}</small>
            </span>
          </label>
        ))}
      </div>
      <button disabled={busy || !name.trim()}>Salva ruolo</button>
      {role && !role.is_default && (
        <div className="management-role-delete">
          {confirm ? (
            <>
              <span>Rimuovere il ruolo da tutti i membri?</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onDelete()}
              >
                Conferma eliminazione
              </button>
              <button type="button" onClick={() => setConfirm(false)}>
                Annulla
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirm(true)}
            >
              Elimina ruolo
            </button>
          )}
        </div>
      )}
    </form>
  );
}
function Members({
  state,
  spaceId,
  currentUserId,
  busy,
  act,
}: PanelProps & { currentUserId: string }) {
  const actor = state.members.find((m) => m.user_id === currentUserId),
    roles = state.roles.filter((r) => !r.is_default);
  return (
    <div className="space-management-list">
      {!roles.length && (
        <p className="management-hint">
          Crea ruoli nella scheda Ruoli per assegnare colori e permessi ai
          membri.
        </p>
      )}
      {state.members.map((m) => {
        const assigned = state.assignments
          .filter((a) => a.user_id === m.user_id)
          .map((a) => a.role_id);
        return (
          <section className="management-member" key={m.user_id}>
            <div className="management-member-heading">
              <strong>{m.display_name || m.username}</strong>
              <small>
                @{m.username} · {m.role}
              </small>
              {m.user_id !== currentUserId &&
                m.role !== "owner" &&
                (actor?.role === "owner" || m.role === "member") && (
                  <>
                    <select
                      aria-label={`Accesso di ${m.display_name}`}
                      disabled={busy}
                      value={m.role}
                      onChange={(e) =>
                        void act(() =>
                          manageSpaceMember(
                            spaceId,
                            m.user_id,
                            e.target.value as "member" | "admin",
                          ),
                        )
                      }
                    >
                      <option value="member">Membro</option>
                      {actor?.role === "owner" && (
                        <option value="admin">Amministratore</option>
                      )}
                    </select>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(() => kickSpaceMember(spaceId, m.user_id))
                      }
                    >
                      Espelli
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(() => setSpaceBan(spaceId, m.user_id, true))
                      }
                    >
                      Banna
                    </button>
                  </>
                )}
            </div>
            <div className="management-member-roles">
              {roles.map((r) => (
                <label
                  key={r.id}
                  className="management-member-role-choice"
                  style={{ color: r.color }}
                >
                  <input
                    type="checkbox"
                    disabled={
                      busy || (m.role === "owner" && actor?.role !== "owner")
                    }
                    checked={assigned.includes(r.id)}
                    onChange={(e) =>
                      void act(() =>
                        setMemberRoles(
                          spaceId,
                          m.user_id,
                          e.target.checked
                            ? [...assigned, r.id]
                            : assigned.filter((id) => id !== r.id),
                        ),
                      )
                    }
                  />
                  {r.name}
                </label>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
