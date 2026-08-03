import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";

const CORE_PAGES = ["index.md", "profile.md"] as const;
const PAGE_DIRECTORIES = ["topics", "relationships", "timeline"] as const;
const MAX_PAGE_BYTES = 64 * 1024;
const MAX_VAULT_BYTES = 8 * 1024 * 1024;
const MAX_VAULT_PAGES = 256;
const MAX_CORE_CONTEXT_BYTES = 8 * 1024;
const MAX_GET_BYTES = 32 * 1024;
const MAX_GET_LINES = 200;
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_STALE_LOCK_MS = 30_000;
const TEMP_FILE_PREFIX = ".wiki-tmp-";
const CHARACTER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WINDOWS_RESERVED_NAME_PATTERN =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const WINDOWS_INVALID_FILENAME_CHARACTER_PATTERN = /[<>:"|?*]/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export type MemoryWikiScope =
  | "all"
  | "core"
  | "topics"
  | "relationships"
  | "timeline";

export interface MemoryWikiPage {
  readonly page: string;
  readonly revision: string;
  readonly content: string;
}

export interface MemoryWikiSearchResult {
  readonly page: string;
  readonly line: number;
  readonly excerpt: string;
  readonly revision: string;
}

export interface MemoryWikiSearchResponse {
  readonly status: "ok";
  readonly results: readonly MemoryWikiSearchResult[];
  readonly truncated: boolean;
}

export type MemoryWikiGetResponse =
  | {
      readonly status: "found";
      readonly page: string;
      readonly revision: string;
      readonly totalLines: number;
      readonly startLine: number;
      readonly endLine: number;
      readonly content: string;
      readonly truncated: boolean;
    }
  | {
      readonly status: "not_found";
      readonly page: string;
    };

export type MemoryWikiApplyPatchResponse =
  | {
      readonly status: "applied";
      readonly page: string;
      readonly previousRevision: string | null;
      readonly revision: string;
    }
  | {
      readonly status: "conflict";
      readonly page: string;
      readonly currentRevision: string | null;
    }
  | {
      readonly status: "not_found";
      readonly page: string;
    };

export type MemoryWikiErrorCode =
  | "invalid_character"
  | "invalid_page"
  | "invalid_range"
  | "invalid_patch"
  | "unsafe_path"
  | "page_too_large"
  | "vault_limit"
  | "lock_timeout";

export class MemoryWikiError extends Error {
  public constructor(
    public readonly code: MemoryWikiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MemoryWikiError";
  }
}

export interface MemoryWikiService {
  initialize(characterIds: readonly string[]): Promise<void>;
  loadCore(characterId: string): Promise<readonly MemoryWikiPage[]>;
  search(
    characterId: string,
    request: {
      readonly query: string;
      readonly scope?: MemoryWikiScope | undefined;
      readonly limit?: number | undefined;
    },
  ): Promise<MemoryWikiSearchResponse>;
  get(
    characterId: string,
    request: {
      readonly page: string;
      readonly startLine?: number | undefined;
      readonly endLine?: number | undefined;
    },
  ): Promise<MemoryWikiGetResponse>;
  applyPatch(
    characterId: string,
    request: {
      readonly baseRevision: string | null;
      readonly patch: string;
    },
  ): Promise<MemoryWikiApplyPatchResponse>;
  deleteCharacterMemoryTransaction(
    characterId: string,
    deleteDatabaseRecord: () => unknown | Promise<unknown>,
  ): Promise<{
    readonly result: unknown;
    readonly cleanupError: unknown | null;
  }>;
  stageCharacterDeletion(characterId: string): Promise<boolean>;
  rollbackCharacterDeletion(characterId: string): Promise<void>;
  commitCharacterDeletion(characterId: string): Promise<void>;
}

interface MemoryWikiServiceOptions {
  readonly userDataPath: string;
  readonly lockTimeoutMs?: number;
  readonly staleLockMs?: number;
}

interface ParsedPatch {
  readonly operation: "add" | "update";
  readonly page: string;
  readonly lines: readonly string[];
}

interface ListedPage {
  readonly page: string;
  readonly byteSize: number;
}

function assertCharacterId(characterId: string): void {
  if (!CHARACTER_ID_PATTERN.test(characterId)) {
    throw new MemoryWikiError("invalid_character", "角色记忆标识无效。");
  }
}

function assertSafeSegment(segment: string): void {
  if (
    segment.length === 0 ||
    segment === "." ||
    segment === ".." ||
    segment.startsWith(".") ||
    segment.endsWith(".") ||
    segment.endsWith(" ") ||
    WINDOWS_INVALID_FILENAME_CHARACTER_PATTERN.test(segment) ||
    CONTROL_CHARACTER_PATTERN.test(segment) ||
    WINDOWS_RESERVED_NAME_PATTERN.test(segment)
  ) {
    throw new MemoryWikiError("invalid_page", "记忆页面路径无效。");
  }
}

export function normalizeMemoryWikiPagePath(input: string): string {
  const page = input.normalize("NFC");
  if (
    page !== input ||
    isAbsolute(page) ||
    page.startsWith("/") ||
    page.startsWith("\\") ||
    page.includes("\\") ||
    /^[a-z]:/i.test(page) ||
    CONTROL_CHARACTER_PATTERN.test(page)
  ) {
    throw new MemoryWikiError("invalid_page", "记忆页面路径无效。");
  }

  const segments = page.split("/");
  for (const segment of segments) assertSafeSegment(segment);

  const validCorePage =
    segments.length === 1 &&
    CORE_PAGES.includes(segments[0] as (typeof CORE_PAGES)[number]);
  const validExtendedPage =
    segments.length === 2 &&
    PAGE_DIRECTORIES.includes(
      segments[0] as (typeof PAGE_DIRECTORIES)[number],
    ) &&
    segments[1]?.endsWith(".md") === true;

  if (!validCorePage && !validExtendedPage) {
    throw new MemoryWikiError(
      "invalid_page",
      "页面必须是核心页，或位于允许的记忆目录中。",
    );
  }
  if (!page.endsWith(".md")) {
    throw new MemoryWikiError("invalid_page", "记忆页面必须使用 .md 扩展名。");
  }
  return page;
}

function normalizeContent(content: string): string {
  return content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function decodeUtf8(buffer: Buffer): string {
  try {
    return normalizeContent(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
  } catch {
    throw new MemoryWikiError("unsafe_path", "记忆页面不是有效的 UTF-8 文本。");
  }
}

function revisionFor(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function truncateUtf8(content: string, maxBytes: number): string {
  const buffer = Buffer.from(content, "utf8");
  if (buffer.byteLength <= maxBytes) return content;
  for (let length = maxBytes; length >= Math.max(0, maxBytes - 4); length -= 1) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        buffer.subarray(0, length),
      );
    } catch {
      // Try the preceding UTF-8 code point boundary.
    }
  }
  return "";
}

function truncateUtf8WithNotice(
  content: string,
  maxBytes: number,
  notice: string,
): string {
  if (Buffer.byteLength(content, "utf8") <= maxBytes) return content;
  const noticeBytes = Buffer.byteLength(notice, "utf8");
  return `${truncateUtf8(content, Math.max(0, maxBytes - noticeBytes))}${notice}`;
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
}

async function assertRegularFile(path: string): Promise<number> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new MemoryWikiError("unsafe_path", "记忆页面不是安全的普通文件。");
  }
  return info.size;
}

