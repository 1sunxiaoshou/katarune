import { makeAssistantToolUI, type ToolCallMessagePartProps } from "@assistant-ui/react";
import { z } from "zod";
import { ToolCallDetails } from "@/components/tool-fallback";
import { toolErrorMessage } from "./toolErrorMessage";
import {
  memoryReadInputSchema, memoryForgetInputSchema, memoryToolSaveSchema,
  memoryToolSearchResultSchema, memoryToolReadResultSchema, memoryToolWriteResultSchema, memoryToolForgetResultSchema,
  memoryToolActionSchema, memoryPageResultSchema,
} from "../../../shared/memory";

const labels = {
  search: { activity: "正在搜索记忆…", complete: "搜索记忆", failed: "记忆搜索失败" },
  read: { activity: "正在读取记忆…", complete: "读取记忆", failed: "记忆读取失败" },
  save: { activity: "正在保存记忆…", complete: "保存记忆", failed: "记忆保存失败" },
  forget: { activity: "正在遗忘记忆…", complete: "遗忘记忆", failed: "记忆遗忘失败" },
  list: { activity: "正在查看记忆…", complete: "查看记忆", failed: "记忆查看失败" },
  memory: { activity: "正在处理记忆…", complete: "记忆", failed: "记忆操作失败" },
};
type MemoryToolName = keyof typeof labels;
const notices: Record<string, string> = {
  conflict: "版本冲突",
  duplicate: "已有相关记忆",
  not_found: "未找到",
};

type Detail = { title: string; state: string };
function presentation(operation: MemoryToolName, args: unknown, result: unknown): { count?: string | undefined; outcome?: string | undefined; note?: string | undefined; details: Detail[] } {
  if (operation === "memory") return { details: [] };
  if (operation === "list") {
    const output = memoryPageResultSchema.safeParse(result);
    if (!output.success) return { details: [] };
    const { entries, total, page, hasMore } = output.data;
    return { count: `${entries.length} 条`, note: `第 ${page} 页 · 共 ${total} 条${hasMore ? " · 还有下一页" : ""}`,
      details: entries.map(entry => ({ title: entry.title, state: { person: "人物", event: "纪事", diary: "日记" }[entry.kind] })),
    };
  }
  if (operation === "search") {
    const output = memoryToolSearchResultSchema.safeParse(result);
    if (!output.success) return { details: [] };
    const searches = output.data.searches;
    const entries = [...new Map(searches.flatMap(search => search.results).map(entry => [entry.id, entry])).values()];
    return { count: `${entries.length} 条`,
      note: entries.length === 0 ? "未找到相关记忆" : searches.some(search => search.truncated) ? "还有更多匹配" : undefined,
      details: entries.map(entry => ({ title: entry.title, state: "已找到" })),
    };
  }
  if (operation === "read") {
    const input = memoryReadInputSchema.safeParse(args);
    const output = memoryToolReadResultSchema.safeParse(result);
    const missing = output.success ? output.data.results.filter(item => item.status === "not_found").length : 0;
    return { count: input.success ? `${new Set(input.data.ids).size} 条` : undefined,
      outcome: missing > 0 ? `${missing} 条未找到` : undefined,
      details: output.success ? output.data.results.map((item, index) => ({
        title: item.status === "found" ? item.entry.title : `记忆 ${index + 1}`,
        state: item.status === "found" ? "已读取" : "未找到",
      })) : [],
    };
  }
  if (operation === "forget") {
    const input = memoryForgetInputSchema.safeParse(args);
    const output = memoryToolForgetResultSchema.safeParse(result);
    const unfinished = output.success ? output.data.results.filter(item => item.status !== "forgotten").length : 0;
    return { count: input.success ? `${input.data.entries.length} 条` : undefined,
      outcome: unfinished > 0 ? `${unfinished} 条未完成` : undefined,
      details: output.success ? output.data.results.map((item, index) => ({
        title: item.title ?? `记忆 ${index + 1}`,
        state: item.status === "forgotten" ? "已遗忘" : notices[item.status] ?? "未完成",
      })) : [],
    };
  }
  const input = memoryToolSaveSchema.safeParse(args);
  const output = memoryToolWriteResultSchema.safeParse(result);
  const outcome = output.success ? notices[output.data.status] : undefined;
  return { count: input.success ? "1 条" : undefined, outcome,
    details: output.success ? [{
      title: output.data.status === "duplicate" ? output.data.existing.title
        : "title" in output.data ? output.data.title : input.success ? input.data.title : "记忆",
      state: outcome ?? "已保存",
    }] : [],
  };
}

function MemoryToolStatus({ operation, parameters, ...props }: ToolCallMessagePartProps & {
  operation: MemoryToolName;
  parameters?: unknown;
}): React.JSX.Element {
  const label = labels[operation];
  const { args, result, status, isError } = props;
  const error = toolErrorMessage(result, status);
  const cancelled = status.type === "incomplete" && status.reason === "cancelled";
  const failed = !cancelled && (!!isError || !!error || status.type === "incomplete");
  const running = status.type === "running";
  const complete = status.type === "complete";
  const display = presentation(operation, parameters ?? args, complete && !failed ? result : undefined);
  const summary = [cancelled ? "记忆操作已取消" : failed ? label.failed : running ? label.activity : label.complete,
    display.count, complete && !failed ? display.outcome : undefined].filter(Boolean).join(" · ");
  return <ToolCallDetails {...props} label={summary} labelClassName="min-w-0 max-w-none shrink whitespace-normal" hasDetails={failed || display.details.length > 0 || !!display.note} failed={failed} data-testid="memory-tool-status">
    {failed ? <p role="alert" className="text-destructive">记忆操作未完成，请重试或检查模型设置。</p>
      : display.details.length > 0 ? <ul className="space-y-2" aria-label="记忆操作明细">
        {display.details.map((item, index) => <li key={index} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="min-w-0 wrap-anywhere">{item.title}</span>
          <span className="text-muted-foreground text-xs">{item.state}</span>
        </li>)}
      </ul> : null}
    {display.note && <p className="text-muted-foreground">{display.note}</p>}
  </ToolCallDetails>;
}

const requestPreviewSchema = z.object({ request: z.object({ action: memoryToolActionSchema }).catchall(z.unknown()) });
export const MemoryToolUI = makeAssistantToolUI({
  toolName: "memory",
  render: props => {
    const input = requestPreviewSchema.safeParse(props.args);
    if (!input.success) return <MemoryToolStatus {...props} operation="memory" />;
    const { action, ...parameters } = input.data.request;
    return <MemoryToolStatus {...props} operation={action} parameters={parameters} />;
  },
});
