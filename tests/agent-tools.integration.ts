import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import BetterSqlite3 from "better-sqlite3";
import type { UIMessage } from "ai";
import { z } from "zod";
import { AgentToolsService } from "../src/main/ai/agentTools";
import { ChatAttachmentRunBudget } from "../src/main/ai/chatAttachments";
import { createAssetService } from "../src/main/assets/assetService";
import { openDatabase, type DatabaseConfigValidator, type DatabaseRuntime } from "../src/main/database/database";
import { assetUrl } from "../src/shared/assets";

export async function runImageReferenceIntegration(configValidator: DatabaseConfigValidator) {
  const directory = await mkdtemp(join(tmpdir(), "katarune-image-reference-"));
  let database: DatabaseRuntime | undefined;
  try {
    const options = { userDataPath: directory, appPath: process.cwd(), configValidator };
    database = openDatabase(options);
    const imageDirectory = join(directory, "originals");
    await mkdir(imageDirectory);
    const source = join(imageDirectory, "image.png");
    const bytes = await readFile(join(process.cwd(), "resources", "katarune-logo.png"));
    await writeFile(source, bytes);
    const assets = createAssetService({ userDataPath: directory, characterResourcesPath: join(directory, "unused") });
    const image = assets.referenceChatAttachment(source, database, "image/png");
    assert.equal(database.fetchAssetSourcePath(image.id), await realpath(source));
    assert.equal(JSON.stringify(image).includes(directory), false, "source path stays in main");
    await assert.rejects(stat(assets.resolveManagedPath(image.id)), { code: "ENOENT" });
    assert.deepEqual(Buffer.from(assets.readChatAttachment(image.id, database).data), bytes);
    const textPath = join(imageDirectory, "notes.txt");
    await writeFile(textPath, "first");
    const textAsset = assets.referenceChatAttachment(textPath, database, "text/plain");
    await assert.rejects(stat(assets.resolveManagedPath(textAsset.id)), { code: "ENOENT" });
    await writeFile(textPath, "second");
    assert.equal(new TextDecoder().decode(assets.readChatAttachment(textAsset.id, database).data), "second");
    assets.releaseChatAttachment(textAsset.id, database);
    assert.equal(await readFile(textPath, "utf8"), "second");
    const characterId = database.getAppState().activeCharacter.id;
    const threadId = "image-reference";
    database.initializeThread(threadId, characterId);
    const message: UIMessage = { id: "image-reference-message", role: "user", parts: [{ type: "file", mediaType: "image/png", url: assetUrl(image.id), filename: "image.png" }] };
    database.appendThreadMessage({ characterId, threadId, assetIds: [image.id], message: { id: message.id, parent_id: null, format: "ai-sdk/v6", content: { role: message.role, parts: message.parts } } });
    database.close(); database = openDatabase(options);
    const service = new AgentToolsService(join(directory, "workspaces"), database, assets);
    const prepared = await service.prepare({ characterId, threadId, messages: [message], imageProcessor: { prepare: (data, mediaType) => ({ data, mediaType }) }, budget: new ChatAttachmentRunBudget(), signal: new AbortController().signal });
    assert.deepEqual(await readdir(await service.workspace(characterId)), [], "viewing an image does not create a workspace copy");
    assert.deepEqual(database.getThreadToolAccess(threadId, characterId).directories, []);
    const imagePath = prepared.attachmentPaths.get(image.id);
    assert.ok(imagePath);
    const bash = prepared.tools.bash?.execute;
    assert.ok(bash);
    const bashResult = z.object({ stdout: z.string(), exitCode: z.number() });
    assert.equal(Number(bashResult.parse(await bash({ command: `wc -c < '${imagePath}'` }, { toolCallId: "bytes", messages: [], context: undefined })).stdout.trim()), bytes.byteLength);
    await writeFile(join(imageDirectory, "private.txt"), "private sibling");
    assert.notEqual(bashResult.parse(await bash({ command: `cat '/attachments/${image.id}/private.txt'` }, { toolCallId: "sibling", messages: [], context: undefined })).exitCode, 0);

    await assert.rejects(service.readChatFile(characterId, threadId, { path: source }), /已授权目录/);
    assert.deepEqual(Buffer.from((await service.readChatFile(characterId, threadId, { attachmentId: image.id })).data), bytes);
    database.initializeThread("other-image-thread", characterId);
    await assert.rejects(service.readChatFile(characterId, "other-image-thread", { attachmentId: image.id }));
    const view = prepared.tools.view_image?.execute;
    assert.ok(view);
    await view({ path: prepared.attachmentPaths.get(image.id) }, { toolCallId: "view", messages: [], context: undefined });
    const changed = Buffer.concat([bytes, Buffer.from("updated")]);
    await writeFile(source, changed);
    assert.deepEqual(Buffer.from(assets.readChatAttachment(image.id, database).data), changed);
    const reread = await view({ path: imagePath }, { toolCallId: "edited", messages: [], context: undefined });
    assert.equal(z.object({ sourceByteSize: z.number() }).parse(reread).sourceByteSize, changed.length);

    const movedDirectory = join(directory, "moved");
    await rename(imageDirectory, movedDirectory);
    assert.throws(() => assets.readChatAttachment(image.id, database!), /原文件不可用/);
    await assert.rejects(view({ path: imagePath }, { toolCallId: "missing", messages: [], context: undefined }), /原文件不可用/);

    await symlink(movedDirectory, imageDirectory, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => assets.readChatAttachment(image.id, database!), /原文件不可用/);
    database.deleteThread(threadId, characterId);
    assert.equal(assets.releaseChatAttachment(image.id, database), true);
    assert.deepEqual(await readFile(join(movedDirectory, "image.png")), changed, "deleting chat never deletes the original");
    const draft = assets.referenceChatAttachment(join(movedDirectory, "image.png"), database, "image/png");
    assets.cleanupUnreferencedChatAttachments(database);
    assert.throws(() => database!.fetchAsset(draft.id));
    assert.deepEqual(await readFile(join(movedDirectory, "image.png")), changed);
    console.log("Image references: no copy, live reads, restart, ownership, path retargeting and original-preserving cleanup passed.");
  } finally { database?.close(); await rm(directory, { recursive: true, force: true }); }
}

