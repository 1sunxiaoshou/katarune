import type { ThreadTitleMessage } from "./ipc";

export const THREAD_TITLE_MAX_MESSAGES = 12;
export const THREAD_TITLE_MAX_EXCERPT = 2000;

type MessagePart = { readonly type: string; readonly text?: string };

export function toThreadTitleMessages<Message extends { readonly role: string }>(
  messages: readonly Message[],
  partsOf: (message: Message) => readonly MessagePart[],
): ThreadTitleMessage[] {
  const excerpts: ThreadTitleMessage[] = [];
  for (const message of messages) {
    const { role } = message;
    if (role !== "user" && role !== "assistant") continue;
    const text = partsOf(message)
      .filter(part => part.type === "text")
      .map(part => part.text)
      .join("\n")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, THREAD_TITLE_MAX_EXCERPT);
    if (!text) continue;
    excerpts.push({ role, text });
    if (excerpts.length === THREAD_TITLE_MAX_MESSAGES) break;
  }
  return excerpts;
}
