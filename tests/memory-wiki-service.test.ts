import {
  access,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  MemoryWikiError,
  createMemoryWikiService,
  normalizeMemoryWikiPagePath,
  parseMemoryWikiPatch,
} from "../src/main/memory/memoryWikiService";
import { createMemoryWikiTools } from "../src/main/memory/memoryWikiTools";

const characterId = "00000000-0000-4000-8000-000000000001";
const secondCharacterId = "00000000-0000-4000-8000-000000000002";
const temporaryDirectories: string[] = [];

async function createUserDataPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "katarune-memory-wiki-"));
  temporaryDirectories.push(directory);
  return directory;
}

function addPagePatch(page: string, lines: readonly string[]): string {
  return [
    "*** Begin Patch",
    `*** Add File: ${page}`,
    ...lines.map((line) => `+${line}`),
    "*** End Patch",
  ].join("\n");
}

function updatePagePatch(page: string, oldLine: string, newLine: string): string {
  return [
    "*** Begin Patch",
    `*** Update File: ${page}`,
    "@@",
    `-${oldLine}`,
    `+${newLine}`,
    "*** End Patch",
  ].join("\n");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Memory Wiki service", () => {
  it("initializes bounded core pages and keeps them across service restarts", async () => {
    const userDataPath = await createUserDataPath();
    const service = createMemoryWikiService({ userDataPath });
    await service.initialize([characterId]);

    const core = await service.loadCore(characterId);
    expect(core.map((page) => page.page)).toEqual(["index.md", "profile.md"]);
    expect(core[0]).toMatchObject({
      revision: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      content: "# Memory Index\n",
    });

    const profile = await service.get(characterId, { page: "profile.md" });
    expect(profile).toMatchObject({ status: "found", content: "# User Profile\n" });

    const restarted = createMemoryWikiService({ userDataPath });
    await restarted.initialize([characterId]);
    expect(await restarted.get(characterId, { page: "profile.md" })).toEqual(profile);
  });

  it("adds, searches, reads, updates, and forgets durable Markdown facts", async () => {
    const service = createMemoryWikiService({ userDataPath: await createUserDataPath() });
    await service.initialize([characterId]);
    const added = await service.applyPatch(characterId, {
      baseRevision: null,
      patch: addPagePatch("topics/preferences.md", [
        "# Preferences",
        "用户喜欢蓝色。",
        "用户偏好简洁回答。",
      ]),
    });
    expect(added).toMatchObject({ status: "applied", previousRevision: null });

    const blue = await service.search(characterId, { query: "喜欢 蓝色" });
    expect(blue.results[0]).toMatchObject({
      page: "topics/preferences.md",
      line: 2,
      excerpt: "用户喜欢蓝色。",
    });

    const page = await service.get(characterId, {
      page: "topics/preferences.md",
      startLine: 2,
      endLine: 3,
    });
    expect(page).toMatchObject({
      status: "found",
      startLine: 2,
      endLine: 3,
      content: "用户喜欢蓝色。\n用户偏好简洁回答。",
    });
    if (page.status !== "found") throw new Error("Expected stored preferences.");

    const corrected = await service.applyPatch(characterId, {
      baseRevision: page.revision,
      patch: updatePagePatch("topics/preferences.md", "用户喜欢蓝色。", "用户喜欢绿色。"),
    });
    expect(corrected.status).toBe("applied");
    expect((await service.search(characterId, { query: "绿色" })).results).toHaveLength(1);
    expect((await service.search(characterId, { query: "蓝色" })).results).toHaveLength(0);

    if (corrected.status !== "applied") throw new Error("Expected corrected memory.");
    await service.applyPatch(characterId, {
      baseRevision: corrected.revision,
      patch: updatePagePatch("topics/preferences.md", "用户喜欢绿色。", ""),
    });
    expect((await service.search(characterId, { query: "绿色" })).results).toHaveLength(0);
  });

  it("updates an empty page and bounds core injection and paged reads by UTF-8 bytes", async () => {
    const userDataPath = await createUserDataPath();
    const service = createMemoryWikiService({ userDataPath });
    await service.initialize([characterId]);
    const empty = await service.applyPatch(characterId, {
      baseRevision: null,
      patch: addPagePatch("topics/empty.md", []),
    });
    if (empty.status !== "applied") throw new Error("Expected empty page.");
    await expect(
      service.applyPatch(characterId, {
        baseRevision: empty.revision,
        patch: [
          "*** Begin Patch",
          "*** Update File: topics/empty.md",
          "@@",
          "+first durable fact",
          "*** End Patch",
        ].join("\n"),
      }),
    ).resolves.toMatchObject({ status: "applied" });
    expect(await service.get(characterId, { page: "topics/empty.md" })).toMatchObject({
      status: "found",
      content: "first durable fact",
    });

    const characterDirectory = join(
      userDataPath,
      "memory",
      "agents",
      characterId,
    );
    await writeFile(join(characterDirectory, "profile.md"), "你".repeat(20_000), "utf8");
    await writeFile(
      join(characterDirectory, "topics", "long-line.md"),
      "界".repeat(20_000),
      "utf8",
    );
    const core = await service.loadCore(characterId);
    expect(core.every((page) => Buffer.byteLength(page.content, "utf8") <= 8 * 1024)).toBe(
      true,
    );
    const paged = await service.get(characterId, { page: "topics/long-line.md" });
    expect(paged).toMatchObject({ status: "found", truncated: true });
    if (paged.status !== "found") throw new Error("Expected long page.");
    expect(Buffer.byteLength(paged.content, "utf8")).toBeLessThanOrEqual(32 * 1024);
    expect(
      await service.get(characterId, {
        page: "topics/long-line.md",
        startLine: 99,
      }),
    ).toMatchObject({ status: "found", startLine: 1, endLine: 1, content: "" });
  });

  it("uses revision compare-and-swap so concurrent updates cannot overwrite silently", async () => {
    const service = createMemoryWikiService({ userDataPath: await createUserDataPath() });
    await service.initialize([characterId]);
    const added = await service.applyPatch(characterId, {
      baseRevision: null,
      patch: addPagePatch("topics/concurrency.md", ["# State", "value: old"]),
    });
    if (added.status !== "applied") throw new Error("Expected added page.");

    const results = await Promise.all([
      service.applyPatch(characterId, {
        baseRevision: added.revision,
        patch: updatePagePatch("topics/concurrency.md", "value: old", "value: first"),
      }),
      service.applyPatch(characterId, {
        baseRevision: added.revision,
        patch: updatePagePatch("topics/concurrency.md", "value: old", "value: second"),
      }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "applied",
      "conflict",
    ]);
    const stored = await service.get(characterId, { page: "topics/concurrency.md" });
    expect(stored.status).toBe("found");
    if (stored.status === "found") {
      expect(["# State\nvalue: first\n", "# State\nvalue: second\n"]).toContain(
        stored.content,
      );
    }
  });

  it("rejects ambiguous or malformed patches without changing the page", async () => {
    const service = createMemoryWikiService({ userDataPath: await createUserDataPath() });
    await service.initialize([characterId]);
    const added = await service.applyPatch(characterId, {
      baseRevision: null,
      patch: addPagePatch("topics/repeated.md", ["same", "same"]),
    });
    if (added.status !== "applied") throw new Error("Expected added page.");

    await expect(
      service.applyPatch(characterId, {
        baseRevision: added.revision,
        patch: updatePagePatch("topics/repeated.md", "same", "changed"),
      }),
    ).rejects.toMatchObject({ code: "invalid_patch" });
    expect(await service.get(characterId, { page: "topics/repeated.md" })).toMatchObject({
      status: "found",
      content: "same\nsame\n",
      revision: added.revision,
    });
  });

  it.each([
    "../profile.md",
    "/profile.md",
    "C:/profile.md",
    "\\\\server\\share\\profile.md",
    "topics/nested/page.md",
    "topics/CON.md",
    "topics/secret.txt",
    ".hidden.md",
  ])("rejects unsafe page path %s", (page) => {
    expect(() => normalizeMemoryWikiPagePath(page)).toThrow(MemoryWikiError);
  });

  it("rejects delete, move, multi-file, oversized, and case-conflicting writes", async () => {
    expect(() =>
      parseMemoryWikiPatch(
        "*** Begin Patch\n*** Delete File: profile.md\n*** End Patch",
      ),
    ).toThrow(MemoryWikiError);
    expect(() =>
      parseMemoryWikiPatch(
        "*** Begin Patch\n*** Add File: topics/a.md\n+a\n*** Add File: topics/b.md\n+b\n*** End Patch",
      ),
    ).toThrow(MemoryWikiError);

    const userDataPath = await createUserDataPath();
    const service = createMemoryWikiService({ userDataPath });
    await service.initialize([characterId]);
    await writeFile(
      join(userDataPath, "memory", "agents", characterId, "topics", "Case.md"),
      "case\n",
      "utf8",
    );
    await expect(
      service.applyPatch(characterId, {
        baseRevision: null,
        patch: addPagePatch("topics/case.md", ["conflict"]),
      }),
    ).rejects.toMatchObject({ code: "invalid_page" });

    await expect(
      service.applyPatch(characterId, {
        baseRevision: null,
        patch: addPagePatch("topics/large.md", ["x".repeat(64 * 1024 + 1)]),
      }),
    ).rejects.toMatchObject({ code: "page_too_large" });
  });

  it("enforces the 256-page vault limit", async () => {
    const userDataPath = await createUserDataPath();
    const service = createMemoryWikiService({ userDataPath });
    await service.initialize([characterId]);
    const topicsDirectory = join(
      userDataPath,
      "memory",
      "agents",
      characterId,
      "topics",
    );
    await Promise.all(
      Array.from({ length: 254 }, (_, index) =>
        writeFile(join(topicsDirectory, `page-${index}.md`), `${index}\n`, "utf8"),
      ),
    );

    await expect(
      service.applyPatch(characterId, {
        baseRevision: null,
        patch: addPagePatch("topics/overflow.md", ["too many"]),
      }),
    ).rejects.toMatchObject({ code: "vault_limit" });
  });

  it("rejects linked page directories instead of following them", async () => {
    const userDataPath = await createUserDataPath();
    const outside = await createUserDataPath();
    const service = createMemoryWikiService({ userDataPath });
    await service.initialize([characterId]);
    const topics = join(userDataPath, "memory", "agents", characterId, "topics");
    await rm(topics, { recursive: true, force: true });
    await symlink(outside, topics, process.platform === "win32" ? "junction" : "dir");

    await expect(
      service.search(characterId, { query: "anything" }),
    ).rejects.toMatchObject({ code: "unsafe_path" });
  });

  it("rejects a linked Memory Wiki root before creating files through it", async () => {
    const userDataPath = await createUserDataPath();
    const outside = await createUserDataPath();
    await symlink(
      outside,
      join(userDataPath, "memory"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const service = createMemoryWikiService({ userDataPath });

    await expect(service.loadCore(characterId)).rejects.toMatchObject({
      code: "unsafe_path",
    });
    await expect(access(join(outside, "agents"))).rejects.toThrow();
  });

  it("recovers a stale cross-process lock", async () => {
    const userDataPath = await createUserDataPath();
    const service = createMemoryWikiService({ userDataPath });
    await service.initialize([characterId]);
    const lockDirectory = join(userDataPath, "memory", "locks", characterId);
    await mkdir(lockDirectory);
    await writeFile(
      join(lockDirectory, "owner.json"),
      JSON.stringify({ pid: 999_999_999 }),
      "utf8",
    );

    const recovered = createMemoryWikiService({
      userDataPath,
      lockTimeoutMs: 250,
      staleLockMs: 60_000,
    });
    await expect(recovered.loadCore(characterId)).resolves.toHaveLength(2);
  });

  it("does not steal an expired lock that still belongs to the current live process", async () => {
    const userDataPath = await createUserDataPath();
    const service = createMemoryWikiService({ userDataPath });
    await service.initialize([characterId]);
    const lockDirectory = join(userDataPath, "memory", "locks", characterId);
    await mkdir(lockDirectory);
    await writeFile(
      join(lockDirectory, "owner.json"),
      JSON.stringify({ pid: process.pid }),
      "utf8",
    );

    const contender = createMemoryWikiService({
      userDataPath,
      lockTimeoutMs: 50,
      staleLockMs: 0,
    });
    await expect(contender.loadCore(characterId)).rejects.toMatchObject({
      code: "lock_timeout",
    });
  });

  it("holds the agent lock across database deletion, restores on failure, and tombstones success", async () => {
    const userDataPath = await createUserDataPath();
    const service = createMemoryWikiService({ userDataPath });
    await service.initialize([characterId, secondCharacterId]);
    await service.applyPatch(characterId, {
      baseRevision: null,
      patch: addPagePatch("topics/private.md", ["keep on rollback"]),
    });

    await expect(
      service.deleteCharacterMemoryTransaction(characterId, () => {
        throw new Error("database failure");
      }),
    ).rejects.toThrow("database failure");
    expect((await service.search(characterId, { query: "rollback" })).results).toHaveLength(1);

    let releaseDatabaseDelete!: () => void;
    let markDatabaseStarted!: () => void;
    const databaseStarted = new Promise<void>((resolve) => {
      markDatabaseStarted = resolve;
    });
    const databaseRelease = new Promise<void>((resolve) => {
      releaseDatabaseDelete = resolve;
    });
    const deletion = service.deleteCharacterMemoryTransaction(characterId, async () => {
      markDatabaseStarted();
      await databaseRelease;
      return "deleted";
    });
    await databaseStarted;
    const staleChatMemoryLoad = service.loadCore(characterId);
    releaseDatabaseDelete();

    await expect(deletion).resolves.toEqual({ result: "deleted", cleanupError: null });
    await expect(staleChatMemoryLoad).rejects.toMatchObject({
      code: "invalid_character",
    });
    await expect(
      access(join(userDataPath, "memory", "agents", characterId)),
    ).rejects.toThrow();
  });

  it("cleans crash-left temporary files during startup", async () => {
    const userDataPath = await createUserDataPath();
    const service = createMemoryWikiService({ userDataPath });
    await service.initialize([characterId]);
    const temporaryFile = join(
      userDataPath,
      "memory",
      "agents",
      characterId,
      "topics",
      ".wiki-tmp-crash",
    );
    await writeFile(temporaryFile, "partial", "utf8");

    const restarted = createMemoryWikiService({ userDataPath });
    await restarted.initialize([characterId]);
    await expect(access(temporaryFile)).rejects.toThrow();
  });

  it("isolates characters and reconciles staged deletion after crashes", async () => {
    const userDataPath = await createUserDataPath();
    const service = createMemoryWikiService({ userDataPath });
    await service.initialize([characterId, secondCharacterId]);
    await service.applyPatch(characterId, {
      baseRevision: null,
      patch: addPagePatch("topics/private.md", ["only character one"]),
    });
    expect((await service.search(secondCharacterId, { query: "character one" })).results).toHaveLength(0);

    expect(await service.stageCharacterDeletion(characterId)).toBe(true);
    await expect(
      access(join(userDataPath, "memory", "agents", characterId)),
    ).rejects.toThrow();
    await service.rollbackCharacterDeletion(characterId);
    expect((await service.search(characterId, { query: "character one" })).results).toHaveLength(1);

    await service.stageCharacterDeletion(characterId);
    const restarted = createMemoryWikiService({ userDataPath });
    await restarted.initialize([characterId, secondCharacterId]);
    expect((await restarted.search(characterId, { query: "character one" })).results).toHaveLength(1);

    await restarted.stageCharacterDeletion(characterId);
    const afterDatabaseDelete = createMemoryWikiService({ userDataPath });
    await afterDatabaseDelete.initialize([secondCharacterId]);
    await expect(
      access(join(userDataPath, "memory", "trash", characterId)),
    ).rejects.toThrow();
  });

  it("exposes three automatically executable AI SDK tools bound outside model input", async () => {
    const service = createMemoryWikiService({ userDataPath: await createUserDataPath() });
    await service.initialize([characterId]);
    const tools = createMemoryWikiTools(service, characterId);

    expect(Object.keys(tools)).toEqual([
      "wiki_search",
      "wiki_get",
      "wiki_apply_patch",
    ]);
    for (const memoryTool of Object.values(tools)) {
      expect(memoryTool.execute).toBeTypeOf("function");
      expect(memoryTool).not.toHaveProperty("needsApproval");
    }
    expect(JSON.stringify(tools)).not.toContain(characterId);

    const executionOptions = {
      toolCallId: "memory-cycle",
      messages: [],
      context: undefined,
    };
    const applyPatch = tools.wiki_apply_patch?.execute;
    const search = tools.wiki_search?.execute;
    const get = tools.wiki_get?.execute;
    if (applyPatch === undefined || search === undefined || get === undefined) {
      throw new Error("Expected executable Memory Wiki tools.");
    }
    const added = await applyPatch(
      {
        baseRevision: null,
        patch: addPagePatch("topics/tool-cycle.md", ["version one"]),
      },
      executionOptions,
    );
    expect(added).toMatchObject({ status: "applied" });
    const found = await search({ query: "version one" }, executionOptions);
    expect(found).toMatchObject({
      status: "ok",
      results: [expect.objectContaining({ page: "topics/tool-cycle.md" })],
    });
    const page = await get({ page: "topics/tool-cycle.md" }, executionOptions);
    expect(page).toMatchObject({ status: "found", content: "version one\n" });
    if (
      typeof page !== "object" ||
      page === null ||
      !("revision" in page) ||
      typeof page.revision !== "string"
    ) {
      throw new Error("Expected a page revision from wiki_get.");
    }
    await expect(
      applyPatch(
        {
          baseRevision: page.revision,
          patch: updatePagePatch(
            "topics/tool-cycle.md",
            "version one",
            "version two",
          ),
        },
        executionOptions,
      ),
    ).resolves.toMatchObject({ status: "applied" });
  });
});
