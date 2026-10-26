export type ThemeId = "hush-void" | "midnight" | "tokyo-night" | "nord" | "frosted-glass" | "liquid-glass";

export type Theme = {
  id: ThemeId;
  name: string;
  description: string;
  swatches: readonly [string, string, string];
};

export const THEMES: readonly Theme[] = [
  { id: "liquid-glass", name: "Liquid Glass", description: "Vetro limpido, bordi rifrangenti e riflessi di luce", swatches: ["#171a1d", "#72777c", "#f5f6f7"] },
  { id: "midnight", name: "Midnight", description: "AMOLED profondo, indaco tenue", swatches: ["#000000", "#0d101a", "#8998ff"] },
  { id: "tokyo-night", name: "Tokyo Night", description: "Blu notte e insegne soffuse", swatches: ["#1a1b26", "#24283b", "#7aa2f7"] },
  { id: "nord", name: "Nord", description: "Ardesia nordica, gelo e pino", swatches: ["#2e3440", "#3b4252", "#88c0d0"] },
  { id: "frosted-glass", name: "Frosted Glass", description: "Vetro fumé neutro, finitura satinata", swatches: ["#17181a", "#333538", "#e8e9eb"] },
  { id: "hush-void", name: "Hush Void", description: "Nero quieto, dettagli freddi", swatches: ["#090b0e", "#171c22", "#a9b4c2"] },
];

const STORAGE_KEY = "hush-theme";

export function readTheme(): ThemeId {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return THEMES.some((theme) => theme.id === value) ? value as ThemeId : "liquid-glass";
  } catch { return "liquid-glass"; }
}

let materialRevision = 0;
let transparencyPreference: MediaQueryList | undefined;
let contrastPreference: MediaQueryList | undefined;

function syncWindowMaterial() {
  const revision = ++materialRevision;
  const root = document.documentElement;
  const glass = root.dataset.theme === "liquid-glass" || root.dataset.theme === "frosted-glass";
  const enabled = glass && !transparencyPreference?.matches && !contrastPreference?.matches;
  delete root.dataset.nativeGlass;
  void window.hushWindow?.setMaterial?.(enabled).then((active) => {
    if (revision === materialRevision && active && enabled) root.dataset.nativeGlass = "true";
  }).catch(() => { /* The neutral browser fallback remains readable. */ });
}

export function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem(STORAGE_KEY, theme);
  if (!transparencyPreference && typeof window.matchMedia === "function") {
    transparencyPreference = window.matchMedia("(prefers-reduced-transparency: reduce)");
    contrastPreference = window.matchMedia("(prefers-contrast: more)");
    transparencyPreference.addEventListener("change", syncWindowMaterial);
    contrastPreference.addEventListener("change", syncWindowMaterial);
  }
  syncWindowMaterial();
}
