import type { UIMessageChunk } from "ai";
import { EventEmitter, once } from "node:events";
import { connect, type Socket } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AvatarService } from "../src/main/avatar/avatarService";

const fixture = vi.hoisted(() => ({
  pipe: "",
  child: undefined as
    (EventEmitter & { kill: ReturnType<typeof vi.fn> }) | undefined,
}));
vi.mock("node:child_process", () => ({
  spawn: vi.fn((_exe, _args, options) => {
    fixture.pipe = options.env.KATARUNE_AVATAR_PIPE;
    fixture.child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    return fixture.child;
  }),
}));
const binding = {
  characterId: "00000000-0000-4000-8000-000000000001",
  threadId: "00000000-0000-4000-8000-000000000002",
};
const instances: AvatarService[] = [];
const sockets: Socket[] = [];
afterEach(() => {
  instances.splice(0).forEach((service) => service.stop());
  sockets.splice(0).forEach((socket) => socket.destroy());
});

async function launch() {
  fixture.pipe = "";
  const service = new AvatarService(
    process.execPath,
    ".test-dist/avatar-service",
  );
  instances.push(service);
  const startup = service.start(binding);
  await vi.waitFor(() => expect(fixture.pipe).not.toBe(""));
  const socket = connect(`\\\\.\\pipe\\${fixture.pipe}`);
  sockets.push(socket);
  await once(socket, "connect");
  socket.setEncoding("utf8");
  const requests: {
    id: string;
    operation: string;
    value: string;
    type?: string;
    event?: UIMessageChunk;
    allowSpeech?: boolean;
    toolCallId?: string;
    runId?: string;
    dialogueId?: string;
  }[] = [];
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      requests.push(JSON.parse(buffer.slice(0, end)));
      buffer = buffer.slice(end + 1);
    }
  });
  socket.write(
    JSON.stringify({
      type: "ready",
      capabilities: {
        actions: [{ id: "wave", label: "挥手", durationSeconds: 2.4 }],
        expressions: ["neutral", "happy"],
      },
    }) + "\n",
  );
  await startup;
  const tools = service.createTools(binding, new AbortController().signal);
  const invoke = (name: string, input: unknown) =>
    Promise.resolve(
      tools[name]!.execute!(input as never, {
        toolCallId: name,
        messages: [],
        context: undefined,
      }),
    );
  return { service, socket, requests, tools, invoke };
}

