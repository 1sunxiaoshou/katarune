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
  private generating = false;
  private stopped = false;
  private task: Promise<void> = Promise.resolve();
  private directory?: string;
  private lifetime = new AbortController();
  private transfers = new Map<string, Awaited<ReturnType<typeof createAvatarSpeechStream>>>();

  constructor(private readonly runId: string, private readonly characterId: string,
    private readonly service: SpeechService, private readonly send: (message: object) => void,
    private readonly temporaryDirectory = tmpdir(), private readonly onFailure: () => void = () => {}) {}

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
    this.queue.push({ id, text });
    this.pump();
  }

  completed(id: string) {
    this.transfers.get(id)?.dispose(); this.transfers.delete(id);
    this.occupied.delete(id); this.pump();
  }

  private pump() {
    if (this.stopped || this.generating || this.occupied.size >= 2) return;
    const block = this.queue.shift();
    if (!block) return;
    this.occupied.add(block.id);
    this.generating = true;
    this.task = (async () => {
      let streamed = false;
      try {
        const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(120_000)]);
        const result = await this.service.generate(this.characterId, block.text, signal, true, async (event, context) => {
          if (event.type === "format") {
            const transfer = await createAvatarSpeechStream(signal);
            streamed = true;
            this.transfers.set(block.id, transfer);
            this.send({ type: "dialogue-audio", runId: this.runId, dialogueId: block.id,
              streaming: true, value: transfer.name, text: context.text, profilePath: context.profilePath ?? "" });
          }
          const transfer = this.transfers.get(block.id);
          if (!transfer) throw new Error("Missing speech transport.");
          await transfer.write(event);
        });
        signal.throwIfAborted();
        if (streamed) return;
        this.directory ??= await mkdtemp(join(this.temporaryDirectory, "katarune-dialogue-"));
        const path = join(this.directory, `${crypto.randomUUID()}.${result.format}`);
        await writeFile(path, result.audio, { signal });
        signal.throwIfAborted();
        this.send({ type: "dialogue-audio", runId: this.runId, dialogueId: block.id,
          value: path, text: result.spokenText ?? block.text, segments: result.segments ?? [],
          profilePath: result.profilePath ?? "", voiceKey: result.voiceKey ?? "", failed: false });
      } catch {
        if (!this.stopped) this.onFailure();
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
  }
}
