import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  AppendThreadMessageRequest,
  AppState,
  Asset,
  Character,
  CharacterList,
  CreateCharacterRequest,
  CreateModelConfigRequest,
  CreateProviderConfigRequest,
  DatabaseStatus,
  DeleteCharacterResult,
  InitializeThreadResponse,
  JsonObject,
  ModelConfig,
  ModelConfigList,
  ModelType,
  PortraitFraming,
  ProviderConfig,
  ProviderConfigList,
  ProviderType,
  ThreadList,
  ThreadMessages,
  ThreadMetadata,
  UpdateCharacterRequest,
  UpdateModelConfigRequest,
  UpdateProviderConfigRequest,
} from "../../shared/ipc";

export type KataruneDatabase = BetterSQLite3Database;

export interface DatabaseSettingsValidator {
  validateProviderSettings(
    providerType: ProviderType,
    settings: JsonObject | null,
  ): void;
  validateModelSettings(
    providerType: ProviderType,
    modelType: ModelType,
    settings: JsonObject | null,
  ): void;
}

export interface DatabaseRuntime {
  getStatus(): DatabaseStatus;
  getAppState(): AppState;
  setActiveCharacter(characterId: string): AppState;
  listThreads(characterId: string): ThreadList;
  initializeThread(
    threadId: string,
    characterId: string,
  ): InitializeThreadResponse;
  fetchThread(threadId: string, characterId: string): ThreadMetadata;
  renameThread(threadId: string, characterId: string, title: string): void;
  setThreadStatus(
    threadId: string,
    characterId: string,
    status: "regular" | "archived",
  ): void;
  deleteThread(threadId: string, characterId: string): void;
  loadThreadMessages(
    threadId: string,
    characterId: string,
  ): ThreadMessages;
  appendThreadMessage(request: AppendThreadMessageRequest): void;
  deleteThreadMessages(
    threadId: string,
    characterId: string,
    messageIds: readonly string[],
  ): void;
  listProviderConfigs(): ProviderConfigList;
  createProviderConfig(
    request: CreateProviderConfigRequest,
  ): ProviderConfig;
  fetchProviderConfig(id: string): ProviderConfig;
  updateProviderConfig(
    request: UpdateProviderConfigRequest,
  ): ProviderConfig;
  setProviderCredentialReference(
    id: string,
    credentialRef: string | null,
  ): ProviderConfig;
  deleteProviderConfig(id: string): void;
  listModelConfigs(): ModelConfigList;
  createModelConfig(request: CreateModelConfigRequest): ModelConfig;
  fetchModelConfig(id: string): ModelConfig;
  updateModelConfig(request: UpdateModelConfigRequest): ModelConfig;
  deleteModelConfig(id: string): void;
  listCharacters(): CharacterList;
  createCharacter(
    request: CreateCharacterRequest,
    portraitAsset?: ReadyAssetRegistration,
    portraitFraming?: PortraitFraming,
  ): Character;
  deleteCharacter(id: string): DeleteCharacterResult;
  fetchCharacter(id: string): Character;
  updateCharacter(request: UpdateCharacterRequest): Character;
  fetchAsset(id: string): Asset;
  listAssets(): readonly Asset[];
  updateCharacterPortrait(
    characterId: string,
    framing: PortraitFraming,
    asset?: ReadyAssetRegistration,
  ): Character;
  markAssetReady(id: string, metadata: AssetMetadata): Asset;
  close(): void;
}

export interface AssetMetadata {
  readonly mimeType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly originalName: string;
}

export interface ReadyAssetRegistration extends AssetMetadata {
  readonly id: string;
  readonly storageKey: string;
}

export type AppStateRepository = Pick<
  DatabaseRuntime,
  "getAppState" | "setActiveCharacter"
>;
export type ThreadRepository = Pick<
  DatabaseRuntime,
  | "listThreads"
  | "initializeThread"
  | "fetchThread"
  | "renameThread"
  | "setThreadStatus"
  | "deleteThread"
  | "loadThreadMessages"
  | "appendThreadMessage"
  | "deleteThreadMessages"
>;
export type ProviderRepository = Pick<
  DatabaseRuntime,
  | "listProviderConfigs"
  | "createProviderConfig"
  | "fetchProviderConfig"
  | "updateProviderConfig"
  | "setProviderCredentialReference"
  | "deleteProviderConfig"
>;
export type ModelRepository = Pick<
  DatabaseRuntime,
  | "listModelConfigs"
  | "createModelConfig"
  | "fetchModelConfig"
  | "updateModelConfig"
  | "deleteModelConfig"
>;
export type CharacterRepository = Pick<
  DatabaseRuntime,
  | "listCharacters"
  | "createCharacter"
  | "deleteCharacter"
  | "fetchCharacter"
  | "updateCharacter"
  | "updateCharacterPortrait"
>;
export type AssetRepository = Pick<
  DatabaseRuntime,
  "fetchAsset" | "listAssets" | "markAssetReady"
>;
