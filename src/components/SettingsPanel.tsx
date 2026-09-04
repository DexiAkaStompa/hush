import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download, Mic, Palette, UserRound } from "lucide-react";
import { Modal } from "./Modal";
import { ProfileImage } from "./ProfileImage";
import { initialsFor, readableError, type Profile } from "../lib/workspace";
import { previewProfileImage, saveProfile } from "../lib/profile-media";
import { THEMES, type ThemeId } from "../lib/themes";
import { DEFAULT_MEDIA_SETTINGS, routeAudio, updateMediaSettings, useMediaSettings, type MediaSettings } from "../lib/media-settings";
import { openMicrophone, type MicrophoneCapture } from "../lib/microphone";

const tabs = [
  { id: "profile", label: "Il mio profilo", icon: UserRound },
  { id: "voice", label: "Voce e video", icon: Mic },
  { id: "appearance", label: "Aspetto", icon: Palette },
  { id: "updates", label: "Aggiornamenti", icon: Download },
] as const;

function ImagePicker({ label, onChange, disabled }: { label: string; onChange: (file: File | null, preview?: string) => void; disabled: boolean }) {
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  return <div className="image-picker">
    <label>{label}<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled={disabled} onChange={(event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      const attempt = ++generation.current;
      void previewProfileImage(file).then((url) => {
        if (attempt !== generation.current) { URL.revokeObjectURL(url); return; }
        setError(""); onChange(file, url);
      }).catch((reason) => { if (attempt === generation.current) setError(readableError(reason)); });
    }} /></label>
    <button type="button" className="settings-secondary" disabled={disabled} onClick={() => { generation.current++; setError(""); onChange(null); }}>Rimuovi</button>
    {error ? <p className="auth-error" role="alert">{error}</p> : null}
  </div>;
}

function VoiceSettings({ inCall }: { inCall: boolean }) {
  const settings = useMediaSettings();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  const [ready, setReady] = useState(false);
  const meter = useRef<HTMLMeterElement>(null);
  const playback = useRef<HTMLAudioElement>(null);
  const refreshDevices = async () => {
    const list = await navigator.mediaDevices.enumerateDevices();
    setDevices(list);
  };
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media) { setError("Dispositivi multimediali non disponibili in questo browser."); return; }
    let active = true;
    const refresh = () => { void media.enumerateDevices().then((list) => { if (active) setDevices(list); }).catch(() => { if (active) setError("Impossibile leggere i dispositivi audio."); }); };
    refresh(); media.addEventListener("devicechange", refresh);
    return () => { active = false; media.removeEventListener("devicechange", refresh); };
  }, []);
  useEffect(() => {
    if (!testing) return;
    let active = true;
    let capture: MicrophoneCapture | undefined;
    let context: AudioContext | undefined;
    let frame = 0;
    const element = playback.current;
    setReady(false);
    void openMicrophone(settings).then(async (opened) => {
      capture = opened;
      if (!active) { opened.close(); return; }
      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(opened.stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const tick = () => {
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        if (meter.current) meter.current.value = Math.min(100, rms * 300);
        frame = requestAnimationFrame(tick);
      };
      tick();
      if (element) { element.srcObject = opened.stream; await routeAudio(element, settings); }
      if (active) { setReady(true); await refreshDevices(); }
    }).catch((reason) => {
      capture?.close();
      if (active) { setError(`Test non riuscito: ${readableError(reason)}`); setTesting(false); }
    });
    return () => {
      active = false; cancelAnimationFrame(frame); capture?.close();
      void context?.close().catch(() => undefined);
      if (element) { element.pause(); element.srcObject = null; }
    };
  }, [testing, settings]);

  const change = (patch: Partial<MediaSettings>) => {
    try { updateMediaSettings(patch); setError(""); } catch { setError("Impossibile salvare le preferenze su questo dispositivo."); }
  };
  const selectDevice = (label: string, kind: MediaDeviceKind, key: "inputId" | "outputId" | "cameraId") => {
    const choices = devices.filter((device) => device.kind === kind && device.deviceId !== "default");
    return <label>{label}<select value={settings[key]} disabled={key === "outputId" && !("setSinkId" in HTMLMediaElement.prototype)} onChange={(event) => change({ [key]: event.target.value })}>
      <option value="">Predefinito di sistema</option>
      {settings[key] && !choices.some((device) => device.deviceId === settings[key]) ? <option value={settings[key]}>Dispositivo non disponibile — scegline un altro</option> : null}
      {choices.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `${label} ${index + 1}`}</option>)}
    </select></label>;
  };
  return <div className="modal-form settings-form">
    <h3>La tua voce, più chiara</h3><p className="settings-hint">Le preferenze audio si applicano anche durante la chiamata. La videocamera selezionata sarà usata alla prossima attivazione.</p>
    {selectDevice("Microfono", "audioinput", "inputId")}
    {selectDevice("Cuffie o altoparlanti delle chiamate", "audiooutput", "outputId")}
    {selectDevice("Videocamera", "videoinput", "cameraId")}
    <p className="settings-hint">Avvia il test per autorizzare il microfono e vedere i nomi dei dispositivi.</p>
    <label>Volume microfono · {settings.inputVolume}%<input type="range" min="0" max="200" step="5" value={settings.inputVolume} onChange={(event) => change({ inputVolume: Number(event.target.value) })} /></label>
    <label>Volume chiamate · {settings.outputVolume}%<input type="range" min="0" max="100" value={settings.outputVolume} onChange={(event) => change({ outputVolume: Number(event.target.value) })} /></label>
    <label>Riduzione del rumore<select value={settings.noise} onChange={(event) => change({ noise: event.target.value as MediaSettings["noise"] })}>
      <option value="rnnoise">Avanzata · RNNoise</option><option value="standard">Standard</option><option value="off">Disattivata</option>
    </select></label>
    <p className="settings-hint">RNNoise è gratuito e filtra il rumore sul tuo dispositivo. Nessun audio viene inviato a servizi di elaborazione.</p>
    <label className="settings-toggle"><input type="checkbox" checked={settings.echoCancellation} onChange={(event) => change({ echoCancellation: event.target.checked })} />Cancellazione dell’eco</label>
    <label className="settings-toggle"><input type="checkbox" checked={settings.autoGainControl} onChange={(event) => change({ autoGainControl: event.target.checked })} />Regolazione automatica del microfono</label>
    <div className="microphone-test"><strong>Prova il microfono</strong>
      <p className="settings-hint">{inCall ? "Esci dalla chiamata per provare il microfono senza trasmettere agli altri." : "Parla per controllare il livello. Usa le cuffie se attivi il riascolto."}</p>
      <meter ref={meter} min="0" max="100" value="0" aria-label="Livello del microfono" />
      <button type="button" className="settings-secondary" disabled={inCall} onClick={() => { setError(""); setTesting(!testing); }}>{testing ? "Interrompi test" : "Avvia test"}</button>
      {testing ? <><span role="status">{ready ? "Microfono pronto" : "Preparazione microfono…"}</span><label className="settings-toggle"><input type="checkbox" checked={monitoring} onChange={(event) => setMonitoring(event.target.checked)} />Riascolta nelle cuffie</label></> : null}
      <audio ref={playback} autoPlay muted={!monitoring} />
    </div>
    {error ? <div className="auth-error" role="alert">{error}</div> : null}
    <button type="button" className="settings-secondary" onClick={() => change(DEFAULT_MEDIA_SETTINGS)}>Ripristina impostazioni audio</button>
  </div>;
}

