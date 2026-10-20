import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Activity, ChevronDown, Headphones, HeadphoneOff, Mic, MicOff, MonitorUp, PhoneOff, Signal, Video, VideoOff, X } from "lucide-react";
import { updateMediaSettings, useMediaSettings } from "../lib/media-settings";
import "./call-dock.css";

type Props = {
  roomName: string;
  connected: boolean;
  notice: string;
  latency: number | null;
  relayAvailable?: boolean;
  connectionPath?: "direct" | "relay" | null;
  mic: boolean;
  deafened: boolean;
  camera: boolean;
  sharing: boolean;
  canShare: boolean;
  onExpand: () => void;
  onLeave: () => void;
  onMic: () => Promise<void>;
  onDeafen: () => void;
  onCamera: () => Promise<void>;
  onShare: () => Promise<void>;
};

export function CallDock(props: Props) {
  const { roomName, connected, notice, latency, mic, deafened, camera, sharing } = props;
  const settings = useMediaSettings();
  const [panel, setPanel] = useState<"audio" | "connection" | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceError, setDeviceError] = useState("");
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState({ left: 0, bottom: 0 });
  const root = useRef<HTMLElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!panel) return;
    const place = () => {
      const rect = root.current?.getBoundingClientRect();
      if (rect) setPosition({ left: Math.max(8, Math.min(rect.left, innerWidth - 292)), bottom: Math.max(8, innerHeight - rect.top + 8) });
    };
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setPanel(null);
    };
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setPanel(null); trigger.current?.focus(); } };
    place();
    window.addEventListener("resize", place);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keydown, true);
    popup.current?.querySelector<HTMLElement>("button,select")?.focus();
    return () => { window.removeEventListener("resize", place); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", keydown, true); };
  }, [panel]);

  useEffect(() => {
    if (panel !== "audio") return;
    let active = true;
    const refresh = () => { void navigator.mediaDevices.enumerateDevices().then(list => { if (active) { setDevices(list); setDeviceError(""); } }).catch(() => { if (active) setDeviceError("Dispositivi non disponibili. Controlla i permessi del sistema."); }); };
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => { active = false; navigator.mediaDevices.removeEventListener("devicechange", refresh); };
  }, [panel]);

  const togglePanel = (kind: "audio" | "connection", button: HTMLButtonElement) => {
    trigger.current = button;
    setPanel(current => current === kind ? null : kind);
  };
  const run = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); try { await action(); } finally { setBusy(false); } };
  const deviceSelect = (kind: "audioinput" | "audiooutput", value: string, label: string) => <label>{label}<select value={value} onChange={event => updateMediaSettings(kind === "audioinput" ? { inputId: event.target.value } : { outputId: event.target.value })}>
    <option value="">Predefinito di sistema</option>
    {value && !devices.some(device => device.kind === kind && device.deviceId === value) && <option value={value}>Dispositivo non disponibile</option>}
    {devices.filter(device => device.kind === kind && device.deviceId !== "default").map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${kind === "audioinput" ? "Microfono" : "Uscita audio"} ${index + 1}`}</option>)}
  </select></label>;

  return <>
    <section ref={root} className={`desktop-call-widget ${connected ? "is-connected" : "is-connecting"}`} aria-label="Controlli chiamata desktop">
      <div className="call-widget-heading">
        <button className="call-widget-room" onClick={props.onExpand} title={`Apri chiamata: ${roomName}`}>
          <Signal size={21} /><span><strong>{connected ? "Connesso alla chiamata" : "Connessione in corso…"}</strong><small>{roomName}</small></span>
        </button>
        <button className="call-widget-icon" aria-label="Dettagli connessione" aria-expanded={panel === "connection"} onClick={event => togglePanel("connection", event.currentTarget)} title={latency === null ? "Dettagli connessione" : `Latenza: ${latency} ms`}><Activity size={17} /></button>
        <button className="call-widget-icon call-widget-leave" onClick={props.onLeave} aria-label="Lascia chiamata" title="Disconnetti"><PhoneOff size={18} /></button>
      </div>
      <div className="call-widget-actions">
        <button className={camera ? "is-active" : ""} onClick={() => { void run(props.onCamera); }} disabled={busy || sharing} aria-pressed={camera} aria-label={camera ? "Disattiva videocamera" : "Attiva videocamera"} title={sharing ? "Interrompi la condivisione per attivare la videocamera" : "Videocamera"}>{camera ? <Video size={18} /> : <VideoOff size={18} />}</button>
        {props.canShare && <button className={sharing ? "is-active" : ""} onClick={() => { void run(props.onShare); }} disabled={busy} aria-pressed={sharing} aria-label={sharing ? "Interrompi condivisione schermo" : "Condividi schermo"} title={sharing ? "Interrompi condivisione" : "Condividi schermo"}><MonitorUp size={18} /></button>}
        <div className="call-widget-microphone"><button className={!mic ? "is-muted" : ""} onClick={() => { void props.onMic(); }} aria-pressed={mic} aria-label={mic ? "Disattiva microfono" : "Attiva microfono"} title={mic ? "Disattiva microfono" : "Attiva microfono"}>{mic ? <Mic size={17} /> : <MicOff size={17} />}</button><button aria-label="Dispositivi audio" aria-expanded={panel === "audio"} onClick={event => togglePanel("audio", event.currentTarget)} title="Dispositivi e volume"><ChevronDown size={12} /></button></div>
        <button className={deafened ? "is-muted" : ""} onClick={props.onDeafen} aria-pressed={deafened} aria-label={deafened ? "Riattiva audio chiamata" : "Silenzia audio chiamata"} title={deafened ? "Riattiva audio e microfono precedente" : "Silenzia audio e microfono"}>{deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}</button>
      </div>
    </section>
    {panel && createPortal(<div ref={popup} className="call-widget-popover" role="dialog" aria-label={panel === "audio" ? "Dispositivi audio" : "Dettagli connessione"} style={position}>
      <header><strong>{panel === "audio" ? "Audio della chiamata" : "Connessione vocale"}</strong><button aria-label="Chiudi pannello chiamata" onClick={() => { setPanel(null); trigger.current?.focus(); }}><X size={16} /></button></header>
      {panel === "audio" ? <>
        {deviceSelect("audioinput", settings.inputId, "Microfono")}
        {deviceSelect("audiooutput", settings.outputId, "Uscita audio")}
        <label>Volume in uscita <output>{settings.outputVolume}%</output><input type="range" min="0" max="100" value={settings.outputVolume} onChange={event => updateMediaSettings({ outputVolume: Number(event.target.value) })} /></label>
        {deviceError && <p role="status">{deviceError}</p>}
      </> : <><div className="call-widget-quality"><Signal size={23} /><span>{connected ? "Canale vocale connesso" : "Collegamento al canale…"}<small>{latency === null ? "Latenza disponibile quando un partecipante è collegato." : `Latenza WebRTC: ${latency} ms`}</small></span></div><p>{props.connectionPath === "relay" ? "Traffico cifrato tramite relay." : props.connectionPath === "direct" ? "Collegamento diretto tra i partecipanti." : "Collegamento con i partecipanti in preparazione."}<br/>{props.relayAvailable ? "Connessione alternativa disponibile per VPN e reti restrittive." : "Relay non disponibile: alcune VPN o reti potrebbero impedire la chiamata."}</p><p>{notice}</p><button className="call-widget-open" onClick={() => { setPanel(null); props.onExpand(); }}>Apri chiamata</button></>}
    </div>, document.body)}
  </>;
}
