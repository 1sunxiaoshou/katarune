import type { useChat } from "@ai-sdk/react";

type SendMessage = ReturnType<typeof useChat>["sendMessage"];
type Task = { args: Parameters<SendMessage>; priority: boolean; resolve(): void; reject(error: unknown): void };

export function createChatSendQueue(
  send: SendMessage,
  onPending: (count: number) => void,
  onDispatch?: (priority: boolean) => void,
) {
  const pending: Task[] = [];
  let active = false;
  let disposed = false;
  const drain = (): void => {
    if (active || disposed || pending.length === 0) return;
    active = true;
    const task = pending.shift()!;
    onPending(pending.length);
    onDispatch?.(task.priority);
    void send(...task.args).then(task.resolve, task.reject).finally(() => {
      active = false;
      drain();
    });
  };
  const enqueue = (priority: boolean, args: Parameters<SendMessage>): Promise<void> => new Promise((resolve, reject) => {
    if (disposed) { resolve(); return; }
    const task = { args, priority, resolve, reject };
    if (priority) pending.unshift(task);
    else pending.push(task);
    onPending(pending.length);
    queueMicrotask(drain);
  });
  return {
    send: (...args: Parameters<SendMessage>) => enqueue(false, args),
    prioritySend: (...args: Parameters<SendMessage>) => enqueue(true, args),
    dispose: () => {
      disposed = true;
      for (const task of pending.splice(0)) task.resolve();
      onPending(0);
    },
    activate: () => {
      disposed = false;
    },
  };
}
