import { diagnostic } from "../diagnostics/logger";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UIMessageChunk } from "ai";
import type { SpeechService } from "../speech/ttsService";
import { extractSpokenText } from "../speech/spokenText";
import { createAvatarSpeechStream } from "./avatarSpeechStream";

export class AvatarDialogueSpeech {
  private blocks = new Map<string, string>();
  private queue: { id: string; text: string }[] = [];
  private occupied = new Set<string>();
  private delivery = new Map<string, "spoken" | "chat-only">();
  private generating = false;
  private stopped = false;
  private task: Promise<void> = Promise.resolve();
  private directory?: string;
  private lifetime = new AbortController();
  private transfers = new Map<string, Awaited<ReturnType<typeof createAvatarSpeechStream>>>();

  constructor(private readonly runId: string, private readonly characterId: string,
    private readonly service: SpeechService, private readonly send: (message: object) => void,
    private readonly temporaryDirectory = tmpdir(), private readonly onFailure: (error: unknown, incidentId?: string) => void = () => {}) {}

  observe(chunk: UIMessageChunk) {
    if (this.stopped) return;
    if (chunk.type === "text-start") this.blocks.set(chunk.id, "");
    if (chunk.type === "text-delta" && this.blocks.has(chunk.id))
      this.blocks.set(chunk.id, this.blocks.get(chunk.id)! + chunk.delta);
    if (chunk.type === "text-end") this.complete(chunk.id);
    if (chunk.type === "finish-step" || chunk.type === "finish") this.seal();
    if (chunk.type === "error" || chunk.type === "abort") {
      for (const [id, text] of this.blocks) this.send({ type: "dialogue-audio", runId: this.runId,
        dialogueId: id, failed: true, text: extractSpokenText(text) });
      this.blocks.clear();
    }
  }

  seal() { for (const id of this.blocks.keys()) this.complete(id); }

  private complete(id: string) {
    const text = this.blocks.get(id);
    if (text === undefined) return;
    this.blocks.delete(id);
    if (this.delivery.get(id) === "chat-only") return;
    this.queue.push({ id, text });
    this.pump();
  }

  admit(id: string, delivery: "spoken" | "chat-only") {
    if (this.stopped || this.delivery.has(id)) return;
    this.delivery.set(id, delivery);
    diagnostic("info", "dialogue.admitted", { runId: this.runId, dialogueId: id, outcome: delivery });
    if (delivery === "chat-only") this.queue = this.queue.filter(block => block.id !== id);
    this.pump();
  }

  completed(id: string) {
    this.transfers.get(id)?.dispose(); this.transfers.delete(id);
    this.occupied.delete(id); this.pump();
  }

  private pump() {
    if (this.stopped || this.generating || this.occupied.size >= 2) return;
    const index = this.queue.findIndex(block => this.delivery.get(block.id) === "spoken");
    if (index < 0) return;
    const [block] = this.queue.splice(index, 1);
    if (!block) return;
    this.occupied.add(block.id);
    this.generating = true;
    this.task = (async () => {
      let streamed = false;
      const started = performance.now();
      const context = { runId: this.runId, dialogueId: block.id };
      try {
        if (!extractSpokenText(block.text)) {
          this.send({ type: "dialogue-audio", runId: this.runId, dialogueId: block.id, failed: true, text: "" });
          return;
        }
        const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(120_000)]);
        diagnostic("info", "tts.started", context);
        const result = await this.service.generate(this.characterId, block.text, signal, true, async (event, speechContext) => {
          if (event.type === "format") {
            diagnostic("debug", "tts.first-audio", { ...context, durationMs: performance.now() - started });
            const transfer = await createAvatarSpeechStream(signal);
            streamed = true;
            this.transfers.set(block.id, transfer);
            this.send({ type: "dialogue-audio", runId: this.runId, dialogueId: block.id,
              streaming: true, value: transfer.name, text: speechContext.text, profilePath: speechContext.profilePath ?? "" });
          }
          const transfer = this.transfers.get(block.id);
          if (!transfer) throw new Error("Missing speech transport.");
          await transfer.write(event);
        });
        signal.throwIfAborted();
        diagnostic("info", "tts.succeeded", { ...context, durationMs: performance.now() - started });
        if (streamed) return;
        this.directory ??= await mkdtemp(join(this.temporaryDirectory, "katarune-dialogue-"));
        const path = join(this.directory, `${crypto.randomUUID()}.${result.format}`);
        await writeFile(path, result.audio, { signal });
        signal.throwIfAborted();
        this.send({ type: "dialogue-audio", runId: this.runId, dialogueId: block.id,
          value: path, text: result.spokenText ?? block.text, segments: result.segments ?? [],
          profilePath: result.profilePath ?? "", voiceKey: result.voiceKey ?? "", failed: false });
      } catch (error) {
        if (!this.stopped) {
          const incidentId = diagnostic("error", "tts.failed", { ...context, durationMs: performance.now() - started }, error);
          this.onFailure(error, incidentId);
          diagnostic("info", "dialogue.fallback", { ...context, outcome: "degraded" });
        } else diagnostic("info", "tts.cancelled", { ...context, outcome: "cancelled" });
        if (streamed) {
          await this.transfers.get(block.id)?.fail();
          return;
        }
        if (!this.stopped) this.send({ type: "dialogue-audio", runId: this.runId, dialogueId: block.id,
          failed: true, text: extractSpokenText(block.text) });
      } finally { this.generating = false; }
    })().finally(() => this.pump());
  }

  async dispose() {
    this.cancel();
    await this.task;
    if (this.directory) await rm(this.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  cancel() {
    this.stopped = true;
    this.lifetime.abort();
    for (const transfer of this.transfers.values()) transfer.dispose();
    this.transfers.clear();
    this.blocks.clear(); this.queue.length = 0;
    this.delivery.clear();
  }

  silence() { this.cancel(); }
}
