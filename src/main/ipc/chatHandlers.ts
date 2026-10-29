import { OperationRejected, parseRequest } from "../diagnostics/operationRejected";
import { diagnostic } from "../diagnostics/logger";
import { diagnosticIpcMain } from "../diagnostics/ipc";
import type { AvatarService } from "../avatar/avatarService";
import type { LiveService } from "../live/liveService";
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
  live?: LiveService,
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
    const request = parseRequest(importChatAttachmentRequestSchema, value);
    return assetService.importChatAttachment(request, database);
  });
  diagnosticIpcMain.handle(IPC_CHANNELS.releaseChatAttachment, (_event, value: unknown) => {
    const { assetId } = parseRequest(releaseChatAttachmentRequestSchema, value);
    assetService.releaseChatAttachment(assetId, database);
    return operationSuccessSchema.parse({ success: true });
  });

  diagnosticIpcMain.handle(IPC_CHANNELS.listThreads, (_event, value: unknown) => {
    const { characterId } = parseRequest(listThreadsRequestSchema, value);
    return database.listThreads(characterId);
  });
  diagnosticIpcMain.handle(IPC_CHANNELS.initializeThread, (_event, value: unknown) => {
    const { threadId, characterId } = parseRequest(threadIdRequestSchema, value);
    return database.initializeThread(threadId, characterId);
  });
  diagnosticIpcMain.handle(IPC_CHANNELS.fetchThread, (_event, value: unknown) => {
    const { threadId, characterId } = parseRequest(threadIdRequestSchema, value);
    return database.fetchThread(threadId, characterId);
  });
  diagnosticIpcMain.handle(IPC_CHANNELS.generateThreadTitle, async (_event, value: unknown) => {
    const request = parseRequest(generateThreadTitleRequestSchema, value);
    return generateThreadTitleResponseSchema.parse(
      await chatService.generateTitle(request),
    );
  });
  diagnosticIpcMain.handle(IPC_CHANNELS.renameThread, (_event, value: unknown) => {
    const { threadId, characterId, title } = parseRequest(renameThreadRequestSchema, value);
    database.renameThread(threadId, characterId, title);
    return operationSuccessSchema.parse({ success: true });
  });
  diagnosticIpcMain.handle(IPC_CHANNELS.setThreadStatus, (_event, value: unknown) => {
    const { threadId, characterId, status } = parseRequest(setThreadStatusRequestSchema, value);
    database.setThreadStatus(threadId, characterId, status);
    return operationSuccessSchema.parse({ success: true });
  });
  diagnosticIpcMain.handle(IPC_CHANNELS.deleteThread, async (_event, value: unknown) => {
    const { threadId, characterId } = parseRequest(threadIdRequestSchema, value);
    database.fetchThread(threadId, characterId);
    if (live?.active && live.status.threadId === threadId) await live.stop();
    chatStreams.cancelThread(characterId, threadId);
    const candidateAssetIds = database.deleteThread(threadId, characterId);
    for (const assetId of candidateAssetIds) {
      assetService.releaseChatAttachment(assetId, database);
    }
    return operationSuccessSchema.parse({ success: true });
  });
  diagnosticIpcMain.handle(IPC_CHANNELS.loadThreadMessages, (_event, value: unknown) => {
    const { threadId, characterId } = parseRequest(threadIdRequestSchema, value);
    return database.loadThreadMessages(threadId, characterId);
  });
  diagnosticIpcMain.handle(IPC_CHANNELS.appendThreadMessage, (_event, value: unknown) => {
    const request = parseRequest(appendThreadMessageRequestSchema, value);
    if (database.fetchThread(request.threadId, request.characterId).kind === "live") throw new OperationRejected("operation-not-allowed");
    database.appendThreadMessage(request);
    database.queueMemoryDiaryMessage(request.characterId, request.message.id, Intl.DateTimeFormat().resolvedOptions().timeZone);
    return operationSuccessSchema.parse({ success: true });
  });
  diagnosticIpcMain.handle(IPC_CHANNELS.deleteThreadMessages, (_event, value: unknown) => {
    const { threadId, characterId, messageIds } =
      parseRequest(deleteThreadMessagesRequestSchema, value);
    if (database.fetchThread(threadId, characterId).kind === "live") throw new OperationRejected("operation-not-allowed");
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
    if (port === undefined) {
      diagnostic("warn", "chat.stream-rejected", { outcome: "rejected", reasonCode: "missing-port" });
      return;
    }

    const request = chatStreamRequestSchema.safeParse(value);
    if (!request.success) {
      diagnostic("warn", "chat.stream-rejected", { outcome: "rejected", reasonCode: "invalid-input" });
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
    try {
      if (database.fetchThread(request.data.threadId, request.data.characterId).kind === "live") throw new OperationRejected("operation-not-allowed");
    } catch (error) {
      let message: string;
      if (error instanceof OperationRejected) {
        diagnostic("warn", "chat.stream-rejected", { outcome: "rejected", reasonCode: error.reasonCode });
        message = `${error.message}（原因码：${error.reasonCode}）`;
      } else {
        const incidentId = diagnostic("error", "chat.stream-failed", { outcome: "failed" }, error);
        message = `无法读取会话，请稍后重试。${incidentId ? `（故障编号：${incidentId}）` : ""}`;
      }
      port.start(); port.postMessage({ type: "error", message }); port.close(); return;
    }
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
