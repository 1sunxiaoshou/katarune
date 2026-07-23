export type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "katarune.theme";

export function readTheme(): Theme {
  return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export function initializeTheme(): Theme {
  const theme = readTheme();
  applyTheme(theme);
  return theme;
}
