import { randomUUID } from "node:crypto";
import { createServer, type Socket } from "node:net";
import type { SpeechStreamEvent } from "../ai/streamingSpeech";

// One binary pipe per dialogue keeps audio backpressure off the control connection.
export async function createAvatarSpeechStream(signal: AbortSignal) {
  signal.throwIfAborted();
  const name = `katarune-pcm-${randomUUID()}`;
  const server = createServer();
  let socket: Socket | undefined;
  let rejectConnection!: (error: Error) => void;
  const connected = new Promise<Socket>((resolve, reject) => {
    rejectConnection = reject;
    server.on("connection", client => {
      if (socket || signal.aborted) { client.destroy(); return; }
      socket = client;
      client.on("error", () => {});
      resolve(client);
    });
  });
  void connected.catch(() => {});
  const dispose = () => {
    rejectConnection(new Error("Speech transport closed."));
    socket?.destroy();
    server.close();
    signal.removeEventListener("abort", dispose);
  };
  server.on("error", rejectConnection);
  signal.addEventListener("abort", dispose, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(`\\\\.\\pipe\\${name}`, () => { server.removeListener("error", reject); resolve(); });
    });
    signal.throwIfAborted();
  } catch (error) { dispose(); throw error; }
  const frame = async (kind: number, payload: Uint8Array) => {
    signal.throwIfAborted();
    if (payload.length > 8 * 1024 * 1024) throw new Error("Speech frame exceeds limit.");
    const client = await connected;
    signal.throwIfAborted();
    const header = Buffer.alloc(5);
    header.writeUInt32LE(payload.length + 1); header[4] = kind;
    await new Promise<void>((resolve, reject) => {
      client.write(Buffer.concat([header, payload]), error => error ? reject(error) : resolve());
    });
  };
  return {
    name, dispose,
    async write(event: SpeechStreamEvent) {
      if (event.type === "audio") {
        for (let offset = 0; offset < event.audio.length; offset += 16384)
          await frame(2, event.audio.subarray(offset, offset + 16384));
      } else if (event.type === "format") await frame(1, Buffer.from(JSON.stringify(event)));
      else if (event.type === "alignment") await frame(3, Buffer.from(JSON.stringify(event)));
      else { await frame(4, new Uint8Array()); socket?.end(); }
    },
    async fail() {
      await frame(5, new Uint8Array()).catch(() => {});
      socket?.end();
    },
  };
}
