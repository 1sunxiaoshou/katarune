import * as z from "zod/mini";
import {
  characterSchema,
  type Character,
  type CharacterIdRequest,
  type CharacterList,
  type CharacterPortraitImportRequest,
  type CharacterPortraitImportResult,
  type CreateCharacterRequest,
  type DeleteCharacterResult,
  type UpdateCharacterRequest,
} from "./characters";
import { MODEL_TYPES } from "./models";
import { PROVIDER_TYPES } from "./providers";

export {
  characterIdRequestSchema,
  characterListSchema,
  characterPortraitImportRequestSchema,
  characterPortraitImportResultSchema,
  characterSchema,
  createCharacterRequestSchema,
  deleteCharacterResultSchema,
  defaultCharacterConfigSchema,
  updateCharacterRequestSchema,
} from "./characters";
export type {
  Character,
  CharacterIdRequest,
  CharacterList,
  CharacterPortraitImportRequest,
  CharacterPortraitImportResult,
  CreateCharacterRequest,
  DeleteCharacterResult,
  DefaultCharacterConfig,
  UpdateCharacterRequest,
} from "./characters";
export { assetSchema, ASSET_STATUSES, assetUrl } from "./assets";
export type { Asset, AssetStatus } from "./assets";
export { MODEL_TYPES } from "./models";
export type { ModelType } from "./models";
export { PROVIDER_TYPES } from "./providers";
export type { ProviderType } from "./providers";

export const IPC_CHANNELS = {
  getAppInfo: "app:get-info",
  getDatabaseStatus: "database:get-status",
  getAiRuntimeStatus: "ai:get-runtime-status",
  getAppState: "app-state:get",
  setActiveCharacter: "app-state:set-active-character",
  listThreads: "threads:list",
  initializeThread: "threads:initialize",
  fetchThread: "threads:fetch",
  generateThreadTitle: "threads:generate-title",
  renameThread: "threads:rename",
  setThreadStatus: "threads:set-status",
  deleteThread: "threads:delete",
  loadThreadMessages: "thread-messages:load",
  appendThreadMessage: "thread-messages:append",
  deleteThreadMessages: "thread-messages:delete",
  startChatStream: "chat-stream:start",
  listProviderConfigs: "provider-configs:list",
  createProviderConfig: "provider-configs:create",
  fetchProviderConfig: "provider-configs:fetch",
  updateProviderConfig: "provider-configs:update",
  replaceProviderCredential: "provider-configs:replace-credential",
  clearProviderCredential: "provider-configs:clear-credential",
  deleteProviderConfig: "provider-configs:delete",
  listModelConfigs: "model-configs:list",
  createModelConfig: "model-configs:create",
  fetchModelConfig: "model-configs:fetch",
  updateModelConfig: "model-configs:update",
  deleteModelConfig: "model-configs:delete",
  discoverProviderModels: "model-configs:discover",
  testModelConnection: "model-configs:test-connection",
  listCharacters: "characters:list",
  createCharacter: "characters:create",
  deleteCharacter: "characters:delete",
  updateCharacter: "characters:update",
  importCharacterPortrait: "characters:import-portrait",
} as const;

const nonEmptyStringSchema = z.string().check(z.minLength(1));
const boundedStringSchema = z.string().check(z.minLength(1), z.maxLength(200));

export const appInfoSchema = z.strictObject({
  name: nonEmptyStringSchema,
  version: nonEmptyStringSchema,
  platform: nonEmptyStringSchema,
  electronVersion: nonEmptyStringSchema,
  nodeVersion: nonEmptyStringSchema,
});

export const databaseStatusSchema = z.strictObject({
  ready: z.literal(true),
  journalMode: z.literal("wal"),
  threadCount: z.int().check(z.nonnegative()),
  validationThreadId: nonEmptyStringSchema,
  validationThreadRestored: z.boolean(),
});

export const aiRuntimeStatusSchema = z.strictObject({
  ready: z.literal(true),
  configuredProviderCount: z.int().check(z.nonnegative()),
  modelCallsEnabled: z.boolean(),
});

