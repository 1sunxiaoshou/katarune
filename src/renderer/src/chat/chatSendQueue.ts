import type { useChat } from "@ai-sdk/react";

type SendMessage = ReturnType<typeof useChat>["sendMessage"];

export function createChatSendQueue(
  send: SendMessage,
  onPending: (count: number) => void,
) {
  let tail = Promise.resolve();
  let pending = 0;
  let disposed = false;
  return {
    send: (...args: Parameters<SendMessage>): Promise<void> => {
      pending += 1;
      onPending(pending);
      const task = tail.then(async () => {
        pending -= 1;
        onPending(pending);
        if (disposed) return;
        await send(...args);
      });
      tail = task.catch(() => undefined);
      return task;
    },
    dispose: () => {
      disposed = true;
    },
    activate: () => {
      disposed = false;
    },
  };
}
