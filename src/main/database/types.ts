import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  AppendThreadMessageRequest,
  AppSettings,
  AppState,
  Asset,
  AssetKind,
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
  ModelMetadata,
  ModelType,
  ProviderConfig,
  ProviderConfigList,
  ProviderType,
  ThreadList,
  ThreadMessages,
  ThreadMetadata,
  UpdateCharacterRequest,
  UpdateAppSettingsRequest,
  UpdateModelConfigRequest,
  UpdateProviderConfigRequest,
} from "../../shared/ipc";

export type KataruneDatabase = BetterSQLite3Database;

export interface DatabaseConfigValidator {
  validateProviderSettings(
    providerType: ProviderType,
    settings: JsonObject | null,
  ): void;
  validateModelSettings(
    providerType: ProviderType,
    modelType: ModelType,
    settings: JsonObject | null,
  ): void;
  validateModelMetadata(
    providerType: ProviderType,
    modelType: ModelType,
    metadata: ModelMetadata | null,
  ): void;
}

export interface DatabaseRuntime extends ReturnType<typeof import("./characterPackageRepository").createCharacterPackageRepository> {
  getStatus(): DatabaseStatus;
  getAppState(): AppState;
  setActiveCharacter(characterId: string): AppState;
  getAppSettings(): AppSettings;
  updateAppSettings(request: UpdateAppSettingsRequest): AppSettings;
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
  deleteThread(threadId: string, characterId: string): readonly string[];
  loadThreadMessages(
    threadId: string,
    characterId: string,
  ): ThreadMessages;
  appendThreadMessage(request: AppendThreadMessageRequest): void;
  deleteThreadMessages(
    threadId: string,
    characterId: string,
    messageIds: readonly string[],
  ): readonly string[];
  fetchThreadChatAttachment(
    threadId: string,
    characterId: string,
    assetId: string,
  ): Asset;
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
  createModelConfig(request: PersistModelConfigRequest): ModelConfig;
  fetchModelConfig(id: string): ModelConfig;
  updateModelConfig(request: PersistModelConfigUpdate): ModelConfig;
  deleteModelConfig(id: string): void;
  listCharacters(): CharacterList;
  createCharacter(
    request: CreateCharacterRequest,
    portraitAsset?: ReadyAssetRegistration,
  ): Character;
  deleteCharacter(id: string): DeleteCharacterResult;
  fetchCharacter(id: string): Character;
  updateCharacter(request: UpdateCharacterRequest): Character;
  fetchAsset(id: string): Asset;
  listAssets(): readonly Asset[];
  markAssetReady(id: string, metadata: AssetMetadata): Asset;
  registerReadyAsset(asset: ReadyAssetRegistration): Asset;
  deleteUnreferencedChatAttachment(id: string): boolean;
  listUnreferencedChatAttachmentIds(): readonly string[];
  close(): void;
}

export type PersistModelConfigRequest = Omit<
  CreateModelConfigRequest,
  "modelType"
> & {
  readonly modelType: ModelType;
  readonly metadata: ModelMetadata | null;
};

export type PersistModelConfigUpdate = UpdateModelConfigRequest & {
  readonly metadata: ModelMetadata | null;
};

export interface AssetMetadata {
  readonly mimeType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly originalName: string;
}

export interface ReadyAssetRegistration extends AssetMetadata {
  readonly id: string;
  readonly storageKey: string;
  readonly kind: AssetKind;
}

export type AppStateRepository = Pick<
  DatabaseRuntime,
  "getAppState" | "setActiveCharacter"
>;
export type AppSettingsRepository = Pick<
  DatabaseRuntime,
  "getAppSettings" | "updateAppSettings"
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
  | "fetchThreadChatAttachment"
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
>;
export type AssetRepository = Pick<
  DatabaseRuntime,
  | "fetchAsset"
  | "listAssets"
  | "markAssetReady"
  | "registerReadyAsset"
  | "deleteUnreferencedChatAttachment"
  | "listUnreferencedChatAttachmentIds"
>;
