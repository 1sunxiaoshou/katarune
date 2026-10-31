import { BrowserWindow, dialog, nativeImage, shell } from "electron";
import { writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { chatFileRequestSchema, chatFileResultSchema } from "../../shared/agentTools";
import { AGENT_TOOL_CHANNELS, agentAccessStateSchema, agentAccessRequestSchema, agentCharacterRequestSchema, agentModeRequestSchema } from "../../shared/agentTools";
import { diagnosticIpcMain } from "../diagnostics/ipc";
import { OperationRejected, parseRequest } from "../diagnostics/operationRejected";
import type { AgentToolsService } from "../ai/agentTools";

export function registerAgentToolHandlers(service: Pick<AgentToolsService, "readChatFile" | "describeChatAttachment" | "state" | "setMode" | "workspace">) {
  diagnosticIpcMain.handle(AGENT_TOOL_CHANNELS.file, async (event, value: unknown) => {
    const request = parseRequest(chatFileRequestSchema, value);
    if (request.action === "open" && "attachmentId" in request.source) throw new OperationRejected("operation-not-allowed", "附件请使用预览或另存为。");
    if (request.action === "info" && "attachmentId" in request.source) return chatFileResultSchema.parse(service.describeChatAttachment(request.characterId, request.threadId, request.source.attachmentId));
    const file = await service.readChatFile(request.characterId, request.threadId, request.source);
    const filename = basename(file.filename.replaceAll("\\", "/"));
    const result = { filename, byteSize: file.data.byteLength };
    const extension = extname(filename).toLowerCase();
    if (request.action === "info") return chatFileResultSchema.parse(result);
    if (request.action === "preview") {
      if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(extension)) {
        const image = nativeImage.createFromBuffer(Buffer.from(file.data));
        if (!image.isEmpty()) return chatFileResultSchema.parse({ ...result, image: image.resize({ width: Math.min(image.getSize().width, 1600) }).toDataURL() });
      }
      if (/^\.(txt|md|csv|json|log|yaml|yml|xml|ts|tsx|js|jsx|css|html|py|sh)$/.test(extension)) {
        return chatFileResultSchema.parse({ ...result, text: new TextDecoder().decode(file.data.slice(0, 200_000)) + (file.data.byteLength > 200_000 ? "\n…预览已截断" : "") });
      }
      return chatFileResultSchema.parse(result);
    }
    if (request.action === "save") {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) throw new Error("文件窗口已关闭。");
      const destination = await dialog.showSaveDialog(window, { defaultPath: filename, properties: ["showOverwriteConfirmation"] });
      if (destination.canceled || !destination.filePath) return { ...result, cancelled: true };
      await writeFile(destination.filePath, file.data);
    } else {
      if (!/^\.(txt|md|csv|json|pdf|docx?|xlsx?|pptx?|odt|ods|odp|png|jpe?g|webp|gif|bmp|mp3|wav|mp4|webm)$/.test(extension)) throw new Error("此文件类型请使用另存为。");
      if (!("path" in file) || typeof file.path !== "string") throw new Error("文件路径不可用。");
      if (await shell.openPath(file.path)) throw new Error("无法打开文件，请尝试另存为。");
    }
    return chatFileResultSchema.parse(result);
  });
  diagnosticIpcMain.handle(AGENT_TOOL_CHANNELS.get, (_event, value: unknown) => {
    const request = parseRequest(agentAccessRequestSchema, value);
    return agentAccessStateSchema.parse(service.state(request.characterId, request.threadId));
  });
  diagnosticIpcMain.handle(AGENT_TOOL_CHANNELS.setMode, (_event, value: unknown) => {
    const request = parseRequest(agentModeRequestSchema, value);
    return agentAccessStateSchema.parse(service.setMode(request.characterId, request.threadId, request.mode));
  });
  diagnosticIpcMain.handle(AGENT_TOOL_CHANNELS.openWorkspace, async (_event, value: unknown) => {
    const request = parseRequest(agentCharacterRequestSchema, value);
    const error = await shell.openPath(await service.workspace(request.characterId));
    if (error) throw new Error("无法打开角色工作区。");
  });
}
