import { posix } from "node:path";
import { Bash, InMemoryFs, MountableFs, OverlayFs, ReadWriteFs, type IFileSystem, type InitialFiles } from "just-bash";
import type { Experimental_SandboxSession } from "ai";
import type { DirectoryGrant } from "../../shared/agentTools";

// Only explicitly attached files exist in this mount. Lazy reads do not create
// disk copies or expose the directory containing the source file.
class AttachmentFs extends InMemoryFs {
  private denied(): never { throw new Error("EROFS: 附件只允许读取，请将修改结果写入工作区。"); }
  override async writeFile(): Promise<void> { this.denied(); }
  override async appendFile(): Promise<void> { this.denied(); }
  override async mkdir(): Promise<void> { this.denied(); }
  override async createExclusive(): Promise<void> { this.denied(); }
  override async rm(): Promise<void> { this.denied(); }
  override async cp(): Promise<void> { this.denied(); }
  override async mv(): Promise<void> { this.denied(); }
  override async chmod(): Promise<void> { this.denied(); }
  override async symlink(): Promise<void> { this.denied(); }
  override async link(): Promise<void> { this.denied(); }
  override async utimes(): Promise<void> { this.denied(); }
}

export function createRestrictedFilesystem(workspace: string, directories: readonly DirectoryGrant[], attachments: InitialFiles = {}): IFileSystem {
  const fs = new MountableFs({ base: new InMemoryFs() });
  fs.mount("/workspace", new ReadWriteFs({ root: workspace, maxFileReadSize: 100 * 1024 * 1024, maxCopySize: 100 * 1024 * 1024 }));
  fs.mount("/attachments", new AttachmentFs(attachments));
  for (const grant of directories) fs.mount(`/directories/${grant.id}`,
    grant.access === "read" ? new OverlayFs({ root: grant.path, mountPoint: "/", readOnly: true, maxFileReadSize: 100 * 1024 * 1024 }) : new ReadWriteFs({ root: grant.path, maxFileReadSize: 100 * 1024 * 1024, maxCopySize: 100 * 1024 * 1024 }));
  return fs;
}

export function createRestrictedBash(fs: IFileSystem): Bash {
  return new Bash({ fs, cwd: "/workspace", executionLimitProfile: "hardened",
    executionLimits: { maxExecutionTimeMs: 60_000, maxCommandCount: 10_000, maxOutputSize: 8 * 1024 * 1024, maxFileSystemBytes: 256 * 1024 * 1024 } });
}

// The official Bash tool uses run(); the remaining methods implement its shared
// sandbox contract so image/file tools use exactly the same scoped filesystem.
export function filesystemSandbox(fs: IFileSystem, run: Experimental_SandboxSession["run"], description: string): Experimental_SandboxSession {
  const path = (value: string) => posix.resolve("/workspace", value);
  const read = async (value: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (!await fs.exists(path(value))) return null;
    return fs.readFileBuffer(path(value));
  };
  return {
    description, run,
    spawn: async () => { throw new Error("此工具仅支持有界命令，不提供交互式后台进程。"); },
    readBinaryFile: ({ path: value, abortSignal }) => read(value, abortSignal),
    readFile: async ({ path: value, abortSignal }) => {
      const bytes = await read(value, abortSignal);
      return bytes === null ? null : new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
    },
    readTextFile: async ({ path: value, startLine, endLine, abortSignal }) => {
      const bytes = await read(value, abortSignal);
      if (bytes === null) return null;
      return new TextDecoder().decode(bytes).split("\n").slice(startLine === undefined ? 0 : Math.max(0, startLine - 1), endLine).join("\n");
    },
    writeBinaryFile: async ({ path: value, content, abortSignal }) => { abortSignal?.throwIfAborted(); await fs.writeFile(path(value), content); },
    writeTextFile: async ({ path: value, content, abortSignal }) => { abortSignal?.throwIfAborted(); await fs.writeFile(path(value), content); },
    writeFile: async ({ path: value, content, abortSignal }) => {
      const bytes = await new Response(content).arrayBuffer(); abortSignal?.throwIfAborted();
      await fs.writeFile(path(value), new Uint8Array(bytes));
    },
    stat: async ({ path: value, abortSignal }) => {
      abortSignal?.throwIfAborted(); if (!await fs.exists(path(value))) return null;
      const stat = await fs.stat(path(value));
      return { type: stat.isDirectory ? "directory" : stat.isFile ? "file" : "other", size: stat.size };
    },
    listDirectory: async ({ path: value, abortSignal }) => {
      abortSignal?.throwIfAborted(); if (!await fs.exists(path(value))) return null;
      return Promise.all((await fs.readdir(path(value))).map(async name => {
        const entry = await fs.lstat(posix.join(path(value), name));
        return { name, type: entry.isSymbolicLink ? "symlink" as const : entry.isDirectory ? "directory" as const : entry.isFile ? "file" as const : "other" as const };
      }));
    },
    deleteFile: async ({ path: value, abortSignal }) => {
      abortSignal?.throwIfAborted(); if (!await fs.exists(path(value))) return false;
      await fs.rm(path(value)); return true;
    },
  };
}
