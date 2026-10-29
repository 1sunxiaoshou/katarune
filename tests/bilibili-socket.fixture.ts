import { biliPacket } from "../src/main/live/bilibili";

export class SocketFixture extends EventTarget implements WebSocket {
  readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSING = 2; readonly CLOSED = 3;
  readonly bufferedAmount = 0; readonly extensions = ""; readonly protocol = "";
  binaryType: BinaryType = "arraybuffer";
  readyState: 0 | 1 | 2 | 3 = 0;
  onopen: WebSocket["onopen"] = null; onclose: WebSocket["onclose"] = null;
  onerror: WebSocket["onerror"] = null; onmessage: WebSocket["onmessage"] = null;
  sent = 0; sentData: unknown[] = [];
  constructor(readonly url: string) { super(); }
  send(data?: unknown) { this.sent++; this.sentData.push(data); }
  open() { this.readyState = 1; this.onopen?.call(this, new Event("open")); }
  receive(operation: number, body: unknown) {
    const packet = biliPacket(operation, JSON.stringify(body));
    this.onmessage?.call(this, new MessageEvent("message", { data: new Uint8Array(packet).buffer }));
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.call(this, Object.assign(new Event("close"), { code: 1000, reason: "", wasClean: true }));
  }
}
