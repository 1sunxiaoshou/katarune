import { ipcMain } from "electron";
import {
  IPC_CHANNELS,
  speechCancelRequestSchema,
  speechGenerateRequestSchema,
  speechGenerateResponseSchema,
} from "../../shared/ipc";
import { SpeechRequestRegistry } from "../speech/speechRequestRegistry";
import {
  SpeechServiceError,
  type SpeechService,
} from "../speech/ttsService";

export function registerSpeechHandlers(
  speechService: SpeechService,
  speechRequests: SpeechRequestRegistry,
): void {
  ipcMain.handle(IPC_CHANNELS.generateSpeech, async (event, value: unknown) => {
    const request = speechGenerateRequestSchema.parse(value);
    const abortController = new AbortController();
    const senderId = event.sender.id;
    const unregister = speechRequests.register(
      senderId,
      request.requestId,
      abortController,
    );
    const handleSenderDestroyed = (): void =>
      speechRequests.cancelSender(senderId);
    event.sender.once("destroyed", handleSenderDestroyed);

    try {
      const result = await speechService.generate(
        request.characterId,
        request.text,
        abortController.signal,
      );
      if (abortController.signal.aborted) {
        return speechGenerateResponseSchema.parse({
          status: "cancelled",
          requestId: request.requestId,
        });
      }
      return speechGenerateResponseSchema.parse({
        status: "success",
        requestId: request.requestId,
        audio: result.audio,
        format: result.format,
        mediaType: result.mediaType,
        cacheHit: result.cacheHit,
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        return speechGenerateResponseSchema.parse({
          status: "cancelled",
          requestId: request.requestId,
        });
      }
      const publicError =
        error instanceof SpeechServiceError
          ? error
          : new SpeechServiceError(
              "provider-error",
              "语音生成失败，请检查供应商连接后重试。",
            );
      return speechGenerateResponseSchema.parse({
        status: "error",
        requestId: request.requestId,
        code: publicError.code,
        message: publicError.message,
      });
    } finally {
      unregister();
      event.sender.removeListener("destroyed", handleSenderDestroyed);
    }
  });
  ipcMain.on(IPC_CHANNELS.cancelSpeech, (event, value: unknown) => {
    const request = speechCancelRequestSchema.safeParse(value);
    if (!request.success) return;
    speechRequests.cancel(event.sender.id, request.data.requestId);
  });
}
