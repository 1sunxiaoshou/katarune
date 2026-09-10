import { makeAssistantToolUI } from "@assistant-ui/react";

const Action = makeAssistantToolUI<
  { action: string; allowSpeech?: boolean },
  { actionId: string; status: "accepted" }
>({
  toolName: "avatar_action",
  render: ({ args, status, isError }) => (
    <span className="text-muted-foreground text-sm">
      {isError || status.type === "incomplete"
        ? "动作失败"
        : status.type === "running"
          ? "正在提交动作"
          : "动作已接收"}{" "}
      · {args.action}
    </span>
  ),
});
const Expression = makeAssistantToolUI<
  { expression: string },
  { expressionId: string; status: "accepted" }
>({
  toolName: "set_expression",
  render: ({ args, status, isError }) => (
    <span className="text-muted-foreground text-sm">
      {isError || status.type === "incomplete"
        ? "表情编排失败"
        : status.type === "running"
          ? "正在提交表情"
          : "表情已接收"}{" "}
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
