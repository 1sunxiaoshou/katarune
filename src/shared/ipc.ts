import * as z from "zod/mini";
import { MODEL_TYPES } from "./models";
import { PROVIDER_TYPES } from "./providers";

export { MODEL_TYPES } from "./models";
export type { ModelType } from "./models";
export { PROVIDER_TYPES } from "./providers";
export type { ProviderType } from "./providers";

export const IPC_CHANNELS = {
  getAppInfo: "app:get-info",
  getDatabaseStatus: "database:get-status",
  getAiRuntimeStatus: "ai:get-runtime-status",
  listThreads: "threads:list",
  initializeThread: "threads:initialize",
  fetchThread: "threads:fetch",
  renameThread: "threads:rename",
  setThreadStatus: "threads:set-status",
  deleteThread: "threads:delete",
  loadThreadMessages: "thread-messages:load",
  appendThreadMessage: "thread-messages:append",
  deleteThreadMessages: "thread-messages:delete",
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
});

export const threadMetadataSchema = z.strictObject({
  remoteId: nonEmptyStringSchema,
  status: z.enum(["regular", "archived"]),
  title: nonEmptyStringSchema,
  lastMessageAt: z.date(),
});

export const threadListSchema = z.strictObject({
  threads: z.array(threadMetadataSchema),
});

export const initializeThreadResponseSchema = z.strictObject({
  remoteId: nonEmptyStringSchema,
});

export const renameThreadRequestSchema = z.strictObject({
  threadId: nonEmptyStringSchema,
  title: nonEmptyStringSchema,
});

export const setThreadStatusRequestSchema = z.strictObject({
  threadId: nonEmptyStringSchema,
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
  message: storedMessageSchema,
});

export const deleteThreadMessagesRequestSchema = z.strictObject({
  threadId: nonEmptyStringSchema,
  messageIds: z.array(nonEmptyStringSchema).check(z.minLength(1)),
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
  owner: z.nullable(boundedStringSchema),
  description: z.nullable(z.string().check(z.minLength(1), z.maxLength(4000))),
  modelType: z.nullable(modelTypeSchema),
});

export const discoveredModelListSchema = z.strictObject({
  models: z.array(discoveredModelSchema).check(z.maxLength(5000)),
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
export type ThreadMetadata = Readonly<z.infer<typeof threadMetadataSchema>>;
export type ThreadList = Readonly<z.infer<typeof threadListSchema>>;
export type InitializeThreadResponse = Readonly<z.infer<typeof initializeThreadResponseSchema>>;
export type RenameThreadRequest = Readonly<z.infer<typeof renameThreadRequestSchema>>;
export type SetThreadStatusRequest = Readonly<z.infer<typeof setThreadStatusRequestSchema>>;
export type StoredMessage = Readonly<z.infer<typeof storedMessageSchema>>;
export type ThreadMessages = Readonly<z.infer<typeof threadMessagesSchema>>;
export type AppendThreadMessageRequest = Readonly<z.infer<typeof appendThreadMessageRequestSchema>>;
export type DeleteThreadMessagesRequest = Readonly<z.infer<typeof deleteThreadMessagesRequestSchema>>;
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
  listThreads(): Promise<ThreadList>;
  initializeThread(request: ThreadIdRequest): Promise<InitializeThreadResponse>;
  fetchThread(request: ThreadIdRequest): Promise<ThreadMetadata>;
  renameThread(request: RenameThreadRequest): Promise<OperationSuccess>;
  setThreadStatus(request: SetThreadStatusRequest): Promise<OperationSuccess>;
  deleteThread(request: ThreadIdRequest): Promise<OperationSuccess>;
  loadThreadMessages(request: ThreadIdRequest): Promise<ThreadMessages>;
  appendThreadMessage(request: AppendThreadMessageRequest): Promise<OperationSuccess>;
  deleteThreadMessages(request: DeleteThreadMessagesRequest): Promise<OperationSuccess>;
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
}
