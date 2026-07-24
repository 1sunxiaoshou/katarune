import "./character-fonts.css";
import {
  ArrowLeftIcon,
  ImagePlusIcon,
  SettingsIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FocusEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
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
import { ProviderLogo } from "@/components/provider-logo";
import type {
  Character,
  ModelConfig,
  ProviderConfig,
  UpdateCharacterRequest,
} from "../../../shared/ipc";
import { assetUrl } from "../../../shared/ipc";
import { useCharacterSession } from "./CharacterSessionProvider";
import { CharacterList } from "./CharacterList";

const NO_MODEL_ID = "__katarune_no_model__";
const NO_MODEL_OPTION: ModelOption = {
  id: NO_MODEL_ID,
  name: "暂不选择模型",
};

interface CharacterPageProps {
  readonly onClose: () => void;
  readonly onOpenSettings: () => void;
}

type SaveState =
  | { readonly status: "idle"; readonly message: string }
  | { readonly status: "dirty"; readonly message: string }
  | { readonly status: "saving"; readonly message: string }
  | { readonly status: "saved"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

interface CharacterEditorProps {
  readonly character: Character;
  readonly models: readonly ModelConfig[];
  readonly providers: readonly ProviderConfig[];
  readonly onCharacterUpdated: (request: UpdateCharacterRequest) => Promise<Character>;
  readonly onPortraitImport: () => Promise<void>;
  readonly onOpenSettings: () => void;
}

function CharacterEditor({
  character,
  models,
  providers,
  onCharacterUpdated,
  onPortraitImport,
  onOpenSettings,
}: CharacterEditorProps): React.JSX.Element {
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
  const [saveState, setSaveState] = useState<SaveState>({
    status: "idle",
    message: "修改会在离开输入框时自动保存",
  });
  const availableProviderIds = useMemo(
    () => new Set(providers.filter((provider) => provider.enabled).map((provider) => provider.id)),
    [providers],
  );
  const availableModels = useMemo(
    () =>
      models.filter(
        (model) =>
          model.enabled &&
          model.modelType === "languageModel" &&
          availableProviderIds.has(model.providerConfigId),
      ),
    [availableProviderIds, models],
  );
  const currentModelAvailable =
    character.modelConfigId === null ||
    availableModels.some((model) => model.id === character.modelConfigId);

  const persist = useCallback(
    async (request: UpdateCharacterRequest): Promise<void> => {
      setSaveState({ status: "saving", message: "正在保存…" });
      try {
        await onCharacterUpdated(request);
        setSaveState({ status: "saved", message: "已保存" });
      } catch (error) {
        setSaveState({
          status: "error",
          message: error instanceof Error ? error.message : "保存失败，请重试。",
        });
      }
    },
    [onCharacterUpdated],
  );

  const saveName = (event: FocusEvent<HTMLInputElement>): void => {
    const normalized = event.currentTarget.value.trim();
    if (normalized.length === 0) {
      setName(character.name);
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

  const groupedModels = useMemo(() => {
    return providers
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
      .filter((group) => group.options.length > 0);
  }, [availableModels, availableProviderIds, providers]);
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
      NO_MODEL_OPTION,
      ...(unavailableModelOption === null ? [] : [unavailableModelOption]),
      ...groupedModels.flatMap((group) => group.options),
    ],
    [groupedModels, unavailableModelOption],
  );

  return (
    <>
      <section className="character-copy-panel" aria-label="角色资料">
        <div className="character-name-block">
          <label htmlFor="character-name">名称 / NAME</label>
          <div className="character-name-editor">
            <input
              id="character-name"
              data-testid="character-name"
              maxLength={50}
              value={name}
              onBlur={saveName}
              onChange={(event) => {
                setName(event.target.value);
                setSaveState({ status: "dirty", message: "已修改，离开输入框后保存" });
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
                  <ModelSelectorItem model={NO_MODEL_OPTION} />
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
              setSaveState({ status: "dirty", message: "已修改，离开输入框后保存" });
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

      <section className="character-art-panel" aria-label="角色立绘">
        <div className="character-art">
          {portrait !== null && (
            <img
              alt={`${character.name}的立绘`}
              src={portrait}
              onError={() => setPortraitFailed(true)}
            />
          )}
        </div>
        <Button
          className="character-portrait-button"
          data-testid="character-portrait-import"
          type="button"
          variant="outline"
          onClick={() => void onPortraitImport()}
        >
          <ImagePlusIcon aria-hidden="true" />
          {portrait === null ? "导入立绘" : "更换立绘"}
        </Button>
      </section>
    </>
  );
}

export function CharacterPage({
  onClose,
  onOpenSettings,
}: CharacterPageProps): React.JSX.Element {
  const { activeCharacter, setActiveCharacter } = useCharacterSession();
  const [characters, setCharacters] = useState<readonly Character[]>([]);
  const [models, setModels] = useState<readonly ModelConfig[]>([]);
  const [providers, setProviders] = useState<readonly ProviderConfig[]>([]);
  const [selectedId, setSelectedId] = useState<string>(activeCharacter.id);
  const [error, setError] = useState<string | null>(null);
  const [exitError, setExitError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.katarune.listCharacters(),
      window.katarune.listModelConfigs(),
      window.katarune.listProviderConfigs(),
    ])
      .then(([characterResult, modelResult, providerResult]) => {
        if (!active) return;
        setCharacters(characterResult.characters);
        setModels(modelResult.modelConfigs);
        setProviders(providerResult.providerConfigs);
        const activeExists = characterResult.characters.some(
          (character) => character.id === activeCharacter.id,
        );
        if (!activeExists && characterResult.characters[0] !== undefined) {
          setSelectedId(characterResult.characters[0].id);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "无法读取角色配置。");
        }
      });
    return () => {
      active = false;
    };
  }, [activeCharacter.id]);

  const selectedCharacter =
    characters.find((character) => character.id === selectedId) ?? characters[0];

  const updateCharacter = useCallback(
    async (request: UpdateCharacterRequest): Promise<Character> => {
      const updated = await window.katarune.updateCharacter(request);
      setCharacters((current) =>
        current.map((character) => (character.id === updated.id ? updated : character)),
      );
      return updated;
    },
    [],
  );

  const importPortrait = useCallback(async (): Promise<void> => {
    if (selectedCharacter === undefined) return;
    const result = await window.katarune.importCharacterPortrait({ id: selectedCharacter.id });
    if (result.canceled || result.character === null) return;
    setCharacters((current) =>
      current.map((character) =>
        character.id === result.character?.id ? result.character : character,
      ),
    );
  }, [selectedCharacter]);

  const leave = useCallback(
    async (destination: "chat" | "settings"): Promise<void> => {
      if (selectedCharacter === undefined) return;
      setExitError(null);
      try {
        await setActiveCharacter(selectedCharacter.id);
        if (destination === "chat") onClose();
        else onOpenSettings();
      } catch (leaveError) {
        setExitError(
          leaveError instanceof Error ? leaveError.message : "切换角色失败，请重试。",
        );
      }
    },
    [onClose, onOpenSettings, selectedCharacter, setActiveCharacter],
  );

  return (
    <main className="character-studio" data-testid="character-page" id="main-content">
      <header className="character-header">
        <TooltipIconButton
          className="character-back size-8 rounded-md active:scale-100"
          data-testid="character-back"
          tooltip="返回聊天"
          onClick={() => void leave("chat")}
        >
          <ArrowLeftIcon aria-hidden="true" />
        </TooltipIconButton>
        <span className="character-header-star" aria-hidden="true">✦</span>
        <h1>角色图鉴</h1>
        <span>CHARACTER GALLERY</span>
        <div className="character-header-line" aria-hidden="true" />
        <span className="character-page-count">
          {selectedCharacter === undefined
            ? "00"
            : String(
                Math.max(
                  1,
                  characters.findIndex((character) => character.id === selectedCharacter.id) + 1,
                ),
              ).padStart(2, "0")}
          {" / "}
          {String(characters.length).padStart(2, "0")}
        </span>
      </header>

      {error !== null ? (
        <div className="character-page-error" role="alert">
          <p>{error}</p>
          <Button variant="outline" onClick={onClose}>返回聊天</Button>
        </div>
      ) : selectedCharacter === undefined ? (
        <div className="character-page-loading" role="status">正在读取角色配置……</div>
      ) : (
        <div className="character-layout">
          <CharacterEditor
            key={selectedCharacter.id}
            character={selectedCharacter}
            models={models}
            providers={providers}
            onCharacterUpdated={updateCharacter}
            onOpenSettings={() => void leave("settings")}
            onPortraitImport={importPortrait}
          />
          <CharacterList
            characters={characters}
            selectedId={selectedCharacter.id}
            onSelect={setSelectedId}
          />
          {exitError !== null && (
            <p className="character-exit-error" role="alert">{exitError}</p>
          )}
        </div>
      )}
    </main>
  );
}
