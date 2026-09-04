import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ChevronDown,
  Copy,
  Hash,
  LockKeyhole,
  LogOut,
  Menu,
  MessageCircleMore,
  Phone,
  PhoneOff,
  PanelTopOpen,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Smile,
  Trash2,
  UserPlus,
  UserRound,
  Video,
  Volume2,
  X,
} from "lucide-react";
import { AuthScreen } from "./components/AuthScreen";
import { BrandMark } from "./components/BrandMark";
import { DotPattern } from "./components/DotPattern";
import { EncryptedLabel } from "./components/EncryptedLabel";
import { MediaStage } from "./components/MediaStage";
import { Modal } from "./components/Modal";
import { SettingsPanel } from "./components/SettingsPanel";
import { ProfileImage } from "./components/ProfileImage";
import { copyText } from "./lib/clipboard";
import { decryptText, encryptText, getKeyFingerprint } from "./lib/crypto";
import {
  ensureDeviceIdentity,
  fulfillPendingKeyRequests,
  initializeConversationKey,
  loadConversationKey,
  requestConversationKey,
  type DeviceIdentity,
} from "./lib/device-crypto";
import {
  persistEncryptedMessage,
  subscribeToConversation,
  unsubscribeFromConversation,
} from "./lib/realtime";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import { applyTheme, readTheme, type ThemeId } from "./lib/themes";
import { playCallSound, playChatSound } from "./lib/interaction-sound";
import {
  initialsFor,
  loadAndDecryptMessages,
  loadChannels,
  loadConversationMembers,
  loadWorkspace,
  readableError,
  type Conversation,
  type DecryptedMessage,
  type Profile,
  type Space,
} from "./lib/workspace";

type ModalKind = "space" | "channel" | "voice" | "dm" | "settings" | "server" | null;
type KeyStatus = "idle" | "loading" | "ready" | "waiting" | "error";
type CallStage = {
  open: boolean;
  expanded: boolean;
  video: boolean;
  conversationId: string | null;
  roomName: string;
  memberNames: Record<string, string>;
};

const EMPTY_CALL_STAGE: CallStage = {
  open: false,
  expanded: false,
  video: false,
  conversationId: null,
  roomName: "Chiamata",
  memberNames: {},
};

function Avatar({ profile, size = "normal" }: { profile: Pick<Profile, "display_name" | "avatar_color" | "avatar_path">; size?: "normal" | "small" }) {
  return (
    <span
      className={`avatar ${size === "small" ? "avatar-small" : ""}`}
      style={{ backgroundColor: profile.avatar_color }}
    >
      {initialsFor(profile.display_name)}<ProfileImage path={profile.avatar_path} alt="" />
    </span>
  );
}

function profileFromSession(session: Session): Profile {
  const metadata = session.user.user_metadata;
  const username = typeof metadata.username === "string" ? metadata.username : session.user.email?.split("@")[0] ?? "utente";
  return {
    id: session.user.id,
    username,
    display_name: typeof metadata.display_name === "string" ? metadata.display_name : username,
    avatar_color: "#ff7a66",
  };
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [theme, setTheme] = useState<ThemeId>(readTheme);

  useEffect(() => { applyTheme(theme); }, [theme]);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (!authReady) {
    return <main className="app-loading"><BrandMark size={48} title="Hush" /><span>Preparazione dello spazio privato…</span></main>;
  }
  if (isSupabaseConfigured && !session) return <AuthScreen />;
  if (!session) {
    return <main className="app-loading"><BrandMark size={48} /><span>Configura Supabase per usare Hush.</span></main>;
  }
  return <WorkspaceApp session={session} theme={theme} onThemeChange={setTheme} />;
}

