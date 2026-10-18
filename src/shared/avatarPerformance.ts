import { z } from "zod";

const cueId = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const avatarStepSchema = z.object({
  at: z.enum(["start", "sentence", "after_action", "end"]).describe("start：对白开始；sentence：指定句开始；after_action：前一个动作完成后；end：对白结束。"),
  sentence: z.number().int().min(1).max(128).nullish().describe("仅 at=sentence 时填写，从 1 开始；其他触发条件省略或填 null。"),
  action: z.string().min(1).max(256).nullish(),
  expression: z.string().min(1).max(256).nullish(),
});
export const avatarPerformSchema = z.object({ steps: z.array(avatarStepSchema).min(1).max(32) }).superRefine(({ steps }, ctx) => {
  let hasAction = false;
  steps.forEach((step, index) => {
    const reject = (message: string) => ctx.addIssue({ code: "custom", path: ["steps", index], message });
    if (!step.action && !step.expression) reject("每一步必须包含动作或表情。");
    if (step.at === "sentence" && step.sentence == null) reject("sentence 触发需要填写句子编号。");
    if (step.at !== "sentence" && step.sentence != null) reject("只有 sentence 触发可以填写句子编号。");
    if (step.at === "after_action" && !hasAction) reject("after_action 前必须安排一个一次性动作。");
    if (step.action) hasAction = true;
  });
});
export type AvatarStep = z.infer<typeof avatarStepSchema>;
export const avatarControlSchema = z.object({ performanceId: z.uuid(), command: z.enum(["finish", "cancel"]) });
export const avatarPerformanceStateSchema = z.object({
  performanceId: z.uuid(),
  toolCallId: z.string().min(1).max(256),
  state: z.enum(["accepted", "running", "exiting", "completed", "cancelled", "failed"]),
  error: z.string().max(4000).optional(),
  cues: z.array(z.object({ id: cueId, state: z.enum(["pending", "running", "completed", "skipped", "cancelled", "failed"]) })).max(32),
});
export type AvatarPerformanceState = z.infer<typeof avatarPerformanceStateSchema>;
export const avatarPerformAcceptedSchema = z.object({
  status: z.literal("accepted"), performanceId: z.uuid(),
});
export const avatarPerformResultSchema = avatarPerformAcceptedSchema.extend({
  steps: z.array(z.object({ action: z.string().max(256).optional(), expression: z.string().max(256).optional() })).max(32),
});
export type AvatarPerformResult = z.infer<typeof avatarPerformResultSchema>;
