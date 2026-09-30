import { randomUUID } from "node:crypto";
import { count, desc, eq, ne, and } from "drizzle-orm";
import {
  characterListSchema,
  characterSchema,
  DEFAULT_PORTRAIT_FRAMING,
  deleteCharacterResultSchema,
  modelConfigSchema,
  type Character,
} from "../../shared/ipc";
import { VALIDATION_THREAD_ID } from "./constants";
import { appState, assets, characters, modelConfigs, threads } from "./schema";
import type {
  CharacterRepository,
  KataruneDatabase,
} from "./types";

export function createCharacterRepository(
  database: KataruneDatabase,
): CharacterRepository {
  const validateSpeechSelection = (
    speechModelConfigId: string | null,
    speechVoice: string | null,
    useDefaultSpeechVoice = false,
  ): void => {
    if (
      !useDefaultSpeechVoice && (speechModelConfigId === null) !==
      (speechVoice === null)
    ) {
      throw new Error("语音模型和 voice 必须同时配置或同时清空。");
    }
    if (speechModelConfigId === null) return;
    const rawModel = database
      .select()
      .from(modelConfigs)
      .where(eq(modelConfigs.id, speechModelConfigId))
      .get();
    if (rawModel === undefined) {
      throw new Error("选择的语音模型不存在。");
    }
    const model = modelConfigSchema.parse(rawModel);
    if (model.modelType !== "speechModel") {
      throw new Error("选择的模型不是语音生成模型。");
    }
  };

  const fetchCharacter = (id: string): Character => {
    const character = database
      .select()
      .from(characters)
      .where(eq(characters.id, id))
      .get();
    if (character === undefined) {
      throw new Error(`Character "${id}" was not found.`);
    }
    return characterSchema.parse(character);
  };

  return {
    listCharacters: () =>
      characterListSchema.parse({
        characters: database
          .select()
          .from(characters)
          .orderBy(desc(characters.createdAt), desc(characters.id))
          .all(),
      }),
    createCharacter: (
      {
        name,
        modelConfigId,
        speechModelConfigId,
        speechVoice,
        useDefaultSpeechModel = false,
        useDefaultSpeechVoice = false,
        systemPrompt,
      },
      portraitAsset,
      portraitFraming = DEFAULT_PORTRAIT_FRAMING,
    ) => {
      validateSpeechSelection(speechModelConfigId, speechVoice, useDefaultSpeechVoice);
      const id = randomUUID();
      const latestCharacter = database
        .select({ createdAt: characters.createdAt })
        .from(characters)
        .orderBy(desc(characters.createdAt), desc(characters.id))
        .get();
      const now = new Date(
        Math.max(
          Date.now(),
          (latestCharacter?.createdAt.getTime() ?? 0) + 1,
        ),
      );
      database.transaction((transaction) => {
        if (portraitAsset !== undefined) {
          transaction
            .insert(assets)
            .values({
              ...portraitAsset,
              status: "ready",
              createdAt: now,
              updatedAt: now,
            })
            .run();
        }
        transaction
          .insert(characters)
          .values({
            id,
            name,
            portraitAssetId: portraitAsset?.id ?? null,
            portraitFocusX: portraitFraming.focusX,
            portraitFocusY: portraitFraming.focusY,
            portraitZoom: portraitFraming.zoom,
            modelConfigId,
            speechModelConfigId,
            speechVoice,
            useDefaultSpeechModel,
            useDefaultSpeechVoice,
            systemPrompt,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      });
      return fetchCharacter(id);
    },
    deleteCharacter: (id) =>
      database.transaction((transaction) => {
        const orderedCharacters = transaction
          .select()
          .from(characters)
          .orderBy(desc(characters.createdAt), desc(characters.id))
          .all();
        const deletedIndex = orderedCharacters.findIndex(
          (character) => character.id === id,
        );
        if (deletedIndex === -1) {
          throw new Error(`Character "${id}" was not found.`);
        }
        if (orderedCharacters.length <= 1) {
          throw new Error("至少需要保留一个角色。");
        }

        const replacement =
          orderedCharacters[deletedIndex + 1] ??
          orderedCharacters[deletedIndex - 1];
        if (replacement === undefined) {
          throw new Error("无法确定替代角色。");
        }

        const state = transaction
          .select()
          .from(appState)
          .where(eq(appState.id, 1))
          .get();
        if (state === undefined) {
          throw new Error("Application state was not initialized.");
        }
        const activeCharacterId =
          state.activeCharacterId === id
            ? replacement.id
            : state.activeCharacterId;
        if (state.activeCharacterId === id) {
          transaction
            .update(appState)
            .set({ activeCharacterId, updatedAt: new Date() })
            .where(eq(appState.id, 1))
            .run();
        }

        const deletedThreadCount =
          transaction
            .select({ value: count() })
            .from(threads)
            .where(
              and(
                eq(threads.characterId, id),
                ne(threads.id, VALIDATION_THREAD_ID),
              ),
            )
            .get()?.value ?? 0;
        transaction
          .delete(threads)
          .where(eq(threads.characterId, id))
          .run();
        const deletedCharacter = transaction
          .delete(characters)
          .where(eq(characters.id, id))
          .run();
        if (deletedCharacter.changes !== 1) {
          throw new Error(`Character "${id}" was not found.`);
        }

        const activeCharacter = transaction
          .select()
          .from(characters)
          .where(eq(characters.id, activeCharacterId))
          .get();
        if (activeCharacter === undefined) {
          throw new Error(
            "Application state references a missing character.",
          );
        }

        return deleteCharacterResultSchema.parse({
          deletedCharacterId: id,
          deletedThreadCount,
          replacementCharacter: replacement,
          activeCharacter,
        });
      }),
    fetchCharacter,
    updateCharacter: ({
      id,
      name,
      modelConfigId,
      speechModelConfigId,
      speechVoice,
      useDefaultSpeechModel,
      useDefaultSpeechVoice,
      systemPrompt,
    }) => {
      const currentCharacter = fetchCharacter(id);
      const nextSpeechModelConfigId =
        speechModelConfigId === undefined
          ? currentCharacter.speechModelConfigId
          : speechModelConfigId;
      const nextSpeechVoice =
        speechVoice === undefined
          ? currentCharacter.speechVoice
          : speechVoice;
      validateSpeechSelection(
        nextSpeechModelConfigId,
        nextSpeechVoice,
        useDefaultSpeechVoice ?? currentCharacter.useDefaultSpeechVoice,
      );
      const updates: {
        name?: string;
        modelConfigId?: string | null;
        speechModelConfigId?: string | null;
        speechVoice?: string | null;
        useDefaultSpeechModel?: boolean;
        useDefaultSpeechVoice?: boolean;
        systemPrompt?: string;
        updatedAt: Date;
      } = { updatedAt: new Date() };
      if (name !== undefined) updates.name = name;
      if (modelConfigId !== undefined) updates.modelConfigId = modelConfigId;
      if (speechModelConfigId !== undefined) {
        updates.speechModelConfigId = speechModelConfigId;
      }
      if (speechVoice !== undefined) updates.speechVoice = speechVoice;
      if (useDefaultSpeechModel !== undefined) updates.useDefaultSpeechModel = useDefaultSpeechModel;
      if (useDefaultSpeechVoice !== undefined) updates.useDefaultSpeechVoice = useDefaultSpeechVoice;
      if (systemPrompt !== undefined) updates.systemPrompt = systemPrompt;

      const result = database
        .update(characters)
        .set(updates)
        .where(eq(characters.id, id))
        .run();
      if (result.changes === 0) fetchCharacter(id);
      return fetchCharacter(id);
    },
    updateCharacterPortrait: (characterId, framing, asset) => {
      const currentCharacter = fetchCharacter(characterId);
      if (asset === undefined && currentCharacter.portraitAssetId === null) {
        throw new Error("角色尚未设置立绘。");
      }
      const now = new Date();
      database.transaction((transaction) => {
        if (asset !== undefined) {
          transaction
            .insert(assets)
            .values({
              ...asset,
              status: "ready",
              createdAt: now,
              updatedAt: now,
            })
            .run();
        }
        const result = transaction
          .update(characters)
          .set({
            ...(asset === undefined ? {} : { portraitAssetId: asset.id }),
            portraitFocusX: framing.focusX,
            portraitFocusY: framing.focusY,
            portraitZoom: framing.zoom,
            updatedAt: now,
          })
          .where(eq(characters.id, characterId))
          .run();
        if (result.changes !== 1) {
          throw new Error(`Character "${characterId}" was not found.`);
        }
      });
      return fetchCharacter(characterId);
    },
  };
}
