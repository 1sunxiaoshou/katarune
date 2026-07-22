import { contextBridge, ipcRenderer } from "electron";
import {
  aiRuntimeStatusSchema,
  appendThreadMessageRequestSchema,
  appInfoSchema,
  createProviderConfigRequestSchema,
  discoveredModelListSchema,
  databaseStatusSchema,
  deleteThreadMessagesRequestSchema,
  initializeThreadResponseSchema,
  IPC_CHANNELS,
  createModelConfigRequestSchema,
  modelConfigIdRequestSchema,
  modelConfigListSchema,
  modelConfigSchema,
  modelConnectionTestResultSchema,
  operationSuccessSchema,
  providerConfigIdRequestSchema,
  providerConfigListSchema,
  providerConfigSchema,
  replaceProviderCredentialRequestSchema,
  renameThreadRequestSchema,
  setThreadStatusRequestSchema,
  threadIdRequestSchema,
  threadListSchema,
  threadMessagesSchema,
  threadMetadataSchema,
  updateProviderConfigRequestSchema,
  updateModelConfigRequestSchema,
  type AppendThreadMessageRequest,
  type CreateProviderConfigRequest,
  type CreateModelConfigRequest,
  type DeleteThreadMessagesRequest,
  type KataruneApi,
  type ProviderConfigIdRequest,
  type ReplaceProviderCredentialRequest,
  type ModelConfigIdRequest,
  type RenameThreadRequest,
  type SetThreadStatusRequest,
  type ThreadIdRequest,
  type UpdateProviderConfigRequest,
  type UpdateModelConfigRequest,
} from "../shared/ipc";

interface RuntimeSchema<T> {
  parse(value: unknown): T;
}

async function invokeValidated<T>(
  channel: string,
  schema: RuntimeSchema<T>,
  ...args: readonly unknown[]
): Promise<T> {
  const value: unknown = await ipcRenderer.invoke(channel, ...args);
  return schema.parse(value);
}

const api: KataruneApi = Object.freeze({
  getAppInfo: () => invokeValidated(IPC_CHANNELS.getAppInfo, appInfoSchema),
  getDatabaseStatus: () => invokeValidated(IPC_CHANNELS.getDatabaseStatus, databaseStatusSchema),
  getAiRuntimeStatus: () => invokeValidated(IPC_CHANNELS.getAiRuntimeStatus, aiRuntimeStatusSchema),
  listThreads: () => invokeValidated(IPC_CHANNELS.listThreads, threadListSchema),
  initializeThread: (request: ThreadIdRequest) =>
    invokeValidated(
      IPC_CHANNELS.initializeThread,
      initializeThreadResponseSchema,
      threadIdRequestSchema.parse(request),
    ),
  fetchThread: (request: ThreadIdRequest) =>
    invokeValidated(
      IPC_CHANNELS.fetchThread,
      threadMetadataSchema,
      threadIdRequestSchema.parse(request),
    ),
  renameThread: (request: RenameThreadRequest) =>
    invokeValidated(
      IPC_CHANNELS.renameThread,
      operationSuccessSchema,
      renameThreadRequestSchema.parse(request),
    ),
  setThreadStatus: (request: SetThreadStatusRequest) =>
    invokeValidated(
      IPC_CHANNELS.setThreadStatus,
      operationSuccessSchema,
      setThreadStatusRequestSchema.parse(request),
    ),
  deleteThread: (request: ThreadIdRequest) =>
    invokeValidated(
      IPC_CHANNELS.deleteThread,
      operationSuccessSchema,
      threadIdRequestSchema.parse(request),
    ),
  loadThreadMessages: (request: ThreadIdRequest) =>
    invokeValidated(
      IPC_CHANNELS.loadThreadMessages,
      threadMessagesSchema,
      threadIdRequestSchema.parse(request),
    ),
  appendThreadMessage: (request: AppendThreadMessageRequest) =>
    invokeValidated(
      IPC_CHANNELS.appendThreadMessage,
      operationSuccessSchema,
      appendThreadMessageRequestSchema.parse(request),
    ),
  deleteThreadMessages: (request: DeleteThreadMessagesRequest) =>
    invokeValidated(
      IPC_CHANNELS.deleteThreadMessages,
      operationSuccessSchema,
      deleteThreadMessagesRequestSchema.parse(request),
    ),
  listProviderConfigs: () =>
    invokeValidated(IPC_CHANNELS.listProviderConfigs, providerConfigListSchema),
  createProviderConfig: (request: CreateProviderConfigRequest) =>
    invokeValidated(
      IPC_CHANNELS.createProviderConfig,
      providerConfigSchema,
      createProviderConfigRequestSchema.parse(request),
    ),
  fetchProviderConfig: (request: ProviderConfigIdRequest) =>
    invokeValidated(
      IPC_CHANNELS.fetchProviderConfig,
      providerConfigSchema,
      providerConfigIdRequestSchema.parse(request),
    ),
  updateProviderConfig: (request: UpdateProviderConfigRequest) =>
    invokeValidated(
      IPC_CHANNELS.updateProviderConfig,
      providerConfigSchema,
      updateProviderConfigRequestSchema.parse(request),
    ),
  replaceProviderCredential: (request: ReplaceProviderCredentialRequest) =>
    invokeValidated(
      IPC_CHANNELS.replaceProviderCredential,
      providerConfigSchema,
      replaceProviderCredentialRequestSchema.parse(request),
    ),
  clearProviderCredential: (request: ProviderConfigIdRequest) =>
    invokeValidated(
      IPC_CHANNELS.clearProviderCredential,
      providerConfigSchema,
      providerConfigIdRequestSchema.parse(request),
    ),
  deleteProviderConfig: (request: ProviderConfigIdRequest) =>
    invokeValidated(
      IPC_CHANNELS.deleteProviderConfig,
      operationSuccessSchema,
      providerConfigIdRequestSchema.parse(request),
    ),
  listModelConfigs: () => invokeValidated(IPC_CHANNELS.listModelConfigs, modelConfigListSchema),
  createModelConfig: (request: CreateModelConfigRequest) =>
    invokeValidated(
      IPC_CHANNELS.createModelConfig,
      modelConfigSchema,
      createModelConfigRequestSchema.parse(request),
    ),
  fetchModelConfig: (request: ModelConfigIdRequest) =>
    invokeValidated(
      IPC_CHANNELS.fetchModelConfig,
      modelConfigSchema,
      modelConfigIdRequestSchema.parse(request),
    ),
  updateModelConfig: (request: UpdateModelConfigRequest) =>
    invokeValidated(
      IPC_CHANNELS.updateModelConfig,
      modelConfigSchema,
      updateModelConfigRequestSchema.parse(request),
    ),
  deleteModelConfig: (request: ModelConfigIdRequest) =>
    invokeValidated(
      IPC_CHANNELS.deleteModelConfig,
      operationSuccessSchema,
      modelConfigIdRequestSchema.parse(request),
    ),
  discoverProviderModels: (request: ProviderConfigIdRequest) =>
    invokeValidated(
      IPC_CHANNELS.discoverProviderModels,
      discoveredModelListSchema,
      providerConfigIdRequestSchema.parse(request),
    ),
  testModelConnection: (request: ModelConfigIdRequest) =>
    invokeValidated(
      IPC_CHANNELS.testModelConnection,
      modelConnectionTestResultSchema,
      modelConfigIdRequestSchema.parse(request),
    ),
});

contextBridge.exposeInMainWorld("katarune", api);
