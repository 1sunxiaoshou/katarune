import { makeAssistantToolUI } from "@assistant-ui/react";
import {
  BookOpenText,
  CheckCircle2,
  LoaderCircle,
  Search,
  TriangleAlert,
  FilePenLine,
} from "lucide-react";

interface ToolStatusProps {
  readonly activity: string;
  readonly complete: string;
  readonly failed: string;
  readonly icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  readonly result: unknown;
  readonly status: {
    readonly type: "running" | "complete" | "incomplete" | "requires-action";
  };
  readonly isSuccessfulResult: (result: unknown) => boolean;
  readonly conflict?: boolean;
}

function hasResultStatus(result: unknown, expected: string): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    "status" in result &&
    result.status === expected
  );
}

function ToolStatus({
  activity,
  complete,
  failed,
  icon: Icon,
  result,
  status,
  isSuccessfulResult,
  conflict = false,
}: ToolStatusProps): React.JSX.Element {
  if (status.type === "running") {
    return (
      <div
        className="text-muted-foreground flex items-center gap-2 py-1 text-sm"
        data-testid="memory-wiki-tool-status"
      >
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        <span>{activity}</span>
      </div>
    );
  }

  if (status.type === "complete" && isSuccessfulResult(result)) {
    return (
      <div
        className="text-muted-foreground flex items-center gap-2 py-1 text-sm"
        data-testid="memory-wiki-tool-status"
      >
        <CheckCircle2 className="size-4" aria-hidden />
        <span>{complete}</span>
      </div>
    );
  }

  if (status.type === "complete" && conflict) {
    return (
      <div
        className="text-muted-foreground flex items-center gap-2 py-1 text-sm"
        data-testid="memory-wiki-tool-status"
      >
        <TriangleAlert className="size-4" aria-hidden />
        <span>记忆已变化，正在等待重新读取</span>
      </div>
    );
  }

  if (status.type === "incomplete") {
    return (
      <div
        className="text-destructive flex items-center gap-2 py-1 text-sm"
        data-testid="memory-wiki-tool-status"
      >
        <TriangleAlert className="size-4" aria-hidden />
        <span>{failed}</span>
      </div>
    );
  }

  return (
    <div
      className="text-muted-foreground flex items-center gap-2 py-1 text-sm"
      data-testid="memory-wiki-tool-status"
    >
      <Icon className="size-4" aria-hidden />
      <span>{complete}</span>
    </div>
  );
}

const WikiSearchToolUI = makeAssistantToolUI({
  toolName: "wiki_search",
  display: "standalone",
  render: ({ result, status }) => (
    <ToolStatus
      activity="正在搜索记忆…"
      complete="已搜索记忆"
      failed="记忆搜索失败"
      icon={Search}
      result={result}
      status={status}
      isSuccessfulResult={(value) => hasResultStatus(value, "ok")}
    />
  ),
});

const WikiGetToolUI = makeAssistantToolUI({
  toolName: "wiki_get",
  display: "standalone",
  render: ({ result, status }) => (
    <ToolStatus
      activity="正在读取记忆…"
      complete={hasResultStatus(result, "not_found") ? "未找到相关记忆" : "已读取记忆"}
      failed="记忆读取失败"
      icon={BookOpenText}
      result={result}
      status={status}
      isSuccessfulResult={(value) =>
        hasResultStatus(value, "found") || hasResultStatus(value, "not_found")
      }
    />
  ),
});

const WikiApplyPatchToolUI = makeAssistantToolUI({
  toolName: "wiki_apply_patch",
  display: "standalone",
  render: ({ result, status }) => (
    <ToolStatus
      activity="正在更新记忆…"
      complete={hasResultStatus(result, "not_found") ? "未找到待更新记忆" : "已更新记忆"}
      failed="记忆更新失败"
      icon={FilePenLine}
      result={result}
      status={status}
      isSuccessfulResult={(value) =>
        hasResultStatus(value, "applied") || hasResultStatus(value, "not_found")
      }
      conflict={hasResultStatus(result, "conflict")}
    />
  ),
});

export function MemoryWikiToolUI(): React.JSX.Element {
  return (
    <>
      <WikiSearchToolUI />
      <WikiGetToolUI />
      <WikiApplyPatchToolUI />
    </>
  );
}
