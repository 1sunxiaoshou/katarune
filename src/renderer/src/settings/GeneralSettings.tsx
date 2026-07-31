import { useMemo, useState } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import {
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorRoot,
  ModelSelectorSearch,
  ModelSelectorTrigger,
  type ModelOption,
} from "@/components/model-selector";
import { Switch } from "@/components/ui/switch";
import {
  Tabs,
  TabsIndicator,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { notify } from "../notifications";
import { useApplicationSettings } from "./ApplicationSettingsProvider";
import { errorMessage, type SettingsDataState } from "./settingsState";

const NO_DEFAULT_MODEL_ID = "__katarune_no_default_model__";
const NO_DEFAULT_MODEL_OPTION: ModelOption = {
  id: NO_DEFAULT_MODEL_ID,
  name: "未设置",
};

interface GeneralSettingsProps {
  readonly dataState: SettingsDataState;
}

function SettingCopy({
  description,
  id,
  title,
}: {
  readonly description: string;
  readonly id: string;
  readonly title: string;
}): React.JSX.Element {
  return (
    <span className="grid min-w-0 gap-0.5">
      <span className="text-sm font-medium" id={id}>{title}</span>
      <span className="text-xs leading-5 text-muted-foreground">{description}</span>
    </span>
  );
}

const settingRowClassName =
  "grid min-h-16 items-center gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto]";

export function GeneralSettings({
  dataState,
}: GeneralSettingsProps): React.JSX.Element {
  const {
    appSettings,
    autoReadReplies,
    reduceMotion,
    setAutoReadReplies,
    setReduceMotion,
    setTheme,
    theme,
    updateDefaultLanguageModel,
  } = useApplicationSettings();
  const [savingModel, setSavingModel] = useState(false);

  const availableModels = useMemo(
    () =>
      dataState.status === "ready"
        ? dataState.models.filter(
            (model) =>
              model.modelType === "languageModel" &&
              dataState.availableModelIds.has(model.id),
          )
        : [],
    [dataState],
  );
  const groupedModels = useMemo(
    () =>
      dataState.status === "ready"
        ? dataState.providers
            .map((provider) => ({
              provider,
              options: availableModels
                .filter((model) => model.providerConfigId === provider.id)
                .map<ModelOption>((model) => ({
                  id: model.id,
                  name: model.displayName ?? model.modelId,
                  description: model.modelId,
                  icon: (
                    <ProviderLogo
                      className="size-3.5"
                      providerType={provider.providerType}
                    />
                  ),
                  keywords: [
                    provider.displayName,
                    provider.providerType,
                    model.modelId,
                  ],
                })),
            }))
            .filter((group) => group.options.length > 0)
        : [],
    [availableModels, dataState],
  );
  const currentDefaultAvailable =
    appSettings.defaultLanguageModelConfigId === null ||
    availableModels.some(
      (model) => model.id === appSettings.defaultLanguageModelConfigId,
    );
  const currentDefaultModel =
    dataState.status === "ready"
      ? dataState.models.find(
          (model) => model.id === appSettings.defaultLanguageModelConfigId,
        )
      : undefined;
  const unavailableDefaultOption =
    !currentDefaultAvailable &&
    appSettings.defaultLanguageModelConfigId !== null
      ? {
          id: appSettings.defaultLanguageModelConfigId,
          name:
            currentDefaultModel?.displayName ??
            currentDefaultModel?.modelId ??
            "默认模型",
          description: "当前不可用",
          disabled: true,
        } satisfies ModelOption
      : null;
  const modelOptions = [
    NO_DEFAULT_MODEL_OPTION,
    ...(unavailableDefaultOption === null ? [] : [unavailableDefaultOption]),
    ...groupedModels.flatMap((group) => group.options),
  ];

  const selectDefaultModel = async (value: string): Promise<void> => {
    const modelConfigId = value === NO_DEFAULT_MODEL_ID ? null : value;
    setSavingModel(true);
    try {
      await updateDefaultLanguageModel(modelConfigId);
      notify({
        level: "success",
        message:
          modelConfigId === null
            ? "已清除默认语言模型。"
            : "默认语言模型已更新。",
        dedupeKey: "default-language-model-updated",
      });
    } catch (error) {
      notify({
        level: "error",
        message: errorMessage(error, "无法更新默认语言模型。"),
        dedupeKey: "default-language-model-error",
      });
    } finally {
      setSavingModel(false);
    }
  };

  return (
    <section className="grid min-h-[31rem] w-full content-start gap-7 border bg-card p-6 md:p-8 lg:h-full lg:min-h-0" aria-labelledby="general-settings-title" data-testid="general-settings">
      <div className="grid gap-1.5">
        <h2 className="text-2xl font-semibold tracking-tight" id="general-settings-title">常规</h2>
        <p className="text-sm leading-6 text-muted-foreground">设置言奏在此设备上的默认行为。</p>
      </div>

      <div className="grid gap-1">
        <div className={settingRowClassName}>
          <SettingCopy
            id="default-language-model-label"
            title="默认模型"
            description="角色未选择模型时使用。"
          />
          <ModelSelectorRoot
            models={modelOptions}
            value={appSettings.defaultLanguageModelConfigId ?? NO_DEFAULT_MODEL_ID}
            onValueChange={(value) => void selectDefaultModel(value)}
          >
            <ModelSelectorTrigger
              aria-labelledby="default-language-model-label"
              className="w-full justify-end px-2 sm:w-64"
              disabled={savingModel || dataState.status !== "ready"}
              data-testid="default-language-model"
              variant="ghost"
            />
            <ModelSelectorContent align="end" searchable>
              <ModelSelectorSearch placeholder="搜索模型…" />
              <ModelSelectorList>
                <ModelSelectorEmpty>没有可用的语言模型</ModelSelectorEmpty>
                <ModelSelectorGroup heading="应用">
                  <ModelSelectorItem model={NO_DEFAULT_MODEL_OPTION} />
                  {unavailableDefaultOption !== null && (
                    <ModelSelectorItem model={unavailableDefaultOption} />
                  )}
                </ModelSelectorGroup>
                {groupedModels.map(({ provider, options }) => (
                  <ModelSelectorGroup heading={provider.displayName} key={provider.id}>
                    {options.map((model) => (
                      <ModelSelectorItem model={model} key={model.id} />
                    ))}
                  </ModelSelectorGroup>
                ))}
              </ModelSelectorList>
            </ModelSelectorContent>
          </ModelSelectorRoot>
        </div>

        <div className={settingRowClassName}>
          <SettingCopy
            id="theme-setting-label"
            title="主题"
            description="选择界面的明暗外观。"
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

        <label className={`${settingRowClassName} cursor-pointer`} htmlFor="auto-read-replies">
          <SettingCopy
            id="auto-read-replies-label"
            title="自动朗读回复"
            description="角色配置了声音时，自动朗读新完成的回复。"
          />
          <Switch
            id="auto-read-replies"
            checked={autoReadReplies}
            data-testid="auto-read-replies"
            aria-labelledby="auto-read-replies-label"
            onCheckedChange={setAutoReadReplies}
          />
        </label>

        <label className={`${settingRowClassName} cursor-pointer`} htmlFor="reduce-motion">
          <SettingCopy
            id="reduce-motion-label"
            title="减少动态效果"
            description="收起非必要的动画；系统偏好始终优先。"
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
  );
}
