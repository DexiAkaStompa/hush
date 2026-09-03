import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Link2, Music2, Pause, Play, RotateCcw, Search, SkipForward, Volume2, VolumeX, X } from "lucide-react";
import { playMusicSound } from "../lib/interaction-sound";
import {
  extractMusicBroadcast,
  formatMusicTime,
  isDirectMusicUrl,
  musicProvider,
  musicTopic,
  normalizeMusicState,
  providerEmbedUrl,
  synchronizedMusicPosition,
  type ConversationMusicState,
} from "../lib/music";
import { isMusicBridgeConfigured, requestMusicStream, searchMusicBridge } from "../lib/musicBridge";
import { supabase } from "../lib/supabase";

const VOLUME_KEY = "hush:room-music-volume:v1";

function initialVolume() {
  const stored = Number(window.localStorage.getItem(VOLUME_KEY));
  return Number.isFinite(stored) && stored >= 0 && stored <= 1 ? stored : 0.72;
}

function titleFromUrl(value: string) {
  try {
    const url = new URL(value);
    const filename = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "");
    return filename.replace(/\.(mp3|aac|m4a|ogg|opus|wav|flac)$/i, "").replace(/[-_]+/g, " ") || url.hostname;
  } catch {
    return "Audio condiviso";
  }
}

function commandError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "Comando musicale non riuscito.";
}

