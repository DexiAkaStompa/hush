import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

type ModalProps = {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
};

export function Modal({ title, description, children, onClose, className = "" }: ModalProps) {
  const id = useId();
  const card = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(card.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex="0"]') ?? []).filter((element) => element.getClientRects().length > 0);
    if (!card.current?.contains(document.activeElement)) focusables()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const elements = focusables();
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, []);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section ref={card} className={`modal-card ${className}`} role="dialog" aria-modal="true" aria-labelledby={id}>
        <header>
          <div><span className="eyebrow">Hush · spazio privato</span><h2 id={id}>{title}</h2></div>
          <button type="button" onClick={onClose} aria-label="Chiudi"><X size={18} /></button>
        </header>
        {description ? <p className="modal-description">{description}</p> : null}
        {children}
      </section>
    </div>
  );
}
