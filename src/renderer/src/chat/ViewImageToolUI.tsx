import { makeAssistantToolUI } from "@assistant-ui/react";
import { ToolCallDetails } from "@/components/tool-fallback";

interface ViewImageResult {
  readonly status: "loaded";
  readonly filename: string;
}

function isViewImageResult(value: unknown): value is ViewImageResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    value.status === "loaded" &&
    "filename" in value &&
    typeof value.filename === "string"
  );
}

export const ViewImageToolUI = makeAssistantToolUI({
  toolName: "view_image",
  render: props => {
    const { result, status, isError } = props;
    const cancelled = status.type === "incomplete" && status.reason === "cancelled";
    const label = cancelled ? "图片读取已取消" : status.type === "running" ? "正在读取图片…"
      : status.type === "incomplete" || isError ? "图片读取失败" : "已读取图片";
    const filename = isViewImageResult(result) ? result.filename : undefined;
    return <ToolCallDetails {...props} label={label} target={filename} />;
  },
});
