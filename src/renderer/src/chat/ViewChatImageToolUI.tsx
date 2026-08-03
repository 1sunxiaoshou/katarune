import { makeAssistantToolUI } from "@assistant-ui/react";
import { CheckCircle2, ImageIcon, LoaderCircle, TriangleAlert } from "lucide-react";

interface ViewChatImageResult {
  readonly status: "loaded";
  readonly filename: string;
}

function isViewChatImageResult(value: unknown): value is ViewChatImageResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    value.status === "loaded" &&
    "filename" in value &&
    typeof value.filename === "string"
  );
}

export const ViewChatImageToolUI = makeAssistantToolUI({
  toolName: "view_chat_image",
  render: ({ result, status }) => {
    if (status.type === "running") {
      return (
        <div className="text-muted-foreground flex items-center gap-2 py-1 text-sm">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          <span>正在读取历史图片…</span>
        </div>
      );
    }

    if (status.type === "complete" && isViewChatImageResult(result)) {
      return (
        <div className="text-muted-foreground flex items-center gap-2 py-1 text-sm">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          <span>已读取图片“{result.filename}”</span>
        </div>
      );
    }

    if (status.type === "incomplete") {
      return (
        <div className="text-destructive flex items-center gap-2 py-1 text-sm">
          <TriangleAlert className="size-4" aria-hidden="true" />
          <span>历史图片读取失败</span>
        </div>
      );
    }

    return (
      <div className="text-muted-foreground flex items-center gap-2 py-1 text-sm">
        <ImageIcon className="size-4" aria-hidden="true" />
        <span>历史图片</span>
      </div>
    );
  },
});
