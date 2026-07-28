import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import type { ChatStreamRequest } from "../src/shared/ipc";
import {
  createChatService,
  sanitizeChatError,
  type ChatServiceAiRuntime,
  type ChatServiceDatabase,
} from "../src/main/ai/chatService";

const characterId = "00000000-0000-4000-8000-000000000001";
const modelConfigId = "00000000-0000-4000-8000-000000000002";
const request: ChatStreamRequest = {
  requestId: "00000000-0000-4000-8000-000000000003",
  threadId: "thread-1",
  characterId,
  frontendTools: {},
  messages: [
    {
      id: "message-1",
      role: "user",
      parts: [{ type: "text", text: "你好" }],
    },
  ],
};

function createDatabase(
  modelId: string | null = modelConfigId,
): ChatServiceDatabase {
  return {
    fetchThread: vi.fn(() => ({
      remoteId: request.threadId,
      status: "regular" as const,
      title: "新对话",
      lastMessageAt: new Date(),
      characterId,
    })),
    fetchCharacter: vi.fn(() => ({
      id: characterId,
      name: "星澜",
      portraitAssetId: null,
      modelConfigId: modelId,
      systemPrompt: "只回答确定性测试内容。",
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    renameThread: vi.fn(),
  };
}

function createModel(onPrompt: (prompt: unknown) => void): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async (options) => {
      onPrompt(options.prompt);
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "text-start", id: "text-1" });
            controller.enqueue({
              type: "text-delta",
              id: "text-1",
              delta: "Katarune ready",
            });
            controller.enqueue({ type: "text-end", id: "text-1" });
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: {
                  total: 2,
                  text: 2,
                  reasoning: undefined,
                },
              },
            });
            controller.close();
          },
        }),
      };
    },
  });
}

