import { describe, expect, it, vi } from "vitest";
import { createChatSendQueue } from "../src/renderer/src/chat/chatSendQueue";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("avatar chat input queue", () => {
  it("waits for the whole previous send before forwarding the next input", async () => {
    const first = deferred();
    const send = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    const counts: number[] = [];
    const queue = createChatSendQueue(send, (count) => counts.push(count));
    const one = queue.send({ text: "第一句" });
    await Promise.resolve();
    const two = queue.send({ text: "第二句" });
    const three = queue.send({ text: "第三句" });
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    expect(counts.at(-1)).toBe(2);
    first.resolve();
    await Promise.all([one, two, three]);
    expect(send.mock.calls.map((call) => call[0].text)).toEqual([
      "第一句",
      "第二句",
      "第三句",
    ]);
    expect(counts.at(-1)).toBe(0);
  });

  it("releases the next message after an error and drops waiting messages on disposal", async () => {
    const first = deferred();
    const send = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    const queue = createChatSendQueue(send, () => undefined);
    const one = queue.send({ text: "one" });
    const failure = expect(one).rejects.toThrow("offline");
    const two = queue.send({ text: "two" });
    await Promise.resolve();
    first.reject(new Error("offline"));
    await failure;
    await two;
    expect(send).toHaveBeenCalledTimes(2);
    const three = queue.send({ text: "three" });
    queue.dispose();
    await three;
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("runs confirmed speech before waiting typed messages", async () => {
    const first = deferred();
    const send = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined);
    const dispatched: boolean[] = [];
    const queue = createChatSendQueue(send, () => undefined, priority => dispatched.push(priority));
    const running = queue.send({ text: "正在回复" });
    await Promise.resolve();
    const typed = queue.send({ text: "排队文字" });
    const voice = queue.prioritySend({ text: "语音插话" });
    first.resolve();
    await Promise.all([running, typed, voice]);
    expect(send.mock.calls.map(call => call[0].text)).toEqual(["正在回复", "语音插话", "排队文字"]);
    expect(dispatched).toEqual([false, true, false]);
  });
});
