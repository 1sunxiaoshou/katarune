import { makeAssistantToolUI, type ToolCallMessagePartProps } from "@assistant-ui/react";
import { ToolCallDetails } from "@/components/tool-fallback";
import { toolErrorMessage } from "./toolErrorMessage";

const labels = {
  memory_search: { activity: "正在搜索记忆…", complete: "已搜索记忆", failed: "记忆搜索失败" },
  memory_read: { activity: "正在读取记忆…", complete: "已读取记忆", failed: "记忆读取失败" },
  memory_save: { activity: "正在保存记忆…", complete: "已保存记忆", failed: "记忆保存失败" },
  memory_forget: { activity: "正在遗忘记忆…", complete: "已遗忘记忆", failed: "记忆遗忘失败" },
};
type MemoryToolName = keyof typeof labels;
const notices: Record<string, string> = {
  conflict: "记忆已变化，正在等待重新读取",
  duplicate: "已有相关记忆，正在等待整理原条目",
  not_found: "未找到相关记忆",
};

function MemoryToolStatus({ operation, ...props }: ToolCallMessagePartProps & {
  operation: MemoryToolName;
}): React.JSX.Element {
  const label = labels[operation];
  const { result, status, isError } = props;
  const error = toolErrorMessage(result, status);
  const cancelled = status.type === "incomplete" && status.reason === "cancelled";
  const failed = !cancelled && (!!isError || !!error || status.type === "incomplete");
  const resultStatus = typeof result === "object" && result !== null && "status" in result && typeof result.status === "string"
    ? result.status : undefined;
  const running = status.type === "running";
  const complete = status.type === "complete";
  const notice = complete && resultStatus ? notices[resultStatus] : undefined;
  const summary = cancelled ? "记忆操作已取消" : failed ? label.failed : running ? label.activity : notice ?? label.complete;
  return <ToolCallDetails {...props} label={summary} failed={failed} data-testid="memory-tool-status">
    {error ? <p role="alert" className="text-destructive wrap-anywhere">{error}</p>
      : <p className="text-muted-foreground">{notice ?? summary}。可在记忆页面查看和管理。</p>}
  </ToolCallDetails>;
}

function registerMemoryToolUI(toolName: MemoryToolName) {
  return makeAssistantToolUI({
    toolName,
    render: props => <MemoryToolStatus {...props} operation={toolName} />,
  });
}

const MemorySearchToolUI = registerMemoryToolUI("memory_search");
const MemoryReadToolUI = registerMemoryToolUI("memory_read");
const MemorySaveToolUI = registerMemoryToolUI("memory_save");
const MemoryForgetToolUI = registerMemoryToolUI("memory_forget");

export function MemoryToolUI(): React.JSX.Element {
  return <><MemorySearchToolUI /><MemoryReadToolUI /><MemorySaveToolUI /><MemoryForgetToolUI /></>;
}
