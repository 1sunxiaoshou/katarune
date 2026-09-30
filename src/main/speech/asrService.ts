import { app, utilityProcess, type UtilityProcess } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { asrResultSchema, type AsrResult } from '../../shared/asr';

type Owner = { sender: number; requestId: string; realtime: boolean; inFlight: boolean };
type Pending = { owner: Owner | undefined; resolve: (result: AsrResult) => void; timer: ReturnType<typeof setTimeout> };
const cancelled: AsrResult = { status: 'cancelled' };

/** Requests lease the worker; weights remain loaded for the application lifetime. */
export class AsrService {
  constructor(private readonly applicationPath = app.getAppPath(),
    private readonly resourcePath = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')) {}
  private child: UtilityProcess | undefined;
  private ready: Promise<AsrResult> | undefined;
  private owner: Owner | undefined;
  private pending = new Map<string, Pending>();

  onTranscribing: ((sender: number, requestId: string) => void) | undefined;

  private request(operation: string, samples?: Float32Array): Promise<AsrResult> {
    const id = randomUUID();
    return new Promise(resolve => {
      const timer = setTimeout(() => this.dispose({ status: 'error', message: '离线识别超时，请重试。' }), 90_000);
      this.pending.set(id, { owner: this.owner, resolve, timer });
      try { this.child!.postMessage({ id, operation, samples }); }
      catch { this.dispose({ status: 'error', message: '离线识别进程不可用，请重试。' }); }
    });
  }
  private load(): Promise<AsrResult> {
    if (this.ready) return this.ready;
    try {
      const child = utilityProcess.fork(join(this.resourcePath, 'asr-worker.cjs'),
        [this.applicationPath, join(this.resourcePath, 'asr', 'sensevoice-int8')],
        { stdio: 'ignore', serviceName: 'Katarune offline speech' });
      this.child = child;
      child.on('message', (value: { id?: string; result?: unknown; progress?: string }) => {
        if (this.child !== child || !value || typeof value.id !== 'string') return;
        const request = this.pending.get(value.id);
        if (!request) return;
        if (value.progress === 'transcribing') {
          if (request.owner && this.owner === request.owner) this.onTranscribing?.(request.owner.sender, request.owner.requestId);
          return;
        }
        this.pending.delete(value.id);
        clearTimeout(request.timer);
        const parsed = asrResultSchema.safeParse(value.result);
        request.resolve(parsed.success ? parsed.data : { status: 'error', message: '离线识别返回无效结果。' });
      });
      child.on('exit', () => {
        if (this.child === child) this.dispose({ status: 'error', message: '离线识别进程已退出，请重试。' });
      });
      this.ready = this.request('load');
      const ready = this.ready;
      void ready.then(result => { if (result.status !== 'success' && this.ready === ready) this.dispose(result); });
      return ready;
    } catch {
      return Promise.resolve({ status: 'error', message: '离线语音模型无法加载，请检查语音资源。' });
    }
  }
  async prepare(sender: number, requestId: string, realtime = false): Promise<AsrResult> {
    if (this.owner) return { status: 'error', message: '已有语音输入正在进行。' };
    const owner: Owner = { sender, requestId, realtime, inFlight: false };
    this.owner = owner;
    let result = await this.load();
    if (this.owner !== owner) return result.status === 'error' ? result : cancelled;
    if (result.status === 'success' && realtime) result = await this.request('vad-load');
    if (this.owner !== owner) return result.status === 'error' ? result : cancelled;
    if (result.status !== 'success') this.owner = undefined;
    return result;
  }
  private owns(sender: number, requestId: string): boolean {
    return this.owner?.sender === sender && this.owner.requestId === requestId;
  }
  async transcribe(sender: number, requestId: string, samples: Float32Array): Promise<AsrResult> {
    return this.run(sender, requestId, 'transcribe', samples);
  }
  async frame(sender: number, requestId: string, samples: Float32Array): Promise<AsrResult> {
    if (!this.owner?.realtime) return cancelled;
    return this.run(sender, requestId, 'frame', samples);
  }
  async reset(sender: number, requestId: string): Promise<AsrResult> {
    if (!this.owns(sender, requestId) || !this.owner?.realtime) return cancelled;
    return this.request('reset');
  }
  private async run(sender: number, requestId: string, operation: string, samples: Float32Array): Promise<AsrResult> {
    if (!this.owns(sender, requestId) || !this.child || this.owner!.inFlight) return cancelled;
    const owner = this.owner!;
    owner.inFlight = true;
    const result = await this.request(operation, samples);
    if (this.owner !== owner) return result.status === 'error' ? result : cancelled;
    owner.inFlight = false;
    if (!owner.realtime) this.owner = undefined;
    return result;
  }
  cancel(sender: number, requestId?: string): void {
    if (this.owner?.sender !== sender || (requestId !== undefined && this.owner.requestId !== requestId)) return;
    const realtime = this.owner.realtime;
    this.owner = undefined;
    if (realtime && this.child) void this.request('reset');
    // Synchronous inference can finish; its result cannot escape its old lease.
  }
  dispose(result: AsrResult = cancelled): void {
    const child = this.child;
    this.child = undefined;
    this.ready = undefined;
    this.owner = undefined;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.resolve(result); }
    this.pending.clear();
    child?.kill();
  }
}
