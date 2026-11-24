import { useLayoutEffect, useRef, useState } from "react";

const MIN_WIDTH = 192;
const MAX_WIDTH = 344;
const STORAGE_KEY = "hush:linea-sidebar-width";

function constrain(width: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
}

function readWidth() {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(value) && value > 0) return constrain(value);
  } catch { /* Use the default if storage is unavailable. */ }
  return null;
}

export function SidebarResize() {
  const handle = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLElement | null>(null);
  const [width, setWidth] = useState(readWidth);
  const [naturalWidth, setNaturalWidth] = useState(230);
  const currentWidth = width ?? naturalWidth;
  const drag = useRef<{ pointer: number; x: number; startWidth: number; width: number } | null>(null);

  useLayoutEffect(() => {
    shell.current = handle.current?.closest<HTMLElement>(".app-shell") ?? null;
    const element = shell.current;
    return () => { element?.style.removeProperty("--linea-sidebar-width"); shell.current = null; };
  }, []);
  useLayoutEffect(() => {
    if (width !== null) {
      shell.current?.style.setProperty("--linea-sidebar-width", `${width}px`);
      return;
    }
    shell.current?.style.removeProperty("--linea-sidebar-width");
    const sidebar = shell.current?.querySelector("#workspace-channels");
    if (!sidebar) return;
    const update = () => setNaturalWidth(Math.round(sidebar.getBoundingClientRect().width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(sidebar);
    return () => observer.disconnect();
  }, [width]);

  const commit = (next: number) => {
    setWidth(next);
    shell.current?.style.setProperty("--linea-sidebar-width", `${next}px`);
    try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* Keep the session width. */ }
  };

  return <div ref={handle} className="linea-sidebar-resize" role="separator" tabIndex={0}
    aria-label="Larghezza elenco canali" aria-controls="workspace-channels" aria-orientation="vertical"
    aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={currentWidth} aria-valuetext={`${currentWidth} pixel`}
    onPointerDown={event => {
      if (event.button !== 0 || drag.current) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointer: event.pointerId, x: event.clientX, startWidth: currentWidth, width: currentWidth };
    }}
    onPointerMove={event => {
      const active = drag.current;
      if (!active || active.pointer !== event.pointerId) return;
      active.width = constrain(active.startWidth + event.clientX - active.x);
      shell.current?.style.setProperty("--linea-sidebar-width", `${active.width}px`);
    }}
    onLostPointerCapture={event => {
      const active = drag.current;
      if (!active || active.pointer !== event.pointerId) return;
      drag.current = null;
      commit(active.width);
    }}
    onDoubleClick={() => {
      shell.current?.style.removeProperty("--linea-sidebar-width");
      setWidth(null);
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* Keep the automatic width for this session. */ }
    }}
    onKeyDown={event => {
      let next: number;
      switch (event.key) {
        case "ArrowLeft": next = currentWidth - 12; break;
        case "ArrowRight": next = currentWidth + 12; break;
        case "Home": next = MIN_WIDTH; break;
        case "End": next = MAX_WIDTH; break;
        default: return;
      }
      event.preventDefault();
      commit(constrain(next));
    }} />;
}
