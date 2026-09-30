import { makeAssistantToolUI } from "@assistant-ui/react";

const Action = makeAssistantToolUI<
  { action: string; allowSpeech?: boolean },
  { ok: true }
>({
  toolName: "avatar_action",
  render: ({ args, status, isError }) => (
    <span className="text-muted-foreground text-sm">
      {isError || status.type === "incomplete"
        ? "动作失败"
        : status.type === "running"
          ? "正在动作"
          : "动作"}{" "}
      · {args.action}
    </span>
  ),
});
const Expression = makeAssistantToolUI<
  { expression: string },
  { ok: true }
>({
  toolName: "set_expression",
  render: ({ args, status, isError }) => (
    <span className="text-muted-foreground text-sm">
      {isError || status.type === "incomplete"
        ? "表情失败"
        : status.type === "running"
          ? "正在改变表情"
          : "表情"}{" "}
      · {args.expression}
    </span>
  ),
});
export function AvatarToolUI() {
  return (
    <>
      <Action />
      <Expression />
    </>
  );
}
