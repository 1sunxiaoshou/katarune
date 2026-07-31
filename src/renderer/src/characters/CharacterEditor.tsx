import "./character-fonts.css";
import { SettingsIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
} from "react";
import { ProviderLogo } from "@/components/provider-logo";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import {
  assetUrl,
  parseSpeechModelMetadata,
  parseSpeechModelSettings,
  type Character,
  type CreateCharacterRequest,
  type ModelConfig,
  type ProviderConfig,
  type UpdateCharacterRequest,
} from "../../../shared/ipc";
import { useApplicationSettings } from "../settings/ApplicationSettingsProvider";
import { CharacterPortraitPanel } from "./CharacterPortraitPanel";

const NO_MODEL_ID = "__katarune_no_model__";
const NO_VOICE_ID = "__katarune_no_voice__";
export const NEW_CHARACTER_NAME = "未命名角色";
const NO_SPEECH_MODEL_OPTION: ModelOption = {
  id: NO_MODEL_ID,
  name: "未选择声音模型",
};
const NO_VOICE_OPTION: ModelOption = {
  id: NO_VOICE_ID,
  name: "请选择音色",
};

function speechDefaultVoice(
  modelConfigId: string | null,
  models: readonly ModelConfig[],
): string | null {
  if (modelConfigId === null) return null;
  const model = models.find((candidate) => candidate.id === modelConfigId);
  if (model === undefined) return null;
  if (model.modelType !== "speechModel") return null;
  return parseSpeechModelSettings(model.settings)?.defaultVoiceId ?? null;
}

export interface CharacterDeleteCandidate {
  readonly character: Character;
  readonly draft: boolean;
  readonly threadCount: number;
}

export function draftRequest(character: Character): CreateCharacterRequest {
  return {
    name: character.name.trim() || NEW_CHARACTER_NAME,
    modelConfigId: character.modelConfigId,
    speechModelConfigId: character.speechModelConfigId,
    speechVoice: character.speechVoice,
    systemPrompt: character.systemPrompt,
  };
}

export function draftHasChanges(character: Character): boolean {
  const request = draftRequest(character);
  return (
    request.name !== NEW_CHARACTER_NAME ||
    request.modelConfigId !== null ||
    request.speechModelConfigId !== null ||
    request.systemPrompt !== ""
  );
}