async function assertDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new MemoryWikiError("unsafe_path", "记忆目录不安全。");
  }
}

function splitContentLines(content: string): {
  readonly lines: string[];
  readonly trailingNewline: boolean;
} {
  if (content.length === 0) return { lines: [], trailingNewline: false };
  const trailingNewline = content.endsWith("\n");
  const withoutTrailingNewline = trailingNewline ? content.slice(0, -1) : content;
  return {
    lines: withoutTrailingNewline.length === 0 ? [] : withoutTrailingNewline.split("\n"),
    trailingNewline,
  };
}

export function parseMemoryWikiPatch(patchInput: string): ParsedPatch {
  const patch = normalizeContent(patchInput);
  const lines = patch.endsWith("\n")
    ? patch.slice(0, -1).split("\n")
    : patch.split("\n");
  if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch") {
    throw new MemoryWikiError(
      "invalid_patch",
      "补丁必须由 *** Begin Patch 和 *** End Patch 包围。",
    );
  }
  const body = lines.slice(1, -1);
  const header = body[0]?.match(/^\*\*\* (Add|Update) File: (.+)$/);
  if (header === null || header === undefined) {
    throw new MemoryWikiError("invalid_patch", "补丁必须添加或更新一个页面。");
  }
  if (
    body.slice(1).some((line) =>
      /^\*\*\* (?:Add|Update|Delete|Move)(?: File)?:/.test(line),
    )
  ) {
    throw new MemoryWikiError("invalid_patch", "一次补丁只能修改一个页面。");
  }
  return {
    operation: header[1] === "Add" ? "add" : "update",
    page: normalizeMemoryWikiPagePath(header[2] ?? ""),
    lines: body.slice(1),
  };
}