describe("Unity local control bridge", () => {
  it("keeps slow synthesis alive after chat closes and accepts the next turn before playback completes", async () => {
    const { service, socket, requests } = await launch();
    let resume!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const generate = vi.fn(async () => {
      await gate;
      return { audio: new Uint8Array([1, 2, 3]), format: "wav", mediaType: "audio/wav" as const,
        cacheHit: false, spokenText: "你好。" };
    });
    service.configureSpeech({ generate });
    const sendTurn = async () => {
      const stream = new ReadableStream<UIMessageChunk>({ start(controller) {
        controller.enqueue({ type: "text-start", id: "text" });
        controller.enqueue({ type: "text-delta", id: "text", delta: "你好。" });
        controller.enqueue({ type: "text-end", id: "text" });
        controller.close();
      } });
      const reader = service.relay(binding, stream, new AbortController().signal).getReader();
      while (!(await reader.read()).done) { /* consume native chat stream */ }
    };
    await sendTurn();
    await sendTurn();
    expect(generate).toHaveBeenCalledTimes(2);
    expect(requests.some(request => request.type === "dialogue-audio")).toBe(false);
    resume();
    await vi.waitFor(() => expect(requests.filter(request => request.type === "dialogue-audio")).toHaveLength(2));
    const runIds = [...new Set(requests.filter(request => request.type === "event").map(request => request.runId))];
    const audio = runIds.map(runId => requests.find(request => request.type === "dialogue-audio" && request.runId === runId)!);
    const drains = requests.filter(request => request.operation === "drain");
    expect(drains).toHaveLength(2);
    expect(audio[0]!.runId).not.toBe(audio[1]!.runId);
    for (const request of audio) expect(existsSync(request.value)).toBe(true);
    socket.write(JSON.stringify({ type: "result", id: drains[0]!.id, ok: true }) + "\n");
    await vi.waitFor(() => expect(existsSync(audio[0]!.value)).toBe(false));
    expect(existsSync(audio[1]!.value)).toBe(true);
    socket.write(JSON.stringify({ type: "result", id: drains[1]!.id, ok: true }) + "\n");
    await vi.waitFor(() => expect(existsSync(audio[1]!.value)).toBe(false));
  });

  it.each([false, true])("always enables desktop dialogue speech without a browser preference (failure=%s)", async (failed) => {
    const { service, socket, requests } = await launch();
    const generate = vi.fn(async () => {
      if (failed) throw new Error("voice unavailable");
      return { audio: new Uint8Array([1, 2, 3]), format: "wav" as const,
        mediaType: "audio/wav" as const, cacheHit: false, spokenText: "你好。" };
    });
    service.configureSpeech({ generate });
    const chunks: UIMessageChunk[] = [
      { type: "text-start", id: "dialogue" },
      { type: "text-delta", id: "dialogue", delta: "你好。" },
      { type: "text-end", id: "dialogue" },
    ];
    const input = new ReadableStream<UIMessageChunk>({ start(controller) {
      chunks.forEach(chunk => controller.enqueue(chunk));
      controller.close();
    } });
    const reader = service.relay(binding, input, new AbortController().signal).getReader();
    for (const chunk of chunks) expect((await reader.read()).value).toEqual(chunk);
    await vi.waitFor(() => expect(requests).toContainEqual(expect.objectContaining({
      type: "dialogue-audio", dialogueId: "dialogue", failed, text: "你好。",
    })));
    expect(generate).toHaveBeenCalledExactlyOnceWith(binding.characterId, "你好。", expect.any(AbortSignal), true, expect.any(Function));
    expect(requests.filter(request => request.type === "event")).toEqual(
      chunks.map(event => expect.objectContaining({ event, speechEnabled: true })),
    );
    expect((await reader.read()).done).toBe(true);
    await vi.waitFor(() => expect(requests.some(request => request.operation === "drain")).toBe(true));
    const drain = requests.find(request => request.operation === "drain")!;
    socket.write(JSON.stringify({ type: "result", id: drain.id, ok: true }) + "\n");
    expect(service.status.phase).toBe("ready");
  });

  it("does not synthesize dialogue for a different conversation", async () => {
    const { service, requests } = await launch();
    const generate = vi.fn();
    service.configureSpeech({ generate });
    const input = new ReadableStream<UIMessageChunk>({ start(controller) { controller.close(); } });
    expect(service.relay({ ...binding, threadId: "other" }, input, new AbortController().signal)).toBe(input);
    expect(generate).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });

  it("plays trusted audio, forwards start, and removes its temporary file after completion", async () => {
    const { service, socket, requests } = await launch();
    const started = vi.fn();
    const playback = service.playSpeech(binding, {
      audio: new Uint8Array([1, 2, 3]), format: "wav", mediaType: "audio/wav", cacheHit: true,
    }, new AbortController().signal, started);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    const request = requests[0]!;
    expect(request.operation).toBe("speech");
    expect([...readFileSync(request.value)]).toEqual([1, 2, 3]);
    socket.write(JSON.stringify({ type: "speech", id: request.id, status: "started", error: null }) + "\n");
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
    socket.write(JSON.stringify({ type: "speech", id: request.id, status: "completed", error: null }) + "\n");
    await expect(playback).resolves.toBe(true);
    expect(existsSync(request.value)).toBe(false);
  });

  it("cancels only the matching speech without stopping the avatar", async () => {
    const { service, socket, requests } = await launch();
    const controller = new AbortController();
    const playback = service.playSpeech(binding, {
      audio: new Uint8Array([1]), format: "wav", mediaType: "audio/wav", cacheHit: false,
    }, controller.signal, () => {});
    const rejected = expect(playback).rejects.toThrow();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    controller.abort();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]!.operation).toBe("speech-stop");
    expect(requests[1]!.value).toBe(requests[0]!.id);
    socket.write(JSON.stringify({ type: "speech", id: requests[0]!.id, status: "cancelled" }) + "\n");
    await rejected;
    expect(service.status.phase).toBe("ready");
    expect(existsSync(requests[0]!.value)).toBe(false);
  });

  it("describes action durations approximately", async () => {
    const { tools } = await launch();

    expect(tools.avatar_action?.description).toContain(
      "wave（挥手，约 2 秒）",
    );
  });

  it("closes chat before Unity finishes playback and detaches the generation signal", async () => {
    const { service, socket, requests } = await launch();
    expect(
      service.createTools(binding, new AbortController().signal),
    ).not.toHaveProperty("speak");
    const chunks: UIMessageChunk[] = [
      { type: "start", messageId: "message" },
      { type: "start-step" },
      { type: "reasoning-start", id: "reason" },
      { type: "reasoning-delta", id: "reason", delta: "private reasoning" },
      { type: "reasoning-end", id: "reason" },
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", delta: "你好🌸" },
      { type: "text-end", id: "text" },
      {
        type: "tool-input-available",
        toolCallId: "action",
        toolName: "avatar_action",
        input: { action: "wave" },
      },
      {
        type: "tool-output-available",
        toolCallId: "action",
        output: { completed: true },
      },
      { type: "finish-step" },
      { type: "finish", finishReason: "stop" },
    ];
    let source!: ReadableStreamDefaultController<UIMessageChunk>;
    const input = new ReadableStream<UIMessageChunk>({
      start(controller) {
        source = controller;
      },
    });
    const lifetime = new AbortController();
    const reader = service.relay(binding, input, lifetime.signal).getReader();
    for (const chunk of chunks) {
      source.enqueue(chunk);
      expect((await reader.read()).value).toEqual(chunk);
    }
    await vi.waitFor(() => expect(requests).toHaveLength(chunks.length));
    expect(requests.map((r) => r.event)).toEqual(chunks);
    // Observing the tool request must never execute the action twice.
    expect(requests.every((r) => r.type === "event")).toBe(true);
    await expect(
      service.start({ ...binding, threadId: "other" }),
    ).rejects.toThrow("角色仍在执行");
    source.close();
    let closed = false;
    const done = reader.read().then((result) => {
      closed = result.done;
    });
    await vi.waitFor(() => expect(requests.at(-1)?.operation).toBe("drain"));
    await done;
    expect(closed).toBe(true);
    lifetime.abort();
    await new Promise(resolve => setImmediate(resolve));
    expect(requests.some(request => request.operation === "run-cancel")).toBe(false);
    socket.write(
      JSON.stringify({ type: "result", id: requests.at(-1)!.id, ok: true }) +
        "\n",
    );
    expect(service.status.phase).toBe("ready");
  });

  it("keeps chat output available after Unity disconnects", async () => {
    const { service, socket } = await launch();
    let source!: ReadableStreamDefaultController<UIMessageChunk>;
    const input = new ReadableStream<UIMessageChunk>({
      start(controller) {
        source = controller;
      },
    });
    const reader = service
      .relay(binding, input, new AbortController().signal)
      .getReader();
    socket.end();
    await vi.waitFor(() => expect(service.status.phase).toBe("error"));
    source.enqueue({ type: "text-delta", id: "text", delta: "继续回复" });
    source.close();
    expect((await reader.read()).value).toEqual({
      type: "text-delta",
      id: "text",
      delta: "继续回复",
    });
    expect((await reader.read()).done).toBe(true);
  });

  it("binds tools to the active character/thread and accepts each correlated instruction", async () => {
    const { service, socket, requests, invoke } = await launch();
    expect(service.status.phase).toBe("ready");
    expect(
      service.createTools(
        { ...binding, threadId: "other" },
        new AbortController().signal,
      ),
    ).toEqual({});
    let expressionAccepted = false;
    const expression = invoke("set_expression", { expression: "happy" }).then(
      (result) => {
        expressionAccepted = true;
        return result;
      },
    );
    const action = invoke("avatar_action", {
      action: "wave",
      allowSpeech: false,
    });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    const actionRequest = requests.find((r) => r.operation === "action")!;
    expect(actionRequest).toMatchObject({
      allowSpeech: false,
      toolCallId: "avatar_action",
    });
    socket.write(
      JSON.stringify({ type: "result", id: actionRequest.id, ok: true }) + "\n",
    );
    await expect(action).resolves.toEqual({ ok: true });
    expect(expressionAccepted).toBe(false);
    await expect(
      service.start({ ...binding, threadId: "other" }),
    ).rejects.toThrow("角色仍在执行");
    socket.write(
      JSON.stringify({
        type: "result",
        id: requests.find((r) => r.operation === "expression")!.id,
        ok: true,
      }) + "\n",
    );
    await expect(expression).resolves.toEqual({ ok: true });
    expect(expressionAccepted).toBe(true);
    expect(requests.find((r) => r.operation === "expression")).toMatchObject({
      toolCallId: "set_expression",
    });
    await expect(
      service.start({ ...binding, threadId: "other" }),
    ).rejects.toThrow("角色仍在执行");
    socket.write(
      JSON.stringify({
        type: "action",
        id: actionRequest.id,
        status: "completed",
      }) + "\n",
    );
    socket.write(
      JSON.stringify({
        type: "expression",
        id: requests.find((r) => r.operation === "expression")!.id,
        status: "applied",
      }) + "\n",
    );
  });

  it("reports runtime failure without claiming a successful action", async () => {
    const { socket, requests, invoke } = await launch();
    const result = invoke("avatar_action", { action: "wave" });
    const failed = expect(result).rejects.toThrow("动作被中止");
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    socket.write(
      JSON.stringify({
        type: "result",
        id: requests[0]!.id,
        ok: false,
        error: "动作被中止",
      }) + "\n",
    );
    await failed;
  });

  it("returns on acceptance and handles a later playback failure separately", async () => {
    const { service, socket, requests, invoke } = await launch();
    const result = invoke("avatar_action", {
      action: "wave",
      allowSpeech: true,
    });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    const id = requests[0]!.id;
    socket.write(JSON.stringify({ type: "result", id, ok: true }) + "\n");
    await expect(result).resolves.toEqual({ ok: true });
    socket.write(
      JSON.stringify({ type: "action", id, status: "started" }) + "\n",
    );
    socket.write(
      JSON.stringify({
        type: "action",
        id,
        status: "failed",
        error: "播放失败",
      }) + "\n",
    );
    await vi.waitFor(() => expect(service.status.error).toBe("播放失败"));
    expect(service.status.phase).toBe("ready");
  });

  it("rejects pending work on disconnect and can stop during startup", async () => {
    const { service, socket, invoke } = await launch();
    const failed = expect(
      invoke("set_expression", { expression: "happy" }),
    ).rejects.toThrow("Unity 已断开");
    socket.end();
    await failed;
    expect(service.status.phase).toBe("error");
    const starting = service.start(binding);
    const stopped = expect(starting).rejects.toThrow("桌宠控制已停止");
    service.stop();
    await stopped;
    expect(service.status.phase).toBe("stopped");
  });
});
