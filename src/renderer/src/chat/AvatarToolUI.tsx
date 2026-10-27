import { makeAssistantToolUI, type ToolCallMessagePartProps } from "@assistant-ui/react";
import { ChevronDown, Drama, LoaderCircle, TriangleAlert } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible";
import { avatarPerformSchema, avatarPerformAcceptedSchema, avatarPerformResultSchema, avatarControlSchema, type AvatarStep } from "../../../shared/avatarPerformance";
import { avatarDanceStartedSchema } from "../../../shared/avatar";
import { useAvatarState } from "./avatarState";
import { toolErrorMessage } from "./toolErrorMessage";

const expressions: Record<string, string> = { neutral: "平静", happy: "开心", relaxed: "放松", sad: "难过", angry: "生气", surprised: "惊讶" };
const states: Record<string, string> = { accepted: "已安排", running: "正在表演", exiting: "正在收尾", completed: "表演完成", cancelled: "表演已取消", failed: "表演失败" };
const cueStates: Record<string, string> = { pending: "等待", running: "进行中", completed: "完成", skipped: "已跳过", cancelled: "已取消", failed: "失败" };
function triggerLabel(step: AvatarStep, steps: AvatarStep[], index: number) {
  switch (step.at) {
    case "start": return "对白开始";
    case "end": return "对白结束";
    case "sentence": return `第 ${step.sentence} 句`;
    case "after_action": return `第 ${steps.slice(0, index).reduce((last, item, i) => item.action ? i + 1 : last, 0)} 项动作完成后`;
  }
}
function PerformanceView({ args, result, status, isError, toolCallId }: ToolCallMessagePartProps) {
  const parsed = avatarPerformSchema.safeParse(args);
  const accepted = avatarPerformAcceptedSchema.safeParse(result);
  const summary = avatarPerformResultSchema.safeParse(result);
  const id = accepted.success ? accepted.data.performanceId : undefined;
  const live = useAvatarState(state => state.status.performances?.find(item => item.toolCallId === toolCallId
    || (id !== undefined && item.performanceId === id)));
  const failed = isError || status.type === "incomplete" || live?.state === "failed";
  const pending = status.type === "running";
  const label = status.type === "incomplete" && status.reason === "cancelled" ? "安排已取消"
    : failed ? "表演失败" : live ? states[live.state] : pending ? "正在安排表演…" : accepted.success ? "已安排" : "播放状态未同步";
  const steps = parsed.success ? parsed.data.steps : [];
  const error = live?.error ?? toolErrorMessage(result, status);
  return <Collapsible className="my-1 text-sm" data-testid="avatar-performance" data-tool-call-id={toolCallId}>
    <CollapsibleTrigger className="group text-muted-foreground hover:text-foreground flex w-full items-center gap-2 rounded-md py-1 text-left focus-visible:outline-2 focus-visible:outline-ring">
      {failed ? <TriangleAlert className="text-destructive size-4 shrink-0" aria-hidden />
        : pending ? <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden /> : <Drama className="size-4 shrink-0" aria-hidden />}
      <span>{label}{steps.length > 0 ? ` · ${steps.length} 项` : ""}</span>
      <ChevronDown className="size-3.5 transition-transform group-data-panel-open:rotate-180" aria-hidden />
    </CollapsibleTrigger>
    {error ? <p className="text-destructive py-1" role="alert">{error}</p> : null}
    <CollapsibleContent>
      <ol className="border-border mt-1 ml-2 space-y-2 border-l pl-4 pb-1">
        {steps.map((step, index) => {
          const id = `step-${index + 1}`;
          const saved = summary.success ? summary.data.steps[index] : undefined;
          const action = saved?.action ?? (step.action ? "动作" : undefined);
          const expression = step.expression ? expressions[step.expression] ?? step.expression : undefined;
          const cueState = live?.cues.find(item => item.id === id)?.state;
          return <li key={id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-muted-foreground text-xs">{index + 1}. {triggerLabel(step, steps, index)}</span>
            <span>{[action, expression].filter(Boolean).join(" ＋ ")}</span>
            {cueState ? <span className="text-muted-foreground text-xs">{cueStates[cueState]}</span> : null}
          </li>;
        })}
      </ol>
    </CollapsibleContent>
  </Collapsible>;
}
const Performance = makeAssistantToolUI({ toolName: "avatar_perform", display: "standalone", render: PerformanceView });
function DanceView({ result, status, isError, toolCallId }: ToolCallMessagePartProps) {
  const started = avatarDanceStartedSchema.safeParse(result);
  const live = useAvatarState(state => state.status.dance?.toolCallId === toolCallId
    || (started.success && state.status.dance?.performanceId === started.data.performanceId) ? state.status.dance : undefined);
  const error = live ? live.error : toolErrorMessage(result, status);
  const failed = live ? live.state === "failed" : isError || status.type === "incomplete";
  const pending = !live && status.type === "running";
  const label = failed ? "舞蹈播放失败" : pending ? "正在准备舞蹈…"
    : live?.state === "completed" ? "舞蹈已完成" : live?.state === "started" ? "正在表演"
      : started.success ? "舞蹈已启动" : "播放状态未同步";
  return <div className="text-muted-foreground my-1 text-sm" data-testid="avatar-dance" data-tool-call-id={toolCallId}>
    <p className="flex items-center gap-2 py-1">{failed ? <TriangleAlert className="text-destructive size-4 shrink-0" aria-hidden />
      : pending ? <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden /> : <Drama className="size-4 shrink-0" aria-hidden />}
      <span>{label}{live ? ` · ${live.action}` : started.success ? ` · ${started.data.action}` : ""}</span></p>
    {error ? <p className="text-destructive" role="alert">{error}</p> : null}
  </div>;
}
const Dance = makeAssistantToolUI({ toolName: "avatar_play", display: "standalone", render: DanceView });
const Control = makeAssistantToolUI({
  toolName: "avatar_control", display: "standalone",
  render: ({ args, result, status, isError }) => {
    const parsed = avatarControlSchema.safeParse(args);
    const error = toolErrorMessage(result, status);
    return <div className="text-muted-foreground py-1 text-sm"><p>
      {isError || status.type === "incomplete" ? "表演控制失败" : status.type === "running" ? "正在调整表演…"
        : parsed.success && parsed.data.command === "cancel" ? "已请求取消表演" : "已请求自然收尾"}
    </p>{error ? <p className="text-destructive" role="alert">{error}</p> : null}</div>;
  },
});
export function AvatarToolUI() { return <><Performance /><Dance /><Control /></>; }
