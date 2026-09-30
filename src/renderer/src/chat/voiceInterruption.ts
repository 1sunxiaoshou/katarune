export async function interruptForVoice(options: {
  enqueue(): Promise<void>;
  isGenerating(): boolean;
  stopGeneration(): Promise<void>;
  markReply(incomplete: boolean): void;
  now?: () => number;
  delay?: (milliseconds: number) => Promise<void>;
}): Promise<void> {
  const now = options.now ?? Date.now;
  const delay = options.delay ?? (milliseconds => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
  const wasGenerating = options.isGenerating();
  const queued = options.enqueue();
  void queued.catch(() => {});
  if (wasGenerating) {
    const deadline = now() + 10_000;
    while (options.isGenerating() && now() < deadline) await delay(Math.min(50, deadline - now()));
  }
  const incomplete = wasGenerating && options.isGenerating();
  if (incomplete) await options.stopGeneration();
  options.markReply(incomplete);
  await queued;
}
