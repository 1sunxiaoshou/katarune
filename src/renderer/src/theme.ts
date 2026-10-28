import type { WindowTheme } from "../../shared/ipc";

export type Theme = WindowTheme;

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
  void window.katarune?.setWindowTheme(theme).catch(() => {
    console.error("无法同步窗口标题栏主题。");
  });
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
