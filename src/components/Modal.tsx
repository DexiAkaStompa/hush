import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type ModalProps = {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  headerActions?: ReactNode;
};
const modalStack: symbol[] = [];
const modalCards = new Map<symbol, HTMLElement>();
function updateModalVisibility() {
  for (const [key, element] of modalCards) {
    const underneath = key !== modalStack.at(-1);
    element.inert = underneath;
    if (underneath) element.setAttribute("aria-hidden", "true");
    else element.removeAttribute("aria-hidden");
  }
}
let modalLayer = 0;
let backgroundElement: HTMLElement | null = null;
let backgroundWasInert = false;

export function Modal({
  title,
  description,
  children,
  onClose,
  className = "",
  headerActions,
}: ModalProps) {
  const id = useId();
  const card = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(
    document.activeElement as HTMLElement | null,
  );
  const closeRef = useRef(onClose);
  const token = useRef(Symbol("modal"));
  useLayoutEffect(() => {
    if (!modalStack.length) {
      backgroundElement = document.querySelector<HTMLElement>(".app-shell");
      backgroundWasInert = backgroundElement?.inert ?? false;
      if (backgroundElement) backgroundElement.inert = true;
    }
    modalStack.push(token.current);
    if (card.current) modalCards.set(token.current, card.current);
    updateModalVisibility();
    const overlay = card.current?.parentElement;
    if (overlay) overlay.style.zIndex = String(1000 + modalLayer++);
    return () => {
      const index = modalStack.indexOf(token.current);
      if (index >= 0) modalStack.splice(index, 1);
      modalCards.delete(token.current);
      updateModalVisibility();
      if (!modalStack.length) {
        modalLayer = 0;
        if (backgroundElement) backgroundElement.inert = backgroundWasInert;
        backgroundElement = null;
      }
    };
  }, []);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previous = previousFocus.current;
    const focusables = () =>
      Array.from(
        card.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex="0"]',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
    if (!card.current?.contains(document.activeElement))
      focusables()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (modalStack.at(-1) !== token.current || event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const elements = focusables();
      const first = elements[0],
        last = elements.at(-1);
      if (!first) {
        event.preventDefault();
        card.current?.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first ||
          !card.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !card.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={card}
        tabIndex={-1}
        className={`modal-card ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        aria-describedby={description ? `${id}-description` : undefined}
      >
        <header>
          <div>
            <span className="eyebrow">Hush · spazio privato</span>
            <h2 id={id}>{title}</h2>
          </div>
          {headerActions && (
            <div className="modal-header-actions">{headerActions}</div>
          )}
          <button type="button" onClick={onClose} aria-label="Chiudi">
            <X size={18} />
          </button>
        </header>
        {description ? (
          <p id={`${id}-description`} className="modal-description">
            {description}
          </p>
        ) : null}
        {children}
      </section>
    </div>,
    document.body,
  );
}
