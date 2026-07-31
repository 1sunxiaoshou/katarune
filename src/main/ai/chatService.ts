import {
  stepCountIs,
  ToolLoopAgent,
  createAgentUIStreamResponse,
  type LanguageModel,
  type ToolSet,
} from "ai";
import type { FrontendTools as AISDKFrontendTools } from "@assistant-ui/react-ai-sdk";
import type { ToolJSONSchema } from "assistant-stream";
import { z } from "zod";
import type {
  ChatStreamRequest,
  GenerateThreadTitleRequest,
  GenerateThreadTitleResponse,
} from "../../shared/ipc";
import type { Character } from "../../shared/characters";
import type { DatabaseRuntime } from "../database/database";
import type { AiRuntime, ResolvedLanguageModel } from "./runtime";
import {
  kataruneAiToolkit,
  type KataruneAiToolkitToolsOptions,
} from "./toolkit";

export type ChatServiceDatabase = Pick<
  DatabaseRuntime,
  "fetchCharacter" | "fetchThread" | "getAppSettings" | "renameThread"
>;
export type ChatServiceAiRuntime = Pick<AiRuntime, "resolveLanguageModel">;

interface ChatEnvironmentSource {
  now(): Date;
  timeZone(): string;
}

export interface ChatService {
  createResponse(
    request: ChatStreamRequest,
    abortSignal: AbortSignal,
  ): Promise<Response>;
  generateTitle(
    request: GenerateThreadTitleRequest,
  ): Promise<GenerateThreadTitleResponse>;
}

interface CreateChatServiceOptions {
  readonly database: ChatServiceDatabase;
  readonly aiRuntime: ChatServiceAiRuntime;
  readonly createAgent?: typeof createCharacterAgent;
  readonly createTitleAgent?: typeof createCharacterTitleAgent;
  readonly environmentSource?: ChatEnvironmentSource;
  readonly toolkit?: {
    tools(options?: KataruneAiToolkitToolsOptions): Promise<ToolSet>;
  };
}

class PublicChatError extends Error {}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const chatCallOptionsSchema = z.object({
  currentDate: z.iso.date(),
  timeZone: z
    .string()
    .min(1)
    .refine(isValidTimeZone, "Invalid IANA time zone."),
});

type ChatCallOptions = z.infer<typeof chatCallOptionsSchema>;

const systemChatEnvironmentSource: ChatEnvironmentSource = {
  now: () => new Date(),
  timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
};

function toAISDKFrontendTools(
  frontendTools: ChatStreamRequest["frontendTools"],
): AISDKFrontendTools {
  return Object.fromEntries(
    Object.entries(frontendTools).map(([name, frontendTool]) => [
      name,
      {
        ...(frontendTool.description !== undefined && {
          description: frontendTool.description,
        }),
        parameters:
          frontendTool.parameters as ToolJSONSchema["parameters"],
      },
    ]),
  );
}

function createCharacterAgent(
  character: Character,
  model: LanguageModel,
  tools: ToolSet,
): ToolLoopAgent<ChatCallOptions, ToolSet> {
  return new ToolLoopAgent<ChatCallOptions, ToolSet>({
    id: `character-${character.id}`,
    model,
    instructions: character.systemPrompt,
    callOptionsSchema: chatCallOptionsSchema,
    prepareCall: ({ options, ...settings }) => ({
      ...settings,
      instructions: [
        character.systemPrompt,
        `Current date: ${options.currentDate}`,
        `Time zone: ${options.timeZone}`,
      ].join("\n"),
    }),
    tools,
    stopWhen: stepCountIs(8),
  });
}

function createCharacterTitleAgent(
  character: Character,
  model: LanguageModel,
): ToolLoopAgent {
  return new ToolLoopAgent({
    id: `character-${character.id}-thread-title`,
    model,
    maxOutputTokens: 80,
    instructions: [
      character.systemPrompt,
      "当前任务是生成会话标题。保持角色语言风格，但只输出标题本身，不要添加引号、解释、Markdown 或句号；标题不超过 30 个字符。",
    ].join("\n\n"),
  });
}

function containsSystemMessage(messages: readonly unknown[]): boolean {
  return messages.some(
    (message) =>
      typeof message === "object" &&
      message !== null &&
      "role" in message &&
      message.role === "system",
  );
}

