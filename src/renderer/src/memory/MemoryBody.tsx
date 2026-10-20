import type { ReactNode } from "react";
import type { MemoryContent } from "../../../shared/memory";

export function DiaryBody({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="memory-diary-body"><div className="memory-diary-scroll">{children}</div></div>;
}

export function MemoryStamp({ content }: { content: MemoryContent }): React.JSX.Element {
  return content.kind === "diary" ? <time className="memory-diary-date" dateTime={content.day}><span>{content.day.slice(0, 4)}年{Number(content.day.slice(5, 7))}月{Number(content.day.slice(8))}日</span><span>{new Date(`${content.day}T12:00:00`).toLocaleDateString("zh-CN", { weekday: "long" })}</span></time> : <p>{content.kind === "person" ? content.isUser ? "用户画像" : "人物画像" : "纪事"}</p>;
}
