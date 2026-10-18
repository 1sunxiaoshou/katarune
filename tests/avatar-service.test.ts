import { asSchema, ToolLoopAgent, type UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { EventEmitter, once } from "node:events";
import { connect, type Socket } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AvatarService } from "../src/main/avatar/avatarService";
import { avatarReplySchema, type AvatarCapabilities } from "../src/shared/avatar";
import { avatarStepSchema } from "../src/shared/avatarPerformance";
import { z } from "zod";

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

async function launch(capabilities: AvatarCapabilities = {
  actions: [{ id: "wave", label: "挥手", durationSeconds: 2.4 }],
  expressions: ["neutral", "happy"],
}) {
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
    toolCallId?: string;
    runId?: string;
    dialogueId?: string;
  }[] = [];
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const request = JSON.parse(buffer.slice(0, end));
      if (request.type !== "binding") requests.push(request);
      buffer = buffer.slice(end + 1);
    }
  });
  socket.write(
    JSON.stringify({
      type: "ready",
      capabilities,
    }) + "\n",
  );
  await startup;
  const tools = service.createTools(binding, new AbortController().signal);
  const invoke = async (name: string, input: unknown) => {
    const target = tools[name]!;
    const parsed = await asSchema(target.inputSchema).validate!(input);
    if (!parsed.success) throw parsed.error;
    return target.execute!(parsed.value, {
        toolCallId: name,
        messages: [],
        context: undefined,
      });
  };
  return { service, socket, requests, tools, invoke };
}

