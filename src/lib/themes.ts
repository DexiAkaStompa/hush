export type ThemeId = "hush-void" | "midnight" | "tokyo-night" | "nord" | "frosted-glass";

export type Theme = {
  id: ThemeId;
  name: string;
  description: string;
  swatches: readonly [string, string, string];
};

export const THEMES: readonly Theme[] = [
  { id: "hush-void", name: "Hush Void", description: "Nero quieto, dettagli freddi", swatches: ["#090b0e", "#171c22", "#a9b4c2"] },
  { id: "midnight", name: "Midnight", description: "AMOLED profondo, indaco tenue", swatches: ["#000000", "#0d101a", "#8998ff"] },
  { id: "tokyo-night", name: "Tokyo Night", description: "Blu notte e insegne soffuse", swatches: ["#1a1b26", "#24283b", "#7aa2f7"] },
  { id: "nord", name: "Nord", description: "Ardesia nordica, gelo e pino", swatches: ["#2e3440", "#3b4252", "#88c0d0"] },
  { id: "frosted-glass", name: "Frosted Glass", description: "Vetro fumé su aurora scura", swatches: ["#101722", "#5b7897", "#c4e5ff"] },
];

const STORAGE_KEY = "hush-theme";

export function readTheme(): ThemeId {
  const value = window.localStorage.getItem(STORAGE_KEY);
  return THEMES.some((theme) => theme.id === value) ? value as ThemeId : "hush-void";
}

export function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem(STORAGE_KEY, theme);
}