export function RoomMusic({ conversationId }: { conversationId: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [music, setMusic] = useState<ConversationMusicState | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [title, setTitle] = useState("");
  const [notice, setNotice] = useState("Sincronizzazione della stanza…");
  const [busy, setBusy] = useState(false);
  const [volume, setVolume] = useState(initialVolume);
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [pendingSeek, setPendingSeek] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchProvider, setSearchProvider] = useState<"youtube" | "spotify">("youtube");
  const [searchResults, setSearchResults] = useState<Array<{ title: string; author: string; url: string; artworkUrl: string | null; length: number }>>([]);
  const [searching, setSearching] = useState(false);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    let channel: RealtimeChannel | null = null;

    const acceptBroadcast = (payload: unknown) => {
      const next = extractMusicBroadcast(payload);
      if (!active || !next || next.conversation_id !== conversationId) return;
      setMusic((current) => !current || next.revision >= current.revision ? next : current);
      setNotice("");
    };

    const loadCurrentState = async () => {
      const { data, error } = await client
        .from("conversation_music_state")
        .select("*")
        .eq("conversation_id", conversationId)
        .maybeSingle();
      if (!active) return;
      if (error) {
        setNotice("Musica non configurata su Supabase: applica l’ultima migrazione.");
        return;
      }
      setMusic(normalizeMusicState(data));
      setNotice("");
    };

    const subscribe = async () => {
      await client.realtime.setAuth();
      if (!active) return;
      channel = client.channel(musicTopic(conversationId), {
        config: { private: true, broadcast: { self: true, ack: true } },
      });
      channel
        .on("broadcast", { event: "INSERT" }, (event) => acceptBroadcast(event))
        .on("broadcast", { event: "UPDATE" }, (event) => acceptBroadcast(event))
        .subscribe((status) => {
          if (status === "SUBSCRIBED") void loadCurrentState();
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            setNotice("Sincronizzazione musicale non raggiungibile.");
          }
        });
    };

    void subscribe().catch(() => setNotice("Impossibile aprire il player condiviso."));
    return () => {
      active = false;
      if (channel) void client.removeChannel(channel);
    };
  }, [conversationId]);

  useEffect(() => {
    window.localStorage.setItem(VOLUME_KEY, String(volume));
    if (!audio.current) return;
    audio.current.volume = volume;
    audio.current.muted = muted;
  }, [muted, volume]);

  useEffect(() => {
    const player = audio.current;
    if (!player) return;
    if (!music?.source_url) {
      setStreamUrl(null);
      player.pause();
      player.removeAttribute("src");
      player.load();
      setDuration(0);
      setPlayhead(0);
      return;
    }
    let active = true;
    const provider = musicProvider(music.source_url);
    const expected = synchronizedMusicPosition(music);
    const setSource = (source: string) => {
      if (!active) return;
      setStreamUrl(source);
      player.dataset.source = source;
      player.src = source;
      player.load();
      const alignPlayback = () => {
        if (!active) return;
        const maximum = Number.isFinite(player.duration) ? Math.max(0, player.duration - 0.1) : expected;
        const target = Math.min(expected, maximum);
        if (Math.abs(player.currentTime - target) > 1.1) player.currentTime = target;
        if (music.is_playing) {
          void player.play().catch(() => setNotice("Premi Play per autorizzare l'audio su questo dispositivo."));
        } else {
          player.pause();
        }
        setPlayhead(target);
      };
      player.addEventListener("loadedmetadata", alignPlayback, { once: true });
    };

    if (provider === "direct" || !isMusicBridgeConfigured) {
      setStreamUrl(null);
      setSource(music.source_url);
    } else {
      setStreamUrl(null);
      setNotice("Connessione al music bridge…");
      void requestMusicStream(music.source_url, expected)
        .then((url) => {
          if (active) {
            setNotice("");
            setSource(url);
          }
        })
        .catch((error) => active && setNotice(commandError(error)));
    }
    return () => { active = false; };
  }, [music]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const player = audio.current;
      if (!player) return;
      if (music?.source_url && musicProvider(music.source_url) !== "direct" && !streamUrl) {
        setPlayhead(synchronizedMusicPosition(music));
        return;
      }
      setPlayhead(player.currentTime || 0);
      if (!music?.is_playing || player.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      const expected = synchronizedMusicPosition(music);
      if (Number.isFinite(player.duration) && expected >= player.duration) return;
      if (Math.abs(player.currentTime - expected) > 2) player.currentTime = expected;
    }, 1000);
    return () => window.clearInterval(timer);
  }, [music, streamUrl]);

  const commit = async (next: {
    sourceUrl: string | null;
    title: string | null;
    playing: boolean;
    position: number;
  }) => {
    const client = supabase;
    if (!client) return false;
    setBusy(true);
    setNotice("");
    try {
      const { data, error } = await client.rpc("set_conversation_music_state", {
        p_conversation_id: conversationId,
        p_source_url: next.sourceUrl,
        p_title: next.title,
        p_is_playing: next.playing,
        p_position_seconds: Math.max(0, next.position),
      });
      if (error) throw error;
      const normalized = normalizeMusicState(data);
      if (normalized) setMusic(normalized);
      return true;
    } catch (error) {
      setNotice(commandError(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitSource = (event: FormEvent) => {
    event.preventDefault();
    const cleanUrl = sourceUrl.trim();
    if (!isDirectMusicUrl(cleanUrl)) {
      setNotice("Inserisci un link HTTPS valido.");
      return;
    }
    const cleanTitle = title.trim() || titleFromUrl(cleanUrl);
    void playMusicSound("skipNext");
    void commit({ sourceUrl: cleanUrl, title: cleanTitle, playing: true, position: 0 })
      .then((saved) => { if (saved) setEditorOpen(false); });
  };

  const searchMusic = async (event: FormEvent) => {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query || (!window.hushWindow?.searchMusic && !isMusicBridgeConfigured)) return;
    setSearching(true);
    setNotice("");
    try {
      setSearchResults(isMusicBridgeConfigured
        ? await searchMusicBridge(query, searchProvider)
        : await window.hushWindow!.searchMusic(query, searchProvider));
    } catch (error) {
      setSearchResults([]);
      setNotice(commandError(error));
    } finally {
      setSearching(false);
    }
  };

  const chooseSearchResult = (result: { title: string; url: string }) => {
    void playMusicSound("skipNext");
    void commit({ sourceUrl: result.url, title: result.title, playing: true, position: 0 })
      .then((saved) => { if (saved) { setSearchResults([]); setSearchQuery(""); setEditorOpen(false); } });
  };

  const currentPosition = () => {
    const local = audio.current?.currentTime;
    return typeof local === "number" && Number.isFinite(local)
      ? local
      : music ? synchronizedMusicPosition(music) : 0;
  };

  const togglePlayback = () => {
    if (!music?.source_url) {
      setEditorOpen(true);
      return;
    }
    const nextPlaying = !music.is_playing;
    void playMusicSound(nextPlaying ? "play" : "pause");
    if (musicProvider(music.source_url) === "direct") {
      if (nextPlaying) void audio.current?.play().catch(() => undefined);
      else audio.current?.pause();
    }
    void commit({
      sourceUrl: music.source_url,
      title: music.title,
      playing: nextPlaying,
      position: currentPosition(),
    });
  };

  const commitSeek = () => {
    if (pendingSeek === null || !music?.source_url) return;
    void playMusicSound("seek");
    if (musicProvider(music.source_url) === "direct" && audio.current) audio.current.currentTime = pendingSeek;
    void commit({
      sourceUrl: music.source_url,
      title: music.title,
      playing: music.is_playing,
      position: pendingSeek,
    });
    setPendingSeek(null);
  };

  const seekable = Number.isFinite(duration) && duration > 0;
  const shownPosition = pendingSeek ?? playhead;
  const provider = musicProvider(music?.source_url);
  const embedPosition = useMemo(
    () => music ? synchronizedMusicPosition(music) : 0,
    [music?.anchor_at, music?.is_playing, music?.position_seconds, music?.revision],
  );
  const embedUrl = useMemo(
    () => music?.source_url && provider !== "direct"
      ? providerEmbedUrl(music.source_url, provider, embedPosition, music.is_playing, muted)
      : null,
    [embedPosition, music?.is_playing, music?.source_url, muted, provider],
  );

  return (
    <section className="room-music" aria-label="Musica della stanza">
      <audio
        ref={audio}
        preload="auto"
        onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onError={() => setNotice("Sorgente non riproducibile. Usa il link HTTPS diretto al file o allo stream audio.")}
      />
      {embedUrl && !isMusicBridgeConfigured ? (
        <div className="music-provider-player">
          <iframe key={`${music?.source_url}:${music?.is_playing}:${music?.revision}:${muted}`} src={embedUrl} title={music?.title ?? "Player musicale"} allow="autoplay; encrypted-media; picture-in-picture" referrerPolicy="origin" />
          <small>{provider === "spotify" ? "Spotify: volume e controlli avanzati nel player ufficiale" : "YouTube: player ufficiale sincronizzato"}</small>
        </div>
      ) : null}
      <div className="music-identity">
        <span className={`music-orbit ${music?.is_playing ? "music-orbit-live" : ""}`}><Music2 size={17} /></span>
        <span><small>musica condivisa</small><strong>{music?.title ?? "Nessuna traccia"}</strong></span>
      </div>

      {music?.source_url ? (
        <div className="music-transport">
          <button className="music-play" onClick={togglePlayback} disabled={busy} aria-label={music.is_playing ? "Metti in pausa per tutti" : "Riproduci per tutti"}>
            {music.is_playing ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <button
            onClick={() => {
              void playMusicSound("skipNext");
              setSourceUrl(music.source_url ?? "");
              setTitle(music.title ?? "");
              setEditorOpen(true);
            }}
            aria-label="Traccia successiva o cambia sorgente"
            title="Traccia successiva"
          >
            <SkipForward size={16} />
          </button>
          <div className="music-timeline">
            <input
              type="range"
              min={0}
              max={seekable ? duration : 1}
              step={0.1}
              value={seekable ? Math.min(shownPosition, duration) : 0}
              disabled={!seekable || busy}
              onChange={(event) => setPendingSeek(Number(event.target.value))}
              onPointerUp={commitSeek}
              onKeyUp={commitSeek}
              aria-label="Posizione condivisa"
            />
            <span>{formatMusicTime(shownPosition)} / {seekable ? formatMusicTime(duration) : "live"}</span>
          </div>
          <button onClick={() => { setSourceUrl(music.source_url ?? ""); setTitle(music.title ?? ""); setEditorOpen(true); }} aria-label="Cambia sorgente"><Link2 size={16} /></button>
          <button onClick={() => void commit({ sourceUrl: null, title: null, playing: false, position: 0 })} aria-label="Ferma e rimuovi per tutti"><RotateCcw size={16} /></button>
        </div>
      ) : (
        <button className="music-empty" onClick={() => setEditorOpen(true)}><Music2 size={15} /> Scegli una sorgente audio</button>
      )}

      <div className="music-local-volume" title="Questo volume vale solo sul tuo dispositivo">
        <button
          onClick={() => {
            setMuted((current) => !current);
            void playMusicSound("volume");
          }}
          aria-label={muted ? "Riattiva musica per me" : "Muta musica per me"}
        >
          {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={volume}
          onChange={(event) => {
            setVolume(Number(event.target.value));
            void playMusicSound("volume");
          }}
          aria-label="Volume musica personale"
        />
        <small>solo per me</small>
      </div>

      {editorOpen ? (
        <form className="music-source-form" onSubmit={submitSource}>
          <button type="button" className="music-source-close" onClick={() => setEditorOpen(false)} aria-label="Chiudi"><X size={15} /></button>
          <p className="music-source-hint">Puoi incollare un link HTTPS diretto, YouTube o Spotify, oppure cercare qui sotto.</p>
          <label>Link audio diretto HTTPS<input autoFocus required maxLength={2048} value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://…/traccia.mp3" /></label>
          <label>Titolo facoltativo<input maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Titolo per la stanza" /></label>
          <div className="music-search-divider"><span>oppure cerca</span></div>
          <div className="music-search-row">
            <select value={searchProvider} onChange={(event) => setSearchProvider(event.target.value as "youtube" | "spotify")} aria-label="Servizio di ricerca"><option value="youtube">YouTube</option><option value="spotify">Spotify</option></select>
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Cerca una canzone..." />
            <button type="button" onClick={searchMusic} disabled={searching || searchQuery.trim().length < 2} aria-label="Cerca"><Search size={15} /></button>
          </div>
          {searchResults.length ? <div className="music-search-results">{searchResults.map((result) => <button type="button" className="music-search-result" key={result.url} onClick={() => chooseSearchResult(result)}><span>{result.artworkUrl ? <img src={result.artworkUrl} alt="" /> : <Music2 size={14} />}</span><span><strong>{result.title}</strong><small>{result.author}</small></span><Play size={14} /></button>)}</div> : null}
          <button className="music-source-submit" disabled={busy}>{busy ? "Sincronizzo…" : "Riproduci per tutti"}</button>
          <p>Funzionano file MP3/AAC/Ogg e radio con URL diretto. Le pagine YouTube o Spotify non sono flussi audio. URL e posizione sono visibili a Supabase; la sorgente riceve la connessione di ogni client.</p>
        </form>
      ) : null}
      {notice ? <p className="music-notice" role="status">{notice}</p> : null}
    </section>
  );
}
