import { selectionCopy } from "@/components/model-selection-copy";
import "./character-fonts.css";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
} from "react";
import { ProviderLogo } from "@/components/provider-logo";
import { Textarea } from "@/components/ui/textarea";
import {
  ModelSelectorSetupButton,
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
  type Character,
  type CreateCharacterRequest,
  type ModelConfig,
  type ProviderConfig,
  type UpdateCharacterRequest,
} from "../../../shared/ipc";
import { useApplicationSettings } from "../settings/ApplicationSettingsProvider";
import { defaultVoiceForModel } from "../../../shared/speechSelection";
import { SpeechVoicePicker } from "../speech/SpeechVoicePicker";
import { CharacterPortraitPanel } from "./CharacterPortraitPanel";

const NO_MODEL_ID = "__katarune_no_model__";
const DEFAULT_SPEECH_ID = "__default_speech__";
export const NEW_CHARACTER_NAME = "未命名角色";

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
    useDefaultSpeechModel: character.useDefaultSpeechModel,
    useDefaultSpeechVoice: character.useDefaultSpeechVoice,
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
  const [selectedSpeechModelId, setSelectedSpeechModelId] = useState<string | null>(
    character.useDefaultSpeechModel ? DEFAULT_SPEECH_ID : character.speechModelConfigId,
  );
  useEffect(() => {
    setSelectedSpeechModelId(character.useDefaultSpeechModel ? DEFAULT_SPEECH_ID : character.speechModelConfigId);
  }, [character.useDefaultSpeechModel, character.speechModelConfigId]);
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
  const defaultLanguageModelOption: ModelOption = {
    id: NO_MODEL_ID,
    name: "使用默认",
    placeholder: appSettings.defaultLanguageModelConfigId === null,
  };
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

  const pendingSaves = useRef(new Set<Promise<unknown>>());
  const saveFailed = useRef(false);
  const openingSettings = useRef(false);
  const openModelSettings = async (): Promise<void> => {
    if (openingSettings.current) return;
    openingSettings.current = true;
    try {
      await Promise.allSettled([...pendingSaves.current]);
      if (!saveFailed.current) onOpenSettings();
    } finally { openingSettings.current = false; }
  };

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
          ...(request.useDefaultSpeechModel === undefined ? {} : { useDefaultSpeechModel: request.useDefaultSpeechModel }),
          ...(request.useDefaultSpeechVoice === undefined ? {} : { useDefaultSpeechVoice: request.useDefaultSpeechVoice }),
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
      const saving = onCharacterUpdated(request);
      pendingSaves.current.add(saving);
      try {
        await saving;
        saveFailed.current = false;
        setSaveState({ status: "saved", message: "已保存" });
      } catch (error) {
        saveFailed.current = true;
        setSaveState({
          status: "error",
          message:
            error instanceof Error ? error.message : "保存失败，请重试。",
        });
      } finally {
        pendingSaves.current.delete(saving);
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
            name: selectionCopy.unavailable,
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
            name: selectionCopy.unavailable,
            description:
              "该模型已被删除、禁用、改变类别，或所属供应商不可用",
            disabled: true,
          }
        : null,
    [character.speechModelConfigId, currentSpeechModelAvailable],
  );
  const defaultSpeechModelOption: ModelOption = {
    id: DEFAULT_SPEECH_ID,
    name: "使用默认",
  };
  const speechModelOptions = [defaultSpeechModelOption,
    ...(unavailableSpeechModelOption ? [unavailableSpeechModelOption] : []),
    ...groupedSpeechModels.flatMap((group) => group.options)];
  const effectiveSpeechModelId = selectedSpeechModelId === DEFAULT_SPEECH_ID
    ? appSettings.defaultSpeechModelConfigId : selectedSpeechModelId;
  const selectedSpeechModel = models.find((model) => model.id === effectiveSpeechModelId);
  const defaultVoice = defaultVoiceForModel(selectedSpeechModel, appSettings);
  const voiceName = (id: string | null) => selectedSpeechModel
    ? parseSpeechModelMetadata(selectedSpeechModel.metadata)?.voices?.find((voice) => voice.id === id)?.displayName ?? id
    : id;
  const voiceNeedsConfirmation = !character.useDefaultSpeechVoice && character.speechVoice !== null
    && character.speechModelConfigId !== effectiveSpeechModelId;

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
          {availableModels.length === 0 ? <ModelSelectorSetupButton id="character-model" data-testid="character-model" aria-label="对话模型：前往模型设置" warning={!currentModelAvailable} onClick={openModelSettings} /> : (
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
              title={character.modelConfigId === null ? (appSettings.defaultLanguageModelConfigId === null ? "尚未设置默认模型" : "使用默认模型") : undefined}
              data-model-id={character.modelConfigId ?? ""}
              data-testid="character-model"
            />
            <ModelSelectorContent searchable={availableModels.length > 6}>
              {availableModels.length > 6 && <ModelSelectorSearch placeholder="搜索模型…" />}
              <ModelSelectorList>
                <ModelSelectorEmpty />
                <ModelSelectorGroup>
                  <ModelSelectorItem model={defaultLanguageModelOption} />
                  {unavailableModelOption !== null && (
                    <ModelSelectorItem model={unavailableModelOption} />
                  )}
                </ModelSelectorGroup>
                {groupedModels.map(({ provider, options }) => (
                  <ModelSelectorGroup
                    key={provider.id}
                    heading={groupedModels.length > 1 ? provider.displayName : undefined}
                  >
                    {options.map((option) => (
                      <ModelSelectorItem key={option.id} model={option} />
                    ))}
                  </ModelSelectorGroup>
                ))}
              </ModelSelectorList>
            </ModelSelectorContent>
          </ModelSelectorRoot>
          )}
        </div>

        <div className="character-field">
          <label htmlFor="character-speech-model">
            <span className="character-star" aria-hidden="true">✦</span>
            声音 <small>/ SPEECH MODEL</small>
          </label>
          <div className="grid min-w-0 grid-cols-1 items-start gap-2">
          {availableSpeechModels.length === 0 ? <ModelSelectorSetupButton id="character-speech-model" data-testid="character-speech-model" aria-label="语音模型：前往模型设置" warning={!currentSpeechModelAvailable} onClick={openModelSettings} /> : (
          <ModelSelectorRoot
            models={speechModelOptions}
            value={selectedSpeechModelId ?? NO_MODEL_ID}
            onValueChange={(value) => {
              const inherits = value === DEFAULT_SPEECH_ID;
              setSelectedSpeechModelId(value);
              void persist({ id: character.id, useDefaultSpeechModel: inherits,
                useDefaultSpeechVoice: true,
                speechModelConfigId: inherits ? null : value, speechVoice: null });
            }}
          >
            <ModelSelectorTrigger
              id="character-speech-model"
              className="w-full"
              title={selectedSpeechModelId === DEFAULT_SPEECH_ID && appSettings.defaultSpeechModelConfigId === null ? "尚未设置默认模型" : speechModelOptions.find((option) => option.id === (selectedSpeechModelId ?? NO_MODEL_ID))?.name}
              data-model-id={selectedSpeechModelId ?? ""}
              data-testid="character-speech-model"
            />
            <ModelSelectorContent searchable={availableSpeechModels.length > 6}>
              {availableSpeechModels.length > 6 && <ModelSelectorSearch placeholder="搜索语音模型…" />}
              <ModelSelectorList>
                <ModelSelectorEmpty />
                <ModelSelectorGroup>
                  <ModelSelectorItem model={defaultSpeechModelOption} />
                  {unavailableSpeechModelOption !== null && (
                    <ModelSelectorItem model={unavailableSpeechModelOption} />
                  )}
                </ModelSelectorGroup>
                {groupedSpeechModels.map(({ provider, options }) => (
                  <ModelSelectorGroup key={provider.id} heading={groupedSpeechModels.length > 1 ? provider.displayName : undefined}>
                    {options.map((option) => (
                      <ModelSelectorItem key={option.id} model={option} />
                    ))}
                  </ModelSelectorGroup>
                ))}
              </ModelSelectorList>
            </ModelSelectorContent>
          </ModelSelectorRoot>
          )}
          <SpeechVoicePicker key={effectiveSpeechModelId ?? "none"} model={selectedSpeechModel}
            testId="character-speech-voice" disabled={!selectedSpeechModel || selectedSpeechModelId === null}
            defaultName={voiceName(defaultVoice) ?? selectionCopy.defaultVoiceMissing}
            value={character.useDefaultSpeechVoice ? null : character.speechVoice}
            onChange={(voice) => void persist({ id: character.id,
              useDefaultSpeechModel: selectedSpeechModelId === DEFAULT_SPEECH_ID,
              useDefaultSpeechVoice: voice === null,
              speechModelConfigId: effectiveSpeechModelId, speechVoice: voice })} />
          </div>
          {(selectedSpeechModelId === DEFAULT_SPEECH_ID || character.useDefaultSpeechVoice) && selectedSpeechModelId !== null && (
            <p className="text-xs leading-5 text-muted-foreground break-words">
              当前：{selectedSpeechModel?.displayName ?? selectedSpeechModel?.modelId ?? selectionCopy.modelPlaceholder}
              {" · "}{voiceName(character.useDefaultSpeechVoice ? defaultVoice : character.speechVoice) ?? selectionCopy.voicePlaceholder}
            </p>
          )}
          {voiceNeedsConfirmation && <p className="text-xs text-destructive">默认模型已变更，请重新选择音色或使用默认音色。</p>}
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
