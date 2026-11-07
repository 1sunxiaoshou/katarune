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
export const memoryToolSearchSchema = z.strictObject({
  queries: z.array(memorySearchInputSchema.shape.query).min(1).max(5)
    .describe("1 至 5 个字面关键词，逐个搜索；不要重复填写。"),
  kind: memorySearchInputSchema.shape.kind,
});
export const memoryReadInputSchema = z.strictObject({
  ids: z.array(z.uuid()).min(1).max(10).describe("1 至 10 个搜索或目录返回的记忆标识，不能自行编造。"),
});
export const memoryForgetInputSchema = z.strictObject({
  entries: z.array(z.strictObject({
    id: z.uuid(), revision: z.int().positive().describe("该条记忆搜索或读取返回的当前版本。"),
  })).min(1).max(10).refine(entries => new Set(entries.map(entry => entry.id)).size === entries.length, "不能重复遗忘同一条记忆。"),
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

export const memoryPageInputSchema = z.strictObject({
  kind: memoryKindSchema.nullable().describe("null 列出所有可读取的分类。"),
  page: z.int().min(1).max(1_000_000).describe("页码，从 1 开始。"),
  pageSize: z.int().min(1).max(50).describe("每页条数，建议 20，最多 50。"),
  sortBy: z.enum(["updatedAt", "title", "kind"]).describe("按更新时间、标题或分类排序。"),
  order: z.enum(["asc", "desc"]).describe("asc 升序，desc 降序；浏览最近记忆使用 updatedAt/desc。"),
});
const searchOperation = memoryToolSearchSchema.extend({ action: z.literal("search") });
const readOperation = memoryReadInputSchema.extend({ action: z.literal("read") });
const listOperation = memoryPageInputSchema.extend({ action: z.literal("list") });
export const memoryToolActionSchema = z.enum(["search", "read", "list", "save", "forget"]);
export const memoryReadOperationSchema = z.discriminatedUnion("action", [searchOperation, readOperation, listOperation]);
// Keep the provider-facing root an object; the selected operation has only its own fields.
export const memoryToolInputSchema = z.strictObject({
  request: z.discriminatedUnion("action", [
    searchOperation, readOperation, listOperation,
    memoryToolSaveSchema.safeExtend({ action: z.literal("save") }),
    memoryForgetInputSchema.extend({ action: z.literal("forget") }),
  ]),
});
export const memoryPageResultSchema = z.strictObject({
  entries: z.array(memorySummarySchema.extend({ updatedAt: z.iso.datetime(), revision: z.int().positive() })),
  total: z.int().nonnegative(), page: z.int().positive(), pageSize: z.int().positive(), hasMore: z.boolean(),
});
export type MemoryPageInput = z.infer<typeof memoryPageInputSchema>;
export type MemoryReadOperation = z.infer<typeof memoryReadOperationSchema>;

const memoryToolEntrySchema = memoryContentSchema.and(z.object({
  id: z.uuid(), revision: z.int().positive(), bodyTruncated: z.boolean(),
}));
export const memoryToolSearchResultSchema = z.object({
  status: z.literal("ok"), searches: z.array(z.object({
    query: z.string(), truncated: z.boolean(), results: z.array(memoryToolEntrySchema),
  })),
});
export const memoryToolReadResultSchema = z.object({
  results: z.array(z.discriminatedUnion("status", [
    z.object({ id: z.uuid(), status: z.literal("found"), entry: memoryToolEntrySchema }),
    z.object({ id: z.uuid(), status: z.literal("not_found") }),
  ])),
});
export const memoryToolWriteResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.enum(["saved", "forgotten"]), id: z.uuid(), revision: z.int().positive(), title: titleSchema }),
  z.object({ status: z.enum(["conflict", "not_found"]), message: z.string() }),
  z.object({ status: z.literal("duplicate"), existing: z.object({ id: z.uuid(), title: titleSchema }), message: z.string() }),
]);
export const memoryToolForgetResultSchema = z.object({
  results: z.array(z.object({ id: z.uuid(), title: titleSchema.optional() }).and(memoryToolWriteResultSchema)),
});
export const diaryFailureCodeSchema = z.enum(["configuration", "invalid_output", "context_changed", "timeout", "interrupted", "authentication", "rate_limit", "provider", "request_rejected", "network", "unknown"]);
export type DiaryFailureCode = z.infer<typeof diaryFailureCodeSchema>;
export function diaryFailureMessage(code: DiaryFailureCode | null): string {
  if (code === null) return "此前未记录失败原因，请重试。";
  return {
    configuration: "语言模型配置不可用，请检查设置后重试。",
    invalid_output: "模型未提交完整的日记草稿，请重试。",
    context_changed: "生成期间对话发生变化，请重试。",
    timeout: "生成超时，请稍后重试。",
    interrupted: "上次生成中断，请重试。",
    authentication: "供应商认证失败，请检查密钥和权限。",
    rate_limit: "供应商限制了请求，请检查额度或稍后重试。",
    provider: "供应商服务暂时不可用，请稍后重试。",
    request_rejected: "供应商拒绝了请求，请检查模型和请求设置。",
    network: "无法连接供应商，请检查网络后重试。",
    unknown: "生成未完成，请重试；若持续失败，请检查模型设置。",
  }[code];
}
export const memoryDiaryStateSchema = z.strictObject({
  enabled: z.boolean(), pending: z.int().nonnegative(), failed: z.int().nonnegative(),
  lastFailure: z.strictObject({ day: z.iso.date(), code: diaryFailureCodeSchema.nullable() }).nullable(),
});
export const memoryDiarySettingsSchema = z.strictObject({ characterId: z.uuid(), enabled: z.boolean() });
export const memoryChangedSchema = z.strictObject({ characterId: z.uuid() });
export const diaryDraftSchema = z.strictObject({
  worthKeeping: z.boolean(), title: z.string().trim().max(120), body: z.string().trim().max(32_000),
}).refine(value => !value.worthKeeping || (value.title.length > 0 && value.body.length > 0), "需要保留的日记必须包含标题和正文。");

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