function resolveChatCallOptions(
  environmentSource: ChatEnvironmentSource,
): ChatCallOptions {
  const timeZone = new Intl.DateTimeFormat("en-US", {
    timeZone: environmentSource.timeZone(),
  }).resolvedOptions().timeZone;
  const dateParts = new Intl.DateTimeFormat("en-US", {
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(environmentSource.now());

  const readPart = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = dateParts.find((part) => part.type === type)?.value;
    if (value === undefined) {
      throw new Error(`Unable to resolve environment date part "${type}".`);
    }
    return value;
  };

  return {
    currentDate: `${readPart("year")}-${readPart("month")}-${readPart("day")}`,
    timeZone,
  };
}

function fallbackThreadTitle(request: GenerateThreadTitleRequest): string {
  const firstUserMessage =
    request.messages.find((message) => message.role === "user")?.text ??
    request.messages[0]?.text ??
    "新对话";
  const normalized = firstUserMessage.replace(/\s+/g, " ").trim();
  return Array.from(normalized).slice(0, 30).join("") || "新对话";
}

function resolveLanguageModelConfigId(
  database: ChatServiceDatabase,
  character: Character,
): string | null {
  return (
    character.modelConfigId ??
    database.getAppSettings().defaultLanguageModelConfigId
  );
}

function sanitizeThreadTitle(value: string, fallback: string): string {
  const normalized = value
    .replace(/^#+\s*/, "")
    .replace(/^标题\s*[:：]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“‘《「『`]+|["'”’》」』`]+$/g, "")
    .trim();
  return Array.from(normalized || fallback).slice(0, 30).join("");
}

function buildTitlePrompt(request: GenerateThreadTitleRequest): string {
  const transcript = request.messages
    .map((message) => `${message.role === "user" ? "用户" : "角色"}：${message.text}`)
    .join("\n");
  return `请为下面的对话生成一个简短的会话标题：\n\n${transcript}`;
}

export function sanitizeChatError(error: unknown): string {
  if (error instanceof PublicChatError) return error.message;
  return "模型回复失败，请稍后重试或检查模型设置。";
}

export function createChatService({
  database,
  aiRuntime,
  createAgent = createCharacterAgent,
  createTitleAgent = createCharacterTitleAgent,
  environmentSource = systemChatEnvironmentSource,
  toolkit = kataruneAiToolkit,
}: CreateChatServiceOptions): ChatService {
  return {
    createResponse: async (request, abortSignal) => {
      database.fetchThread(request.threadId, request.characterId);
      const character = database.fetchCharacter(request.characterId);
      const modelConfigId = resolveLanguageModelConfigId(database, character);

      if (modelConfigId === null) {
        throw new PublicChatError("尚未设置应用默认语言模型。");
      }
      if (containsSystemMessage(request.messages)) {
        throw new PublicChatError("会话消息包含不允许的系统消息。");
      }

      let model: ResolvedLanguageModel;
      try {
        model = aiRuntime.resolveLanguageModel(modelConfigId);
      } catch {
        throw new PublicChatError(
          character.modelConfigId === null
            ? "应用默认模型暂不可用，请检查常规与模型设置。"
            : "当前角色配置的模型暂不可用，请检查模型与供应商设置。",
        );
      }

      const tools = await toolkit.tools({
        frontend: toAISDKFrontendTools(request.frontendTools),
        providerContext: {
          provider: model.provider,
          modelId: model.modelId,
        },
      });
      const agent = createAgent(character, model, tools);
      return createAgentUIStreamResponse({
        agent,
        uiMessages: request.messages,
        options: resolveChatCallOptions(environmentSource),
        abortSignal,
        onError: sanitizeChatError,
      });
    },
    generateTitle: async (request) => {
      database.fetchThread(request.threadId, request.characterId);
      const character = database.fetchCharacter(request.characterId);
      const fallback = fallbackThreadTitle(request);
      let title = fallback;
      const modelConfigId = resolveLanguageModelConfigId(database, character);

      if (modelConfigId !== null) {
        try {
          const model = aiRuntime.resolveLanguageModel(modelConfigId);
          const agent = createTitleAgent(character, model);
          const result = await agent.generate({
            prompt: buildTitlePrompt(request),
            timeout: 15_000,
          });
          title = sanitizeThreadTitle(result.text, fallback);
        } catch {
          title = fallback;
        }
      }

      database.renameThread(request.threadId, request.characterId, title);
      return { title };
    },
  };
}
