/** A hold consumes the following click; cancellation consumes it too. */
export class HoldGesture {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private consumed = false;
  private down = false;
  constructor(private readonly hold: () => void, private readonly clickAction: () => void) {}
  press() {
    if (this.down) return;
    this.down = true; this.consumed = false;
    this.timer = setTimeout(() => { this.timer = undefined; this.consumed = true; this.hold(); }, 600);
  }
  release() { clearTimeout(this.timer); this.timer = undefined; this.down = false; }
  cancel() { if (this.down) this.consumed = true; this.release(); }
  click() {
    this.release();
    if (this.consumed) { this.consumed = false; return; }
    this.clickAction();
  }
}