// Runs inside the database suite's isolated Electron process with real SQLite,
// managed attachment bytes, the official Bash tool and just-bash filesystem.
export async function runAgentToolIntegration(database: DatabaseRuntime, userDataPath: string) {
  const characterId = database.getAppState().activeCharacter.id;
  const threadId = "agent-attachment-integration";
  database.initializeThread(threadId, characterId);
  const assets = createAssetService({ userDataPath, characterResourcesPath: join(userDataPath, "unused-resources") });
  const service = new AgentToolsService(join(userDataPath, "workspaces"), database, assets);
  const asset = assets.importChatAttachment({ name: "first.txt", mediaType: "text/plain", data: new TextEncoder().encode("first attachment") }, database);
  service.authorizeImportedAttachment(characterId, asset.id);
  const message: UIMessage = { id: "first-attachment", role: "user", parts: [{ type: "file", url: assetUrl(asset.id), mediaType: "text/plain", filename: "first.txt" }] };
  const prepare = (instance: AgentToolsService, messages: UIMessage[]) => instance.prepare({ characterId, threadId, messages,
    imageProcessor: { prepare: (data, mediaType) => ({ data, mediaType }) }, budget: new ChatAttachmentRunBudget(), signal: new AbortController().signal });
  const run = async (instance: AgentToolsService, messages: UIMessage[]) => {
    const prepared = await prepare(instance, messages);
    const execute = prepared.tools.bash?.execute;
    if (!execute) throw new Error("Missing official Bash tool");
    return z.object({ stdout: z.string(), exitCode: z.number() }).parse(await execute({ command: `cat /attachments/${asset.id}/first.txt` },
      { toolCallId: "read", messages: [], context: undefined, abortSignal: new AbortController().signal }));
  };
  assert.deepEqual(await run(service, [message]), { stdout: "first attachment", exitCode: 0 });
  database.appendThreadMessage({ threadId, characterId, assetIds: [asset.id], message: {
    id: message.id, parent_id: null, format: "ai-sdk/v6", content: { role: message.role, parts: message.parts },
  } });
  const restarted = new AgentToolsService(join(userDataPath, "workspaces"), database, assets);
  assert.deepEqual(await run(restarted, [message]), { stdout: "first attachment", exitCode: 0 });
  const historical = await prepare(restarted, [message, { id: "later", role: "user", parts: [{ type: "text", text: "read again" }] }]);
  assert.equal(historical.attachmentPaths.get(asset.id), `/attachments/${asset.id}/first.txt`);
  assert.deepEqual(await readdir(await service.workspace(characterId)), [], "attachments create no workspace copies");
  assert.equal(new TextDecoder().decode(assets.readChatAttachment(asset.id, database).data), "first attachment");
  database.deleteThread(threadId, characterId);
  assets.releaseChatAttachment(asset.id, database);
  console.log("Agent tools: first attachment, persisted ownership, workspace and official Bash passed in Electron.");
}

