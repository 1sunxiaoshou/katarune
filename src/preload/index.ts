import { PACKAGE_CHANNELS, packageListSchema, packageIdRequestSchema, characterPackageSchema, packageBindSchema, packageImportRequestSchema, packageImportResultSchema, packageProgressSchema, type PackageProgress } from "../shared/characterPackages";
import { AVATAR_CHANNELS, avatarBindingSchema, avatarStatusSchema, avatarVoiceStateSchema, avatarPlaybackControlSchema, avatarUserSubtitleSchema, type AvatarBinding } from "../shared/avatar";
import { contextBridge, ipcRenderer } from "electron";
import {
  discoverProviderModelsRequestSchema,
  type DiscoverProviderModelsRequest,
  aiRuntimeStatusSchema,
  appendThreadMessageRequestSchema,
  appInfoSchema,
  appSettingsSchema,
  appStateSchema,
  availableModelListSchema,
  characterIdRequestSchema,
  characterListSchema,
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
  importChatAttachmentRequestSchema,
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
  releaseChatAttachmentRequestSchema,
  assetSchema,
  renameThreadRequestSchema,
  setThreadStatusRequestSchema,
  setActiveCharacterRequestSchema,
  updateAppSettingsRequestSchema,
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
  type ChatStreamFrameListener,
  type ChatStreamRequest,
  type ListThreadsRequest,
  type CreateProviderConfigRequest,
  type CreateCharacterRequest,
  type CreateModelConfigRequest,
  type DeleteThreadMessagesRequest,
  type GenerateThreadTitleRequest,
  type ImportChatAttachmentRequest,
  type KataruneApi,
  type ProviderConfigIdRequest,
  type ReplaceProviderCredentialRequest,
  type ModelConfigIdRequest,
  type RenameThreadRequest,
  type ReleaseChatAttachmentRequest,
  type SetThreadStatusRequest,
  type UpdateAppSettingsRequest,
  type SetActiveCharacterRequest,
  type SpeechCancelRequest,
  type SpeechGenerateRequest,
  type ThreadIdRequest,
  type UpdateProviderConfigRequest,
  type UpdateModelConfigRequest,
  type UpdateCharacterRequest,
} from "../shared/ipc";

