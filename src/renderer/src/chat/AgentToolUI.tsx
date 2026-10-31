import { makeAssistantToolUI, type ToolCallMessagePartProps } from "@assistant-ui/react";
import { ToolCallDetails, ToolFallback } from "@/components/tool-fallback";
import { z } from "zod";

const DirectoryAccessUI = makeAssistantToolUI({
  toolName: "request_directory_access",
  render: props => {
    const { args, status, result, isError } = props;
    const path = typeof args.path === "string" ? args.path : "";
    const cancelled = status.type === "incomplete" && status.reason === "cancelled";
    const label = status.type === "requires-action" ? "等待批准目录访问"
      : cancelled ? "目录访问申请已取消" : status.type === "running" ? "正在请求目录访问…"
        : status.type === "complete" && result && !isError ? "目录已授权" : "未获得目录访问权限";
    return <ToolCallDetails {...props} label={label} target={path} data-testid="directory-access-request">
      <p className="text-muted-foreground">访问权限：{args.access === "read-write" ? "读写" : "只读"}</p>
      <pre className="whitespace-pre-wrap break-all font-mono">{path}</pre>
      {typeof args.reason === "string" && <p>{args.reason}</p>}
      {status.type === "requires-action" && <p className="text-muted-foreground">批准后，仅当前会话可访问该目录。</p>}
      <ToolFallback.Error status={status} />
      {isError && <ToolFallback.Result result={result} />}
    </ToolCallDetails>;
  },
});

function AgentAction({ kind, ...props }: ToolCallMessagePartProps & { kind: "bash" | "fetch" }) {
  const { args, result, status, isError } = props;
  const output = z.record(z.string(), z.unknown()).safeParse(result).data ?? {};
  const exitCode = "exitCode" in output && typeof output.exitCode === "number" ? output.exitCode : undefined;
  const cancelled = status.type === "incomplete" && status.reason === "cancelled";
  const denied = props.approval?.approved === false;
  const failed = isError || (exitCode !== undefined && exitCode !== 0) || (status.type === "incomplete" && !cancelled);
  const pending = status.type === "requires-action";
  const running = status.type === "running";
  const label = kind === "bash" ? "运行命令" : "读取网页";
  const target = kind === "bash" ? args.command : args.url;
  const summary = pending ? `等待批准${label}` : denied ? `已拒绝${label}` : cancelled ? `已取消${label}`
    : failed ? `${label}失败` : running ? `正在${label}…` : `已${label}`;
  return <ToolCallDetails {...props} label={`${summary}${exitCode !== undefined ? ` · 退出码 ${exitCode}` : ""}`} target={typeof target === "string" ? target : undefined} failed={failed} data-testid={`agent-action-${kind}`}>
      {typeof target === "string" && <div><p className="mb-1 text-muted-foreground">{kind === "bash" ? "命令" : "网址"}</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2.5">{target}</pre></div>}
      <ToolFallback.Error status={status} />
      {(["stdout", "stderr", "content"] as const).map(key => typeof output[key] === "string" && output[key] ? <div key={key}><p className="mb-1 text-muted-foreground">{{ stdout: "输出", stderr: "错误输出", content: "网页内容" }[key]}</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2.5">{output[key]}</pre></div> : null)}
      {isError && <p role="alert" className="text-destructive">{typeof result === "string" ? result : "工具执行失败。"}</p>}
  </ToolCallDetails>;
}
const BashUI = makeAssistantToolUI({ toolName: "bash", render: props => <AgentAction {...props} kind="bash" /> });
const FetchUI = makeAssistantToolUI({ toolName: "fetch_url", render: props => <AgentAction {...props} kind="fetch" /> });

export function AgentToolUI() {
  return <><DirectoryAccessUI /><BashUI /><FetchUI /></>;
}
