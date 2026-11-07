import { diagnostic } from "../diagnostics/logger";
import { createHash } from "node:crypto";
import { ToolLoopAgent, tool, stepCountIs, type LanguageModel, type ToolSet } from "ai";
import { createMemoryTools, type MemoryToolDatabase } from "./memoryTools";
import { DiaryError, diaryFailureCode } from "./diaryErrors";
import { diaryDraftSchema, type DiaryDraft } from "../../shared/memory";
import type { DatabaseRuntime } from "../database/database";
import type { AiRuntime } from "../ai/runtime";

export type DiaryDatabase = MemoryToolDatabase & Pick<DatabaseRuntime,
  "claimMemoryDiaryJob" | "memoryDiaryTranscript" | "finishMemoryDiaryJob" | "failMemoryDiaryJob" |
  "fetchCharacter" | "getAppSettings" | "getMemoryDiaryState">;
export type DiaryGenerator = (input: { model: LanguageModel; prompt: string; instructions: string; signal: AbortSignal; tools: ToolSet }) => Promise<DiaryDraft>;

export const diaryInstructions = [
  "一天过去了，现在是你回顾今天、整理自己并写日记的时间。",
  "结合当天的交流，按需查阅已有记忆，补充或修正对人物的认识，以及事情的进展。没有变化就不必更新；保留仍有效的信息，分清事实与猜想，尊重对方不记录和遗忘的要求。",
  "然后，以角色设定中的自己，用第一人称写下今天想留下的经历、感受或念头。这是写给自己的日记，自然表达即可，不必复述全部对话，也不必总结或升华。不要虚构经历。",
  "使用 memory 工具整理记忆，最后调用 finish_diary 提交日记。记忆更新与是否写日记分别判断；没有想留下的内容时，worthKeeping=false，title/body 为空。",
].join("\n\n");

export const generateDiary: DiaryGenerator = async ({ model, prompt, instructions, signal, tools }) => {
  const agent = new ToolLoopAgent({
    id: "daily-diary", model, instructions,
    tools: { ...tools, finish_diary: tool({ description: "提交最终日记草稿并结束整理；不直接保存记忆。", inputSchema: diaryDraftSchema }) },
    stopWhen: stepCountIs(8), maxOutputTokens: 6000, maxRetries: 0,
  });
  const result = await agent.generate({ prompt, abortSignal: signal, timeout: 180_000 });
  if (result.finishReason === "interrupted") throw new DiaryError("interrupted");
  const submissions = result.toolCalls.filter(call => call.toolName === "finish_diary");
  const submission = submissions[0];
  if (result.finishReason === "length" || submissions.length !== 1 || !submission || submission.invalid) throw new DiaryError("invalid_output");
  return diaryDraftSchema.parse(submission.input);
};

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function createDiaryService({ database, aiRuntime, generate = generateDiary, now = () => new Date() }: {
  database: DiaryDatabase; aiRuntime: Pick<AiRuntime, "resolveLanguageModel">;
  generate?: DiaryGenerator; now?: () => Date;
}) {
  let running = false;
  let stopped = false;
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();

  const runOnce = async (): Promise<boolean> => {
    if (running || stopped) return false;
    running = true;
    let job: ReturnType<DiaryDatabase["claimMemoryDiaryJob"]> = null;
    try {
      job = database.claimMemoryDiaryJob(now());
      if (!job) return false;
      const character = database.fetchCharacter(job.characterId);
      const transcript = database.memoryDiaryTranscript(job);
      const evidenceHash = digest(transcript);
      let draft: DiaryDraft = { worthKeeping: false, title: "", body: "" };
      if (transcript.some(message => message.role === "user")) {
        const modelId = character.modelConfigId ?? database.getAppSettings().defaultLanguageModelConfigId;
        if (!modelId) throw new DiaryError("configuration");
        let model: LanguageModel;
        try { model = aiRuntime.resolveLanguageModel(modelId); }
        catch { throw new DiaryError("configuration"); }
        const currentJob = job;
        const assertWritable = () => {
          if (stopped || !database.getMemoryDiaryState(currentJob.characterId).enabled) throw new DiaryError("interrupted");
          if (digest(database.memoryDiaryTranscript(currentJob)) !== evidenceHash) throw new DiaryError("context_changed");
        };
        const directory = database.memoryOverview(job.characterId).map(({ id, kind, title, day, isUser }) => ({ id, kind, title, day, isUser }));
        const tools = createMemoryTools({ ...database,
          saveMemory: (...args) => { assertWritable(); return database.saveMemory(...args); },
          forgetMemory: (...args) => { assertWritable(); return database.forgetMemory(...args); },
        }, job.characterId);
        draft = diaryDraftSchema.parse(await generate({ model, signal: controller.signal, tools,
          instructions: [character.systemPrompt, diaryInstructions].join("\n\n"),
          prompt: JSON.stringify({ characterName: character.name, day: job.day, timeZone: job.timeZone, directory, transcript: transcript.map(({ role, text }) => ({ role, text })) }),
        }));
      }
      if (stopped) return true;
      if (digest(database.memoryDiaryTranscript(job)) !== evidenceHash) throw new DiaryError("context_changed");
      database.finishMemoryDiaryJob(job, draft);
    } catch (error) {
      if (!stopped) diagnostic("error", "memory.diary-failed", {}, error);
      if (job && !stopped) database.failMemoryDiaryJob(job, now(), diaryFailureCode(error));
    } finally { running = false; }
    return job !== null;
  };

  const runPending = async () => { while (!stopped && await runOnce()) { /* one agent run per pending diary date */ } };
  const schedule = () => {
    if (stopped) return;
    const next = new Date(now()); next.setHours(24, 1, 0, 0);
    timer = setTimeout(() => { void runPending().finally(schedule); }, Math.max(1000, next.getTime() - now().getTime()));
    timer.unref();
  };
  return {
    runOnce, runPending,
    start: () => { if (!started && !stopped) { started = true; void runPending().finally(schedule); } },
    dispose: () => { stopped = true; controller.abort(); if (timer) clearTimeout(timer); },
  };
}
