import { DefaultModelsSettings } from "./DefaultModelsSettings";
import { Switch } from "@/components/ui/switch";
import {
  Tabs,
  TabsIndicator,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useApplicationSettings } from "./ApplicationSettingsProvider";
import { type SettingsDataState } from "./settingsState";

interface GeneralSettingsProps {
  readonly dataState: SettingsDataState;
  readonly onOpenModels: () => void;
  readonly onReload: () => Promise<void>;
}

function SettingCopy({
  description,
  id,
  title,
}: {
  readonly description?: string;
  readonly id: string;
  readonly title: string;
}): React.JSX.Element {
  return (
    <span className="grid min-w-0 gap-0.5">
      <span className="text-sm font-medium text-foreground-secondary" id={id}>{title}</span>
      {description && <span className="text-xs leading-5 text-muted-foreground">{description}</span>}
    </span>
  );
}

const settingRowClassName =
  "grid min-h-16 items-center gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto]";

export function GeneralSettings({
  dataState,
  onOpenModels,
  onReload,
}: GeneralSettingsProps): React.JSX.Element {
  const {
    autoReadReplies,
    reduceMotion,
    setAutoReadReplies,
    setReduceMotion,
    setTheme,
    theme,
  } = useApplicationSettings();
  return (
    <section className="scrollbar-hidden grid min-h-0 w-full overflow-y-auto content-start gap-7 border bg-card p-6 md:p-8 lg:h-full lg:min-h-0" aria-label="常规设置" data-testid="general-settings">
      <div className="mx-auto grid w-full max-w-3xl gap-8">
        <section className="grid gap-3" aria-labelledby="model-speech-settings-title">
          <h2 className="text-sm font-semibold" id="model-speech-settings-title">默认模型</h2>
          <div className="grid gap-1 pl-4 sm:pl-6">
            {dataState.status === "loading" && <p role="status" className="text-sm text-muted-foreground">加载中…</p>}
            {dataState.status === "error" && <div className="grid justify-items-start gap-1 text-sm">
              <p role="alert" className="text-destructive">加载失败</p>
              <button type="button" className="text-xs text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => void onReload()}>重试</button>
              <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">查看详情</summary><p className="break-words">{dataState.message}</p></details>
            </div>}
            <DefaultModelsSettings dataState={dataState} onOpenModels={onOpenModels} />
          </div>
        </section>
        <label className={`${settingRowClassName} cursor-pointer border-t pt-6`} htmlFor="auto-read-replies">
          <SettingCopy
            id="auto-read-replies-label"
            title="自动朗读"
          />
          <Switch
            id="auto-read-replies"
            checked={autoReadReplies}
            data-testid="auto-read-replies"
            aria-labelledby="auto-read-replies-label"
            onCheckedChange={setAutoReadReplies}
          />
        </label>
        <section className="grid gap-3 border-t pt-6" aria-labelledby="appearance-settings-title">
          <h2 className="text-sm font-semibold" id="appearance-settings-title">外观与动效</h2>
          <div className="grid gap-1 pl-4 sm:pl-6">
            <div className={settingRowClassName}>
              <SettingCopy
                id="theme-setting-label"
                title="主题"
              />
              <Tabs
                className="gap-0"
                value={theme}
                onValueChange={(value) => {
                  if (value === "light" || value === "dark") setTheme(value);
                }}
              >
                <TabsList
                  aria-labelledby="theme-setting-label"
                  className="relative isolate grid h-8! min-w-32 grid-cols-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground dark:bg-muted dark:text-muted-foreground"
                >
                  <TabsIndicator className="model-category-indicator" />
                  <TabsTrigger
                    className="z-[1] w-full! min-w-0 justify-center! rounded-none px-1.5 text-[10px]! text-primary-foreground/70 hover:text-primary-foreground data-active:bg-transparent! data-active:text-foreground data-active:shadow-none! data-active:hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground dark:data-active:border-transparent! dark:data-active:bg-transparent! dark:data-active:text-background dark:data-active:hover:text-background"
                    data-testid="theme-light"
                    value="light"
                  >
                    亮色
                  </TabsTrigger>
                  <TabsTrigger
                    className="z-[1] w-full! min-w-0 justify-center! rounded-none px-1.5 text-[10px]! text-primary-foreground/70 hover:text-primary-foreground data-active:bg-transparent! data-active:text-foreground data-active:shadow-none! data-active:hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground dark:data-active:border-transparent! dark:data-active:bg-transparent! dark:data-active:text-background dark:data-active:hover:text-background"
                    data-testid="theme-dark"
                    value="dark"
                  >
                    暗色
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>


            <label className={`${settingRowClassName} cursor-pointer`} htmlFor="reduce-motion">
              <SettingCopy
                id="reduce-motion-label"
                title="减少动态效果"
              />
              <Switch
                id="reduce-motion"
                checked={reduceMotion}
                data-testid="reduce-motion"
                aria-labelledby="reduce-motion-label"
                onCheckedChange={setReduceMotion}
              />
            </label>
          </div>
        </section>
      </div>
    </section>
  );
}
