import { contextBridge, ipcRenderer } from "electron";
import {
  aiRuntimeStatusSchema,
  appendThreadMessageRequestSchema,
  appInfoSchema,
  appStateSchema,
  availableSpeechModelListSchema,
  characterIdRequestSchema,
  characterListSchema,
  characterPortraitImportRequestSchema,
  characterPortraitImportResultSchema,
  characterSchema,
  chatStreamRequestSchema,
  chatStreamResponseFrameSchema,
  createCharacterRequestSchema,
  createProviderConfigRequestSchema,
  discoveredModelListSchema,
  generateThreadTitleRequestSchema,
  generateThreadTitleResponseSchema,
  databaseStatusSchema,
  deleteCharacterResultSchema,
  deleteThreadMessagesRequestSchema,
  initializeThreadResponseSchema,
  listThreadsRequestSchema,
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
  setActiveCharacterRequestSchema,
  speechCancelRequestSchema,
  speechGenerateRequestSchema,
  speechGenerateResponseSchema,
  threadIdRequestSchema,
  threadListSchema,
  threadMessagesSchema,
  threadMetadataSchema,
  updateProviderConfigRequestSchema,
  updateModelConfigRequestSchema,
  updateCharacterRequestSchema,
  type AppendThreadMessageRequest,
  type CharacterIdRequest,
  type CharacterPortraitImportRequest,
  type ChatStreamFrameListener,
  type ChatStreamRequest,
  type ListThreadsRequest,
  type CreateProviderConfigRequest,
  type CreateCharacterRequest,
  type CreateModelConfigRequest,
  type DeleteThreadMessagesRequest,
  type GenerateThreadTitleRequest,
  type KataruneApi,
  type ProviderConfigIdRequest,
  type ReplaceProviderCredentialRequest,
  type ModelConfigIdRequest,
  type RenameThreadRequest,
  type SetThreadStatusRequest,
  type SetActiveCharacterRequest,
  type SpeechCancelRequest,
  type SpeechGenerateRequest,
  type ThreadIdRequest,
  type UpdateProviderConfigRequest,
  type UpdateModelConfigRequest,
  type UpdateCharacterRequest,
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

const chatStreamPorts = new Map<string, MessagePort>();

function closeChatStreamPort(requestId: string): void {
  const port = chatStreamPorts.get(requestId);
  if (port === undefined) return;
  chatStreamPorts.delete(requestId);
  port.close();
}

const api: KataruneApi = Object.freeze({
  getAppInfo: () => invokeValidated(IPC_CHANNELS.getAppInfo, appInfoSchema),
  getDatabaseStatus: () => invokeValidated(IPC_CHANNELS.getDatabaseStatus, databaseStatusSchema),
  getAiRuntimeStatus: () => invokeValidated(IPC_CHANNELS.getAiRuntimeStatus, aiRuntimeStatusSchema),
  getAppState: () => invokeValidated(IPC_CHANNELS.getAppState, appStateSchema),
  setActiveCharacter: (request: SetActiveCharacterRequest) =>
    invokeValidated(
      IPC_CHANNELS.setActiveCharacter,
      appStateSchema,
      setActiveCharacterRequestSchema.parse(request),
    ),
  listThreads: (request: ListThreadsRequest) =>
    invokeValidated(
      IPC_CHANNELS.listThreads,
      threadListSchema,
      listThreadsRequestSchema.parse(request),
    ),
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
  generateThreadTitle: (request: GenerateThreadTitleRequest) =>
    invokeValidated(
      IPC_CHANNELS.generateThreadTitle,
      generateThreadTitleResponseSchema,
      generateThreadTitleRequestSchema.parse(request),
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
  startChatStream: (
    request: ChatStreamRequest,
    listener: ChatStreamFrameListener,
  ) => {
    const parsedRequest = chatStreamRequestSchema.parse(request);
    closeChatStreamPort(parsedRequest.requestId);

    const channel = new MessageChannel();
    chatStreamPorts.set(parsedRequest.requestId, channel.port1);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      let frame;
      try {
        frame = chatStreamResponseFrameSchema.parse(event.data);
      } catch {
        listener({
          type: "error",
          message: "聊天流返回了无效数据。",
        });
        closeChatStreamPort(parsedRequest.requestId);
        return;
      }
      try {
        listener(frame);
      } catch {
        closeChatStreamPort(parsedRequest.requestId);
      } finally {
        if (frame.type !== "data") {
          closeChatStreamPort(parsedRequest.requestId);
        }
      }
    };
    channel.port1.onmessageerror = () => {
      listener({
        type: "error",
        message: "聊天流数据无法读取。",
      });
      closeChatStreamPort(parsedRequest.requestId);
    };
    channel.port1.start();
    ipcRenderer.postMessage(
      IPC_CHANNELS.startChatStream,
      parsedRequest,
      [channel.port2],
    );
  },
  pullChatStream: (requestId: string) => {
    chatStreamPorts.get(requestId)?.postMessage({ type: "pull" });
  },
  cancelChatStream: (requestId: string) => {
    const port = chatStreamPorts.get(requestId);
    if (port === undefined) return;
    port.postMessage({ type: "cancel" });
    closeChatStreamPort(requestId);
  },
  listAvailableSpeechModels: () =>
    invokeValidated(
      IPC_CHANNELS.listAvailableSpeechModels,
      availableSpeechModelListSchema,
    ),
  generateSpeech: (request: SpeechGenerateRequest) =>
    invokeValidated(
      IPC_CHANNELS.generateSpeech,
      speechGenerateResponseSchema,
      speechGenerateRequestSchema.parse(request),
    ),
  cancelSpeech: (request: SpeechCancelRequest) => {
    ipcRenderer.send(
      IPC_CHANNELS.cancelSpeech,
      speechCancelRequestSchema.parse(request),
    );
  },
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
  listCharacters: () => invokeValidated(IPC_CHANNELS.listCharacters, characterListSchema),
  createCharacter: (request: CreateCharacterRequest) =>
    invokeValidated(
      IPC_CHANNELS.createCharacter,
      characterSchema,
      createCharacterRequestSchema.parse(request),
    ),
  deleteCharacter: (request: CharacterIdRequest) =>
    invokeValidated(
      IPC_CHANNELS.deleteCharacter,
      deleteCharacterResultSchema,
      characterIdRequestSchema.parse(request),
    ),
  updateCharacter: (request: UpdateCharacterRequest) =>
    invokeValidated(
      IPC_CHANNELS.updateCharacter,
      characterSchema,
      updateCharacterRequestSchema.parse(request),
    ),
  importCharacterPortrait: (request: CharacterPortraitImportRequest) =>
    invokeValidated(
      IPC_CHANNELS.importCharacterPortrait,
      characterPortraitImportResultSchema,
      characterPortraitImportRequestSchema.parse(request),
    ),
});

contextBridge.exposeInMainWorld("katarune", api);