export const threadIdRequestSchema = z.strictObject({
  threadId: nonEmptyStringSchema,
  characterId: z.uuid(),
});

export const listThreadsRequestSchema = z.strictObject({
  characterId: z.uuid(),
});

export const threadMetadataSchema = z.strictObject({
  remoteId: nonEmptyStringSchema,
  status: z.enum(["regular", "archived"]),
  title: nonEmptyStringSchema,
  lastMessageAt: z.date(),
  characterId: z.uuid(),
});

export const threadListSchema = z.strictObject({
  threads: z.array(threadMetadataSchema),
});

export const initializeThreadResponseSchema = z.strictObject({
  remoteId: nonEmptyStringSchema,
});

export const threadTitleMessageSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  text: z.string().check(z.minLength(1), z.maxLength(2000)),
});

export const generateThreadTitleRequestSchema = z.strictObject({
  threadId: nonEmptyStringSchema,
  characterId: z.uuid(),
  messages: z.array(threadTitleMessageSchema).check(z.minLength(1), z.maxLength(12)),
});

export const generateThreadTitleResponseSchema = z.strictObject({
  title: boundedStringSchema,
});

export const renameThreadRequestSchema = z.strictObject({
  threadId: nonEmptyStringSchema,
  characterId: z.uuid(),
  title: nonEmptyStringSchema,
});

export const setThreadStatusRequestSchema = z.strictObject({
  threadId: nonEmptyStringSchema,
  characterId: z.uuid(),
  status: z.enum(["regular", "archived"]),
});

export const storedMessageSchema = z.strictObject({
  id: nonEmptyStringSchema,
  parent_id: z.nullable(nonEmptyStringSchema),
  format: nonEmptyStringSchema,
  content: z.record(z.string(), z.unknown()),
});

export const threadMessagesSchema = z.strictObject({
  messages: z.array(storedMessageSchema),
});

export const appendThreadMessageRequestSchema = z.strictObject({
  threadId: nonEmptyStringSchema,
  characterId: z.uuid(),
  message: storedMessageSchema,
});

export const deleteThreadMessagesRequestSchema = z.strictObject({
  threadId: nonEmptyStringSchema,
  characterId: z.uuid(),
  messageIds: z.array(nonEmptyStringSchema).check(z.minLength(1)),
});

const frontendToolNameSchema = z
  .string()
  .check(z.minLength(1), z.maxLength(64), z.regex(/^[A-Za-z0-9_-]+$/));

export const frontendToolSchema = z.strictObject({
  description: z.optional(z.string().check(z.maxLength(1000))),
  parameters: z.record(z.string(), z.unknown()),
});

export const frontendToolsSchema = z
  .record(frontendToolNameSchema, frontendToolSchema)
  .check(
    z.refine((tools) => Object.keys(tools).length <= 64, {
      error: "A chat request can expose at most 64 frontend tools.",
    }),
  );

export const chatStreamRequestSchema = z.strictObject({
  requestId: z.uuid(),
  threadId: nonEmptyStringSchema,
  characterId: z.uuid(),
  messages: z.array(z.unknown()).check(z.maxLength(1000)),
  frontendTools: frontendToolsSchema,
});

export const chatStreamControlFrameSchema = z.union([
  z.strictObject({ type: z.literal("pull") }),
  z.strictObject({ type: z.literal("cancel") }),
]);

export const chatStreamResponseFrameSchema = z.union([
  z.strictObject({
    type: z.literal("data"),
    data: z.instanceof(Uint8Array),
  }),
  z.strictObject({ type: z.literal("end") }),
  z.strictObject({
    type: z.literal("error"),
    message: z.string().check(z.minLength(1), z.maxLength(1000)),
  }),
]);

export const appStateSchema = z.strictObject({
  activeCharacter: characterSchema,
});

export const setActiveCharacterRequestSchema = z.strictObject({
  characterId: z.uuid(),
});

export const operationSuccessSchema = z.strictObject({
  success: z.literal(true),
});

