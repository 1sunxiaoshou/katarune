export type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "katarune.theme";

export function readTheme(): Theme {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark"
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Device preferences are optional; blocked storage must not break startup.
  }
}

export function initializeTheme(): Theme {
  const theme = readTheme();
  applyTheme(theme);
  return theme;
}
