import { lazy, Suspense, useEffect, useLayoutEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AuthScreen } from "./components/AuthScreen";
import { BrandMark } from "./components/BrandMark";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import { applyTheme, readTheme, type ThemeId } from "./lib/themes";
// Keep the established stylesheet order ahead of the global theme overrides.
// Deferring these sheets with the panels would change the glass and mobile UI.
import "./user-profile.css";
import "./message-search.css";
import "./friends.css";
import "./navigation-rail.css";
import "./community-identity.css";
import "./components/call-dock.css";
import "./workspace-actions.css";
import "./media-attachment.css";
import "./link-embeds.css";
import "./message-layout.css";
import "./space-management.css";

// Authentication paints without parsing the messaging, calling and management UI.
const WorkspaceApp = lazy(() => import("./WorkspaceApp").then(module => ({ default: module.WorkspaceApp })));

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [theme, setTheme] = useState<ThemeId>(readTheme);

  useLayoutEffect(() => { applyTheme(theme); }, [theme]);

  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    if (theme === "liquid-glass") void import("./lib/liquid-glass").then(({ installLiquidGlass }) => {
      if (active) dispose = installLiquidGlass();
    }).catch(() => { /* The CSS material remains available without optical filters. */ });
    return () => { active = false; dispose?.(); };
  }, [theme]);

  useEffect(() => {
    const updateVisibility = () => { document.documentElement.dataset.pageHidden = String(document.hidden); };
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => { document.removeEventListener("visibilitychange", updateVisibility); delete document.documentElement.dataset.pageHidden; };
  }, []);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession((prev) => {
        if (
          prev?.user.id === nextSession?.user.id &&
          prev?.access_token === nextSession?.access_token
        ) {
          return prev;
        }
        return nextSession;
      });
      setAuthReady(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (!authReady) {
    return <main className="app-loading"><BrandMark size={48} title="Hush" /><span>Preparazione dello spazio privato…</span></main>;
  }
  if (isSupabaseConfigured && !session) return <AuthScreen />;
  if (!session) {
    return <main className="app-loading"><BrandMark size={48} /><span>Configura Supabase per usare Hush.</span></main>;
  }
  return <Suspense fallback={<main className="app-loading"><BrandMark size={48} title="Hush" /><span>Preparazione dello spazio privato…</span></main>}><WorkspaceApp session={session} theme={theme} onThemeChange={setTheme} /></Suspense>;
}
