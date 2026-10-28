import { diagnosticIpcMain } from "../diagnostics/ipc";
import { diagnostic } from "../diagnostics/logger";
import { ipcMain } from "electron";
import type { AvatarService } from "../avatar/avatarService";
import {
  IPC_CHANNELS,
  speechCancelRequestSchema,
  speechGenerateRequestSchema,
  speechGenerateResponseSchema,
} from "../../shared/ipc";
import { SpeechRequestRegistry } from "../speech/speechRequestRegistry";
import {
  SpeechServiceError,
  toSpeechServiceError,
  type SpeechService,
} from "../speech/ttsService";

export function registerSpeechHandlers(
  speechService: SpeechService,
  speechRequests: SpeechRequestRegistry,
  avatar?: AvatarService,
): void {
  diagnosticIpcMain.handle(IPC_CHANNELS.generateSpeech, async (event, value: unknown) => {
    const request = speechGenerateRequestSchema.parse(value);
    const abortController = new AbortController();
    const binding = request.threadId ? { characterId: request.characterId, threadId: request.threadId } : undefined;
    const avatarEpoch = binding ? avatar?.captureBinding(binding) : null;
    const unsubscribeAvatar = avatarEpoch != null && binding ? avatar?.subscribe(() => {
      if (avatar.captureBinding(binding) !== avatarEpoch) abortController.abort();
    }) : undefined;
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
      if (avatarEpoch != null && avatar && !avatar.canPlayManualSpeech)
        throw new SpeechServiceError("provider-error", "角色正在表演，请先停止演出再朗读。");
      const result = await speechService.generate(
        request.characterId,
        request.text,
        abortController.signal,
        true,
      );
      if (abortController.signal.aborted) {
        return speechGenerateResponseSchema.parse({
          status: "cancelled",
          requestId: request.requestId,
        });
      }
      if (request.threadId && avatar && avatarEpoch != null && await avatar.playSpeech(
        { characterId: request.characterId, threadId: request.threadId },
        result,
        abortController.signal,
        () => {
          if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.speechStarted,
            speechCancelRequestSchema.parse({ requestId: request.requestId }));
        },
        avatarEpoch,
      )) {
        return speechGenerateResponseSchema.parse({ status: "played", requestId: request.requestId });
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
      const publicError = toSpeechServiceError(error);
      const incidentId = diagnostic("error", "tts.manual-failed", {}, error);
      return speechGenerateResponseSchema.parse({
        status: "error",
        requestId: request.requestId,
        code: publicError.code,
        message: `${publicError.message}${incidentId ? `（故障编号：${incidentId}）` : ""}`,
      });
    } finally {
      unsubscribeAvatar?.();
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
