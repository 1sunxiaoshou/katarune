import { makeAssistantToolUI, type ToolCallMessagePartProps } from "@assistant-ui/react";
import { ToolCallDetails } from "@/components/tool-fallback";
import { avatarPerformSchema, avatarPerformAcceptedSchema, avatarPerformResultSchema, avatarControlSchema, type AvatarStep } from "../../../shared/avatarPerformance";
import { avatarDanceAcceptedSchema } from "../../../shared/avatar";
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
function PerformanceView(props: ToolCallMessagePartProps) {
  const { args, result, status, isError, toolCallId } = props;
  const parsed = avatarPerformSchema.safeParse(args);
  const accepted = avatarPerformAcceptedSchema.safeParse(result);
  const summary = avatarPerformResultSchema.safeParse(result);
  const id = accepted.success ? accepted.data.performanceId : undefined;
  const live = useAvatarState(state => state.status.performances?.find(item => item.toolCallId === toolCallId
    || (id !== undefined && item.performanceId === id)));
  const cancelled = status.type === "incomplete" && status.reason === "cancelled";
  const failed = isError || (status.type === "incomplete" && !cancelled) || live?.state === "failed";
  const pending = status.type === "running";
  const label = status.type === "incomplete" && status.reason === "cancelled" ? "安排已取消"
    : failed ? "表演失败" : live ? states[live.state] : pending ? "正在安排表演…" : accepted.success ? "已安排" : "播放状态未同步";
  const steps = parsed.success ? parsed.data.steps : [];
  const error = live?.error ?? toolErrorMessage(result, status);
  return <ToolCallDetails {...props} label={`${label}${steps.length > 0 ? ` · ${steps.length} 项` : ""}`} failed={failed}
    hasDetails={steps.length > 0 || !!error}
    active={pending || live?.state === "running" || live?.state === "exiting"} data-testid="avatar-performance">
      {error ? <p className="text-destructive wrap-anywhere py-1" role="alert">{error}</p> : null}
      {steps.length > 0 && <ol className="space-y-2 py-1">
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
      </ol>}
  </ToolCallDetails>;
}
const Performance = makeAssistantToolUI({ toolName: "avatar_perform", render: PerformanceView });
function DanceView(props: ToolCallMessagePartProps) {
  const { result, status, isError, toolCallId } = props;
  const accepted = avatarDanceAcceptedSchema.safeParse(result);
  const live = useAvatarState(state => state.status.dance?.toolCallId === toolCallId
    || (accepted.success && state.status.dance?.performanceId === accepted.data.performanceId) ? state.status.dance : undefined);
  const error = live ? live.error : toolErrorMessage(result, status);
  const cancelled = status.type === "incomplete" && status.reason === "cancelled";
  const failed = live ? live.state === "failed" : isError || (status.type === "incomplete" && !cancelled);
  const pending = !live && status.type === "running";
  const label = failed ? "舞蹈播放失败" : cancelled ? "舞蹈安排已取消" : pending ? "正在安排舞蹈…"
    : live?.state === "completed" ? "舞蹈已完成" : live?.state === "started" ? "正在表演"
      : live?.state === "cancelled" ? "舞蹈已停止" : live?.state === "preparing" ? "正在准备舞蹈…"
        : live?.state === "accepted" || accepted.success ? "舞蹈已安排" : "播放状态未同步";
  const action = live?.action ?? (accepted.success ? accepted.data.action : undefined);
  return <ToolCallDetails {...props} label={label} target={action} targetClassName="font-sans" failed={failed} hasDetails={!!error || !!failed}
    active={pending || live?.state === "preparing" || live?.state === "started"} data-testid="avatar-dance">
    {error || failed ? <p className="text-destructive" role="alert">{error ?? "舞蹈播放失败。"}</p> : null}
  </ToolCallDetails>;
}
const Dance = makeAssistantToolUI({ toolName: "avatar_play", render: DanceView });
const Control = makeAssistantToolUI({
  toolName: "avatar_control",
  render: props => {
    const { args, result, status, isError } = props;
    const parsed = avatarControlSchema.safeParse(args);
    const error = toolErrorMessage(result, status);
    const cancelled = status.type === "incomplete" && status.reason === "cancelled";
    const label = cancelled ? "表演控制已取消" : isError || status.type === "incomplete" ? "表演控制失败" : status.type === "running" ? "正在调整表演…"
      : parsed.success && parsed.data.command === "cancel" ? "已请求取消表演" : "已请求自然收尾";
    return <ToolCallDetails {...props} label={label} hasDetails={!!error}>
      {error ? <p className="text-destructive" role="alert">{error}</p> : null}
    </ToolCallDetails>;
  },
});
export function AvatarToolUI() { return <><Performance /><Dance /><Control /></>; }
