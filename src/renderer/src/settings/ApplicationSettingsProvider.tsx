import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import type { AppSettings } from "../../../shared/ipc";
import { Button } from "@/components/ui/button";
import { applyTheme, readTheme, type Theme } from "../theme";
import {
  applyReduceMotion,
  readDevicePreferences,
  writeAutoReadReplies,
  writeReduceMotion,
} from "./devicePreferences";

interface ApplicationSettingsContextValue {
  readonly appSettings: AppSettings;
  readonly autoReadReplies: boolean;
  readonly reduceMotion: boolean;
  readonly theme: Theme;
  readonly setAutoReadReplies: (value: boolean) => void;
  readonly setReduceMotion: (value: boolean) => void;
  readonly setTheme: (value: Theme) => void;
  readonly refreshAppSettings: () => Promise<void>;
  readonly updateDefaultLanguageModel: (modelConfigId: string | null) => Promise<void>;
}

const ApplicationSettingsContext =
  createContext<ApplicationSettingsContextValue | null>(null);

export function ApplicationSettingsProvider({
  children,
}: PropsWithChildren): React.JSX.Element {
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [devicePreferences, setDevicePreferences] = useState(
    readDevicePreferences,
  );
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refreshAppSettings = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setAppSettings(await window.katarune.getAppSettings());
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "无法读取应用设置。",
      );
    }
  }, []);

  useEffect(() => {
    let active = true;
    void window.katarune.getAppSettings().then(
      (settings) => {
        if (active) {
          setError(null);
          setAppSettings(settings);
        }
      },
      (loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "无法读取应用设置。",
          );
        }
      },
    );
    return () => {
      active = false;
    };
  }, [reloadToken]);

  const setTheme = useCallback((value: Theme): void => {
    applyTheme(value);
    setThemeState(value);
  }, []);

  const setAutoReadReplies = useCallback((value: boolean): void => {
    writeAutoReadReplies(value);
    setDevicePreferences((current) => ({
      ...current,
      autoReadReplies: value,
    }));
  }, []);

  const setReduceMotion = useCallback((value: boolean): void => {
    writeReduceMotion(value);
    setDevicePreferences((current) => ({ ...current, reduceMotion: value }));
  }, []);

  useEffect(() => {
    applyReduceMotion(devicePreferences.reduceMotion);
  }, [devicePreferences.reduceMotion]);

  const updateDefaultLanguageModel = useCallback(
    async (defaultLanguageModelConfigId: string | null): Promise<void> => {
      const settings = await window.katarune.updateAppSettings({
        defaultLanguageModelConfigId,
      });
      setAppSettings(settings);
    },
    [],
  );

  const value = useMemo<ApplicationSettingsContextValue | null>(
    () =>
      appSettings === null
        ? null
        : {
            appSettings,
            autoReadReplies: devicePreferences.autoReadReplies,
            reduceMotion: devicePreferences.reduceMotion,
            refreshAppSettings,
            theme,
            setAutoReadReplies,
            setReduceMotion,
            setTheme,
            updateDefaultLanguageModel,
          },
    [
      appSettings,
      devicePreferences.autoReadReplies,
      devicePreferences.reduceMotion,
      refreshAppSettings,
      setAutoReadReplies,
      setReduceMotion,
      setTheme,
      theme,
      updateDefaultLanguageModel,
    ],
  );

  if (error !== null) {
    return (
      <main className="grid h-dvh place-items-center text-sm" role="alert">
        <div className="grid justify-items-center gap-3">
          <p>{error}</p>
          <Button
            onClick={() => setReloadToken((current) => current + 1)}
            variant="outline"
          >
            重试
          </Button>
        </div>
      </main>
    );
  }
  if (value === null) {
    return (
      <main className="grid h-dvh place-items-center text-sm text-muted-foreground" role="status">
        正在读取应用设置……
      </main>
    );
  }

  return (
    <ApplicationSettingsContext.Provider value={value}>
      {children}
    </ApplicationSettingsContext.Provider>
  );
}

export function useApplicationSettings(): ApplicationSettingsContextValue {
  const settings = useContext(ApplicationSettingsContext);
  if (settings === null) {
    throw new Error("ApplicationSettingsProvider is missing.");
  }
  return settings;
}
