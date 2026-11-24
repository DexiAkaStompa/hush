const DESIGNS = [
  { id: "linea", name: "Linea", description: "Chat compatta, canali a sinistra e membri richiudibili", swatches: ["#141b1f", "#1d272c", "#9fdfd0"] },
  { id: "ardesia", name: "Ardesia", description: "Grafite e menta, con una chat più ampia", swatches: ["#171c21", "#1e242b", "#b4e9d6"] },
  { id: "inchiostro", name: "Inchiostro", description: "Toni caldi, server in alto e colonna di lettura", swatches: ["#262227", "#221e23", "#ffc6ab"] },
  { id: "basalto", name: "Basalto", description: "Grafite e lime, con canali e messaggi compatti", swatches: ["#191b1c", "#222526", "#d7ed91"] },
  { id: "marea", name: "Marea", description: "Blu profondo e pannelli indipendenti", swatches: ["#0f2033", "#162c46", "#93e5f2"] },
  { id: "prisma", name: "Prisma", description: "Lavanda e corallo, con fumetti e dock dei server", swatches: ["#f8f7fc", "#eeedf7", "#603abc"], light: true },
  { id: "notturno", name: "Notturno", description: "Nero caldo e lilla, con membri a comparsa", swatches: ["#16141a", "#1b181f", "#d6b7fb"] },
  { id: "serra", name: "Serra", description: "Verde salvia, con canali e membri a destra", swatches: ["#fcfcf8", "#e9eee6", "#285c47"], light: true },
  { id: "studio", name: "Studio", description: "Carbone e ambra, con la voce accanto al profilo", swatches: ["#231f1b", "#2c2620", "#ffce7d"] },
  { id: "quota", name: "Quota", description: "Bianco e cobalto, con canali a schede", swatches: ["#f8f9fe", "#edf0f9", "#2345b7"], light: true },
  { id: "orbita", name: "Orbita", description: "Viola e rosa, con orari a sinistra dei messaggi", swatches: ["#231b32", "#1e182a", "#f3b6ea"] },
  { id: "portico", name: "Portico", description: "Sabbia e terracotta, con una testata più ampia", swatches: ["#fbf5ea", "#f1e6d5", "#23564f"], light: true },
] as const;

type Design = typeof DESIGNS[number];
export type ThemeId = Design["id"] | "hush-void" | "midnight" | "tokyo-night" | "nord" | "frosted-glass" | "liquid-glass";

export type Theme = {
  id: ThemeId;
  name: string;
  description: string;
  swatches: readonly [string, string, string];
};

export const THEMES: readonly Theme[] = [
  { id: "liquid-glass", name: "Liquid Glass", description: "Vetro limpido, bordi rifrangenti e riflessi di luce", swatches: ["#171a1d", "#72777c", "#f5f6f7"] },
  ...DESIGNS,
  { id: "midnight", name: "Midnight", description: "AMOLED profondo, indaco tenue", swatches: ["#000000", "#0d101a", "#8998ff"] },
  { id: "tokyo-night", name: "Tokyo Night", description: "Blu notte e insegne soffuse", swatches: ["#1a1b26", "#24283b", "#7aa2f7"] },
  { id: "nord", name: "Nord", description: "Ardesia nordica, gelo e pino", swatches: ["#2e3440", "#3b4252", "#88c0d0"] },
  { id: "frosted-glass", name: "Frosted Glass", description: "Vetro fumé neutro, finitura satinata", swatches: ["#17181a", "#333538", "#e8e9eb"] },
  { id: "hush-void", name: "Hush Void", description: "Nero quieto, dettagli freddi", swatches: ["#090b0e", "#171c22", "#a9b4c2"] },
];

const STORAGE_KEY = "hush-theme";

export function setThemeAttributes(theme: ThemeId) {
  const { dataset } = document.documentElement;
  dataset.theme = theme;
  const design = DESIGNS.find(option => option.id === theme);
  if (design) dataset.design = "light" in design ? "light" : "dark";
  else delete dataset.design;
}

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
  setThemeAttributes(theme);
  try { window.localStorage.setItem(STORAGE_KEY, theme); } catch { /* Apply for the current session even if storage is unavailable. */ }
  if (!transparencyPreference && typeof window.matchMedia === "function") {
    transparencyPreference = window.matchMedia("(prefers-reduced-transparency: reduce)");
    contrastPreference = window.matchMedia("(prefers-contrast: more)");
    transparencyPreference.addEventListener("change", syncWindowMaterial);
    contrastPreference.addEventListener("change", syncWindowMaterial);
  }
  syncWindowMaterial();
}