function UpdateSettings({ inCall }: { inCall: boolean }) {
  const [status, setStatus] = useState<HushUpdateStatus | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const desktop = window.hushWindow;
    if (!desktop) return;
    let active = true;
    const unsubscribe = desktop.onUpdateStatus((next) => { if (active) setStatus(next); });
    void desktop.getUpdateStatus().then((next) => { if (active) setStatus(next); }).catch(() => { if (active) setError("Impossibile leggere gli aggiornamenti."); });
    return () => { active = false; unsubscribe(); };
  }, []);
  const labels = {
    disabled: "Aggiornamenti automatici non attivi in questa build", idle: "Pronto per la verifica", checking: "Ricerca aggiornamenti…",
    available: "Nuova versione disponibile", current: "Hush è aggiornato", downloading: "Download in corso…",
    downloaded: "Aggiornamento pronto da installare", error: "Aggiornamento non riuscito",
  };
  return <div className="modal-form settings-form"><h3>Sempre all’ultima versione</h3>
    <p className="settings-hint">Hush cerca nuove versioni all’avvio e ogni quattro ore e le scarica in background da DexiAkaStompa/hush su GitHub.</p>
    <div className="update-card" role="status"><Download size={28} /><strong>{status ? labels[status.status] : window.hushWindow ? "Caricamento…" : "Disponibile nell’app desktop"}</strong>
      {status ? <span>Versione installata: {status.currentVersion}{status.version ? ` · Nuova versione: ${status.version}` : ""}</span> : null}
      {status?.status === "downloading" ? <><progress max="100" value={status.percent ?? 0} /><span>{Math.round(status.percent ?? 0)}%</span></> : null}
      {status?.message ? <p>{status.message}</p> : null}
    </div>
    <button type="button" className="modal-primary" disabled={!status || ["disabled", "checking", "downloading", "available", "downloaded"].includes(status.status)} onClick={() => {
      setError(""); void window.hushWindow?.checkForUpdates().then(setStatus).catch((reason) => setError(readableError(reason)));
    }}>Cerca aggiornamenti</button>
    {status?.status === "downloaded" ? <button type="button" className="settings-secondary" disabled={inCall} onClick={() => { void window.hushWindow?.installUpdate().catch((reason) => setError(readableError(reason))); }}>Riavvia e installa</button> : null}
    {inCall && status?.status === "downloaded" ? <p className="settings-hint">Termina la chiamata prima di riavviare.</p> : null}
    {error ? <p className="auth-error" role="alert">{error}</p> : null}
  </div>;
}