export async function runAgentPermissionMigrationIntegration(configValidator: DatabaseConfigValidator) {
  const directory = await mkdtemp(join(tmpdir(), "katarune-permission-migration-"));
  let database: DatabaseRuntime | undefined;
  try {
    const options = { userDataPath: directory, appPath: process.cwd(), configValidator };
    database = openDatabase(options);
    const characterId = database.getAppState().activeCharacter.id;
    const threadId = "permission-migration";
    database.initializeThread(threadId, characterId);
    database.appendThreadMessage({ threadId, characterId, assetIds: [], message: {
      id: "preserved-message", parent_id: null, format: "ai-sdk/v6", content: { role: "user", parts: [{ type: "text", text: "preserve" }] },
    } });
    const service = new AgentToolsService(join(directory, "workspaces"), database, { resolveManagedPath: () => { throw new Error("unused"); }, readChatAttachment: () => { throw new Error("unused"); } });
    const file = join(await service.workspace(characterId), "preserved.txt");
    await writeFile(file, "preserved file");
    database.close(); database = undefined;

    // Reconstruct the exact 0030 permissions schema in this temporary database.
    const sqlite = new BetterSqlite3(join(directory, "katarune.sqlite"));
    try {
      sqlite.exec("DROP TABLE thread_directory_grants; DROP TABLE thread_tool_access");
      sqlite.exec(await readFile(join(process.cwd(), "drizzle", "0030_overjoyed_songbird.sql"), "utf8"));
      sqlite.prepare("INSERT INTO character_tool_access (character_id, mode) VALUES (?, 'full-access')").run(characterId);
      sqlite.prepare("INSERT INTO character_directory_grants (id, character_id, path, access) VALUES (?, ?, ?, 'read-write')")
        .run("00000000-0000-4000-8000-000000000007", characterId, directory);
      sqlite.exec("ALTER TABLE assets DROP COLUMN source_path");
      sqlite.prepare("DELETE FROM __drizzle_migrations WHERE created_at >= ?").run(1793441573888);
    } finally { sqlite.close(); }

    database = openDatabase(options);
    assert.deepEqual(database.getThreadToolAccess(threadId, characterId), { mode: "request-approval", directories: [] });
    assert.equal(database.loadThreadMessages(threadId, characterId).messages[0]?.id, "preserved-message");
    assert.equal(await readFile(file, "utf8"), "preserved file");
    database.setThreadToolMode(threadId, characterId, "full-access");
    database.grantThreadDirectory(threadId, characterId, directory, "read");
    database.deleteThread(threadId, characterId);
    database.close(); database = undefined;
    const checked = new BetterSqlite3(join(directory, "katarune.sqlite"), { readonly: true });
    try {
      for (const name of ["thread_tool_access", "thread_directory_grants"]) {
        assert.deepEqual(checked.prepare(`SELECT count(*) AS count FROM ${name}`).get(), { count: 0 });
      }
      assert.deepEqual(checked.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { checked.close(); }
    assert.equal(await readFile(file, "utf8"), "preserved file");
    console.log("Permission migration: old broad grants are not inherited; messages, workspace files and thread deletion boundaries passed.");
  } finally {
    database?.close();
    await rm(directory, { recursive: true, force: true });
  }
}
