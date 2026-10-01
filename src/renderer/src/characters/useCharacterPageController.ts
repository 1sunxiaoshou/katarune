import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  type Character,
  type CreateCharacterRequest,
  type ModelConfig,
  type ProviderConfig,
  type UpdateCharacterRequest,
} from "../../../shared/ipc";
import { notify } from "../notifications";
import { DEFAULT_PACKAGE_ID, type CharacterPackage } from "../../../shared/characterPackages";
import {
  draftHasChanges,
  draftRequest,
  NEW_CHARACTER_NAME,
  type CharacterDeleteCandidate,
} from "./CharacterEditor";
import { useCharacterSession } from "./CharacterSessionProvider";

interface UseCharacterPageControllerOptions {
  readonly onClose: () => void;
  readonly onOpenSettings: () => void;
}

export function useCharacterPageController({
  onClose,
  onOpenSettings,
}: UseCharacterPageControllerOptions) {
  const {
    activeCharacter,
    deleteCharacter: deleteCharacterSession,
    setActiveCharacter,
  } = useCharacterSession();
  const [characters, setCharacters] = useState<readonly Character[]>([]);
  const [defaultPackage, setDefaultPackage] = useState<CharacterPackage | null>(null);
  const [draftCharacter, setDraftCharacter] =
    useState<Character | null>(null);
  const [draftOriginId, setDraftOriginId] = useState<string | null>(null);
  const [models, setModels] = useState<readonly ModelConfig[]>([]);
  const [providers, setProviders] = useState<readonly ProviderConfig[]>([]);
  const [availableModelIds, setAvailableModelIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [selectedId, setSelectedId] = useState<string>(
    activeCharacter.id,
  );
  const [focusNameId, setFocusNameId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] =
    useState<CharacterDeleteCandidate | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.katarune.listCharacters(),
      window.katarune.listModelConfigs(),
      window.katarune.listProviderConfigs(),
      window.katarune.listAvailableModels(),
      window.katarune.fetchCharacterPackage({ id: DEFAULT_PACKAGE_ID }),
    ])
      .then(
        ([characterResult, modelResult, providerResult, speechModels, builtin]) => {
          if (!active) return;
          setDefaultPackage(builtin);
          setCharacters(characterResult.characters);
          setModels(modelResult.modelConfigs);
          setProviders(providerResult.providerConfigs);
          setAvailableModelIds(
            new Set(speechModels.modelConfigIds),
          );
          const activeExists = characterResult.characters.some(
            (character) => character.id === activeCharacter.id,
          );
          if (
            !activeExists &&
            characterResult.characters[0] !== undefined
          ) {
            setSelectedId(characterResult.characters[0].id);
          }
        },
      )
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "无法读取角色配置。",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [activeCharacter.id]);

  const characterEntries = useMemo(
    () =>
      draftCharacter === null
        ? characters
        : [draftCharacter, ...characters],
    [characters, draftCharacter],
  );
  const selectedCharacter =
    characterEntries.find((character) => character.id === selectedId) ??
    characterEntries[0];

  const createCharacterDraft = useCallback((): void => {
    if (draftCharacter !== null) return;
    const now = new Date();
    const draft: Character = {
      id: crypto.randomUUID(),
      name: NEW_CHARACTER_NAME,
      portraitAssetId: null,
      packageId: DEFAULT_PACKAGE_ID,
      packagePortraitAssetId: defaultPackage?.portraitAssetId ?? null,
      packageThumbnailAssetId: defaultPackage?.thumbnailAssetId ?? null,
      modelConfigId: null,
      speechModelConfigId: null,
      speechVoice: null,
      useDefaultSpeechModel: true,
      useDefaultSpeechVoice: true,
      systemPrompt: "",
      createdAt: now,
      updatedAt: now,
    };
    setDraftOriginId(selectedCharacter?.id ?? activeCharacter.id);
    setDraftCharacter(draft);
    setSelectedId(draft.id);
    setFocusNameId(draft.id);
  }, [activeCharacter.id, draftCharacter, selectedCharacter?.id, defaultPackage]);

  const updateDraftCharacter = useCallback(
    (request: Partial<CreateCharacterRequest>): void => {
      setDraftCharacter((current) =>
        current === null
          ? null
          : { ...current, ...request,
              useDefaultSpeechModel: request.useDefaultSpeechModel ?? current.useDefaultSpeechModel,
              useDefaultSpeechVoice: request.useDefaultSpeechVoice ?? current.useDefaultSpeechVoice, updatedAt: new Date() },
      );
    },
    [],
  );

  const finalizeDraft = useCallback(async (): Promise<string> => {
    if (draftCharacter === null) return selectedId;
    const fallbackId = draftOriginId ?? activeCharacter.id;
    if (!draftHasChanges(draftCharacter)) {
      setDraftCharacter(null);
      setDraftOriginId(null);
      setFocusNameId(null);
      setSelectedId(fallbackId);
      return fallbackId;
    }

    const created = await window.katarune.createCharacter(
      draftRequest(draftCharacter),
    );
    setCharacters((current) => [created, ...current]);
    setDraftCharacter(null);
    setDraftOriginId(null);
    setFocusNameId(null);
    setSelectedId(created.id);
    return created.id;
  }, [
    activeCharacter.id,
    draftCharacter,
    draftOriginId,
    selectedId,
  ]);

  const selectCharacter = useCallback(
    async (id: string): Promise<boolean> => {
      if (id === selectedId) return true;
      try {
        if (
          draftCharacter !== null &&
          selectedId === draftCharacter.id
        ) {
          await finalizeDraft();
        }
        setSelectedId(id);
        return true;
      } catch (selectError) {
        notify({
          channel: "toast",
          level: "error",
          message:
            selectError instanceof Error
              ? selectError.message
              : "保存角色草稿失败，请重试。",
          dedupeKey: "character-draft-save",
        });
        return false;
      }
    },
    [draftCharacter, finalizeDraft, selectedId],
  );

  const requestCharacterDelete = useCallback(
    async (character: Character): Promise<void> => {
      if (characterEntries.length <= 1) return;
      if (draftCharacter?.id === character.id) {
        setDeleteCandidate({
          character,
          draft: true,
          threadCount: 0,
        });
        return;
      }
      try {
        const result = await window.katarune.listThreads({
          characterId: character.id,
        });
        setDeleteCandidate({
          character,
          draft: false,
          threadCount: result.threads.length,
        });
      } catch (listError) {
        notify({
          channel: "toast",
          level: "error",
          message:
            listError instanceof Error
              ? listError.message
              : "无法读取角色的会话数量，请重试。",
          dedupeKey: `character-delete-preflight:${character.id}`,
        });
      }
    },
    [characterEntries.length, draftCharacter?.id],
  );

  const confirmCharacterDelete =
    useCallback(async (): Promise<void> => {
      if (deleteCandidate === null) return;
      const deletedId = deleteCandidate.character.id;
      if (deleteCandidate.draft) {
        const fallbackId = draftOriginId ?? activeCharacter.id;
        setDraftCharacter(null);
        setDraftOriginId(null);
        setSelectedId(fallbackId);
        setFocusNameId(null);
        notify({
          level: "success",
          message: "角色草稿已删除。",
          dedupeKey: `character-deleted:${deletedId}`,
        });
        return;
      }
      const result = await deleteCharacterSession(deletedId);
      setCharacters((current) =>
        current.filter((character) => character.id !== deletedId),
      );
      setDraftOriginId((current) =>
        current === deletedId
          ? result.replacementCharacter.id
          : current,
      );
      setSelectedId((current) =>
        current === deletedId
          ? result.replacementCharacter.id
          : current,
      );
      setFocusNameId((current) =>
        current === deletedId ? null : current,
      );
      notify({
        level: "success",
        message: "角色已删除。",
        dedupeKey: `character-deleted:${deletedId}`,
      });
    }, [
      activeCharacter.id,
      deleteCandidate,
      deleteCharacterSession,
      draftOriginId,
    ]);

  const updateCharacter = useCallback(
    async (request: UpdateCharacterRequest): Promise<Character> => {
      const updated = await window.katarune.updateCharacter(request);
      setCharacters((current) =>
        current.map((character) =>
          character.id === updated.id ? updated : character,
        ),
      );
      return updated;
    },
    [],
  );

  const bindPackage = async (characterId: string, packageId: string): Promise<void> => {
    let targetId = characterId;
    if (draftCharacter?.id === characterId) {
      const created = await window.katarune.createCharacter(draftRequest(draftCharacter));
      setCharacters(current => [created, ...current]); setDraftCharacter(null); setDraftOriginId(null);
      setSelectedId(created.id); setFocusNameId(null); targetId = created.id;
    }
    const updated = await window.katarune.bindCharacterPackage({ characterId: targetId, packageId });
    setCharacters(current => current.map(character => character.id === updated.id ? updated : character));
    if (activeCharacter.id === updated.id) await setActiveCharacter(updated.id);
  };

  const leave = useCallback(
    async (destination: "chat" | "settings"): Promise<void> => {
      if (selectedCharacter === undefined) return;
      try {
        const characterId =
          draftCharacter !== null &&
          selectedCharacter.id === draftCharacter.id
            ? await finalizeDraft()
            : selectedCharacter.id;
        await setActiveCharacter(characterId);
        if (destination === "chat") onClose();
        else onOpenSettings();
      } catch (leaveError) {
        notify({
          channel: "toast",
          level: "error",
          message:
            leaveError instanceof Error
              ? leaveError.message
              : "切换角色失败，请重试。",
          dedupeKey: "character-leave",
        });
      }
    },
    [
      draftCharacter,
      finalizeDraft,
      onClose,
      onOpenSettings,
      selectedCharacter,
      setActiveCharacter,
    ],
  );

  return {
    availableModelIds,
    characterEntries,
    characters,
    confirmCharacterDelete,
    createCharacterDraft,
    deleteCandidate,
    draftCharacter,
    error,
    focusNameId,
    bindPackage,
    leave,
    models,
    providers,
    requestCharacterDelete,
    selectedCharacter,
    selectCharacter,
    updateCharacter,
    updateDraftCharacter,
    clearDeleteCandidate: (): void => setDeleteCandidate(null),
    clearFocusName: (): void => setFocusNameId(null),
  };
}