describe("Unity local control bridge", () => {
  it("lets the native Agent correct an action name misused as an expression without executing the invalid performance", async () => {
    const { tools, requests, socket } = await launch({
      actions: [
        { id: "system.confused", label: "困惑", semantic: "confused", kind: "loop" },
        { id: "shake-head-02", label: "摇头 2", key: "ShakeHead02", kind: "oneShot", layer: "head" },
      ], expressions: ["neutral", "happy", "relaxed", "sad", "angry", "surprised"],
    });
    let step = 0;
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({ start(controller) {
      step += 1;
      if (step <= 2) controller.enqueue({ type: "tool-call", toolCallId: `performance-${step}`, toolName: "avatar_perform", input: JSON.stringify({ steps: [
        { at: "start", action: "system:confused", expression: step === 1 ? "confused" : "neutral" },
        { at: "sentence", sentence: 2, action: "custom:ShakeHead02", expression: "neutral" },
      ] }) });
      else {
        controller.enqueue({ type: "text-start", id: "reply" });
        controller.enqueue({ type: "text-delta", id: "reply", delta: "测试完成" });
        controller.enqueue({ type: "text-end", id: "reply" });
      }
      controller.enqueue({ type: "finish", finishReason: { unified: step <= 2 ? "tool-calls" : "stop", raw: undefined },
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } } });
      controller.close();
    } }) }) });
    const result = await new ToolLoopAgent({ model, tools }).stream({ prompt: "验证动作与表情的独立校验及错误恢复。" });
    const text = result.text;
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    const command = requests[0]!;
    expect(command.toolCallId).toBe("performance-2");
    expect(JSON.parse(command.value).steps).toEqual([
      { at: "start", action: "system.confused", expression: "neutral" },
      { at: "sentence", sentence: 2, action: "shake-head-02", expression: "neutral" },
    ]);
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("Invalid option");
    socket.write(JSON.stringify({ type: "result", id: command.id, ok: true }) + "\n");
    await expect(text).resolves.toBe("测试完成");
    expect(model.doStreamCalls).toHaveLength(3);
    expect(requests).toHaveLength(1);
  });
  it("exposes expression selection without model-authored node identifiers or weights", () => {
    const schema = z.toJSONSchema(avatarStepSchema);
    expect(schema).toHaveProperty("properties.expression");
    expect(schema).not.toHaveProperty("properties.id");
    expect(schema).not.toHaveProperty("properties.intensity");
  });
  it("starts with JsonUtility empty optional identifiers and routes the correct semantic or custom action", async () => {
    const customId = "22222222-2222-4222-8222-222222222222";
    const { service, invoke, socket, requests } = await launch({
      actions: [
        { id: "system.nod", label: "nod", kind: "oneShot", layer: "head", key: "", semantic: "nod" },
        { id: customId, label: "点头 2", kind: "oneShot", layer: "head", key: "Nod02", semantic: "" },
      ], expressions: ["neutral"],
    });
    expect(service.status.phase).toBe("ready");
    expect(service.desktopCapabilities?.actions.map(a => [a.key, a.semantic])).toEqual([[null, "nod"], ["Nod02", null]]);
    for (const [selector, id] of [["system:nod", "system.nod"], ["custom:Nod02", customId]]) {
      const action = invoke("avatar_perform", { steps: [{ at: "start", action: selector }] });
      await vi.waitFor(() => expect(requests.some(r => r.operation === "performance" && JSON.parse(r.value).steps[0].action === id)).toBe(true));
      const request = requests.find(r => r.operation === "performance" && JSON.parse(r.value).steps[0].action === id)!;
      socket.write(JSON.stringify({ type: "result", id: request.id, ok: true, error: "" }) + "\n");
      await action;
      socket.write(JSON.stringify({ type: "performance", performance: { performanceId: request.id, toolCallId: "avatar_perform", state: "failed", error: selector + " unavailable", cues: [] } }) + "\n");
      await vi.waitFor(() => expect(service.status.error).toBe(selector + " unavailable"));
      expect(service.status.phase).toBe("ready");
    }
  });
  it("still rejects malformed required identifiers and non-string optional identifiers", () => {
    const action = { id: "system.nod", label: "nod", kind: "oneShot", layer: "head", key: "", semantic: "nod" };
    for (const invalid of [{ id: "" }, { label: "" }, { key: 123 }, { semantic: "x".repeat(257) }, { layer: "unknown" }])
      expect(avatarReplySchema.safeParse({ type: "ready", capabilities: { actions: [{ ...action, ...invalid }], expressions: [] } }).success).toBe(false);
  });
  it("cancels import preparation in a worker while the active Player stays ready", async () => {
    const { service, requests } = await launch();
    const active = fixture.child!;
    const controller = new AbortController();
    const preparing = service.validatePackage({ formatVersion: 2, id: "import", version: "1.0.0", model: "candidate.vrm", idle: "", idleVariations: [], customActions: [] }, controller.signal);
    const rejected = expect(preparing).rejects.toThrow("cancelled import");
    await vi.waitFor(() => expect(fixture.child).not.toBe(active));
    const worker = fixture.child!;
    controller.abort(new Error("cancelled import"));
    expect(worker.kill).toHaveBeenCalledOnce();
    expect(active.kill).not.toHaveBeenCalled();
    worker.emit("exit", 1);
    await rejected;
    expect(service.status.phase).toBe("ready");
    expect(requests.some(r => r.operation === "validate-package")).toBe(false);
    expect(service.createTools(binding, new AbortController().signal).avatar_perform!.description).toContain("wave");
  });
  it("replaces the action catalog on package switch and rejects tools captured from the old package", async () => {
    const { service, socket, requests, invoke } = await launch();
    const pack = { formatVersion: 2 as const, id: "11111111-1111-4111-8111-111111111111", version: "1.0.0", model: "candidate.vrm", idle: "", idleVariations: [], customActions: [] };
    const switching = service.switchPackage(binding.characterId, pack);
    await vi.waitFor(() => expect(requests.some(r => r.operation === "session-reset")).toBe(true));
    const reset = requests.find(r => r.operation === "session-reset")!;
    socket.write(JSON.stringify({ type: "result", id: reset.id, ok: true }) + "\n");
    await vi.waitFor(() => expect(requests.some(r => r.operation === "load-package")).toBe(true));
    const load = requests.find(r => r.operation === "load-package")!;
    socket.write(JSON.stringify({ type: "ready", capabilities: { actions: [{ id: "22222222-2222-4222-8222-222222222222", label: "招手", description: "问候与告别", durationSeconds: 2 }], expressions: ["neutral"] } }) + "\n");
    socket.write(JSON.stringify({ type: "result", id: load.id, ok: true }) + "\n");
    await switching;
    await expect(invoke("avatar_perform", { steps: [{ at: "start", action: "wave" }] })).rejects.toThrow("连接已改变");
    const tools = service.createTools(binding, new AbortController().signal);
    expect(tools.avatar_perform!.description).toContain("问候与告别");
    expect(tools.avatar_perform!.description).not.toContain("wave");
  });
  it("keeps the Player and old catalog ready when a package candidate fails", async () => {
    const { service, socket, requests } = await launch();
    const switching = service.switchPackage(binding.characterId, { formatVersion: 2, id: "11111111-1111-4111-8111-111111111111", version: "1.0.0", model: "bad.vrm", idle: "", idleVariations: [], customActions: [] });
    const rejected = expect(switching).rejects.toThrow("broken candidate");
    await vi.waitFor(() => expect(requests.some(r => r.operation === "session-reset")).toBe(true));
    socket.write(JSON.stringify({ type: "result", id: requests.find(r => r.operation === "session-reset")!.id, ok: true }) + "\n");
    await vi.waitFor(() => expect(requests.some(r => r.operation === "load-package")).toBe(true));
    socket.write(JSON.stringify({ type: "result", id: requests.find(r => r.operation === "load-package")!.id, ok: false, error: "broken candidate" }) + "\n");
    await rejected; expect(service.status.phase).toBe("ready"); expect(fixture.child!.kill).not.toHaveBeenCalled();
    expect(service.createTools(binding, new AbortController().signal).avatar_perform!.description).toContain("wave");
  });
  it("reports model startup failures immediately and releases the Player", async () => {
    fixture.pipe = "";
    const service = new AvatarService(process.execPath, ".test-dist/avatar-service");
    instances.push(service);
    const startup = service.start(binding);
    const rejected = expect(startup).rejects.toThrow("当前仅支持 VRM 1.0");
    await vi.waitFor(() => expect(fixture.pipe).not.toBe(""));
    const socket = connect(`\\\\.\\pipe\\${fixture.pipe}`);
    sockets.push(socket);
    await once(socket, "connect");
    socket.write(JSON.stringify({ type: "startup-error", error: "当前仅支持 VRM 1.0" }) + "\n");
    await rejected;
    expect(service.status).toMatchObject({ phase: "error", error: "当前仅支持 VRM 1.0" });
    expect(fixture.child!.kill).toHaveBeenCalledOnce();
  });

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

    expect(tools.avatar_perform?.description).toContain(
      "wave（挥手，全身，约 2 秒）",
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
        toolName: "avatar_perform",
        input: { steps: [{ at: "start", action: "wave" }] },
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
    await vi.waitFor(() => expect(requests.filter(r => r.type === "event")).toHaveLength(chunks.length));
    expect(requests.filter(r => r.type === "event").map((r) => r.event)).toEqual(chunks);
    // Observing the tool request must never execute the action twice.
    expect(requests.every((r) => r.type === "event" || r.type === "dialogue-text")).toBe(true);
    expect(service.status.busy).toBe(true);
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

  it("accepts one correlated performance and publishes actual failure separately", async () => {
    const { service, socket, requests, invoke, tools } = await launch();
    expect(service.createTools({ ...binding, threadId: "other" }, new AbortController().signal)).toEqual({});
    expect(Object.keys(tools)).toEqual(["avatar_perform", "avatar_control"]);
    const result = invoke("avatar_perform", { steps: [
      // An obsolete weight in a model's existing context cannot weaken the expression.
      { at: "start", action: "wave", expression: "happy", intensity: .5, sentence: null },
      { at: "after_action", action: null, expression: "neutral", intensity: null, sentence: null },
    ] });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    const id = requests[0]!.id;
    expect(requests[0]).toMatchObject({ operation: "performance", toolCallId: "avatar_perform" });
    expect(JSON.parse(requests[0]!.value).steps).toEqual([
      { at: "start", action: "wave", expression: "happy" },
      { at: "after_action", action: null, expression: "neutral" },
    ]);
    socket.write(JSON.stringify({ type: "result", id, ok: true }) + "\n");
    await expect(result).resolves.toEqual({ status: "accepted", performanceId: id,
      steps: [{ action: "挥手", expression: "happy" }, { action: undefined, expression: "neutral" }] });
    socket.write(JSON.stringify({ type: "performance", performance: { performanceId: id, toolCallId: "avatar_perform", state: "failed", error: "播放失败", cues: [] } }) + "\n");
    await vi.waitFor(() => expect(service.status.performances?.[0]?.state).toBe("failed"));
    expect(service.status.error).toBe("播放失败");
    expect(service.status.phase).toBe("ready");
    const control = invoke("avatar_control", { performanceId: id, command: "cancel" });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toMatchObject({ operation: "performance-cancel", value: id });
    socket.write(JSON.stringify({ type: "result", id: requests[1]!.id, ok: true }) + "\n");
    await control;
    await expect(invoke("avatar_control", { performanceId: "99999999-9999-4999-8999-999999999999", command: "cancel" })).rejects.toThrow("不属于");
  });

  it("rejects invalid dependency graphs and unavailable capabilities before transport", async () => {
    const { invoke, requests } = await launch({ actions: [{ id: "think", label: "思考", kind: "loop" }], expressions: ["happy"] });
    const invalid = [
      { steps: [{ at: "start" }] },
      { steps: [{ at: "after_action", action: "think" }] },
      { steps: [{ at: "sentence", expression: "happy" }] },
      { steps: [{ at: "start", expression: "happy", sentence: 2 }] },
      { steps: [{ at: "start", expression: "sad" }] },
      { steps: [{ at: "start", action: "missing" }] },
      { steps: [{ at: "start", action: "think" }, { at: "after_action", expression: "happy" }] },
    ];
    for (const input of invalid) await expect(invoke("avatar_perform", input)).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });

  it("rejects a refused performance without returning an accepted handle", async () => {
    const { socket, requests, invoke } = await launch();
    const result = invoke("avatar_perform", { steps: [{ at: "start", action: "wave" }] });
    const failed = expect(result).rejects.toThrow("队列已满");
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    socket.write(JSON.stringify({ type: "result", id: requests[0]!.id, ok: false, error: "队列已满" }) + "\n");
    await failed;
    await expect(invoke("avatar_control", { performanceId: requests[0]!.id, command: "finish" })).rejects.toThrow("不属于");
  });

  it("rejects pending work on disconnect and can stop during startup", async () => {
    const { service, socket, invoke } = await launch();
    const failed = expect(
      invoke("avatar_perform", { steps: [{ at: "start", expression: "happy" }] }),
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


it("pushes playback failures even for Unity-owned dialogue IDs", async () => {
  const { service, socket, requests } = await launch();
  const input = new ReadableStream<UIMessageChunk>({ start(controller) {
    controller.enqueue({ type: "start", messageId: "message" }); controller.close();
  } });
  const reader = service.relay(binding, input, new AbortController().signal).getReader();
  while (!(await reader.read()).done) { /* consume chat */ }
  await vi.waitFor(() => expect(requests.some(r => r.type === "event")).toBe(true));
  const runId = requests.find(r => r.type === "event")!.runId;
  const listener = vi.fn(); const unsubscribe = service.subscribe(listener);
  socket.write(JSON.stringify({ type: "speech", runId, id: "00000000-0000-4000-8000-000000000099", status: "failed", error: "播放设备失败" }) + "\n");
  await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(expect.objectContaining({ error: "播放设备失败" })));
  service.clearError(); expect(service.status.error).toBeNull(); unsubscribe();
});


it("shows bound user subtitles immediately without occupying the playback queue", async () => {
  const { service, requests } = await launch();
  service.showUserSubtitle({ ...binding, threadId: "other" }, "不能串会话");
  service.showUserSubtitle(binding, "   ");
  service.showUserSubtitle(binding, "  你好，桌宠。  ");
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toEqual({ type: "user-subtitle", text: "你好，桌宠。" });
  expect(service.status.busy).toBe(false);
});

it("keeps the microphone choice on the active connection and reports actual playback state", async () => {
  const { service, socket, requests } = await launch();
  expect(service.status.voice?.desired).toBe(true);
  service.setVoiceDesired(false);
  await vi.waitFor(() => expect(service.status.voice?.desired).toBe(false));
  service.setVoiceDesired(true);
  await vi.waitFor(() => expect(service.status.voice?.desired).toBe(true));
  const input = new ReadableStream<UIMessageChunk>({ start(controller) {
    controller.enqueue({ type: "start", messageId: "message" }); controller.close();
  } });
  const reader = service.relay(binding, input, new AbortController().signal).getReader();
  while (!(await reader.read()).done) { /* consume chat */ }
  await vi.waitFor(() => expect(requests.some(r => r.type === "event")).toBe(true));
  const runId = requests.find(r => r.type === "event")!.runId;
  socket.write(JSON.stringify({ type: "playback", runId, active: true, state: "playing" }) + "\n");
  await vi.waitFor(() => expect(service.status.playback?.state).toBe("playing"));
  service.controlPlayback(binding, "pause");
  await vi.waitFor(() => expect(requests).toContainEqual({ operation: "voice-pause", value: runId }));
  socket.write(JSON.stringify({ type: "playback", runId, active: true, state: "paused" }) + "\n");
  await vi.waitFor(() => expect(service.status.playback?.state).toBe("paused"));
  service.controlPlayback(binding, "resume");
  await vi.waitFor(() => expect(requests).toContainEqual({ operation: "voice-resume", value: runId }));
});
