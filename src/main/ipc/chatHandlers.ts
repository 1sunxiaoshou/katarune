import { diagnosticIpcMain } from "../diagnostics/ipc";
import type { AvatarService } from "../avatar/avatarService";
import { ipcMain } from "electron";
import {
  appendThreadMessageRequestSchema,
  chatStreamRequestSchema,
  chatStreamResponseFrameSchema,
  deleteThreadMessagesRequestSchema,
  generateThreadTitleRequestSchema,
  generateThreadTitleResponseSchema,
  IPC_CHANNELS,
  importChatAttachmentRequestSchema,
  listThreadsRequestSchema,
  operationSuccessSchema,
  releaseChatAttachmentRequestSchema,
  renameThreadRequestSchema,
  setThreadStatusRequestSchema,
  threadIdRequestSchema,
} from "../../shared/ipc";
import { createChatService } from "../ai/chatService";
import { ChatStreamRegistry, startChatStream } from "../ai/chatStream";
import type { AiRuntime } from "../ai/runtime";
import type { DatabaseRuntime } from "../database/database";
import type { AssetService } from "../assets/assetService";
import { createElectronChatImageProcessor } from "../assets/chatImageProcessor";

export function registerChatHandlers(
  database: DatabaseRuntime,
  aiRuntime: AiRuntime,
  chatStreams: ChatStreamRegistry,
  assetService: AssetService,
  avatar?: AvatarService,
): void {
  const chatService = createChatService({
    database,
    aiRuntime,
    memory: database,
    ...(avatar ? { avatar } : {}),
    attachmentSupport: {
      assetService,
      imageProcessor: createElectronChatImageProcessor(),
    },
  });

  diagnosticIpcMain.handle(IPC_CHANNELS.importChatAttachment, (_event, value: unknown) => {
    const request = importChatAttachmentRequestSchema.parse(value);
    return assetService.importChatAttachment(request, database);
  });
  diagnosticIpcMain.handle(IPC_CHANNELS.releaseChatAttachment, (_event, value: unknown) => {
    const { assetId } = releaseChatAttachmentRequestSchema.parse(value);
    assetService.releaseChatAttachment(assetId, database);
    return operationSuccessSchema.parse({ success: true });
  });

  diagnosticIpcMain.handle(IPC_CHANNELS.listThreads, (_event, value: unknown) => {
    const { characterId } = listThreadsRequestSchema.parse(value);
    return database.listThreads(characterId);
  });
  diagnosticIpcMain.handle(IPC_CHANNELS.initializeThread, (_event, value: unknown) => {
    const { threadId, characterId } = threadIdRequestSchema.parse(value);
    return database.initializeThread(threadId, characterId);
  });
  diagnosticIpcMain.handle(IPC_CHANNELS.fetchThread, (_event, value: unknown) => {
    const { threadId, characterId } = threadIdRequestSchema.parse(value);
    return database.fetchThread(threadId, characterId);
  });
  diagnosticIpcMain.handle(IPC_CHANNELS.generateThreadTitle, async (_event, value: unknown) => {
    const request = generateThreadTitleRequestSchema.parse(value);
    return generateThreadTitleResponseSchema.parse(
      await chatService.generateTitle(request),
    );
  });
  diagnosticIpcMain.handle(IPC_CHANNELS.renameThread, (_event, value: unknown) => {
    const { threadId, characterId, title } = renameThreadRequestSchema.parse(value);
    database.renameThread(threadId, characterId, title);
    return operationSuccessSchema.parse({ success: true });
  });
  diagnosticIpcMain.handle(IPC_CHANNELS.setThreadStatus, (_event, value: unknown) => {
    const { threadId, characterId, status } = setThreadStatusRequestSchema.parse(value);
    database.setThreadStatus(threadId, characterId, status);
    return operationSuccessSchema.parse({ success: true });
  });
  diagnosticIpcMain.handle(IPC_CHANNELS.deleteThread, (_event, value: unknown) => {
    const { threadId, characterId } = threadIdRequestSchema.parse(value);
    chatStreams.cancelThread(characterId, threadId);
    const candidateAssetIds = database.deleteThread(threadId, characterId);
    for (const assetId of candidateAssetIds) {
      assetService.releaseChatAttachment(assetId, database);
    }
    return operationSuccessSchema.parse({ success: true });
  });
  diagnosticIpcMain.handle(IPC_CHANNELS.loadThreadMessages, (_event, value: unknown) => {
    const { threadId, characterId } = threadIdRequestSchema.parse(value);
    return database.loadThreadMessages(threadId, characterId);
  });
  diagnosticIpcMain.handle(IPC_CHANNELS.appendThreadMessage, (_event, value: unknown) => {
    const request = appendThreadMessageRequestSchema.parse(value);
    database.appendThreadMessage(request);
    database.queueMemoryDiaryMessage(request.characterId, request.message.id, Intl.DateTimeFormat().resolvedOptions().timeZone);
    return operationSuccessSchema.parse({ success: true });
  });
  diagnosticIpcMain.handle(IPC_CHANNELS.deleteThreadMessages, (_event, value: unknown) => {
    const { threadId, characterId, messageIds } =
      deleteThreadMessagesRequestSchema.parse(value);
    const candidateAssetIds = database.deleteThreadMessages(
      threadId,
      characterId,
      messageIds,
    );
    for (const assetId of candidateAssetIds) {
      assetService.releaseChatAttachment(assetId, database);
    }
    return operationSuccessSchema.parse({ success: true });
  });
  ipcMain.on(IPC_CHANNELS.startChatStream, (event, value: unknown) => {
    const port = event.ports[0];
    if (port === undefined) return;

    const request = chatStreamRequestSchema.safeParse(value);
    if (!request.success) {
      port.start();
      port.postMessage(
        chatStreamResponseFrameSchema.parse({
          type: "error",
          message: "聊天请求无效。",
        }),
      );
      port.close();
      return;
    }

    const senderId = event.sender.id;
    let unregisterStream = (): void => undefined;
    let streamClosed = false;
    const handleSenderDestroyed = (): void => chatStreams.cancelSender(senderId);
    const closeStream = startChatStream({
      chatService,
      request: request.data,
      port,
      onClose: () => {
        streamClosed = true;
        unregisterStream();
        event.sender.removeListener("destroyed", handleSenderDestroyed);
      },
    });
    if (!streamClosed) {
      unregisterStream = chatStreams.register({
        senderId,
        requestId: request.data.requestId,
        characterId: request.data.characterId,
        threadId: request.data.threadId,
        close: closeStream,
      });
      event.sender.once("destroyed", handleSenderDestroyed);
    }
  });
}
