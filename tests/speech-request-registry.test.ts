import { describe, expect, it } from "vitest";
import { SpeechRequestRegistry } from "../src/main/speech/speechRequestRegistry";

describe("speech request ownership", () => {
  it("allows only the owning sender to cancel a request", () => {
    const registry = new SpeechRequestRegistry();
    const controller = new AbortController();
    registry.register(10, "request", controller);

    registry.cancel(11, "request");
    expect(controller.signal.aborted).toBe(false);

    registry.cancel(10, "request");
    expect(controller.signal.aborted).toBe(true);
  });

  it("cancels all requests belonging to a destroyed sender", () => {
    const registry = new SpeechRequestRegistry();
    const first = new AbortController();
    const second = new AbortController();
    const other = new AbortController();
    registry.register(10, "first", first);
    registry.register(10, "second", second);
    registry.register(11, "other", other);

    registry.cancelSender(10);

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(other.signal.aborted).toBe(false);
  });

  it("replaces duplicate request IDs per sender and unregisters by identity", () => {
    const registry = new SpeechRequestRegistry();
    const first = new AbortController();
    const second = new AbortController();
    const unregisterFirst = registry.register(10, "same", first);
    const unregisterSecond = registry.register(10, "same", second);

    expect(first.signal.aborted).toBe(true);
    unregisterFirst();
    expect(registry.size).toBe(1);
    unregisterSecond();
    expect(registry.size).toBe(0);
  });
});