function WorkspaceApp({ session, theme, onThemeChange }: { session: Session; theme: ThemeId; onThemeChange: (theme: ThemeId) => void }) {
  const [profile, setProfile] = useState(() => profileFromSession(session));
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteNotice, setInviteNotice] = useState("");
  const [viewedProfile, setViewedProfile] = useState<Profile | null>(null);
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [channels, setChannels] = useState<Conversation[]>([]);
  const [directMessages, setDirectMessages] = useState<Conversation[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [roomKey, setRoomKey] = useState<CryptoKey | null>(null);
  const [keyStatus, setKeyStatus] = useState<KeyStatus>("idle");
  const [keyRetry, setKeyRetry] = useState(0);
  const [fingerprint, setFingerprint] = useState("");
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showCipher, setShowCipher] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [spaceMode, setSpaceMode] = useState<"create" | "join">("create");
  const [formPrimary, setFormPrimary] = useState("");
  const [formSecondary, setFormSecondary] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [stage, setStage] = useState<CallStage>(EMPTY_CALL_STAGE);
  const messageEnd = useRef<HTMLDivElement>(null);

  const activeSpace = useMemo(() => spaces.find((space) => space.id === activeSpaceId) ?? null, [activeSpaceId, spaces]);
  const conversations = useMemo(() => [...channels, ...directMessages], [channels, directMessages]);
  const textChannels = useMemo(() => channels.filter((channel) => channel.kind === "channel"), [channels]);
  const voiceChannels = useMemo(() => channels.filter((channel) => channel.kind === "voice_channel"), [channels]);
  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );
  const filteredMessages = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("it");
    return query ? messages.filter((message) => `${message.author} ${message.body}`.toLocaleLowerCase("it").includes(query)) : messages;
  }, [messages, search]);
  const latestCipher = messages.at(-1)?.encrypted;

  const startCall = (conversation: Conversation | null, video: boolean) => {
    if (!conversation) return;
    void playCallSound("join");
    setStage({
      open: true,
      expanded: true,
      video,
      conversationId: conversation.id,
      roomName: conversation.name,
      memberNames: Object.fromEntries(members.map((member) => [member.id, member.display_name])),
    });
  };

  const leaveCall = () => {
    void playCallSound("leave");
    setStage(EMPTY_CALL_STAGE);
  };

  const refreshWorkspace = useCallback(async (preferredSpaceId?: string, preferredConversationId?: string) => {
    const data = await loadWorkspace(session.user.id, profileFromSession(session));
    setProfile(data.profile);
    setSpaces(data.spaces);
    setDirectMessages(data.directMessages);
    setActiveSpaceId((current) => preferredSpaceId ?? current ?? data.spaces[0]?.id ?? null);
    if (preferredConversationId) setActiveConversationId(preferredConversationId);
    return data;
  }, [session.user.id]);

  const refreshChannels = useCallback(async (spaceId: string, preferredConversationId?: string) => {
    const nextChannels = await loadChannels(spaceId);
    setChannels(nextChannels);
    setActiveConversationId((current) => (
      preferredConversationId
      ?? (nextChannels.some((channel) => channel.id === current) ? current : nextChannels[0]?.id ?? null)
    ));
    return nextChannels;
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true);
    void Promise.all([ensureDeviceIdentity(session.user.id), loadWorkspace(session.user.id, profileFromSession(session))])
      .then(([nextIdentity, data]) => {
        if (!current) return;
        setIdentity(nextIdentity);
        setProfile(data.profile);
        setSpaces(data.spaces);
        setDirectMessages(data.directMessages);
        setActiveSpaceId(data.spaces[0]?.id ?? null);
      })
      .catch((error) => current && setToast(readableError(error)))
      .finally(() => current && setLoading(false));
    return () => { current = false; };
  }, [session.user.id]);

  useEffect(() => {
    if (!activeSpaceId) {
      setChannels([]);
      return;
    }
    let current = true;
    void refreshChannels(activeSpaceId).catch((error) => current && setToast(readableError(error)));
    return () => { current = false; };
  }, [activeSpaceId, refreshChannels]);

  useEffect(() => {
    if (!activeConversation || !identity) {
      setMessages([]);
      setMembers([]);
      setRoomKey(null);
      setKeyStatus("idle");
      return;
    }

    let current = true;
    let cleanupRealtime: (() => void) | undefined;
    setMessages([]);
    setMembers([]);
    setRoomKey(null);
    setFingerprint("");
    setKeyStatus("loading");

    if (activeConversation.kind === "voice_channel") {
      setKeyStatus("idle");
      setOnlineUserIds([]);
      void loadConversationMembers(activeConversation.id)
        .then((nextMembers) => {
          if (current) setMembers(nextMembers);
        })
        .catch((error) => current && setToast(readableError(error)));
      return () => { current = false; };
    }

    const prepareConversation = async () => {
      let key = await loadConversationKey(activeConversation.id, identity);
      if (!key && activeConversation.created_by === session.user.id) {
        key = await initializeConversationKey(activeConversation.id, identity);
      }
      if (!key) {
        await requestConversationKey(activeConversation.id, identity);
        if (current) {
          setKeyStatus("waiting");
          const retryTimer = window.setInterval(() => {
            void loadConversationKey(activeConversation.id, identity).then((availableKey) => {
              if (!current || !availableKey) return;
              window.clearInterval(retryTimer);
              setKeyRetry((value) => value + 1);
            }).catch(() => undefined);
          }, 3500);
          cleanupRealtime = () => window.clearInterval(retryTimer);
        }
        return;
      }

      const nextMembers = await loadConversationMembers(activeConversation.id);
      const [nextMessages, nextFingerprint] = await Promise.all([
        loadAndDecryptMessages(activeConversation.id, key, nextMembers),
        getKeyFingerprint(key),
        fulfillPendingKeyRequests(activeConversation.id, key, identity),
      ]);
      if (!current) return;
      setRoomKey(key);
      setMembers(nextMembers);
      setMessages(nextMessages);
      setFingerprint(nextFingerprint);
      setKeyStatus("ready");

      const channel = await subscribeToConversation({
        conversationId: activeConversation.id,
        userId: session.user.id,
        onMessage: async (row) => {
          if (!current || row.sender_id === session.user.id) return;
          const sender = nextMembers.find((member) => member.id === row.sender_id);
          const encrypted = { v: 1 as const, iv: row.nonce, ciphertext: row.ciphertext };
          let body = "Messaggio non decifrabile con la chiave corrente.";
          try {
            body = await decryptText(encrypted, key, `hush:conversation:${activeConversation.id}:epoch:0`);
          } catch { /* explicit fallback above */ }
          const mentioned = body.toLocaleLowerCase("it").includes(`@${profile.username.toLocaleLowerCase("it")}`);
          void playChatSound(mentioned ? "mention" : "receive");
          setMessages((currentMessages) => currentMessages.some((message) => message.id === row.id) ? currentMessages : [...currentMessages, {
            id: row.id,
            senderId: row.sender_id,
            author: sender?.display_name ?? "Membro",
            initials: initialsFor(sender?.display_name ?? "Membro"),
            body,
            createdAt: row.created_at,
            encrypted,
          }]);
        },
        onPresence: setOnlineUserIds,
        onStatus: (status) => {
          if (status === "error") setToast("Realtime non raggiungibile. I messaggi restano salvati e verranno ricaricati.");
        },
      });
      const requestTimer = window.setInterval(() => {
        void fulfillPendingKeyRequests(activeConversation.id, key, identity).catch(() => undefined);
      }, 5000);
      cleanupRealtime = () => {
        window.clearInterval(requestTimer);
        void unsubscribeFromConversation(channel);
      };
    };

    void prepareConversation().catch((error) => {
      if (!current) return;
      setKeyStatus("error");
      setToast(readableError(error));
    });
    return () => {
      current = false;
      cleanupRealtime?.();
    };
  }, [activeConversation, identity, keyRetry, session.user.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowSearch(true);
      }
      if (event.key === "Escape") {
        setShowSearch(false);
        setModal(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    messageEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!activeConversationId || members.length === 0) return;
    const nextMemberNames = Object.fromEntries(members.map((member) => [member.id, member.display_name]));
    setStage((current) => current.open && current.conversationId === activeConversationId
      ? { ...current, memberNames: nextMemberNames }
      : current);
  }, [activeConversationId, members]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const openModal = (kind: Exclude<ModalKind, null>) => {
    setFormPrimary(kind === "settings" ? profile.display_name : "");
    setFormSecondary("");
    setFormError(null);
    setSpaceMode("create");
    setModal(kind);
  };

  const runAction = async (action: () => Promise<void>) => {
    setBusy(true);
    setFormError(null);
    try { await action(); } catch (error) { setFormError(readableError(error)); } finally { setBusy(false); }
  };

  const submitSpace = (event: FormEvent) => {
    event.preventDefault();
    void runAction(async () => {
      if (!supabase) return;
      if (spaceMode === "create") {
        const { data, error } = await supabase.rpc("create_space_with_general", { p_name: formPrimary.trim() });
        if (error) throw error;
        await refreshWorkspace(data as string);
        setToast("Server creato");
      } else {
        const token = formPrimary.trim().split(/[/?#]/).filter(Boolean).at(-1) ?? "";
        const { data, error } = await supabase.rpc("join_space_with_invite", { p_token: token });
        if (error) throw error;
        await refreshWorkspace(data as string);
        setToast("Sei entrato nel server");
      }
      setModal(null);
    });
  };

  const submitChannel = (event: FormEvent) => {
    event.preventDefault();
    if (!activeSpace || !identity) return;
    void runAction(async () => {
      if (!supabase) return;
      const { data, error } = await supabase.rpc("create_space_channel", { p_space_id: activeSpace.id, p_name: formPrimary.trim() });
      if (error) throw error;
      const conversationId = data as string;
      await initializeConversationKey(conversationId, identity);
      await refreshChannels(activeSpace.id, conversationId);
      setModal(null);
      setToast("Canale creato e chiave distribuita");
    });
  };

  const submitVoiceChannel = (event: FormEvent) => {
    event.preventDefault();
    if (!activeSpace) return;
    void runAction(async () => {
      if (!supabase) return;
      const { data, error } = await supabase.rpc("create_space_voice_channel", {
        p_space_id: activeSpace.id,
        p_name: formPrimary.trim(),
      });
      if (error) throw error;
      const conversationId = data as string;
      await refreshChannels(activeSpace.id, conversationId);
      setModal(null);
      setToast("Canale vocale creato");
    });
  };

  const submitDm = (event: FormEvent) => {
    event.preventDefault();
    if (!identity) return;
    void runAction(async () => {
      if (!supabase) return;
      const usernames = formSecondary.split(/[\s,]+/).map((value) => value.replace(/^@/, "").trim()).filter(Boolean);
      const { data, error } = await supabase.rpc("create_group_dm", { p_name: formPrimary.trim(), p_usernames: usernames });
      if (error) throw error;
      const conversationId = data as string;
      await initializeConversationKey(conversationId, identity);
      await refreshWorkspace(undefined, conversationId);
      setActiveSpaceId(null);
      setModal(null);
      setToast("Gruppo DM creato");
    });
  };

  const createInvite = () => {
    const client = supabase;
    if (!activeSpace || !client) return;
    void runAction(async () => {
      const { data, error } = await client.rpc("create_space_invite", { p_space_id: activeSpace.id });
      if (error) throw error;
      const invite = `hush://invite/${data as string}`;
      setInviteLink(invite);
      setModal(null);
      setInviteNotice("");
      try { await copyText(invite); setInviteNotice("Invito copiato: scade tra 7 giorni"); }
      catch { setInviteNotice("Seleziona il link e premi Ctrl+C per copiarlo."); }
    });
  };

  const leaveOrDeleteSpace = (remove: boolean) => {
    const client = supabase;
    if (!activeSpace || !client) return;
    if (remove && !window.confirm(`Eliminare definitivamente “${activeSpace.name}” e tutti i suoi messaggi?`)) return;
    void runAction(async () => {
      const functionName = remove ? "delete_owned_space" : "leave_space";
      const { error } = await client.rpc(functionName, { p_space_id: activeSpace.id });
      if (error) throw error;
      setActiveConversationId(null);
      setActiveSpaceId(null);
      await refreshWorkspace();
      setModal(null);
      setToast(remove ? "Server eliminato" : "Hai lasciato il server");
    });
  };

  const deleteChannel = () => {
    const client = supabase;
    if (!activeConversation || !["channel", "voice_channel"].includes(activeConversation.kind) || !client || !activeSpace) return;
    if (!window.confirm(`Eliminare definitivamente il canale “${activeConversation.name}”?`)) return;
    void runAction(async () => {
      const { error } = await client.rpc("delete_space_channel", { p_conversation_id: activeConversation.id });
      if (error) throw error;
      await refreshChannels(activeSpace.id);
      setToast("Canale eliminato");
    });
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const cleanDraft = draft.trim();
    if (!cleanDraft || !roomKey || !activeConversation) return;
    try {
      const id = crypto.randomUUID();
      const context = `hush:conversation:${activeConversation.id}:epoch:0`;
      const encrypted = await encryptText(cleanDraft, roomKey, context);
      await persistEncryptedMessage({
        id,
        conversation_id: activeConversation.id,
        sender_id: session.user.id,
        algorithm: "AES-256-GCM",
        key_epoch: 0,
        nonce: encrypted.iv,
        ciphertext: encrypted.ciphertext,
        aad_json: { version: 1, context },
      });
      setMessages((current) => [...current, {
        id,
        senderId: session.user.id,
        author: profile.display_name,
        initials: initialsFor(profile.display_name),
        body: cleanDraft,
        createdAt: new Date().toISOString(),
        encrypted,
      }]);
      setDraft("");
      void playChatSound("send");
    } catch (error) {
      setToast(readableError(error));
    }
  };

  const selectSpace = (spaceId: string) => {
    setActiveSpaceId(spaceId);
    setActiveConversationId(null);
    setStage((current) => current.open ? { ...current, expanded: false } : current);
  };

  return (
    <div className="app-shell">
      <DotPattern />
      <aside className="server-rail" aria-label="Server">
        <button className="brand-mark" onClick={() => { setActiveSpaceId(null); setActiveConversationId(null); setStage((current) => current.open ? { ...current, expanded: false } : current); }} aria-label="Home Hush"><BrandMark size={28} /></button>
        <div className="rail-rule" />
        {spaces.map((space) => (
          <button className={`server-icon ${activeSpaceId === space.id ? "selected" : ""}`} key={space.id} onClick={() => selectSpace(space.id)} aria-label={space.name} title={space.name}>{initialsFor(space.name)}</button>
        ))}
        <button className="server-icon add-server" onClick={() => openModal("space")} aria-label="Crea o unisciti a un server"><Plus size={20} /></button>
      </aside>

      <aside className={`channel-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <button className="server-title" onClick={() => activeSpace && openModal("server")} disabled={!activeSpace}>
          <span><span className="eyebrow">spazio privato</span><strong>{activeSpace?.name ?? "Messaggi diretti"}</strong></span>
          {activeSpace ? <ChevronDown size={17} /> : null}
        </button>
        <button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Chiudi menu"><X size={18} /></button>
        <div className="sidebar-scroll">
          <button className="find-conversation" onClick={() => activeConversation ? setShowSearch(true) : setToast("Apri una conversazione per cercare nei messaggi.")}><Search size={16} /><span>Cerca nei messaggi</span><kbd>Ctrl K</kbd></button>
          <div className="channel-section">
            <div className="section-label"><span>canali di testo</span><button onClick={() => activeSpace ? openModal("channel") : openModal("space")} aria-label="Crea canale"><Plus size={14} /></button></div>
            {textChannels.map((channel) => (
              <button key={channel.id} className={`channel-row ${activeConversationId === channel.id ? "active" : ""}`} onClick={() => { setActiveConversationId(channel.id); setSidebarOpen(false); setStage((current) => current.open ? { ...current, expanded: false } : current); }}><Hash size={17} /><span>{channel.name}</span></button>
            ))}
            {!loading && textChannels.length === 0 ? <p className="sidebar-empty">Nessun canale di testo</p> : null}
          </div>
          <div className="channel-section voice-section">
            <div className="section-label"><span>canali vocali</span><button onClick={() => activeSpace ? openModal("voice") : openModal("space")} aria-label="Crea canale vocale"><Plus size={14} /></button></div>
            {voiceChannels.map((channel) => (
              <button
                key={channel.id}
                className={`channel-row voice-row ${activeConversationId === channel.id ? "active" : ""}`}
                onClick={() => {
                  setActiveConversationId(channel.id);
                  setSidebarOpen(false);
                  startCall(channel, false);
                }}
              >
                <Volume2 size={17} /><span>{channel.name}</span><small>Entra</small>
              </button>
            ))}
            {!loading && voiceChannels.length === 0 ? <p className="sidebar-empty">Nessun canale vocale</p> : null}
          </div>
          <div className="channel-section">
            <div className="section-label"><span>messaggi diretti</span><button onClick={() => openModal("dm")} aria-label="Nuovo gruppo DM"><Plus size={14} /></button></div>
            {directMessages.map((conversation) => (
              <button className={`dm-row ${activeConversationId === conversation.id ? "active" : ""}`} key={conversation.id} onClick={() => { setActiveSpaceId(null); setActiveConversationId(conversation.id); setSidebarOpen(false); setStage((current) => current.open ? { ...current, expanded: false } : current); }}>
                <span className="dm-generic-avatar"><UserRound size={16} /></span><span><strong>{conversation.name}</strong><small>gruppo cifrato</small></span>
              </button>
            ))}
            {!loading && directMessages.length === 0 ? <p className="sidebar-empty">Nessun gruppo DM</p> : null}
          </div>
        </div>
        {stage.open ? (
          <section className="call-dock" aria-label="Chiamata connessa">
            <div><span className="call-dock-live"><i /> connesso</span><strong>{stage.roomName}</strong><small>La chiamata resta attiva mentre navighi.</small></div>
            <button onClick={() => setStage((current) => ({ ...current, expanded: true }))} aria-label="Riapri chiamata"><PanelTopOpen size={16} /></button>
            <button className="call-dock-leave" onClick={leaveCall} aria-label="Lascia chiamata"><PhoneOff size={16} /></button>
          </section>
        ) : null}
        <div className="user-panel">
          <Avatar profile={profile} />
          <div className="user-copy"><strong>{profile.display_name}</strong><button onClick={() => { void copyText(profile.username).then(() => setToast("Username copiato")).catch(() => setToast("Copia non riuscita. Il tuo username è @" + profile.username)); }}>@{profile.username}</button></div>
          <button onClick={() => openModal("settings")} aria-label="Impostazioni"><Settings size={16} /></button>
          <button aria-label="Esci" onClick={() => { void supabase?.auth.signOut(); }}><LogOut size={16} /></button>
        </div>
      </aside>

      <main className="chat-panel">
        <header className="chat-header">
          <button className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Apri menu"><Menu size={20} /></button>
          {activeConversation?.kind === "voice_channel" ? <Volume2 size={21} className="hash-icon voice-icon" /> : activeConversation ? <Hash size={21} className="hash-icon" /> : <ShieldCheck size={21} className="hash-icon" />}
          <div className="channel-heading"><strong>{activeConversation?.name ?? "Il tuo spazio Hush"}</strong><span>{activeConversation ? activeConversation.kind === "voice_channel" ? `${members.length} membri · canale vocale` : `${members.length} membri` : `Benvenuto, ${profile.display_name}`}</span></div>
          {activeConversation ? (
            <div className="header-actions">
              <button onClick={() => startCall(activeConversation, false)} aria-label="Avvia chiamata"><Phone size={18} /></button>
              <button onClick={() => startCall(activeConversation, true)} aria-label="Avvia videochiamata"><Video size={19} /></button>
              {activeSpace ? <button onClick={createInvite} aria-label="Copia invito"><UserPlus size={19} /></button> : null}
              {["channel", "voice_channel"].includes(activeConversation.kind) && activeSpace?.owner_id === session.user.id ? <button onClick={deleteChannel} aria-label="Elimina canale"><Trash2 size={17} /></button> : null}
              {activeConversation.kind !== "voice_channel" ? <button onClick={() => setShowSearch((current) => !current)} aria-label="Cerca"><Search size={17} /></button> : null}
              {activeConversation.kind !== "voice_channel" && showSearch ? <label className="header-search"><Search size={15} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca" /></label> : null}
            </div>
          ) : null}
        </header>

        <MediaStage
          open={stage.open}
          expanded={stage.expanded}
          startWithVideo={stage.video}
          conversationId={stage.conversationId}
          roomName={stage.roomName}
          userId={session.user.id}
          displayName={profile.display_name}
          memberNames={stage.memberNames}
          onMinimize={() => setStage((current) => ({ ...current, expanded: false }))}
          onClose={leaveCall}
        />

        {stage.expanded ? null : activeConversation ? activeConversation.kind === "voice_channel" ? (
          <div className="chat-content empty-chat voice-lobby">
            <section className="workspace-empty voice-room-card">
              <div className="voice-room-mark"><Volume2 size={30} /></div>
              <span className="eyebrow">stanza vocale cifrata</span>
              <h1>{activeConversation.name}</h1>
              <p>Audio, video e schermo viaggiano direttamente tra i partecipanti tramite WebRTC. Supabase coordina soltanto l’ingresso nella stanza.</p>
              <div className="voice-room-actions">
                <button className="empty-primary" onClick={() => startCall(activeConversation, false)}><Phone size={17} /> Entra in voce</button>
                <button className="voice-video-button" onClick={() => startCall(activeConversation, true)}><Video size={17} /> Entra con video</button>
              </div>
            </section>
          </div>
        ) : (
          <>
            <button className={`trust-line key-${keyStatus}`} onClick={() => keyStatus === "ready" && setShowCipher((current) => !current)} disabled={keyStatus !== "ready"}>
              <span className="trust-signal"><LockKeyhole size={14} /><EncryptedLabel text={keyStatus === "ready" ? "E2EE ATTIVA" : keyStatus === "waiting" ? "CHIAVE RICHIESTA" : "PREPARAZIONE CHIAVE"} /></span>
              <span>{keyStatus === "ready" ? <>Impronta <code>{fingerprint}</code></> : keyStatus === "waiting" ? "Un membro deve aprire questa conversazione per autorizzare il dispositivo." : "Cifratura del dispositivo in corso…"}</span>
              {keyStatus === "ready" ? <span className="trust-action">{showCipher ? "Nascondi" : "Verifica"}</span> : null}
            </button>
            {showCipher ? <section className="cipher-inspector"><div><span className="eyebrow">ultimo pacchetto salvato</span><code>{latestCipher ? `${latestCipher.iv}.${latestCipher.ciphertext}` : "Nessun messaggio inviato."}</code></div><button onClick={() => setShowCipher(false)} aria-label="Chiudi"><X size={16} /></button></section> : null}
            <div className="chat-content">
              <div className="messages" aria-live="polite">
                <section className="channel-intro"><div className="intro-icon"><Hash size={28} /></div><span className="eyebrow">conversazione reale</span><h1>{activeConversation.name}</h1><p>I messaggi vengono cifrati sul dispositivo prima di raggiungere Supabase.</p></section>
                {filteredMessages.length === 0 ? <div className="conversation-empty">{search ? "Nessun messaggio corrisponde alla ricerca." : keyStatus === "waiting" ? "Chiave richiesta. Chiedi a un membro di aprire questa conversazione." : "Nessun messaggio. Scrivi il primo."}</div> : null}
                {filteredMessages.map((message) => {
                  const sender = members.find((member) => member.id === message.senderId) ?? { display_name: message.author, avatar_color: "#73b7ff" };
                  return <article className="message" key={message.id}><Avatar profile={sender} /><div className="message-copy"><div className="message-meta"><strong>{message.author}</strong><time>{new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}</time><span className="sealed"><LockKeyhole size={11} /> cifrato</span></div><p>{message.body}</p></div></article>;
                })}
                <div ref={messageEnd} />
              </div>
              <form className="composer" onSubmit={sendMessage} onKeyDown={(event) => { if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) void playChatSound("typing"); }} onClick={(event) => { if (event.target instanceof Element && event.target.closest("[aria-label='Aggiungi emoji']")) void playChatSound("reaction"); }}>
                <input value={draft} onChange={(event) => setDraft(event.target.value)} disabled={keyStatus !== "ready"} placeholder={keyStatus === "ready" ? `Scrivi in ${activeConversation.name}` : "In attesa della chiave…"} aria-label="Messaggio" />
                <button type="button" onClick={() => setDraft((current) => `${current}🙂`)} aria-label="Aggiungi emoji"><Smile size={19} /></button>
                <button className="send-button" type="submit" disabled={!draft.trim() || keyStatus !== "ready"} aria-label="Invia messaggio"><Send size={17} /></button>
                <div className="composer-security"><LockKeyhole size={11} /> AES-256-GCM sul dispositivo</div>
              </form>
            </div>
          </>
        ) : (
          <div className="chat-content empty-chat"><section className="workspace-empty"><div className="workspace-empty-mark"><BrandMark size={46} /></div><span className="eyebrow">spazio privato</span><h1>{loading ? "Caricamento…" : "Pronto per iniziare"}</h1><p>Crea un server, usa un invito oppure apri un gruppo DM. Ogni elemento mostrato arriva dal tuo account Supabase.</p><button className="empty-primary" onClick={() => openModal("space")}><Plus size={17} /> Crea o unisciti</button></section></div>
        )}
      </main>

      <aside className="member-sidebar">
        <div className="member-heading"><span>Persone</span><span>{members.length || 1}</span></div>
        <div className="member-list">
          {(members.length ? members : [profile]).map((member) => (
            <button type="button" className="member current-member member-profile-button" key={member.id} onClick={() => setViewedProfile(member)} aria-label={`Profilo di ${member.display_name}`}><span className="member-avatar"><Avatar profile={member} /><i className={`status ${onlineUserIds.includes(member.id) || member.id === session.user.id ? "status-online" : "status-away"}`} /></span><span><strong>{member.display_name}</strong><small>@{member.username}</small></span></button>
          ))}
        </div>
        <div className="privacy-note"><ShieldCheck size={16} /><p><strong>{keyStatus === "ready" ? "Chiave verificata" : "Supabase connesso"}</strong><span>{identity ? `Dispositivo ${identity.id.slice(0, 8)}` : "Registrazione dispositivo…"}</span></p><i className={`backend-light backend-${keyStatus === "error" ? "degraded" : "ready"}`} /></div>
      </aside>

      {inviteLink ? <Modal title="Invita nel server" description="Condividi questo link con gli amici. Scade tra 7 giorni; incollalo in Server → Usa invito." onClose={() => setInviteLink(null)}><div className="modal-form"><label>Link di invito<input readOnly value={inviteLink} onFocus={(event) => event.target.select()} /></label><button className="modal-primary" onClick={() => { void copyText(inviteLink).then(() => setInviteNotice("Invito copiato")).catch(() => setInviteNotice("Seleziona il link e premi Ctrl+C per copiarlo.")); }}>Copia invito</button><p role="status">{inviteNotice}</p></div></Modal> : null}
      {viewedProfile ? <Modal title="Profilo" onClose={() => setViewedProfile(null)}><div className="profile-preview"><div className="profile-banner" style={{ backgroundColor: viewedProfile.avatar_color }}><ProfileImage path={viewedProfile.banner_path} alt="Banner profilo" /></div><div className="profile-preview-copy"><Avatar profile={viewedProfile} /><strong>{viewedProfile.display_name}</strong><small>@{viewedProfile.username}</small><p>{viewedProfile.bio}</p></div></div></Modal> : null}
      {modal === "space" ? <Modal title="Server" description="Crea un nuovo spazio oppure incolla un invito ricevuto da un amico." onClose={() => setModal(null)}><div className="modal-tabs"><button className={spaceMode === "create" ? "active" : ""} onClick={() => { setSpaceMode("create"); setFormPrimary(""); setFormError(null); }}>Crea</button><button className={spaceMode === "join" ? "active" : ""} onClick={() => { setSpaceMode("join"); setFormPrimary(""); setFormError(null); }}>Usa invito</button></div><form className="modal-form" onSubmit={submitSpace}><label>{spaceMode === "create" ? "Nome del server" : "Codice o link di invito"}<input autoFocus required maxLength={spaceMode === "create" ? 80 : 200} value={formPrimary} onChange={(event) => setFormPrimary(event.target.value)} placeholder={spaceMode === "create" ? "La nostra stanza" : "hush://invite/…"} /></label>{formError ? <div className="auth-error">{formError}</div> : null}<button className="modal-primary" disabled={busy || !formPrimary.trim()}>{busy ? "Attendi…" : spaceMode === "create" ? "Crea server" : "Entra nel server"}</button></form></Modal> : null}
      {modal === "channel" ? <Modal title="Nuovo canale" description={`Verrà aggiunto a ${activeSpace?.name ?? "questo server"} e riceverà una chiave E2EE separata.`} onClose={() => setModal(null)}><form className="modal-form" onSubmit={submitChannel}><label>Nome del canale<input autoFocus required maxLength={80} value={formPrimary} onChange={(event) => setFormPrimary(event.target.value)} placeholder="gaming" /></label>{formError ? <div className="auth-error">{formError}</div> : null}<button className="modal-primary" disabled={busy || !formPrimary.trim()}>{busy ? "Creazione…" : "Crea canale"}</button></form></Modal> : null}
      {modal === "dm" ? <Modal title="Nuovo gruppo DM" description="Inserisci gli username esatti, separati da virgole. Hush distribuirà la chiave ai loro dispositivi registrati." onClose={() => setModal(null)}><form className="modal-form" onSubmit={submitDm}><label>Nome del gruppo<input autoFocus required maxLength={80} value={formPrimary} onChange={(event) => setFormPrimary(event.target.value)} placeholder="Nome del gruppo" /></label><label>Username<input required value={formSecondary} onChange={(event) => setFormSecondary(event.target.value)} placeholder="@amico1, @amico2" /></label>{formError ? <div className="auth-error">{formError}</div> : null}<button className="modal-primary" disabled={busy || !formPrimary.trim() || !formSecondary.trim()}>{busy ? "Creazione…" : "Crea gruppo"}</button></form></Modal> : null}
      {modal === "settings" ? <SettingsPanel profile={profile} theme={theme} onThemeChange={onThemeChange} inCall={stage.open} onClose={() => setModal(null)} onSaved={(next) => { setProfile(next); setMembers((current) => current.map((member) => member.id === next.id ? next : member)); }} /> : null}
      {modal === "server" && activeSpace ? <Modal title={activeSpace.name} description="Gestisci accesso e permanenza nel server." onClose={() => setModal(null)}><div className="server-actions"><button onClick={createInvite}><Copy size={17} /><span><strong>Copia invito</strong><small>Valido 7 giorni, massimo 25 utilizzi</small></span></button>{activeSpace.owner_id === session.user.id ? <button className="danger-action" onClick={() => leaveOrDeleteSpace(true)}><Trash2 size={17} /><span><strong>Elimina server</strong><small>Rimuove canali e messaggi in modo permanente</small></span></button> : <button className="danger-action" onClick={() => leaveOrDeleteSpace(false)}><LogOut size={17} /><span><strong>Lascia server</strong><small>Perderai accesso alle conversazioni</small></span></button>}{formError ? <div className="auth-error">{formError}</div> : null}</div></Modal> : null}

      {modal === "voice" ? <Modal title="Nuovo canale vocale" description={`Crea una stanza vocale persistente in ${activeSpace?.name ?? "questo server"}.`} onClose={() => setModal(null)}><form className="modal-form" onSubmit={submitVoiceChannel}><label>Nome del canale<input autoFocus required maxLength={80} value={formPrimary} onChange={(event) => setFormPrimary(event.target.value)} placeholder="Lounge" /></label>{formError ? <div className="auth-error">{formError}</div> : null}<button className="modal-primary" disabled={busy || !formPrimary.trim()}>{busy ? "Creazione…" : "Crea canale vocale"}</button></form></Modal> : null}

      {toast ? <div className="toast" role="status"><MessageCircleMore size={16} />{toast}</div> : null}
      {sidebarOpen ? <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Chiudi menu" /> : null}
    </div>
  );
}
