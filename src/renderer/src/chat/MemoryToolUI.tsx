import { makeAssistantToolUI, type ToolCallMessagePartProps } from "@assistant-ui/react";
import { BookOpenText, CheckCircle2, Eraser, FilePenLine, LoaderCircle, Search, TriangleAlert } from "lucide-react";
import { toolErrorMessage } from "./toolErrorMessage";

const labels = {
  memory_search: { activity: "正在搜索记忆…", complete: "已搜索记忆", failed: "记忆搜索失败", success: "ok", icon: Search },
  memory_read: { activity: "正在读取记忆…", complete: "已读取记忆", failed: "记忆读取失败", success: "found", icon: BookOpenText },
  memory_save: { activity: "正在保存记忆…", complete: "已保存记忆", failed: "记忆保存失败", success: "saved", icon: FilePenLine },
  memory_forget: { activity: "正在遗忘记忆…", complete: "已遗忘记忆", failed: "记忆遗忘失败", success: "forgotten", icon: Eraser },
};
type MemoryToolName = keyof typeof labels;
const notices: Record<string, string> = {
  conflict: "记忆已变化，正在等待重新读取",
  duplicate: "已有相关记忆，正在等待整理原条目",
  not_found: "未找到相关记忆",
};

function MemoryToolStatus({ operation, result, status, isError }: Pick<ToolCallMessagePartProps, "result" | "status" | "isError"> & {
  operation: MemoryToolName;
}): React.JSX.Element {
  const label = labels[operation];
  const error = toolErrorMessage(result, status);
  if (isError || error || status.type === "incomplete") return (
    <div className="text-destructive py-1 text-sm" data-testid="memory-tool-status">
      <div className="flex items-center gap-2"><TriangleAlert className="size-4" aria-hidden /><span>{label.failed}</span></div>
      {error ? <p role="alert" className="pt-1">{error}</p> : null}
    </div>
  );

  const resultStatus = typeof result === "object" && result !== null && "status" in result && typeof result.status === "string"
    ? result.status : undefined;
  const running = status.type === "running";
  const complete = status.type === "complete";
  const success = complete && (resultStatus === label.success || (operation === "memory_read" && resultStatus === "not_found"));
  const notice = complete && resultStatus ? notices[resultStatus] : undefined;
  const Icon = running ? LoaderCircle : success ? CheckCircle2 : notice ? TriangleAlert : label.icon;
  return (
    <div className="text-muted-foreground flex items-center gap-2 py-1 text-sm" data-testid="memory-tool-status">
      <Icon className={running ? "size-4 animate-spin" : "size-4"} aria-hidden />
      <span>{running ? label.activity : notice ?? label.complete}</span>
    </div>
  );
}

function registerMemoryToolUI(toolName: MemoryToolName) {
  return makeAssistantToolUI({
    toolName,
    display: "standalone",
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
