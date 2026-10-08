import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Copy, CornerUpLeft, MoreHorizontal, Pencil, Pin, Smile, Trash2, X } from "lucide-react";
import type { DecryptedMessage, Profile } from "../lib/workspace";
import { initialsFor, readableError } from "../lib/workspace";
import { ProfileImage } from "./ProfileImage";
import { ChatAttachment } from "./ChatAttachment";
import { MessageText } from "./MessageText";
import { EmojiPicker } from "./EmojiPicker";
import { copyText } from "../lib/clipboard";
import { Modal } from "./Modal";
export type Reaction = { message_id: string; user_id: string; emoji: string };
export function ChatMessage({ message, sender, selfId, roomKey, conversationId, reply, reactions, pinned, onReply, onEdit, onDelete, onReact, onPin, onProfile, onToast }: {
  message: DecryptedMessage & { replyId?: string | null; editedAt?: string | null }; sender: Profile; selfId: string; roomKey: CryptoKey | null; conversationId: string;
  reply?: DecryptedMessage; reactions: Reaction[]; pinned: boolean; onReply:()=>void; onEdit:(text:string)=>Promise<void>; onDelete:()=>Promise<void>; onReact:(emoji:string)=>Promise<void>; onPin:()=>Promise<void>; onProfile:()=>void; onToast:(text:string)=>void;
}) {
  const [menu,setMenu] = useState(false); const [picker,setPicker] = useState(false); const [editing,setEditing] = useState(false); const [text,setText] = useState(message.body); const [deleting,setDeleting] = useState(false); const [busy,setBusy] = useState(false);
  const run = async (action:()=>Promise<void>) => { if(busy)return; setBusy(true); try { await action(); setEditing(false); setDeleting(false); } catch(error) { onToast(readableError(error)); } finally {setBusy(false);} };
  const articleRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [popupPosition,setPopupPosition] = useState({left:8,top:8});
  const openPopup = (event: MouseEvent<HTMLElement>, kind: "menu" | "picker") => {
    const anchor=event.currentTarget.getBoundingClientRect();
    const width=kind === "picker" ? 320 : 200;
    const height=kind === "picker" ? 360 : 270;
    setPopupPosition({left:Math.max(8,Math.min(event.clientX || anchor.right,window.innerWidth-width-8)),top:Math.max(8,Math.min(event.clientY || anchor.bottom,window.innerHeight-height-8))});
    if(kind === "menu") {setMenu(!menu);setPicker(false);} else {setPicker(!picker);setMenu(false);}
  };
  useEffect(() => {
    if (!menu && !picker) return;
    const dismiss = (event: PointerEvent) => {if (!articleRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node) && !pickerRef.current?.contains(event.target as Node)) {setMenu(false);setPicker(false);}};
    const closeOnResize = () => {setMenu(false);setPicker(false);};
    document.addEventListener("pointerdown",dismiss); window.addEventListener("resize",closeOnResize);
    return ()=>{document.removeEventListener("pointerdown",dismiss);window.removeEventListener("resize",closeOnResize);};
  }, [menu,picker]);
  useEffect(() => {if(menu) menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();}, [menu]);
  const grouped = [...new Set(reactions.map(reaction=>reaction.emoji))];
  return <article ref={articleRef} className={`message chat-message ${pinned ? "is-pinned" : ""}`} id={`message-${message.id}`} onContextMenu={event=>{event.preventDefault();openPopup(event,"menu");}} onKeyDown={event=>{if(event.key==="Escape"){setMenu(false);setPicker(false);}}}>
    <button className="message-avatar-button" onClick={onProfile} aria-label={`Profilo di ${sender.display_name}`}><span className="avatar" style={{backgroundColor:sender.avatar_color}}>{initialsFor(sender.display_name)}<ProfileImage path={sender.avatar_path} alt="" /></span></button>
    <div className="message-copy"><div className="message-meta"><strong>{message.author}</strong><time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString("it")}>{new Date(message.createdAt).toLocaleTimeString("it",{hour:"2-digit",minute:"2-digit"})}</time>{message.editedAt && <small>modificato</small>}{pinned && <Pin size={12} aria-label="Messaggio fissato" />}</div>
      {message.replyId && <button className="message-reply" onClick={()=>document.getElementById(`message-${message.replyId}`)?.scrollIntoView({block:"center"})}><CornerUpLeft size={12} /><span>{reply ? `${reply.author}: ${reply.body || "Allegato"}` : "Risposta a un messaggio precedente"}</span></button>}
      {editing ? <form className="message-editor" onSubmit={event=>{event.preventDefault();void run(()=>onEdit(text));}}><textarea autoFocus value={text} onChange={event=>setText(event.target.value)} maxLength={8000} aria-label="Modifica messaggio" /><div><button type="button" onClick={()=>setEditing(false)}>Annulla</button><button disabled={busy || (!text.trim() && !message.attachment)}>Salva</button></div></form> : message.body ? <MessageText text={message.body} /> : null}
      {message.attachment && <ChatAttachment attachment={message.attachment} conversationId={conversationId} roomKey={roomKey} />}
      {!!grouped.length && <div className="message-reactions">{grouped.map(emoji=><button key={emoji} aria-pressed={reactions.some(reaction=>reaction.emoji===emoji&&reaction.user_id===selfId)} onClick={()=>void run(()=>onReact(emoji))} disabled={busy} aria-label={`Reazione ${emoji}`}>{emoji} <span>{reactions.filter(reaction=>reaction.emoji===emoji).length}</span></button>)}</div>}
    </div><div className={`message-toolbar ${menu ? "is-open" : ""}`}><button onClick={onReply} aria-label="Rispondi"><CornerUpLeft size={15}/></button><button onClick={event=>openPopup(event,"picker")} aria-label="Aggiungi reazione"><Smile size={15}/></button><button onClick={event=>openPopup(event,"menu")} aria-label="Opzioni messaggio" aria-expanded={menu}><MoreHorizontal size={15}/></button></div>
    {picker && createPortal(<div ref={pickerRef} style={popupPosition} className="message-reaction-picker"><EmojiPicker onSelect={emoji=>{setPicker(false);void run(()=>onReact(emoji));}} onClose={()=>setPicker(false)} /></div>,document.body)}
    {menu && createPortal(<div ref={menuRef} style={popupPosition} className="message-options" role="group" aria-label="Azioni messaggio"><button onClick={()=>{setMenu(false);onReply();}}><CornerUpLeft size={14}/>Rispondi</button><button onClick={()=>{setMenu(false);void copyText(message.body).then(()=>onToast("Messaggio copiato")).catch(()=>onToast("Copia non riuscita."));}}><Copy size={14}/>Copia testo</button><button disabled={busy} onClick={()=>{setMenu(false);void run(onPin);}}><Pin size={14}/>{pinned ? "Rimuovi dai fissati" : "Fissa messaggio"}</button>{message.senderId===selfId && <><button onClick={()=>{setText(message.body);setEditing(true);setMenu(false);}}><Pencil size={14}/>Modifica</button><button className="danger" onClick={()=>{setDeleting(true);setMenu(false);}}><Trash2 size={14}/>Elimina</button></>}<button onClick={()=>setMenu(false)}><X size={14}/>Chiudi</button></div>,document.body)}
    {deleting && <Modal title="Eliminare il messaggio?" description="Il messaggio verrà rimosso dalla conversazione per tutti." onClose={()=>setDeleting(false)}><div className="modal-form"><button className="danger-action" disabled={busy} onClick={()=>void run(onDelete)}>{busy ? "Eliminazione..." : "Elimina messaggio"}</button><button className="modal-primary" onClick={()=>setDeleting(false)}>Annulla</button></div></Modal>}
  </article>;
}
