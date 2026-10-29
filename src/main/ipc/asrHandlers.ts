import { parseRequest } from "../diagnostics/operationRejected";
import { diagnostic } from "../diagnostics/logger";
import { diagnosticIpcMain } from "../diagnostics/ipc";
import { ipcMain, webContents } from 'electron';
import { ASR_CHANNELS, asrRequestIdSchema, asrRequestSchema, asrFrameSchema, realtimeAsrRequestSchema, type RealtimeAsrRequest } from '../../shared/asr';
import type { AvatarService } from '../avatar/avatarService';
import { AsrService } from '../speech/asrService';
import type { DatabaseRuntime } from '../database/database';

export function registerAsrHandlers(database: Pick<DatabaseRuntime, 'getAppSettings'>, avatar?: AvatarService): AsrService {
  const service = new AsrService();
  service.onTranscribing = (sender, requestId) => {
    const contents = webContents.fromId(sender);
    if (contents && !contents.isDestroyed()) contents.send(ASR_CHANNELS.progress, { requestId });
  };
  const watched = new Set<number>();
  const realtime = new Map<number, RealtimeAsrRequest>();
  const validBinding = (request: RealtimeAsrRequest) => !avatar?.liveActive && avatar?.status.phase === 'ready'
    && avatar.status.binding?.characterId === request.characterId && avatar.status.binding.threadId === request.threadId;
  const watch = (sender: Electron.WebContents) => {
    if (watched.has(sender.id)) return;
    watched.add(sender.id);
    const cancel = () => { realtime.delete(sender.id); service.cancel(sender.id); };
    sender.once('destroyed', () => { watched.delete(sender.id); cancel(); });
    sender.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) cancel(); });
  };
  let wasLive = false;
  avatar?.subscribe(() => {
    if (avatar.liveActive && !wasLive) service.dispose();
    wasLive = avatar.liveActive;
    for (const [sender, request] of realtime) {
      if (!validBinding(request)) { realtime.delete(sender); service.cancel(sender, request.requestId); }
    }
  });
  diagnosticIpcMain.handle(ASR_CHANNELS.realtime, async (event, value: unknown) => {
    const request = parseRequest(realtimeAsrRequestSchema, value);
    if (!validBinding(request)) return { status: 'error', message: '请先连接桌宠，再开启实时对话。' };
    if (database.getAppSettings().defaultAsrModel === null) return { status: 'error', message: '请先启用语音识别模型。' };
    avatar?.clearError();
    watch(event.sender);
    if (realtime.has(event.sender.id)) return { status: 'error', message: '实时对话已经开启。' };
    realtime.set(event.sender.id, request);
    const result = await service.prepare(event.sender.id, request.requestId, true);
    if (realtime.get(event.sender.id) !== request) return { status: 'cancelled' };
    if (result.status !== 'success') realtime.delete(event.sender.id);
    if (!validBinding(request)) { service.cancel(event.sender.id, request.requestId); return { status: 'cancelled' }; }
    return result;
  });
  diagnosticIpcMain.handle(ASR_CHANNELS.frame, async (event, value: unknown) => {
    const frame = parseRequest(asrFrameSchema, value);
    const request = realtime.get(event.sender.id);
    if (!request || request.requestId !== frame.requestId || !validBinding(request)) return { status: 'cancelled' };
    if (database.getAppSettings().defaultAsrModel === null) {
      service.cancel(event.sender.id, frame.requestId);
      return { status: 'error', message: '语音识别已关闭。' };
    }
    const result = await service.frame(event.sender.id, frame.requestId, frame.samples);
    if (realtime.get(event.sender.id) !== request || !validBinding(request)) return { status: 'success', text: '' };
    return result;
  });
  diagnosticIpcMain.handle(ASR_CHANNELS.reset, (event, value: unknown) => {
    const { requestId } = parseRequest(asrRequestIdSchema, value);
    return service.reset(event.sender.id, requestId);
  });
  diagnosticIpcMain.handle(ASR_CHANNELS.prepare, async (event, value: unknown) => {
    const { requestId } = parseRequest(asrRequestIdSchema, value);
    if (avatar?.liveActive) return { status: 'error', message: '直播期间仅文字交流。' };
    if (database.getAppSettings().defaultAsrModel === null) {
      return { status: 'error', message: '请先在默认模型设置中选择语音识别模型。' };
    }
    const id = event.sender.id;
    watch(event.sender);
    return service.prepare(id, requestId);
  });
  diagnosticIpcMain.handle(ASR_CHANNELS.transcribe, async (event, value: unknown) => {
    const request = parseRequest(asrRequestSchema, value);
    if (avatar?.liveActive) { service.cancel(event.sender.id, request.requestId); return { status: 'cancelled' }; }
    if (database.getAppSettings().defaultAsrModel === null) {
      service.cancel(event.sender.id, request.requestId);
      return { status: 'error', message: '语音识别已关闭。' };
    }
    const cleanup = () => service.cancel(event.sender.id, request.requestId);
    event.sender.once('destroyed', cleanup);
    try { return await service.transcribe(event.sender.id, request.requestId, request.samples); }
    finally { event.sender.removeListener('destroyed', cleanup); }
  });
  ipcMain.on(ASR_CHANNELS.cancel, (event, value: unknown) => {
    const parsed = asrRequestIdSchema.safeParse(value);
    if (!parsed.success) diagnostic("warn", "asr.cancel-rejected", { outcome: "rejected", reasonCode: "invalid-input" });
    if (parsed.success) {
      if (realtime.get(event.sender.id)?.requestId === parsed.data.requestId) realtime.delete(event.sender.id);
      service.cancel(event.sender.id, parsed.data.requestId);
    }
  });
  return service;
}
