export const THEME_IDS = ["plana", "arona"] as const;

export type ThemeId = (typeof THEME_IDS)[number];

const THEME_STORAGE_KEY = "katarune.theme";

function isThemeId(value: string | null): value is ThemeId {
  return value !== null && THEME_IDS.some((theme) => theme === value);
}

export function readStoredTheme(): ThemeId {
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isThemeId(storedTheme) ? storedTheme : "plana";
}

export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "plana");
  document.documentElement.style.colorScheme = theme === "plana" ? "dark" : "light";
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export function initializeTheme(): ThemeId {
  const theme = readStoredTheme();
  applyTheme(theme);
  return theme;
}