export const providerTypeSchema = z.enum(PROVIDER_TYPES);

export const providerSettingsSchema = z.strictObject({
  includeUsage: z.optional(z.boolean()),
  supportsStructuredOutputs: z.optional(z.boolean()),
});

export const providerConfigSchema = z.strictObject({
  id: z.uuid(),
  displayName: boundedStringSchema,
  providerType: providerTypeSchema,
  baseUrl: z.nullable(z.url({ protocol: /^https?$/ })),
  credentialRef: z.nullable(boundedStringSchema),
  settings: z.nullable(providerSettingsSchema),
  enabled: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const providerConfigListSchema = z.strictObject({
  providerConfigs: z.array(providerConfigSchema),
});

export const providerConfigIdRequestSchema = z.strictObject({
  id: z.uuid(),
});

export const createProviderConfigRequestSchema = z.strictObject({
  displayName: boundedStringSchema,
  providerType: providerTypeSchema,
  baseUrl: z.nullable(z.url({ protocol: /^https?$/ })),
  settings: z.nullable(providerSettingsSchema),
  enabled: z.boolean(),
});

export const updateProviderConfigRequestSchema = z.strictObject({
  id: z.uuid(),
  displayName: boundedStringSchema,
  baseUrl: z.nullable(z.url({ protocol: /^https?$/ })),
  settings: z.nullable(providerSettingsSchema),
  enabled: z.boolean(),
});

export const replaceProviderCredentialRequestSchema = z.strictObject({
  providerConfigId: z.uuid(),
  secret: z.string().check(z.minLength(1), z.maxLength(16384)),
});

const finiteNumberSchema = z.number();

export const modelSettingsSchema = z.strictObject({
  maxOutputTokens: z.optional(z.int().check(z.positive())),
  temperature: z.optional(finiteNumberSchema),
  topP: z.optional(finiteNumberSchema.check(z.gte(0), z.lte(1))),
  topK: z.optional(finiteNumberSchema.check(z.nonnegative())),
  presencePenalty: z.optional(finiteNumberSchema.check(z.gte(-1), z.lte(1))),
  frequencyPenalty: z.optional(finiteNumberSchema.check(z.gte(-1), z.lte(1))),
  stopSequences: z.optional(z.array(boundedStringSchema).check(z.maxLength(16))),
  seed: z.optional(z.int()),
});

const providerModelIdSchema = z.string().check(z.minLength(1), z.maxLength(500));
export const modelTypeSchema = z.enum(MODEL_TYPES);

export const modelConfigSchema = z.strictObject({
  id: z.uuid(),
  providerConfigId: z.uuid(),
  modelType: modelTypeSchema,
  modelId: providerModelIdSchema,
  displayName: z.nullable(boundedStringSchema),
  settings: z.nullable(modelSettingsSchema),
  enabled: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const modelConfigListSchema = z.strictObject({
  modelConfigs: z.array(modelConfigSchema),
});

export const discoveredModelSchema = z.strictObject({
  id: providerModelIdSchema,
  displayName: z.nullable(z.string().check(z.minLength(1), z.maxLength(500))),
  modelType: z.nullable(modelTypeSchema),
  typeSource: z.nullable(z.enum(["gateway", "litellm-snapshot", "litellm-api"])),
});

export const discoveredModelListSchema = z.strictObject({
  models: z.array(discoveredModelSchema).check(z.maxLength(5000)),
  source: z.enum(["provider", "litellm-snapshot", "litellm-api"]),
  warning: z.nullable(z.string().check(z.minLength(1), z.maxLength(1000))),
});

export const modelConfigIdRequestSchema = z.strictObject({
  id: z.uuid(),
});

export const createModelConfigRequestSchema = z.strictObject({
  providerConfigId: z.uuid(),
  modelType: modelTypeSchema,
  modelId: providerModelIdSchema,
  displayName: z.nullable(boundedStringSchema),
  settings: z.nullable(modelSettingsSchema),
  enabled: z.boolean(),
});

export const updateModelConfigRequestSchema = z.strictObject({
  id: z.uuid(),
  modelType: modelTypeSchema,
  modelId: providerModelIdSchema,
  displayName: z.nullable(boundedStringSchema),
  settings: z.nullable(modelSettingsSchema),
  enabled: z.boolean(),
});

export const modelConnectionTestResultSchema = z.strictObject({
  modelConfigId: z.uuid(),
  success: z.boolean(),
  latencyMs: z.int().check(z.nonnegative()),
  message: z.string().check(z.minLength(1), z.maxLength(1000)),
});

export type AppInfo = Readonly<z.infer<typeof appInfoSchema>>;
export type DatabaseStatus = Readonly<z.infer<typeof databaseStatusSchema>>;
export type AiRuntimeStatus = Readonly<z.infer<typeof aiRuntimeStatusSchema>>;
export type ThreadIdRequest = Readonly<z.infer<typeof threadIdRequestSchema>>;
export type ListThreadsRequest = Readonly<z.infer<typeof listThreadsRequestSchema>>;
export type ThreadMetadata = Readonly<z.infer<typeof threadMetadataSchema>>;
export type ThreadList = Readonly<z.infer<typeof threadListSchema>>;
export type InitializeThreadResponse = Readonly<z.infer<typeof initializeThreadResponseSchema>>;
export type ThreadTitleMessage = Readonly<z.infer<typeof threadTitleMessageSchema>>;
export type GenerateThreadTitleRequest = Readonly<
  z.infer<typeof generateThreadTitleRequestSchema>
>;
export type GenerateThreadTitleResponse = Readonly<
  z.infer<typeof generateThreadTitleResponseSchema>
>;
export type RenameThreadRequest = Readonly<z.infer<typeof renameThreadRequestSchema>>;
export type SetThreadStatusRequest = Readonly<z.infer<typeof setThreadStatusRequestSchema>>;
export type StoredMessage = Readonly<z.infer<typeof storedMessageSchema>>;
export type ThreadMessages = Readonly<z.infer<typeof threadMessagesSchema>>;
export type AppendThreadMessageRequest = Readonly<z.infer<typeof appendThreadMessageRequestSchema>>;
export type DeleteThreadMessagesRequest = Readonly<z.infer<typeof deleteThreadMessagesRequestSchema>>;
export type FrontendTool = Readonly<z.infer<typeof frontendToolSchema>>;
export type FrontendTools = Readonly<z.infer<typeof frontendToolsSchema>>;
export type ChatStreamRequest = Readonly<z.infer<typeof chatStreamRequestSchema>>;
export type ChatStreamControlFrame = Readonly<z.infer<typeof chatStreamControlFrameSchema>>;
export type ChatStreamResponseFrame = Readonly<z.infer<typeof chatStreamResponseFrameSchema>>;
export type ChatStreamFrameListener = (frame: ChatStreamResponseFrame) => void;
export type AppState = Readonly<z.infer<typeof appStateSchema>>;
export type SetActiveCharacterRequest = Readonly<
  z.infer<typeof setActiveCharacterRequestSchema>
>;
export type OperationSuccess = Readonly<z.infer<typeof operationSuccessSchema>>;
export type ProviderSettings = Readonly<z.infer<typeof providerSettingsSchema>>;
export type ProviderConfig = Readonly<z.infer<typeof providerConfigSchema>>;
export type ProviderConfigList = Readonly<z.infer<typeof providerConfigListSchema>>;
export type ProviderConfigIdRequest = Readonly<z.infer<typeof providerConfigIdRequestSchema>>;
export type CreateProviderConfigRequest = Readonly<z.infer<typeof createProviderConfigRequestSchema>>;
export type UpdateProviderConfigRequest = Readonly<z.infer<typeof updateProviderConfigRequestSchema>>;
export type ReplaceProviderCredentialRequest = Readonly<
  z.infer<typeof replaceProviderCredentialRequestSchema>
>;
export type ModelSettings = Readonly<z.infer<typeof modelSettingsSchema>>;
export type ModelConfig = Readonly<z.infer<typeof modelConfigSchema>>;
export type ModelConfigList = Readonly<z.infer<typeof modelConfigListSchema>>;
export type DiscoveredModel = Readonly<z.infer<typeof discoveredModelSchema>>;
export type DiscoveredModelList = Readonly<z.infer<typeof discoveredModelListSchema>>;
export type ModelConfigIdRequest = Readonly<z.infer<typeof modelConfigIdRequestSchema>>;
export type CreateModelConfigRequest = Readonly<z.infer<typeof createModelConfigRequestSchema>>;
export type UpdateModelConfigRequest = Readonly<z.infer<typeof updateModelConfigRequestSchema>>;
export type ModelConnectionTestResult = Readonly<z.infer<typeof modelConnectionTestResultSchema>>;

export interface KataruneApi {
  getAppInfo(): Promise<AppInfo>;
  getDatabaseStatus(): Promise<DatabaseStatus>;
  getAiRuntimeStatus(): Promise<AiRuntimeStatus>;
  getAppState(): Promise<AppState>;
  setActiveCharacter(request: SetActiveCharacterRequest): Promise<AppState>;
  listThreads(request: ListThreadsRequest): Promise<ThreadList>;
  initializeThread(request: ThreadIdRequest): Promise<InitializeThreadResponse>;
  fetchThread(request: ThreadIdRequest): Promise<ThreadMetadata>;
  generateThreadTitle(
    request: GenerateThreadTitleRequest,
  ): Promise<GenerateThreadTitleResponse>;
  renameThread(request: RenameThreadRequest): Promise<OperationSuccess>;
  setThreadStatus(request: SetThreadStatusRequest): Promise<OperationSuccess>;
  deleteThread(request: ThreadIdRequest): Promise<OperationSuccess>;
  loadThreadMessages(request: ThreadIdRequest): Promise<ThreadMessages>;
  appendThreadMessage(request: AppendThreadMessageRequest): Promise<OperationSuccess>;
  deleteThreadMessages(request: DeleteThreadMessagesRequest): Promise<OperationSuccess>;
  startChatStream(request: ChatStreamRequest, listener: ChatStreamFrameListener): void;
  pullChatStream(requestId: string): void;
  cancelChatStream(requestId: string): void;
  listProviderConfigs(): Promise<ProviderConfigList>;
  createProviderConfig(request: CreateProviderConfigRequest): Promise<ProviderConfig>;
  fetchProviderConfig(request: ProviderConfigIdRequest): Promise<ProviderConfig>;
  updateProviderConfig(request: UpdateProviderConfigRequest): Promise<ProviderConfig>;
  replaceProviderCredential(request: ReplaceProviderCredentialRequest): Promise<ProviderConfig>;
  clearProviderCredential(request: ProviderConfigIdRequest): Promise<ProviderConfig>;
  deleteProviderConfig(request: ProviderConfigIdRequest): Promise<OperationSuccess>;
  listModelConfigs(): Promise<ModelConfigList>;
  createModelConfig(request: CreateModelConfigRequest): Promise<ModelConfig>;
  fetchModelConfig(request: ModelConfigIdRequest): Promise<ModelConfig>;
  updateModelConfig(request: UpdateModelConfigRequest): Promise<ModelConfig>;
  deleteModelConfig(request: ModelConfigIdRequest): Promise<OperationSuccess>;
  discoverProviderModels(request: ProviderConfigIdRequest): Promise<DiscoveredModelList>;
  testModelConnection(request: ModelConfigIdRequest): Promise<ModelConnectionTestResult>;
  listCharacters(): Promise<CharacterList>;
  createCharacter(request: CreateCharacterRequest): Promise<Character>;
  deleteCharacter(request: CharacterIdRequest): Promise<DeleteCharacterResult>;
  updateCharacter(request: UpdateCharacterRequest): Promise<Character>;
  importCharacterPortrait(
    request: CharacterPortraitImportRequest,
  ): Promise<CharacterPortraitImportResult>;
}
