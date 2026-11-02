import { execFile } from "node:child_process";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/** Keep protocol handling upstream, while owning the Windows subprocess tree. */
export class ManagedStdioTransport extends StdioClientTransport {
  #closing: Promise<void> | undefined;

  override close(): Promise<void> {
    return this.#closing ??= this.#close();
  }

  async #close(): Promise<void> {
    const pid = this.pid;
    if (process.platform === "win32" && pid !== null) {
      await new Promise<void>(resolve => {
        execFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"],
          { windowsHide: true, timeout: 5000 }, () => resolve());
      });
    }
    await super.close();
  }
}