function applyAddPatch(lines: readonly string[]): string {
  if (lines.some((line) => !line.startsWith("+"))) {
    throw new MemoryWikiError(
      "invalid_patch",
      "新增页面的每一行都必须以 + 开头。",
    );
  }
  if (lines.length === 0) return "";
  return `${lines.map((line) => line.slice(1)).join("\n")}\n`;
}

function findSegmentOccurrences(lines: readonly string[], segment: readonly string[]): number[] {
  if (segment.length === 0) return [];
  const positions: number[] = [];
  for (let index = 0; index <= lines.length - segment.length; index += 1) {
    if (segment.every((line, offset) => lines[index + offset] === line)) {
      positions.push(index);
    }
  }
  return positions;
}

function applyUpdatePatch(content: string, patchLines: readonly string[]): string {
  const hunks: string[][] = [];
  let currentHunk: string[] | undefined;
  for (const line of patchLines) {
    if (line.startsWith("@@")) {
      currentHunk = [];
      hunks.push(currentHunk);
      continue;
    }
    if (currentHunk === undefined || ![" ", "+", "-"].includes(line[0] ?? "")) {
      throw new MemoryWikiError("invalid_patch", "更新补丁包含无效的 hunk。");
    }
    currentHunk.push(line);
  }
  if (hunks.length === 0 || hunks.some((hunk) => hunk.length === 0)) {
    throw new MemoryWikiError("invalid_patch", "更新补丁至少需要一个非空 hunk。");
  }

  const split = splitContentLines(content);
  let output = [...split.lines];
  for (const hunk of hunks) {
    const oldSegment = hunk
      .filter((line) => line.startsWith(" ") || line.startsWith("-"))
      .map((line) => line.slice(1));
    const newSegment = hunk
      .filter((line) => line.startsWith(" ") || line.startsWith("+"))
      .map((line) => line.slice(1));
    const occurrences =
      oldSegment.length === 0 && output.length === 0
        ? [0]
        : findSegmentOccurrences(output, oldSegment);
    if (occurrences.length !== 1) {
      throw new MemoryWikiError(
        "invalid_patch",
        occurrences.length === 0
          ? "补丁上下文与当前页面不匹配。"
          : "补丁上下文在当前页面中不唯一。",
      );
    }
    output.splice(occurrences[0]!, oldSegment.length, ...newSegment);
  }

  const joined = output.join("\n");
  return split.trailingNewline && joined.length > 0 ? `${joined}\n` : joined;
}

