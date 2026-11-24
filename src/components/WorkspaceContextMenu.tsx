import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, ChevronRight, type LucideIcon } from "lucide-react";
import "../workspace-actions.css";

export type WorkspaceMenuItem = { label: string; icon?: LucideIcon; action?: () => void; disabled?: boolean; danger?: boolean; checked?: boolean; items?: WorkspaceMenuItem[]; separator?: boolean };
export function WorkspaceContextMenu({ x, y, title, items, anchor, onClose }: { x: number; y: number; title: string; items: WorkspaceMenuItem[]; anchor?: HTMLElement; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<{ title: string; items: WorkspaceMenuItem[] } | null>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement;
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useLayoutEffect(() => {
    const element = ref.current!;
    const box = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(x, window.innerWidth - box.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(y, window.innerHeight - box.height - 8))}px`;
    element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y, page]);
  useLayoutEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !anchor?.contains(target)) onClose();
    };
    const dismiss = () => onClose();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", dismiss); window.removeEventListener("blur", dismiss); };
  }, [anchor, onClose]);
  return createPortal(<div ref={ref} className="user-context-menu workspace-context-menu" role="menu" aria-label={page?.title ?? title} style={{ left: x, top: y }} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
    if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); onClose(); }
    if (event.key === "ArrowLeft" && page) { event.preventDefault(); setPage(null); }
    const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  }}>
    {page ? <button role="menuitem" className="user-context-item" onClick={() => setPage(null)}><ArrowLeft size={15} /> Indietro</button> : null}
    <div className="workspace-menu-title">{page?.title ?? title}</div>
    {(page?.items ?? items).map((item, index) => <div key={`${item.label}-${index}`}>
      {item.separator && <div className="user-context-divider" role="separator" />}
      <button type="button" role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"} aria-checked={item.checked} aria-haspopup={item.items ? "menu" : undefined} className={`user-context-item ${item.danger ? "workspace-menu-danger" : ""}`} disabled={item.disabled} onClick={() => {
        if (item.items) setPage({ title: item.label, items: item.items });
        else { onClose(); item.action?.(); }
      }}><span className="workspace-menu-label">{item.icon && <item.icon size={15} aria-hidden="true" />}{item.label}</span>{item.items ? <ChevronRight size={14} /> : item.checked ? <Check size={14} /> : null}</button>
    </div>)}
  </div>, document.body);
}