import { ASR_CHANNELS, asrRequestIdSchema, asrRequestSchema, asrResultSchema, type AsrRequest, asrFrameSchema, realtimeAsrRequestSchema, type RealtimeAsrRequest } from '../shared/asr';

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
  listCharacterPackages: () => invokeValidated(PACKAGE_CHANNELS.list, packageListSchema),
  fetchCharacterPackage: (value: { id: string }) => invokeValidated(PACKAGE_CHANNELS.detail, characterPackageSchema, packageIdRequestSchema.parse(value)),
  importCharacterPackage: (value: { requestId: string }) => invokeValidated(PACKAGE_CHANNELS.import, packageImportResultSchema, packageImportRequestSchema.parse(value)),
  cancelCharacterPackageImport: (value: { requestId: string }) => invokeValidated(PACKAGE_CHANNELS.cancel, operationSuccessSchema, packageImportRequestSchema.parse(value)),
  deleteCharacterPackage: (value: { id: string }) => invokeValidated(PACKAGE_CHANNELS.remove, operationSuccessSchema, packageIdRequestSchema.parse(value)),
  bindCharacterPackage: (value: { characterId: string; packageId: string }) => invokeValidated(PACKAGE_CHANNELS.bind, characterSchema, packageBindSchema.parse(value)),
  onCharacterPackageProgress: (listener: (value: PackageProgress) => void) => {
    const handle = (_event: Electron.IpcRendererEvent, value: unknown) => { const parsed = packageProgressSchema.safeParse(value); if (parsed.success) listener(parsed.data); };
    ipcRenderer.on(PACKAGE_CHANNELS.progress, handle); return () => { ipcRenderer.removeListener(PACKAGE_CHANNELS.progress, handle); };
  },
  onOpenCharacterPackages: (listener: (characterId: string | null) => void) => { const handle = (_event: Electron.IpcRendererEvent, value: unknown) => listener(typeof value === "string" ? value : null); ipcRenderer.on("character-packages:open", handle); return () => { ipcRenderer.removeListener("character-packages:open", handle); }; },
  prepareRealtimeAsr: (request: RealtimeAsrRequest) => invokeValidated(ASR_CHANNELS.realtime, asrResultSchema, realtimeAsrRequestSchema.parse(request)),
  pushAsrFrame: (request: AsrRequest) => invokeValidated(ASR_CHANNELS.frame, asrResultSchema, asrFrameSchema.parse(request)),
  resetRealtimeAsr: (request: { requestId: string }) => invokeValidated(ASR_CHANNELS.reset, asrResultSchema, asrRequestIdSchema.parse(request)),
  onAsrTranscribing: (listener: (requestId: string) => void) => {
    const handle = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = asrRequestIdSchema.safeParse(value);
      if (parsed.success) listener(parsed.data.requestId);
    };
    ipcRenderer.on(ASR_CHANNELS.progress, handle);
    return () => { ipcRenderer.removeListener(ASR_CHANNELS.progress, handle); };
  },
  onAvatarStatus: (listener: (status: import('../shared/avatar').AvatarStatus) => void) => {
    const handle = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = avatarStatusSchema.safeParse(value);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(AVATAR_CHANNELS.changed, handle);
    return () => { ipcRenderer.removeListener(AVATAR_CHANNELS.changed, handle); };
  },
  prepareAsr: (request: { requestId: string }) => invokeValidated(ASR_CHANNELS.prepare, asrResultSchema, asrRequestIdSchema.parse(request)),
  transcribeAsr: (request: AsrRequest) => invokeValidated(ASR_CHANNELS.transcribe, asrResultSchema, asrRequestSchema.parse(request)),
  cancelAsr: (request: { requestId: string }) => ipcRenderer.send(ASR_CHANNELS.cancel, asrRequestIdSchema.parse(request)),
  startAvatar: (request: AvatarBinding) => invokeValidated(AVATAR_CHANNELS.start, avatarStatusSchema, avatarBindingSchema.parse(request)),
  stopAvatar: () => invokeValidated(AVATAR_CHANNELS.stop, avatarStatusSchema),
  getAvatarStatus: () => invokeValidated(AVATAR_CHANNELS.status, avatarStatusSchema),
  setAvatarVoiceState: (request: import('../shared/avatar').AvatarVoiceStateRequest) => ipcRenderer.invoke(AVATAR_CHANNELS.voiceState, avatarVoiceStateSchema.parse(request)),
  controlAvatarPlayback: (request: import('../shared/avatar').AvatarPlaybackControlRequest) => ipcRenderer.invoke(AVATAR_CHANNELS.playbackControl, avatarPlaybackControlSchema.parse(request)),
  showAvatarUserSubtitle: (request: import('../shared/avatar').AvatarUserSubtitleRequest) => ipcRenderer.invoke(AVATAR_CHANNELS.userSubtitle, avatarUserSubtitleSchema.parse(request)),
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
  getAppSettings: () =>
    invokeValidated(IPC_CHANNELS.getAppSettings, appSettingsSchema),
  updateAppSettings: (request: UpdateAppSettingsRequest) =>
    invokeValidated(
      IPC_CHANNELS.updateAppSettings,
      appSettingsSchema,
      updateAppSettingsRequestSchema.parse(request),
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
  importChatAttachment: (request: ImportChatAttachmentRequest) =>
    invokeValidated(
      IPC_CHANNELS.importChatAttachment,
      assetSchema,
      importChatAttachmentRequestSchema.parse(request),
    ),
  releaseChatAttachment: (request: ReleaseChatAttachmentRequest) =>
    invokeValidated(
      IPC_CHANNELS.releaseChatAttachment,
      operationSuccessSchema,
      releaseChatAttachmentRequestSchema.parse(request),
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
  listAvailableModels: () =>
    invokeValidated(
      IPC_CHANNELS.listAvailableModels,
      availableModelListSchema,
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
  onSpeechStarted: (callback: (request: SpeechCancelRequest) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const result = speechCancelRequestSchema.safeParse(value);
      if (result.success) callback(result.data);
    };
    ipcRenderer.on(IPC_CHANNELS.speechStarted, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.speechStarted, listener);
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
  discoverProviderModels: (request: DiscoverProviderModelsRequest) =>
    invokeValidated(
      IPC_CHANNELS.discoverProviderModels,
      discoveredModelListSchema,
      discoverProviderModelsRequestSchema.parse(request),
    ),
  refreshModelMetadata: (request: ModelConfigIdRequest) =>
    invokeValidated(
      IPC_CHANNELS.refreshModelMetadata,
      modelConfigSchema,
      modelConfigIdRequestSchema.parse(request),
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

});

contextBridge.exposeInMainWorld("katarune", api);
