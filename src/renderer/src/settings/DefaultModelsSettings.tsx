import { selectionCopy } from "@/components/model-selection-copy";
import { useState } from "react";
import { parseSpeechModelSettings, type UpdateAppSettingsRequest } from "../../../shared/ipc";
import type { ModelOption } from "@/components/model-selector";
import { ProviderLogo } from "@/components/provider-logo";
import { SpeechVoicePicker } from "../speech/SpeechVoicePicker";
import { notify } from "../notifications";
import { useApplicationSettings } from "./ApplicationSettingsProvider";
import { ModelChoice } from "./ModelChoice";
import { errorMessage, type SettingsDataState } from "./settingsState";

const NONE = "__katarune_no_default_model__";

export function DefaultModelsSettings({ dataState, onOpenModels }: { dataState: SettingsDataState; onOpenModels: () => void }): React.JSX.Element {
  const { appSettings, updateDefaults } = useApplicationSettings();
  const [saving, setSaving] = useState(false);
  const models = dataState.status === "ready" ? dataState.models : [];
  const optionsFor = (type: "languageModel" | "speechModel", selected: string | null): ModelOption[] => [
    { id: NONE, name: selectionCopy.modelPlaceholder, placeholder: true },
    ...models.filter((model) => model.modelType === type && (model.id === selected ||
      (dataState.status === "ready" && dataState.availableModelIds.has(model.id))))
      .map((model) => {
        const provider = dataState.status === "ready" ? dataState.providers.find((item) => item.id === model.providerConfigId) : undefined;
        const unavailable = dataState.status !== "ready" || !dataState.availableModelIds.has(model.id);
        return { id: model.id, name: model.displayName ?? model.modelId,
          description: unavailable ? selectionCopy.unavailable : provider?.displayName ?? model.modelId,
          disabled: unavailable,
          ...(provider ? { icon: <ProviderLogo className="size-3.5" providerType={provider.providerType} /> } : {}),
          keywords: [model.modelId, provider?.displayName ?? ""] };
      }),
    ...(selected && !models.some((model) => model.id === selected && model.modelType === type)
      ? [{ id: selected, name: selectionCopy.unavailable, disabled: true }] : []),
  ];
  const save = async (request: UpdateAppSettingsRequest) => {
    setSaving(true);
    try { await updateDefaults(request); }
    catch (error) { notify({ level: "error", message: errorMessage(error, "无法更新默认模型。"), dedupeKey: "default-model-error" }); }
    finally { setSaving(false); }
  };
  const speechModel = models.find((model) => model.id === appSettings.defaultSpeechModelConfigId);
  const hasModels = (type: string) => dataState.status === "ready" && models.some((model) => model.modelType === type && dataState.availableModelIds.has(model.id));
  const disabled = saving || dataState.status !== "ready";
  return <div className="grid w-full gap-1">
    <div className="grid min-h-14 items-center gap-3 py-2 sm:grid-cols-[6rem_minmax(0,1fr)]">
      <span className="text-sm font-medium">对话</span>
      <div className="w-full min-w-0 max-w-[17rem] justify-self-end">
      <ModelChoice label="默认对话模型" testId="default-language-model" disabled={disabled} available={hasModels("languageModel")} onOpenSettings={onOpenModels}
        options={optionsFor("languageModel", appSettings.defaultLanguageModelConfigId)} value={appSettings.defaultLanguageModelConfigId ?? NONE}
        onChange={(value) => void save({ defaultLanguageModelConfigId: value === NONE ? null : value })} />
      </div>
    </div>
    <div className="grid min-h-14 items-center gap-3 pt-2 pb-1 sm:grid-cols-[6rem_minmax(0,1fr)]">
      <span className="text-sm font-medium">语音合成</span>
      <div className="grid w-full min-w-0 max-w-[17rem] justify-self-end grid-cols-1 items-start gap-2">
        <ModelChoice label="默认语音合成模型" testId="default-speech-model" disabled={disabled} available={hasModels("speechModel")} onOpenSettings={onOpenModels}
          options={optionsFor("speechModel", appSettings.defaultSpeechModelConfigId)} value={appSettings.defaultSpeechModelConfigId ?? NONE}
          onChange={(value) => {
            const model = models.find((item) => item.id === value);
            void save({ defaultSpeechModelConfigId: value === NONE ? null : value,
              defaultSpeechVoice: model ? parseSpeechModelSettings(model.settings)?.defaultVoiceId ?? null : null });
          }} />
      </div>
    </div>
    <div className="grid min-h-12 items-center gap-3 pb-2 sm:grid-cols-[6rem_minmax(0,1fr)]">
      <span className="pl-4 text-sm font-medium text-muted-foreground">音色</span>
      <div className="w-full min-w-0 max-w-[17rem] justify-self-end">
        <SpeechVoicePicker key={speechModel?.id ?? "none"} model={speechModel} value={appSettings.defaultSpeechVoice}
          disabled={disabled || !speechModel} testId="default-speech-voice" onChange={(voice) => void save({ defaultSpeechVoice: voice })} />
      </div>
    </div>
    <div className="grid min-h-14 items-center gap-3 py-2 sm:grid-cols-[6rem_minmax(0,1fr)]">
      <span className="text-sm font-medium">语音识别</span>
      <div className="w-full min-w-0 max-w-[17rem] justify-self-end">
      <ModelChoice label="全局语音识别模型" testId="default-asr-model" disabled={disabled}
        options={[{ id: "sensevoice-small-int8", name: "SenseVoiceSmall INT8" }]}
        value={appSettings.defaultAsrModel ?? "sensevoice-small-int8"} onChange={() => void save({ defaultAsrModel: "sensevoice-small-int8" })} />
      </div>
    </div>
  </div>;
}
