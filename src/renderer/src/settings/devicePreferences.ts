import { initializeTheme, type Theme } from "../theme";

const AUTO_READ_REPLIES_STORAGE_KEY = "katarune.autoReadReplies";
const REDUCE_MOTION_STORAGE_KEY = "katarune.reduceMotion";

export interface DevicePreferences {
  readonly autoReadReplies: boolean;
  readonly reduceMotion: boolean;
  readonly theme: Theme;
}

function readBooleanPreference(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeBooleanPreference(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // Device preferences are optional; blocked storage must not break the app.
  }
}

export function readDevicePreferences(): Omit<DevicePreferences, "theme"> {
  return {
    autoReadReplies: readBooleanPreference(AUTO_READ_REPLIES_STORAGE_KEY),
    reduceMotion: readBooleanPreference(REDUCE_MOTION_STORAGE_KEY),
  };
}

export function applyReduceMotion(reduceMotion: boolean): void {
  document.documentElement.toggleAttribute(
    "data-reduce-motion",
    reduceMotion,
  );
}

export function initializeDevicePreferences(): DevicePreferences {
  const theme = initializeTheme();
  const preferences = readDevicePreferences();
  applyReduceMotion(preferences.reduceMotion);
  return { ...preferences, theme };
}

export function writeAutoReadReplies(value: boolean): void {
  writeBooleanPreference(AUTO_READ_REPLIES_STORAGE_KEY, value);
}

export function writeReduceMotion(value: boolean): void {
  writeBooleanPreference(REDUCE_MOTION_STORAGE_KEY, value);
  applyReduceMotion(value);
}