export function SettingsPanel({ profile, theme, onThemeChange, onSaved, onClose, inCall }: {
  profile: Profile; theme: ThemeId; onThemeChange: (theme: ThemeId) => void;
  onSaved: (profile: Profile) => void; onClose: () => void; inCall: boolean;
}) {
  const [tab, setTab] = useState<typeof tabs[number]["id"]>("profile");
  const [name, setName] = useState(profile.display_name);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [color, setColor] = useState(profile.avatar_color);
  const [avatar, setAvatar] = useState<File | null | undefined>();
  const [banner, setBanner] = useState<File | null | undefined>();
  const [avatarPreview, setAvatarPreview] = useState<string>();
  const [bannerPreview, setBannerPreview] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => () => { if (avatarPreview) URL.revokeObjectURL(avatarPreview); }, [avatarPreview]);
  useEffect(() => () => { if (bannerPreview) URL.revokeObjectURL(bannerPreview); }, [bannerPreview]);
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const next = await saveProfile(profile, { display_name: name, avatar_color: color, bio }, { avatar, banner });
      onSaved(next); setAvatar(undefined); setBanner(undefined); setAvatarPreview(undefined); setBannerPreview(undefined); setMessage("Profilo salvato");
    } catch (reason) { setError(readableError(reason)); } finally { setBusy(false); }
  };
  return <Modal title="Impostazioni" className="settings-modal" onClose={() => { if (!busy) onClose(); }}>
    <div className="settings-layout"><nav className="settings-nav" aria-label="Sezioni impostazioni">
      {tabs.map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}><Icon size={17} />{label}</button>)}
      <small>Il tuo spazio. A modo tuo.</small>
    </nav><div className="settings-content">
      {tab === "profile" ? <form className="modal-form settings-form" onSubmit={(event) => { void save(event); }}>
        <div className="profile-preview"><div className="profile-banner" style={{ backgroundColor: color }}><ProfileImage path={banner === null ? null : profile.banner_path} preview={bannerPreview} alt="Banner profilo" /></div>
          <div className="profile-preview-copy"><span className="avatar profile-avatar" style={{ backgroundColor: color }}>{initialsFor(name)}<ProfileImage path={avatar === null ? null : profile.avatar_path} preview={avatarPreview} alt="" /></span><strong>{name || "Il tuo nome"}</strong><small>@{profile.username}</small><p>{bio || "Un piccolo spazio per raccontarti."}</p></div>
        </div>
        <p className="settings-hint">PNG, JPG, GIF e WebP, anche animati. Massimo 8 MB e 4096 × 4096 pixel. Visibili agli utenti Hush autenticati.</p>
        <ImagePicker label="Immagine profilo" disabled={busy} onChange={(file, url) => { setAvatar(file); setAvatarPreview(url); setMessage(""); }} />
        <ImagePicker label="Banner" disabled={busy} onChange={(file, url) => { setBanner(file); setBannerPreview(url); setMessage(""); }} />
        <label>Nome visualizzato<input required maxLength={64} value={name} disabled={busy} onChange={(event) => { setName(event.target.value); setMessage(""); }} /></label>
        <label>Colore profilo<input type="color" value={color} disabled={busy} onChange={(event) => { setColor(event.target.value); setMessage(""); }} /></label>
        <label>Su di me · {bio.length}/190<textarea maxLength={190} rows={3} value={bio} disabled={busy} onChange={(event) => { setBio(event.target.value); setMessage(""); }} /></label>
        {error ? <div className="auth-error" role="alert">{error}</div> : null}{message ? <p role="status">{message}</p> : null}
        <button className="modal-primary" disabled={busy || !name.trim()}>{busy ? "Salvataggio…" : "Salva profilo"}</button>
      </form> : null}
      {tab === "voice" ? <VoiceSettings inCall={inCall} /> : null}
      {tab === "appearance" ? <div className="settings-form"><h3>Un’atmosfera tutta tua</h3><p className="settings-hint">Il tema si applica subito e rimane salvato su questo dispositivo.</p><div className="theme-grid">{THEMES.map((option) => <button type="button" className={`theme-option ${theme === option.id ? "selected" : ""}`} key={option.id} aria-pressed={theme === option.id} onClick={() => onThemeChange(option.id)}><span className="theme-swatches">{option.swatches.map((swatch) => <i key={swatch} style={{ backgroundColor: swatch }} />)}</span><span><strong>{option.name}</strong><small>{option.description}</small></span></button>)}</div></div> : null}
      {tab === "updates" ? <UpdateSettings inCall={inCall} /> : null}
    </div></div>
  </Modal>;
}
