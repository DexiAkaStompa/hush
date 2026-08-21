import type { ReactNode } from "react";
import { X } from "lucide-react";

type ModalProps = {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
};

export function Modal({ title, description, children, onClose }: ModalProps) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header>
          <div><span className="eyebrow">Hush · spazio privato</span><h2 id="modal-title">{title}</h2></div>
          <button type="button" onClick={onClose} aria-label="Chiudi"><X size={18} /></button>
        </header>
        {description ? <p className="modal-description">{description}</p> : null}
        {children}
      </section>
    </div>
  );
}
