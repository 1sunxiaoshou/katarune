import { z } from "zod";

export const MEMORY_CHANNELS = {
  list: "memory:list", read: "memory:read", save: "memory:save",
  forget: "memory:forget",
  diaryState: "memory:diary-state", diarySettings: "memory:diary-settings",
  changed: "memory:changed",
  retryDiary: "memory:diary-retry",
} as const;

export const memoryKindSchema = z.enum(["diary", "person", "event"]);
const titleSchema = z.string().trim().min(1).max(120);
const bodySchema = z.string().trim().min(1).max(32_000);
export const personMemorySchema = z.strictObject({
  kind: z.literal("person"), title: titleSchema, body: bodySchema, isUser: z.boolean(),
});
export const eventMemorySchema = z.strictObject({
  kind: z.literal("event"), title: titleSchema, body: bodySchema,
});
export const diaryMemorySchema = z.strictObject({
  kind: z.literal("diary"), title: titleSchema, body: bodySchema, day: z.iso.date(),
});
export const memoryContentSchema = z.discriminatedUnion("kind", [personMemorySchema, eventMemorySchema, diaryMemorySchema]);
export const memorySummarySchema = z.strictObject({
  id: z.uuid(), kind: memoryKindSchema, title: titleSchema,
  day: z.iso.date().nullable(), isUser: z.boolean(),
  updatedAt: z.date(),
});
export const memoryEntrySchema = z.strictObject({
  id: z.uuid(), characterId: z.uuid(), content: memoryContentSchema,
  revision: z.int().positive(), updatedAt: z.date(), forgottenAt: z.date().nullable(),
});
export const listMemoryRequestSchema = z.strictObject({
  characterId: z.uuid(), kind: memoryKindSchema, query: z.string().max(200).default(""),
  offset: z.int().nonnegative().default(0),
});
export const memoryListSchema = z.strictObject({ entries: z.array(memorySummarySchema), total: z.int().nonnegative() });
export const memoryIdRequestSchema = z.strictObject({ characterId: z.uuid(), id: z.uuid() });
export const memoryVersionRequestSchema = memoryIdRequestSchema.extend({ revision: z.int().positive() });
export const memorySaveInputSchema = z.strictObject({
  id: z.uuid().nullable(), revision: z.int().positive().nullable(), content: memoryContentSchema,
}).refine(value => (value.id === null) === (value.revision === null), "更新记忆需要当前版本。");
export const saveMemoryRequestSchema = memorySaveInputSchema.safeExtend({ characterId: z.uuid() });
export const memoryWriteResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("saved"), entry: memoryEntrySchema }),
  z.strictObject({ status: z.literal("conflict") }),
]);
export const memorySearchInputSchema = z.strictObject({
  query: z.string().trim().min(1).max(200).describe("标题或正文中的字面关键词，例如小林、生日。"),
  kind: memoryKindSchema.nullable().describe("限定分类；null 表示所有可读取的分类。"),
});
export const memoryBackgroundSearchInputSchema = memorySearchInputSchema.extend({
  kind: z.enum(["person", "event"]).nullable().describe("只允许人物或纪事；null 表示两类都搜索。"),
});
export const memoryReadInputSchema = z.strictObject({
  id: z.uuid().describe("搜索或目录返回的记忆标识，不能自行编造。"),
});
export const memoryForgetInputSchema = memoryReadInputSchema.extend({
  revision: z.int().positive().describe("搜索或读取返回的当前版本。"),
});
export const memoryToolSaveSchema = z.strictObject({
  id: z.uuid().nullable().describe("新增填 null；更新使用已有记忆标识。"),
  revision: z.int().positive().nullable().describe("新增填 null；更新使用搜索或读取返回的版本。"),
  kind: z.enum(["person", "event"]).describe("person 为人物画像，event 为纪事；不能保存日记。"),
  title: titleSchema.describe("人物填姓名或称呼；纪事填简短标题。"),
  body: bodySchema.describe("整理后的完整正文，保留仍有效的信息；支持基础 Markdown。"),
  isUser: z.boolean().nullable().describe("人物填是否为与你交谈的用户；纪事填 null。"),
}).refine(value => (value.id === null) === (value.revision === null), "新增时 id/revision 均为 null，更新时两者都需要。")
  .refine(value => value.kind === "person" ? value.isUser !== null : value.isUser === null, "人物需要 isUser 布尔值，纪事的 isUser 应为 null。");
export const memoryDiaryStateSchema = z.strictObject({ enabled: z.boolean(), pending: z.int().nonnegative(), failed: z.int().nonnegative() });
export const memoryDiarySettingsSchema = z.strictObject({ characterId: z.uuid(), enabled: z.boolean() });
export const memoryChangedSchema = z.strictObject({ characterId: z.uuid() });
export const diaryDraftSchema = z.strictObject({
  worthKeeping: z.boolean(), title: z.string().max(120), body: z.string().max(32_000),
});

export type MemoryKind = z.infer<typeof memoryKindSchema>;
export type MemoryContent = z.infer<typeof memoryContentSchema>;
export type MemoryEntry = z.infer<typeof memoryEntrySchema>;
export type MemorySaveInput = z.infer<typeof memorySaveInputSchema>;
export type MemoryWriteResult = z.infer<typeof memoryWriteResultSchema>;
export type ListMemoryRequest = z.infer<typeof listMemoryRequestSchema>;
export type MemoryList = z.infer<typeof memoryListSchema>;
export type MemoryDiaryState = z.infer<typeof memoryDiaryStateSchema>;
export type DiaryDraft = z.infer<typeof diaryDraftSchema>;

export function memoryDay(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}-${parts.find(p => p.type === "day")!.value}`;
}