type SaveState =
  | { readonly status: "idle"; readonly message: string }
  | { readonly status: "dirty"; readonly message: string }
  | { readonly status: "saving"; readonly message: string }
  | { readonly status: "saved"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

interface CharacterEditorProps {
  readonly availableModelIds: ReadonlySet<string>;
  readonly character: Character;
  readonly draft: boolean;
  readonly focusName: boolean;
  readonly models: readonly ModelConfig[];
  readonly onFocusNameHandled: () => void;
  readonly providers: readonly ProviderConfig[];
  readonly onCharacterUpdated: (
    request: UpdateCharacterRequest,
  ) => Promise<Character>;
  readonly onDraftUpdated: (
    request: Partial<CreateCharacterRequest>,
  ) => void;
  readonly onPortraitEdit: () => Promise<void>;
  readonly onOpenSettings: () => void;
}

export function CharacterEditor({
  availableModelIds,
  character,
  draft,
  focusName,
  models,
  onFocusNameHandled,
  providers,
  onCharacterUpdated,
  onDraftUpdated,
  onPortraitEdit,
  onOpenSettings,
}: CharacterEditorProps): React.JSX.Element {
  const { appSettings } = useApplicationSettings();
  const nameInput = useRef<HTMLInputElement>(null);
  const [portraitFailed, setPortraitFailed] = useState(false);
  useEffect(() => {
    setPortraitFailed(false);
  }, [character.portraitAssetId]);
  const portrait =
    character.portraitAssetId === null || portraitFailed
      ? null
      : assetUrl(character.portraitAssetId);
  const [name, setName] = useState(character.name);
  const [systemPrompt, setSystemPrompt] = useState(character.systemPrompt);
  const [selectedSpeechModelId, setSelectedSpeechModelId] = useState(
    character.speechModelConfigId,
  );
  const [speechVoice, setSpeechVoice] = useState(
    character.speechVoice ??
      speechDefaultVoice(character.speechModelConfigId, models) ??
      "",
  );
  useEffect(() => {
    setSelectedSpeechModelId(character.speechModelConfigId);
    setSpeechVoice(
      character.speechVoice ??
        speechDefaultVoice(
          character.speechModelConfigId,
          models,
        ) ??
        "",
    );
  }, [
    character.speechModelConfigId,
    character.speechVoice,
    models,
    providers,
  ]);
  const [saveState, setSaveState] = useState<SaveState>({
    status: "idle",
    message: draft
      ? "未修改的草稿会在离开角色时丢弃"
      : "修改会在离开输入框时自动保存",
  });
  useEffect(() => {
    if (!focusName) return;
    const frame = requestAnimationFrame(() => {
      nameInput.current?.focus();
      nameInput.current?.select();
      onFocusNameHandled();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusName, onFocusNameHandled]);
  const availableProviderIds = useMemo(
    () =>
      new Set(
        providers
          .filter((provider) => provider.enabled)
          .map((provider) => provider.id),
      ),
    [providers],
  );
  const availableModels = useMemo(
    () =>
      models.filter(
        (model) =>
          model.enabled &&
          model.modelType === "languageModel" &&
          availableProviderIds.has(model.providerConfigId) &&
          availableModelIds.has(model.id),
      ),
    [availableModelIds, availableProviderIds, models],
  );
  const currentModelAvailable =
    character.modelConfigId === null ||
    availableModels.some((model) => model.id === character.modelConfigId);
  const defaultLanguageModelOption = useMemo<ModelOption>(() => {
    const defaultModelId = appSettings.defaultLanguageModelConfigId;
    if (defaultModelId === null) {
      return {
        id: NO_MODEL_ID,
        name: "应用默认",
        description: "尚未配置",
      };
    }
    const defaultModel = models.find((model) => model.id === defaultModelId);
    const defaultModelName =
      defaultModel?.displayName ?? defaultModel?.modelId ?? "默认模型";
    const available = availableModels.some((model) => model.id === defaultModelId);
    return {
      id: NO_MODEL_ID,
      name: "应用默认",
      description: available
        ? `已配置：${defaultModelName}`
        : `已配置但不可用：${defaultModelName}`,
    };
  }, [appSettings.defaultLanguageModelConfigId, availableModels, models]);
  const availableSpeechModels = useMemo(
    () =>
      models.filter(
        (model) =>
          model.modelType === "speechModel" &&
          availableModelIds.has(model.id),
      ),
    [availableModelIds, models],
  );
  const currentSpeechModelAvailable =
    character.speechModelConfigId === null ||
    availableSpeechModels.some(
      (model) => model.id === character.speechModelConfigId,
    );

  const persist = useCallback(
    async (request: UpdateCharacterRequest): Promise<void> => {
      if (draft) {
        onDraftUpdated({
          ...(request.name === undefined ? {} : { name: request.name }),
          ...(request.modelConfigId === undefined
            ? {}
            : { modelConfigId: request.modelConfigId }),
          ...(request.speechModelConfigId === undefined
            ? {}
            : { speechModelConfigId: request.speechModelConfigId }),
          ...(request.speechVoice === undefined
            ? {}
            : { speechVoice: request.speechVoice }),
          ...(request.systemPrompt === undefined
            ? {}
            : { systemPrompt: request.systemPrompt }),
        });
        setSaveState({
          status: "dirty",
          message: "草稿将在离开角色时保存",
        });
        return;
      }
      setSaveState({ status: "saving", message: "正在保存…" });
      try {
        await onCharacterUpdated(request);
        setSaveState({ status: "saved", message: "已保存" });
      } catch (error) {
        setSaveState({
          status: "error",
          message:
            error instanceof Error ? error.message : "保存失败，请重试。",
        });
      }
    },
    [draft, onCharacterUpdated, onDraftUpdated],
  );

  const saveName = (event: FocusEvent<HTMLInputElement>): void => {
    const normalized = event.currentTarget.value.trim();
    if (normalized.length === 0) {
      const fallbackName = draft ? NEW_CHARACTER_NAME : character.name;
      setName(fallbackName);
      if (draft) onDraftUpdated({ name: fallbackName });
      setSaveState({ status: "error", message: "角色名称不能为空。" });
      return;
    }
    if (normalized === character.name) {
      setName(normalized);
      return;
    }
    setName(normalized);
    void persist({ id: character.id, name: normalized });
  };

  const saveSystemPrompt = (): void => {
    if (systemPrompt === character.systemPrompt) return;
    void persist({ id: character.id, systemPrompt });
  };

  const groupedModels = useMemo(
    () =>
      providers
        .filter((provider) => availableProviderIds.has(provider.id))
        .map((provider) => ({
          provider,
          options: availableModels
            .filter((model) => model.providerConfigId === provider.id)
            .map(
              (model): ModelOption => ({
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
              }),
            ),
        }))
        .filter((group) => group.options.length > 0),
    [availableModels, availableProviderIds, providers],
  );
  const unavailableModelOption = useMemo<ModelOption | null>(
    () =>
      !currentModelAvailable && character.modelConfigId !== null
        ? {
            id: character.modelConfigId,
            name: "原模型不可用",
            description: "该模型已被删除、禁用，或所属供应商不可用",
            disabled: true,
          }
        : null,
    [character.modelConfigId, currentModelAvailable],
  );
  const modelOptions = useMemo(
    () => [
      defaultLanguageModelOption,
      ...(unavailableModelOption === null ? [] : [unavailableModelOption]),
      ...groupedModels.flatMap((group) => group.options),
    ],
    [defaultLanguageModelOption, groupedModels, unavailableModelOption],
  );
  const groupedSpeechModels = useMemo(
    () =>
      providers
        .filter((provider) =>
          availableSpeechModels.some(
            (model) => model.providerConfigId === provider.id,
          ),
        )
        .map((provider) => ({
          provider,
          options: availableSpeechModels
            .filter((model) => model.providerConfigId === provider.id)
            .map(
              (model): ModelOption => ({
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
              }),
            ),
        }))
        .filter((group) => group.options.length > 0),
    [availableSpeechModels, providers],
  );
  const unavailableSpeechModelOption = useMemo<ModelOption | null>(
    () =>
      !currentSpeechModelAvailable && character.speechModelConfigId !== null
        ? {
            id: character.speechModelConfigId,
            name: "原声音模型不可用",
            description:
              "该模型已被删除、禁用、改变类别，或所属供应商不可用",
            disabled: true,
          }
        : null,
    [character.speechModelConfigId, currentSpeechModelAvailable],
  );
  const speechModelOptions = useMemo(
    () => [
      NO_SPEECH_MODEL_OPTION,
      ...(unavailableSpeechModelOption === null
        ? []
        : [unavailableSpeechModelOption]),
      ...groupedSpeechModels.flatMap((group) => group.options),
    ],
    [groupedSpeechModels, unavailableSpeechModelOption],
  );
  const selectedSpeechModel = models.find(
    (model) => model.id === selectedSpeechModelId,
  );
  const voiceCatalog =
    selectedSpeechModel?.modelType === "speechModel"
      ? parseSpeechModelMetadata(selectedSpeechModel.metadata)?.voices ?? null
      : null;
  const voiceInCatalog =
    speechVoice.length > 0 &&
    voiceCatalog?.some((voice) => voice.id === speechVoice) === true;
  const voiceOptions = useMemo<ModelOption[]>(
    () => [
      NO_VOICE_OPTION,
      ...(!voiceInCatalog && speechVoice.length > 0
        ? [
            {
              id: speechVoice,
              name: `${speechVoice}（手动 Voice ID）`,
              description: "该 Voice ID 由角色手动配置",
            },
          ]
        : []),
      ...(voiceCatalog ?? []).map((voice) => ({
        id: voice.id,
        name: voice.displayName,
        ...(voice.description === undefined
          ? {}
          : { description: voice.description }),
        keywords: [voice.id, voice.description ?? ""],
      })),
    ],
    [speechVoice, voiceCatalog, voiceInCatalog],
  );

  return (
    <>
      <section className="character-copy-panel" aria-label="角色资料">
        <div className="character-name-block">
          <label htmlFor="character-name">名称 / NAME</label>
          <div className="character-name-editor">
            <input
              ref={nameInput}
              id="character-name"
              data-testid="character-name"
              maxLength={50}
              value={name}
              onBlur={saveName}
              onChange={(event) => {
                setName(event.target.value);
                if (draft) onDraftUpdated({ name: event.target.value });
                setSaveState({
                  status: "dirty",
                  message: draft ? "草稿将在离开角色时保存" : "已修改，离开输入框后保存",
                });
              }}
            />
          </div>
          <div className="character-name-ornament" aria-hidden="true" />
        </div>

        <div className="character-field">
          <label htmlFor="character-model">
            <span className="character-star" aria-hidden="true">✦</span>
            心智 <small>/ MODEL</small>
          </label>
          <ModelSelectorRoot
            models={modelOptions}
            value={character.modelConfigId ?? NO_MODEL_ID}
            onValueChange={(value) => {
              void persist({
                id: character.id,
                modelConfigId: value === NO_MODEL_ID ? null : value,
              });
            }}
          >
            <ModelSelectorTrigger
              id="character-model"
              className="w-full"
              data-model-id={character.modelConfigId ?? ""}
              data-testid="character-model"
            />
            <ModelSelectorContent searchable>
              <ModelSelectorSearch placeholder="搜索模型…" />
              <ModelSelectorList>
                <ModelSelectorEmpty>没有匹配的模型</ModelSelectorEmpty>
                <ModelSelectorGroup heading="角色">
                  <ModelSelectorItem model={defaultLanguageModelOption} />
                  {unavailableModelOption !== null && (
                    <ModelSelectorItem model={unavailableModelOption} />
                  )}
                </ModelSelectorGroup>
                {groupedModels.map(({ provider, options }) => (
                  <ModelSelectorGroup
                    key={provider.id}
                    heading={provider.displayName}
                  >
                    {options.map((option) => (
                      <ModelSelectorItem key={option.id} model={option} />
                    ))}
                  </ModelSelectorGroup>
                ))}
              </ModelSelectorList>
            </ModelSelectorContent>
          </ModelSelectorRoot>
          {availableModels.length === 0 && (
            <button className="character-inline-link" type="button" onClick={onOpenSettings}>
              <SettingsIcon aria-hidden="true" />
              前往模型设置
            </button>
          )}
        </div>

        <div className="character-field">
          <label htmlFor="character-speech-model">
            <span className="character-star" aria-hidden="true">✦</span>
            声音 <small>/ SPEECH MODEL</small>
          </label>
          <ModelSelectorRoot
            models={speechModelOptions}
            value={selectedSpeechModelId ?? NO_MODEL_ID}
            onValueChange={(value) => {
              if (value === NO_MODEL_ID) {
                setSelectedSpeechModelId(null);
                setSpeechVoice("");
                void persist({
                  id: character.id,
                  speechModelConfigId: null,
                  speechVoice: null,
                });
                return;
              }
              const voice = speechDefaultVoice(value, models);
              setSelectedSpeechModelId(value);
              if (voice === null) {
                setSpeechVoice("");
                setSaveState({
                  status: "dirty",
                  message: "请填写 Voice ID 后保存声音模型。",
                });
                return;
              }
              setSpeechVoice(voice);
              void persist({
                id: character.id,
                speechModelConfigId: value,
                speechVoice: voice,
              });
            }}
          >
            <ModelSelectorTrigger
              id="character-speech-model"
              className="w-full"
              data-model-id={selectedSpeechModelId ?? ""}
              data-testid="character-speech-model"
            />
            <ModelSelectorContent searchable>
              <ModelSelectorSearch placeholder="搜索语音模型…" />
              <ModelSelectorList>
                <ModelSelectorEmpty>没有匹配的语音模型</ModelSelectorEmpty>
                <ModelSelectorGroup heading="角色">
                  <ModelSelectorItem model={NO_SPEECH_MODEL_OPTION} />
                  {unavailableSpeechModelOption !== null && (
                    <ModelSelectorItem model={unavailableSpeechModelOption} />
                  )}
                </ModelSelectorGroup>
                {groupedSpeechModels.map(({ provider, options }) => (
                  <ModelSelectorGroup key={provider.id} heading={provider.displayName}>
                    {options.map((option) => (
                      <ModelSelectorItem key={option.id} model={option} />
                    ))}
                  </ModelSelectorGroup>
                ))}
              </ModelSelectorList>
            </ModelSelectorContent>
          </ModelSelectorRoot>
          {selectedSpeechModelId !== null && voiceCatalog !== null && (
            <ModelSelectorRoot
              models={voiceOptions}
              value={speechVoice || NO_VOICE_ID}
              onValueChange={(voice) => {
                if (voice === NO_VOICE_ID || voice === speechVoice) return;
                setSpeechVoice(voice);
                void persist({
                  id: character.id,
                  speechModelConfigId: selectedSpeechModelId,
                  speechVoice: voice,
                });
              }}
            >
              <ModelSelectorTrigger
                className="w-full"
                data-testid="character-speech-voice"
              />
              <ModelSelectorContent searchable>
                <ModelSelectorSearch placeholder="搜索音色…" />
                <ModelSelectorList>
                  <ModelSelectorEmpty>没有匹配的音色</ModelSelectorEmpty>
                  <ModelSelectorGroup heading="音色">
                    {voiceOptions.map((option) => (
                      <ModelSelectorItem key={option.id} model={option} />
                    ))}
                  </ModelSelectorGroup>
                </ModelSelectorList>
              </ModelSelectorContent>
            </ModelSelectorRoot>
          )}
          {selectedSpeechModelId !== null && (
            <Input
              aria-label={
                voiceCatalog === null ? "Voice ID" : "手动 Voice ID"
              }
              data-testid={
                voiceCatalog === null
                  ? "character-speech-voice"
                  : "character-speech-voice-custom"
              }
              maxLength={200}
              placeholder={
                voiceCatalog === null
                  ? "供应商 Voice ID"
                  : "或手动输入 Voice ID"
              }
              value={voiceCatalog !== null && voiceInCatalog ? "" : speechVoice}
              onBlur={(event) => {
                const voice = event.currentTarget.value.trim();
                if (voice.length === 0) {
                  if (voiceCatalog !== null && voiceInCatalog) return;
                  setSpeechVoice(
                    character.speechVoice ??
                      speechDefaultVoice(
                        character.speechModelConfigId,
                        models,
                      ) ??
                      "",
                  );
                  setSaveState({
                    status: "error",
                    message: "Voice ID 不能为空。",
                  });
                  return;
                }
                if (voice === character.speechVoice) return;
                setSpeechVoice(voice);
                void persist({
                  id: character.id,
                  speechModelConfigId: selectedSpeechModelId,
                  speechVoice: voice,
                });
              }}
              onChange={(event) => {
                setSpeechVoice(event.target.value);
                setSaveState({
                  status: "dirty",
                  message: draft
                    ? "草稿将在离开角色时保存"
                    : voiceCatalog === null
                      ? "已修改，离开输入框后保存"
                      : "已输入手动 Voice ID，离开输入框后保存",
                });
              }}
            />
          )}
          {availableSpeechModels.length === 0 && (
            <button className="character-inline-link" type="button" onClick={onOpenSettings}>
              <SettingsIcon aria-hidden="true" />
              前往模型设置
            </button>
          )}
        </div>

        <div className="character-field character-prompt-field">
          <label htmlFor="character-system-prompt">
            <span className="character-star" aria-hidden="true">✦</span>
            人格 <small>/ SYSTEM PROMPT</small>
          </label>
          <Textarea
            id="character-system-prompt"
            data-testid="character-system-prompt"
            maxLength={20_000}
            value={systemPrompt}
            onBlur={saveSystemPrompt}
            onChange={(event) => {
              setSystemPrompt(event.target.value);
              if (draft) onDraftUpdated({ systemPrompt: event.target.value });
              setSaveState({
                status: "dirty",
                message: draft ? "草稿将在离开角色时保存" : "已修改，离开输入框后保存",
              });
            }}
          />
        </div>

        <p className="character-save-state" data-state={saveState.status} role="status">
          <span aria-hidden="true">
            {saveState.status === "saving" ? "◇" : saveState.status === "error" ? "!" : "✦"}
          </span>
          {saveState.message}
        </p>
      </section>

      <CharacterPortraitPanel
        character={character}
        portrait={portrait}
        onEdit={onPortraitEdit}
        onPortraitError={() => setPortraitFailed(true)}
      />
    </>
  );
}