describe("chat service", () => {
  it("uses the database character model and instructions to produce an AI SDK SSE stream", async () => {
    let prompt: unknown;
    const model = createModel((value) => {
      prompt = value;
    });
    const database = createDatabase();
    const aiRuntime: ChatServiceAiRuntime = {
      resolveLanguageModel: vi.fn(() => model),
    };
    const service = createChatService({ database, aiRuntime });

    const response = await service.createResponse(request, new AbortController().signal);
    const streamText = await response.text();

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(streamText).toContain("Katarune ready");
    expect(database.fetchThread).toHaveBeenCalledWith(request.threadId, characterId);
    expect(aiRuntime.resolveLanguageModel).toHaveBeenCalledWith(modelConfigId);
    expect(JSON.stringify(prompt)).toContain("只回答确定性测试内容。");
    expect(model.doStreamCalls[0]?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "get_current_time" }),
      ]),
    );
  });

  it("uploads validated renderer tools as non-executable AI SDK tools", async () => {
    const model = createModel(() => undefined);
    const toolkit = {
      tools: vi.fn(async () => ({})),
    };
    const service = createChatService({
      database: createDatabase(),
      aiRuntime: { resolveLanguageModel: () => model },
      toolkit,
    });

    await (
      await service.createResponse(
        {
          ...request,
          frontendTools: {
            show_location: {
              description: "Show a location.",
              parameters: {
                type: "object",
                properties: { name: { type: "string" } },
              },
            },
          },
        },
        new AbortController().signal,
      )
    ).text();

    expect(toolkit.tools).toHaveBeenCalledWith({
      frontend: {
        show_location: {
          description: "Show a location.",
          parameters: {
            type: "object",
            properties: { name: { type: "string" } },
          },
        },
      },
      providerContext: {
        provider: model.provider,
        modelId: model.modelId,
      },
    });
  });

  it("executes a trusted tool and continues the agent loop", async () => {
    let callCount = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        callCount += 1;
        return {
          stream: new ReadableStream({
            start(controller) {
              if (callCount === 1) {
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: "time-call-1",
                  toolName: "get_current_time",
                  input: "{}",
                });
                controller.enqueue({
                  type: "finish",
                  finishReason: { unified: "tool-calls", raw: undefined },
                  usage: {
                    inputTokens: {
                      total: 1,
                      noCache: 1,
                      cacheRead: undefined,
                      cacheWrite: undefined,
                    },
                    outputTokens: {
                      total: 1,
                      text: undefined,
                      reasoning: undefined,
                    },
                  },
                });
              } else {
                controller.enqueue({ type: "text-start", id: "text-2" });
                controller.enqueue({
                  type: "text-delta",
                  id: "text-2",
                  delta: "Time received",
                });
                controller.enqueue({ type: "text-end", id: "text-2" });
                controller.enqueue({
                  type: "finish",
                  finishReason: { unified: "stop", raw: undefined },
                  usage: {
                    inputTokens: {
                      total: 1,
                      noCache: 1,
                      cacheRead: undefined,
                      cacheWrite: undefined,
                    },
                    outputTokens: {
                      total: 2,
                      text: 2,
                      reasoning: undefined,
                    },
                  },
                });
              }
              controller.close();
            },
          }),
        };
      },
    });
    const service = createChatService({
      database: createDatabase(),
      aiRuntime: { resolveLanguageModel: () => model },
    });

    const response = await service.createResponse(
      request,
      new AbortController().signal,
    );
    const streamText = await response.text();

    expect(callCount).toBe(2);
    expect(streamText).toContain("get_current_time");
    expect(streamText).toContain("Time received");
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("timeZone");
  });

  it("rejects renderer-injected system messages", async () => {
    const service = createChatService({
      database: createDatabase(),
      aiRuntime: { resolveLanguageModel: () => createModel(() => undefined) },
    });

    await expect(
      service.createResponse(
        {
          ...request,
          messages: [{ id: "system-1", role: "system", parts: [] }],
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("不允许的系统消息");
  });

  it("generates and persists a role-styled title with the bound model", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: "《星光下的初次问候》" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: {
            total: 3,
            noCache: 3,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 2,
            text: 2,
            reasoning: undefined,
          },
        },
        warnings: [],
      }),
    });
    const database = createDatabase();
    const service = createChatService({
      database,
      aiRuntime: { resolveLanguageModel: () => model },
    });

    const result = await service.generateTitle({
      threadId: request.threadId,
      characterId,
      messages: [
        { role: "user", text: "你好，第一次见面。" },
        { role: "assistant", text: "你好，很高兴认识你。" },
      ],
    });

    expect(result).toEqual({ title: "星光下的初次问候" });
    expect(database.renameThread).toHaveBeenCalledWith(
      request.threadId,
      characterId,
      "星光下的初次问候",
    );
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain(
      "只回答确定性测试内容。",
    );
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain(
      "第一次见面",
    );
    expect(model.doGenerateCalls[0]?.maxOutputTokens).toBe(80);
  });

  it("falls back to the first user message when title generation fails", async () => {
    const database = createDatabase();
    const service = createChatService({
      database,
      aiRuntime: {
        resolveLanguageModel: () =>
          new MockLanguageModelV4({
            doGenerate: async () => {
              throw new Error("secret provider response");
            },
          }),
      },
    });

    await expect(
      service.generateTitle({
        threadId: request.threadId,
        characterId,
        messages: [{ role: "user", text: "  这是一个需要降级的长标题请求  " }],
      }),
    ).resolves.toEqual({ title: "这是一个需要降级的长标题请求" });
    expect(database.renameThread).toHaveBeenCalledWith(
      request.threadId,
      characterId,
      "这是一个需要降级的长标题请求",
    );
  });

  it("returns stable public errors for missing and unavailable models", async () => {
    const missingModelService = createChatService({
      database: createDatabase(null),
      aiRuntime: {
        resolveLanguageModel: () => {
          throw new Error("must not be called");
        },
      },
    });
    await expect(
      missingModelService.createResponse(request, new AbortController().signal),
    ).rejects.toThrow("尚未选择语言模型");

    const unavailableModelService = createChatService({
      database: createDatabase(),
      aiRuntime: {
        resolveLanguageModel: () => {
          throw new Error("secret provider response");
        },
      },
    });
    await expect(
      unavailableModelService.createResponse(request, new AbortController().signal),
    ).rejects.toThrow("模型暂不可用");
    expect(sanitizeChatError(new Error("secret provider response"))).not.toContain(
      "secret provider response",
    );
  });
});
