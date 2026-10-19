import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronRight,
  MessageCircle,
  Plus,
  Search,
  Users,
  X,
} from "lucide-react";
import { Modal } from "./Modal";
import { ProfileImage } from "./ProfileImage";
import {
  initialsFor,
  readableError,
  type Profile,
  type Space,
} from "../lib/workspace";
import {
  rolesForUser,
  type ServerRoleContext,
  type SpaceRole,
} from "../lib/server-roles";
import {
  loadSharedProfileSpaces,
  profilePopoverPosition,
  type ProfileAnchor,
  type SharedProfileSpace,
} from "../lib/profile-details";
import { safeCommunityImage } from "../lib/community-identity";
import "../user-profile.css";
type Props = {
  profile: Profile;
  selfId: string;
  anchor: ProfileAnchor;
  anchorElement?: HTMLElement | null;
  initialExpanded?: boolean;
  status: "online" | "dnd" | "offline";
  space: Space | null;
  spaces: Space[];
  roleContext: ServerRoleContext;
  canManageRoles: boolean;
  onToggleRole: (role: SpaceRole, assigned: boolean) => Promise<void>;
  onMessage: () => void;
  onSelectSpace: (id: string) => void;
  onClose: () => void;
  friendshipAction?: ReactNode;
};
const statusLabels = {
  online: "Online",
  dnd: "Non disturbare",
  offline: "Offline",
};
export function UserProfile({
  profile,
  selfId,
  anchor,
  anchorElement,
  initialExpanded = false,
  status,
  space,
  spaces,
  roleContext,
  canManageRoles,
  onToggleRole,
  onMessage,
  onSelectSpace,
  onClose,
  friendshipAction,
}: Props) {
  const [expanded, setExpanded] = useState(initialExpanded),
    [tab, setTab] = useState<"about" | "shared">("about"),
    [shared, setShared] = useState<SharedProfileSpace[] | null>(null),
    [detailsError, setDetailsError] = useState("");
  const panel = useRef<HTMLElement>(null),
    previousFocus = useRef(document.activeElement as HTMLElement | null),
    closeRef = useRef(onClose),
    titleId = useId();
  closeRef.current = onClose;
  const [position, setPosition] = useState({ left: 12, top: 12 }),
    [positioned, setPositioned] = useState(false);
  useEffect(() => {
    let active = true;
    setShared(null);
    setDetailsError("");
    loadSharedProfileSpaces(profile.id, spaces)
      .then((rows) => {
        if (active) setShared(rows);
      })
      .catch((e) => {
        if (active) setDetailsError(readableError(e));
      });
    return () => {
      active = false;
    };
  }, [profile.id, spaces]);
  useEffect(
    () => () => {
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    },
    [],
  );
  useLayoutEffect(() => {
    if (expanded || !panel.current) return;
    const update = () => {
      const rect = panel.current!.getBoundingClientRect();
      setPosition(
        profilePopoverPosition(
          anchorElement?.isConnected
            ? anchorElement.getBoundingClientRect()
            : anchor,
          rect.width,
          rect.height,
          window.innerWidth,
          window.innerHeight,
        ),
      );
      setPositioned(true);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(panel.current);
    window.addEventListener("resize", update);
    const scroll = () => update();
    window.addEventListener("scroll", scroll, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [anchor, anchorElement, expanded]);
  useEffect(() => {
    if (!expanded && positioned)
      panel.current
        ?.querySelector<HTMLButtonElement>("button")
        ?.focus({ preventScroll: true });
  }, [expanded, positioned]);
  useEffect(() => {
    if (expanded) return;
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) closeRef.current();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      } else if (event.key === "Tab") {
        const elements = [
            ...panel.current!.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),[tabindex="0"]',
            ),
          ].filter((e) => e.getClientRects().length),
          first = elements[0],
          last = elements.at(-1);
        if (!panel.current?.contains(document.activeElement)) {
          event.preventDefault();
          first?.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keydown);
    };
  }, [expanded]);
  const roles = rolesForUser(roleContext, profile.id),
    membership = roleContext.memberships.find((m) => m.user_id === profile.id);
  const sharedContent = (
    <>
      {detailsError ? (
        <p className="profile-details-error" role="alert">
          {detailsError}
        </p>
      ) : shared === null ? (
        <p className="hush-profile-muted">Caricamento server…</p>
      ) : !shared.length ? (
        <p className="hush-profile-empty">Nessun server in comune.</p>
      ) : (
        <div className="profile-shared-list">
          {shared.map(({ space: s }) => (
            <button key={s.id} onClick={() => onSelectSpace(s.id)}>
              <span
                className="profile-space-icon"
                style={{
                  backgroundColor: s.accent_color ?? "var(--panel-raised)",
                }}
              >
                {safeCommunityImage(s.icon_data) ? (
                  <img src={s.icon_data!} alt="" />
                ) : (
                  initialsFor(s.name)
                )}
              </span>
              <span>
                <strong>{s.name}</strong>
                <small>Server in comune</small>
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      )}
    </>
  );
  const identity = (
    <>
      <div
        className="hush-profile-cover"
        style={{ backgroundColor: profile.avatar_color }}
      >
        <ProfileImage path={profile.banner_path} alt="" />
      </div>
      <div className="hush-profile-body">
        <div className="hush-profile-avatar-row">
          <button
            className="hush-profile-avatar"
            style={{ backgroundColor: profile.avatar_color }}
            onClick={() => setExpanded(true)}
            aria-label={
              expanded
                ? `Immagine di ${profile.display_name}`
                : "Apri profilo completo"
            }
            disabled={expanded}
          >
            {initialsFor(profile.display_name)}
            <ProfileImage path={profile.avatar_path} alt="" />
            <i
              className={`hush-profile-status ${status}`}
              aria-label={statusLabels[status]}
            />
          </button>
          {!expanded && (
            <span className="hush-profile-status-label">
              {statusLabels[status]}
            </span>
          )}
        </div>
        <h2 id={!expanded ? titleId : undefined}>{profile.display_name}</h2>
        <p className="hush-profile-username">
          @{profile.username}
          {membership && (
            <span>
              {" "}
              ·{" "}
              {membership.role === "owner"
                ? "Proprietario"
                : membership.role === "admin"
                  ? "Amministratore"
                  : "Membro"}
            </span>
          )}
        </p>
        {!expanded && profile.bio && (
          <p className="hush-profile-bio">{profile.bio}</p>
        )}
        {profile.id !== selfId && (
          <button className="hush-profile-message" onClick={onMessage}>
            <MessageCircle size={16} />
            Invia messaggio
          </button>
        )}
        {friendshipAction}
        {!expanded && (
          <button
            className="profile-shared-summary"
            onClick={() => {
              setTab("shared");
              setExpanded(true);
            }}
          >
            <Users size={15} />
            {shared === null
              ? "Server in comune"
              : `${shared.length} server in comune`}
            <ChevronRight size={14} />
          </button>
        )}
        {space && membership && (
          <ProfileRoles
            key={space.id + ":" + profile.id}
            roles={roles}
            available={roleContext.roles.filter((r) => !r.is_default)}
            canManage={canManageRoles}
            onToggle={onToggleRole}
            spaceName={space.name}
          />
        )}
        {!expanded && (
          <button
            className="hush-profile-expand"
            onClick={() => setExpanded(true)}
          >
            Visualizza profilo completo
            <ChevronRight size={14} />
          </button>
        )}
      </div>
    </>
  );
  if (expanded)
    return (
      <Modal title="Profilo" onClose={onClose} className="hush-profile-full">
        <div className="hush-profile-full-grid">
          <section className="hush-profile-identity">{identity}</section>
          <section className="hush-profile-details">
            <div
              className="hush-profile-tabs"
              role="tablist"
              aria-label="Dettagli profilo"
            >
              <button
                id={`${titleId}-about-tab`}
                role="tab"
                aria-selected={tab === "about"}
                aria-controls={`${titleId}-about`}
                tabIndex={tab === "about" ? 0 : -1}
                onClick={() => setTab("about")}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    setTab("shared");
                    document.getElementById(`${titleId}-shared-tab`)?.focus();
                  }
                }}
              >
                Informazioni
              </button>
              <button
                id={`${titleId}-shared-tab`}
                role="tab"
                aria-selected={tab === "shared"}
                aria-controls={`${titleId}-shared`}
                tabIndex={tab === "shared" ? 0 : -1}
                onClick={() => setTab("shared")}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    setTab("about");
                    document.getElementById(`${titleId}-about-tab`)?.focus();
                  }
                }}
              >
                Server in comune
                {shared !== null && <span>{shared.length}</span>}
              </button>
            </div>
            <div
              id={`${titleId}-about`}
              role="tabpanel"
              aria-labelledby={`${titleId}-about-tab`}
              hidden={tab !== "about"}
            >
              <h3>Presentazione</h3>
              <p className="hush-profile-about">
                {profile.bio || "Nessuna presentazione aggiunta."}
              </p>
              <dl className="hush-profile-dates">
                {profile.created_at && (
                  <>
                    <dt>Su Hush dal</dt>
                    <dd>{formatDate(profile.created_at)}</dd>
                  </>
                )}
                {space && shared?.find((s) => s.space.id === space.id) && (
                  <>
                    <dt>In {space.name} dal</dt>
                    <dd>
                      {formatDate(
                        shared.find((s) => s.space.id === space.id)!.joinedAt,
                      )}
                    </dd>
                  </>
                )}
                <dt>Stato</dt>
                <dd>{statusLabels[status]}</dd>
              </dl>
            </div>
            <div
              id={`${titleId}-shared`}
              role="tabpanel"
              aria-labelledby={`${titleId}-shared-tab`}
              hidden={tab !== "shared"}
            >
              {sharedContent}
            </div>
          </section>
        </div>
      </Modal>
    );
  return createPortal(
    <section
      ref={panel}
      className="hush-profile-popover"
      role="dialog"
      aria-labelledby={titleId}
      style={{ ...position, visibility: positioned ? "visible" : "hidden" }}
    >
      <button
        className="hush-profile-close"
        aria-label="Chiudi profilo"
        onClick={onClose}
      >
        <X size={16} />
      </button>
      {identity}
    </section>,
    document.body,
  );
}
function formatDate(value: string) {
  return new Date(value).toLocaleDateString("it-IT", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
function ProfileRoles({
  roles,
  available,
  canManage,
  onToggle,
  spaceName,
}: {
  roles: SpaceRole[];
  available: SpaceRole[];
  canManage: boolean;
  onToggle: (role: SpaceRole, assigned: boolean) => Promise<void>;
  spaceName: string;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const picker = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    input = useRef<HTMLInputElement>(null),
    id = useId();
  useEffect(() => {
    if (open) input.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (
        !picker.current?.contains(e.target as Node) &&
        !trigger.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  const toggle = async (role: SpaceRole, assigned: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onToggle(role, assigned);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
      if (picker.current && !picker.current.contains(document.activeElement))
        input.current?.focus({ preventScroll: true });
    }
  };
  const options = available.filter((r) =>
    r.name.toLocaleLowerCase("it").includes(query.toLocaleLowerCase("it")),
  );
  return (
    <section
      className="hush-profile-roles"
      aria-label={`Ruoli in ${spaceName}`}
    >
      <h3>
        Ruoli <span>{spaceName}</span>
      </h3>
      <div className="hush-profile-role-chips">
        {roles.map((r) => (
          <span className="hush-profile-role" key={r.id}>
            <i style={{ backgroundColor: r.color }} />
            {r.name}
            {canManage && (
              <button
                aria-label={`Rimuovi ruolo ${r.name}`}
                disabled={busy}
                onClick={() => void toggle(r, false)}
              >
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        {!roles.length && (
          <span className="hush-profile-muted">Nessun ruolo assegnato</span>
        )}
        {canManage && (
          <button
            ref={trigger}
            className="hush-profile-role-add"
            aria-label="Assegna ruoli"
            aria-expanded={open}
            aria-controls={open ? id : undefined}
            onClick={() => {
              setOpen((v) => !v);
              setQuery("");
            }}
          >
            <Plus size={15} />
          </button>
        )}
      </div>
      {open && (
        <div
          id={id}
          ref={picker}
          className="hush-profile-role-picker"
          role="group"
          aria-label="Seleziona ruoli"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              trigger.current?.focus();
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const buttons = [
                ...picker.current!.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ),
              ];
              const current = buttons.indexOf(
                  document.activeElement as HTMLButtonElement,
                ),
                next =
                  e.key === "ArrowDown"
                    ? (current + 1) % buttons.length
                    : (current - 1 + buttons.length) % buttons.length;
              buttons[next]?.focus();
            }
          }}
        >
          <label className="hush-profile-role-search">
            <Search size={14} />
            <input
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cerca un ruolo"
              aria-label="Cerca un ruolo"
            />
          </label>
          <div className="hush-profile-role-options">
            {options.map((r) => (
              <button
                key={r.id}
                disabled={busy}
                aria-pressed={roles.some((x) => x.id === r.id)}
                onClick={() =>
                  void toggle(r, !roles.some((x) => x.id === r.id))
                }
              >
                <i style={{ backgroundColor: r.color }} />
                <span>{r.name}</span>
                {roles.some((x) => x.id === r.id) && <Check size={15} />}
              </button>
            ))}
            {!options.length && (
              <p className="hush-profile-muted">
                {available.length
                  ? "Nessun ruolo trovato."
                  : "Crea prima un ruolo in Gestisci server → Ruoli."}
              </p>
            )}
          </div>
        </div>
      )}
      {error && (
        <p className="profile-details-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
