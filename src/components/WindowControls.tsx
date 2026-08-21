import { useEffect, useState } from "react";
import { Maximize2, Minus, Square, X } from "lucide-react";

export function WindowControls() {
  const api = window.hushWindow;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!api) return;
    let active = true;
    void api.isMaximized().then((value) => {
      if (active) setMaximized(value);
    });
    const unsubscribe = api.onMaximizedChange(setMaximized);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);

  useEffect(() => {
    document.body.classList.toggle("window-maximized", maximized);
    return () => document.body.classList.remove("window-maximized");
  }, [maximized]);

  if (!api) return null;
  return (
    <nav className="window-controls" aria-label="Controlli finestra">
      <button onClick={api.minimize} aria-label="Riduci a icona"><Minus size={15} /></button>
      <button onClick={api.toggleMaximize} aria-label={maximized ? "Ripristina finestra" : "Ingrandisci finestra"}>
        {maximized ? <Square size={12} /> : <Maximize2 size={13} />}
      </button>
      <button className="window-close" onClick={api.close} aria-label="Chiudi Hush"><X size={16} /></button>
    </nav>
  );
}