function normalizeSearchValue(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

function excerptForLine(line: string, query: string): string {
  if (line.length <= 500) return line;
  const index = normalizeSearchValue(line).indexOf(query);
  const start = Math.max(0, index - 180);
  const excerpt = Array.from(line).slice(start, start + 500).join("");
  return `${start > 0 ? "…" : ""}${excerpt}${start + 500 < line.length ? "…" : ""}`;
}

export function createMemoryWikiService({
  userDataPath,
  lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  staleLockMs = DEFAULT_STALE_LOCK_MS,
}: MemoryWikiServiceOptions): MemoryWikiService {
  const memoryRoot = join(userDataPath, "memory");
  const agentsRoot = join(memoryRoot, "agents");
  const locksRoot = join(memoryRoot, "locks");
  const trashRoot = join(memoryRoot, "trash");
  const deletedCharacterIds = new Set<string>();

  const initializeRoots = async (): Promise<void> => {
    await mkdir(memoryRoot, { recursive: true });
    await assertDirectory(memoryRoot);
    await mkdir(agentsRoot, { recursive: true });
    await mkdir(locksRoot, { recursive: true });
    await mkdir(trashRoot, { recursive: true });
    await Promise.all([
      assertDirectory(memoryRoot),
      assertDirectory(agentsRoot),
      assertDirectory(locksRoot),
      assertDirectory(trashRoot),
    ]);
  };

  const agentDirectory = (characterId: string): string => {
    assertCharacterId(characterId);
    return join(agentsRoot, characterId.toLowerCase());
  };

  const trashDirectory = (characterId: string): string => {
    assertCharacterId(characterId);
    return join(trashRoot, characterId.toLowerCase());
  };

  const lockIsStale = async (lockDirectory: string): Promise<boolean> => {
    const lockStat = await stat(lockDirectory);
    const expired = Date.now() - lockStat.mtimeMs >= staleLockMs;
    try {
      const owner = JSON.parse(
        await readFile(join(lockDirectory, "owner.json"), "utf8"),
      ) as { readonly pid?: unknown };
      if (!Number.isInteger(owner.pid) || Number(owner.pid) <= 0) return expired;
      if (owner.pid === process.pid) return false;
      try {
        process.kill(Number(owner.pid), 0);
        return false;
      } catch (error) {
        return isNodeError(error, "ESRCH");
      }
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return expired;
      return expired;
    }
  };

  const withAgentLock = async <T>(
    characterId: string,
    action: () => Promise<T>,
  ): Promise<T> => {
    assertCharacterId(characterId);
    await initializeRoots();
    const lockDirectory = join(locksRoot, characterId.toLowerCase());
    const deadline = Date.now() + lockTimeoutMs;
    while (true) {
      try {
        await mkdir(lockDirectory);
        await writeFile(
          join(lockDirectory, "owner.json"),
          JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
          "utf8",
        );
        break;
      } catch (error) {
        if (!isNodeError(error, "EEXIST")) throw error;
        await assertDirectory(lockDirectory);
        let stale = false;
        try {
          stale = await lockIsStale(lockDirectory);
        } catch (lockError) {
          if (isNodeError(lockError, "ENOENT")) continue;
          throw lockError;
        }
        if (stale) {
          await rm(lockDirectory, { recursive: true, force: true });
          continue;
        }
        if (Date.now() >= deadline) {
          throw new MemoryWikiError("lock_timeout", "角色记忆当前正被另一个操作占用。");
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      }
    }

    try {
      return await action();
    } finally {
      await rm(lockDirectory, { recursive: true, force: true });
    }
  };

  const assertSafeAgentDirectory = async (characterId: string): Promise<string> => {
    const directory = agentDirectory(characterId);
    await assertDirectory(directory);
    const resolvedAgentsRoot = await realpath(agentsRoot);
    const resolvedDirectory = await realpath(directory);
    const relativeDirectory = relative(resolvedAgentsRoot, resolvedDirectory);
    if (relativeDirectory.startsWith("..") || isAbsolute(relativeDirectory)) {
      throw new MemoryWikiError("unsafe_path", "角色记忆目录越过了允许范围。");
    }
    return directory;
  };

  const ensureAgentUnlocked = async (characterId: string): Promise<string> => {
    if (deletedCharacterIds.has(characterId.toLowerCase())) {
      throw new MemoryWikiError("invalid_character", "角色已被删除。");
    }
    const directory = agentDirectory(characterId);
    await mkdir(directory, { recursive: true });
    await assertSafeAgentDirectory(characterId);
    for (const pageDirectory of PAGE_DIRECTORIES) {
      await mkdir(join(directory, pageDirectory), { recursive: true });
    }
    for (const pageDirectory of PAGE_DIRECTORIES) {
      await assertDirectory(join(directory, pageDirectory));
    }
    const coreContents: Record<(typeof CORE_PAGES)[number], string> = {
      "index.md": "# Memory Index\n",
      "profile.md": "# User Profile\n",
    };
    for (const page of CORE_PAGES) {
      const path = join(directory, page);
      try {
        await writeFile(path, coreContents[page], { encoding: "utf8", flag: "wx" });
      } catch (error) {
        if (!isNodeError(error, "EEXIST")) throw error;
        await assertRegularFile(path);
      }
    }
    return directory;
  };

  const pagePath = async (characterId: string, pageInput: string): Promise<string> => {
    const page = normalizeMemoryWikiPagePath(pageInput);
    const directory = await assertSafeAgentDirectory(characterId);
    const path = join(directory, ...page.split("/"));
    const parent = dirname(path);
    await assertDirectory(parent);
    const resolvedDirectory = await realpath(directory);
    const resolvedParent = await realpath(parent);
    const relativeParent = relative(resolvedDirectory, resolvedParent);
    if (relativeParent.startsWith("..") || isAbsolute(relativeParent)) {
      throw new MemoryWikiError("unsafe_path", "页面路径越过了角色记忆目录。");
    }
    return path;
  };

  const readPageUnlocked = async (
    characterId: string,
    pageInput: string,
  ): Promise<MemoryWikiPage | null> => {
    const page = normalizeMemoryWikiPagePath(pageInput);
    const path = await pagePath(characterId, page);
    try {
      const byteSize = await assertRegularFile(path);
      if (byteSize > MAX_PAGE_BYTES) {
        throw new MemoryWikiError("page_too_large", "记忆页面超过 64 KiB 上限。");
      }
      const content = decodeUtf8(await readFile(path));
      return { page, revision: revisionFor(content), content };
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      throw error;
    }
  };

  const listPagesUnlocked = async (characterId: string): Promise<{
    readonly pages: readonly ListedPage[];
    readonly truncated: boolean;
  }> => {
    const directory = await assertSafeAgentDirectory(characterId);
    const pages: ListedPage[] = [];
    let byteTotal = 0;
    let truncated = false;

    const addPage = async (page: string): Promise<void> => {
      const path = join(directory, ...page.split("/"));
      try {
        const byteSize = await assertRegularFile(path);
        if (byteSize > MAX_PAGE_BYTES) {
          truncated = true;
          return;
        }
        if (
          pages.length >= MAX_VAULT_PAGES ||
          byteTotal + byteSize > MAX_VAULT_BYTES
        ) {
          truncated = true;
          return;
        }
        pages.push({ page, byteSize });
        byteTotal += byteSize;
      } catch (error) {
        if (!isNodeError(error, "ENOENT")) throw error;
      }
    };

    for (const corePage of CORE_PAGES) await addPage(corePage);
    for (const pageDirectory of PAGE_DIRECTORIES) {
      const path = join(directory, pageDirectory);
      await assertDirectory(path);
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (entry.isSymbolicLink()) {
          throw new MemoryWikiError("unsafe_path", "记忆目录包含不允许的链接。");
        }
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        try {
          normalizeMemoryWikiPagePath(`${pageDirectory}/${entry.name}`);
        } catch (error) {
          if (error instanceof MemoryWikiError) continue;
          throw error;
        }
        await addPage(`${pageDirectory}/${entry.name}`);
      }
    }
    return { pages, truncated };
  };

  const assertNoCaseConflict = async (
    characterId: string,
    page: string,
  ): Promise<void> => {
    const path = await pagePath(characterId, page);
    const entries = await readdir(dirname(path));
    const targetName = page.split("/").at(-1)!;
    const conflict = entries.find(
      (entry) =>
        entry !== targetName &&
        entry.toLocaleLowerCase() === targetName.toLocaleLowerCase(),
    );
    if (conflict !== undefined) {
      throw new MemoryWikiError("invalid_page", "页面路径存在大小写冲突。");
    }
  };

  const assertVaultCapacity = async (
    characterId: string,
    newPage: boolean,
    oldByteSize: number,
    newByteSize: number,
  ): Promise<void> => {
    const listed = await listPagesUnlocked(characterId);
    const byteTotal = listed.pages.reduce((sum, page) => sum + page.byteSize, 0);
    if (
      listed.truncated ||
      (newPage && listed.pages.length >= MAX_VAULT_PAGES) ||
      byteTotal - oldByteSize + newByteSize > MAX_VAULT_BYTES
    ) {
      throw new MemoryWikiError("vault_limit", "角色记忆已达到容量上限。");
    }
  };

  const atomicWrite = async (
    characterId: string,
    page: string,
    content: string,
  ): Promise<void> => {
    const path = await pagePath(characterId, page);
    const tempPath = join(dirname(path), `${TEMP_FILE_PREFIX}${randomUUID()}`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(tempPath, "wx");
      await handle.writeFile(content, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(tempPath, path);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  };

  const cleanupTemporaryFiles = async (characterId: string): Promise<void> => {
    const directory = await assertSafeAgentDirectory(characterId);
    for (const pageDirectory of ["", ...PAGE_DIRECTORIES]) {
      const path = pageDirectory.length === 0 ? directory : join(directory, pageDirectory);
      const entries = await readdir(path, { withFileTypes: true });
      await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.startsWith(TEMP_FILE_PREFIX))
          .map((entry) => rm(join(path, entry.name), { force: true })),
      );
    }
  };

  return {
    initialize: async (characterIds) => {
      await initializeRoots();
      const liveIds = new Set(
        characterIds.map((id) => {
          assertCharacterId(id);
          return id.toLowerCase();
        }),
      );
      const trashEntries = await readdir(trashRoot, { withFileTypes: true });
      for (const entry of trashEntries) {
        if (!entry.isDirectory() || !CHARACTER_ID_PATTERN.test(entry.name)) continue;
        await withAgentLock(entry.name, async () => {
          const staged = trashDirectory(entry.name);
          const active = agentDirectory(entry.name);
          if (liveIds.has(entry.name.toLowerCase()) && !(await exists(active))) {
            await rename(staged, active);
          } else {
            await rm(staged, { recursive: true, force: true });
          }
        });
      }
      for (const characterId of liveIds) {
        await withAgentLock(characterId, async () => {
          await ensureAgentUnlocked(characterId);
          await cleanupTemporaryFiles(characterId);
        });
      }
    },
    loadCore: (characterId) =>
      withAgentLock(characterId, async () => {
        await ensureAgentUnlocked(characterId);
        const pages: MemoryWikiPage[] = [];
        for (const page of CORE_PAGES) {
          const stored = await readPageUnlocked(characterId, page);
          if (stored === null) continue;
          const truncated = truncateUtf8WithNotice(
            stored.content,
            MAX_CORE_CONTEXT_BYTES,
            "\n<!-- Core memory truncated; use wiki_get for the rest. -->\n",
          );
          pages.push({
            ...stored,
            content: truncated,
          });
        }
        return pages;
      }),
    search: (characterId, request) =>
      withAgentLock(characterId, async () => {
        await ensureAgentUnlocked(characterId);
        const query = normalizeSearchValue(request.query.trim());
        if (query.length === 0 || query.length > 200) {
          throw new MemoryWikiError("invalid_page", "搜索词长度必须为 1–200 个字符。");
        }
        const scope = request.scope ?? "all";
        const limit = request.limit ?? 5;
        if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
          throw new MemoryWikiError("invalid_range", "搜索结果数量必须为 1–10。 ");
        }
        const tokens = query.split(/\s+/u).filter(Boolean);
        const listed = await listPagesUnlocked(characterId);
        const candidates: Array<MemoryWikiSearchResult & { readonly score: number }> = [];
        for (const listedPage of listed.pages) {
          const pageScope = CORE_PAGES.includes(
            listedPage.page as (typeof CORE_PAGES)[number],
          )
            ? "core"
            : listedPage.page.split("/")[0];
          if (scope !== "all" && scope !== pageScope) continue;
          const stored = await readPageUnlocked(characterId, listedPage.page);
          if (stored === null) continue;
          const normalizedPath = normalizeSearchValue(stored.page);
          const pathScore = normalizedPath.includes(query) ? 80 : 0;
          let best:
            | { readonly line: number; readonly excerpt: string; readonly score: number }
            | undefined;
          const lines = stored.content.split("\n");
          for (const [index, line] of lines.entries()) {
            const normalizedLine = normalizeSearchValue(line);
            const phraseHits = normalizedLine.split(query).length - 1;
            const tokenHits = tokens.reduce(
              (count, token) => count + (normalizedLine.includes(token) ? 1 : 0),
              0,
            );
            if (phraseHits === 0 && tokenHits === 0 && pathScore === 0) continue;
            const headingBonus = line.trimStart().startsWith("#") ? 30 : 0;
            const score = pathScore + phraseHits * 40 + tokenHits * 10 + headingBonus;
            if (best === undefined || score > best.score) {
              best = {
                line: index + 1,
                excerpt: excerptForLine(line, query),
                score,
              };
            }
          }
          if (best !== undefined) {
            candidates.push({
              page: stored.page,
              line: best.line,
              excerpt: best.excerpt,
              revision: stored.revision,
              score: best.score,
            });
          }
        }
        candidates.sort(
          (left, right) => right.score - left.score || left.page.localeCompare(right.page),
        );
        return {
          status: "ok",
          results: candidates.slice(0, limit).map(({ score: _score, ...result }) => result),
          truncated: listed.truncated || candidates.length > limit,
        };
      }),
    get: (characterId, request) =>
      withAgentLock(characterId, async () => {
        await ensureAgentUnlocked(characterId);
        const page = normalizeMemoryWikiPagePath(request.page);
        const stored = await readPageUnlocked(characterId, page);
        if (stored === null) return { status: "not_found", page };
        const startLine = request.startLine ?? 1;
        const endLine = request.endLine ?? startLine + MAX_GET_LINES - 1;
        if (
          !Number.isInteger(startLine) ||
          !Number.isInteger(endLine) ||
          startLine < 1 ||
          endLine < startLine ||
          endLine - startLine + 1 > MAX_GET_LINES
        ) {
          throw new MemoryWikiError(
            "invalid_range",
            "读取范围必须是最多 200 行的有效正整数区间。",
          );
        }
        const lines = stored.content.split("\n");
        const selected = lines.slice(startLine - 1, endLine);
        const selectedText = selected.join("\n");
        const content = truncateUtf8(selectedText, MAX_GET_BYTES);
        const actualStartLine = Math.min(startLine, lines.length);
        const returnedLineCount = content.length === 0 ? 0 : content.split("\n").length;
        const actualEndLine =
          returnedLineCount === 0
            ? actualStartLine
            : actualStartLine + returnedLineCount - 1;
        return {
          status: "found",
          page,
          revision: stored.revision,
          totalLines: lines.length,
          startLine: actualStartLine,
          endLine: actualEndLine,
          content,
          truncated:
            content !== selectedText ||
            actualEndLine < Math.min(endLine, lines.length) ||
            endLine < lines.length,
        };
      }),
    applyPatch: (characterId, request) =>
      withAgentLock(characterId, async () => {
        await ensureAgentUnlocked(characterId);
        const parsed = parseMemoryWikiPatch(request.patch);
        await assertNoCaseConflict(characterId, parsed.page);
        const current = await readPageUnlocked(characterId, parsed.page);

        if (parsed.operation === "add") {
          if (request.baseRevision !== null) {
            throw new MemoryWikiError(
              "invalid_patch",
              "新增页面时 baseRevision 必须为 null。",
            );
          }
          if (current !== null) {
            return {
              status: "conflict",
              page: parsed.page,
              currentRevision: current.revision,
            };
          }
          const content = applyAddPatch(parsed.lines);
          const byteSize = Buffer.byteLength(content, "utf8");
          if (byteSize > MAX_PAGE_BYTES) {
            throw new MemoryWikiError("page_too_large", "记忆页面超过 64 KiB 上限。");
          }
          await assertVaultCapacity(characterId, true, 0, byteSize);
          await atomicWrite(characterId, parsed.page, content);
          return {
            status: "applied",
            page: parsed.page,
            previousRevision: null,
            revision: revisionFor(content),
          };
        }

        if (current === null) return { status: "not_found", page: parsed.page };
        if (request.baseRevision !== current.revision) {
          return {
            status: "conflict",
            page: parsed.page,
            currentRevision: current.revision,
          };
        }
        const content = applyUpdatePatch(current.content, parsed.lines);
        const oldByteSize = Buffer.byteLength(current.content, "utf8");
        const byteSize = Buffer.byteLength(content, "utf8");
        if (byteSize > MAX_PAGE_BYTES) {
          throw new MemoryWikiError("page_too_large", "记忆页面超过 64 KiB 上限。");
        }
        await assertVaultCapacity(characterId, false, oldByteSize, byteSize);
        await atomicWrite(characterId, parsed.page, content);
        return {
          status: "applied",
          page: parsed.page,
          previousRevision: current.revision,
          revision: revisionFor(content),
        };
      }),
    deleteCharacterMemoryTransaction: (
      characterId: string,
      deleteDatabaseRecord: () => unknown | Promise<unknown>,
    ) =>
      withAgentLock(characterId, async () => {
        const normalizedId = characterId.toLowerCase();
        const active = agentDirectory(characterId);
        const staged = trashDirectory(characterId);
        let stagedMemory = false;
        if (await exists(active)) {
          await assertSafeAgentDirectory(characterId);
          if (await exists(staged)) {
            throw new MemoryWikiError(
              "unsafe_path",
              "角色记忆删除暂存目录已存在。",
            );
          }
          await rename(active, staged);
          stagedMemory = true;
        }

        let result: unknown;
        try {
          result = await deleteDatabaseRecord();
        } catch (error) {
          if (stagedMemory) {
            await assertDirectory(staged);
            if (await exists(active)) {
              throw new MemoryWikiError("unsafe_path", "无法恢复角色记忆目录。");
            }
            await rename(staged, active);
          }
          throw error;
        }

        deletedCharacterIds.add(normalizedId);
        let cleanupError: unknown | null = null;
        if (stagedMemory) {
          try {
            await assertDirectory(staged);
            await rm(staged, { recursive: true, force: true });
          } catch (error) {
            cleanupError = error;
          }
        }
        return { result, cleanupError };
      }),
    stageCharacterDeletion: (characterId) =>
      withAgentLock(characterId, async () => {
        const active = agentDirectory(characterId);
        const staged = trashDirectory(characterId);
        if (!(await exists(active))) return false;
        await assertSafeAgentDirectory(characterId);
        if (await exists(staged)) {
          throw new MemoryWikiError("unsafe_path", "角色记忆删除暂存目录已存在。");
        }
        await rename(active, staged);
        return true;
      }),
    rollbackCharacterDeletion: (characterId) =>
      withAgentLock(characterId, async () => {
        const active = agentDirectory(characterId);
        const staged = trashDirectory(characterId);
        if (!(await exists(staged))) return;
        await assertDirectory(staged);
        if (await exists(active)) {
          throw new MemoryWikiError("unsafe_path", "无法恢复角色记忆目录。");
        }
        await rename(staged, active);
      }),
    commitCharacterDeletion: (characterId) =>
      withAgentLock(characterId, async () => {
        const staged = trashDirectory(characterId);
        if (!(await exists(staged))) return;
        await assertDirectory(staged);
        await rm(staged, { recursive: true, force: true });
      }),
  };
}
