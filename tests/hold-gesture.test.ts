import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoldGesture } from '../src/renderer/src/speech/holdGesture';
beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());
describe('recording button hold gesture', () => {
  it('short clicks record, holds trigger once and consume the release click', () => {
    const hold = vi.fn(), click = vi.fn(), gesture = new HoldGesture(hold, click);
    gesture.press(); vi.advanceTimersByTime(599); gesture.release(); gesture.click(); expect(click).toHaveBeenCalledTimes(1);
    gesture.press(); vi.advanceTimersByTime(600); gesture.press(); vi.advanceTimersByTime(1000);
    gesture.release(); gesture.click(); expect(hold).toHaveBeenCalledTimes(1); expect(click).toHaveBeenCalledTimes(1);
    gesture.press(); gesture.release(); gesture.click(); expect(click).toHaveBeenCalledTimes(2);
  });
  it('leaving, blur or pointer cancellation prevents both hold and stale clicks', () => {
    const hold = vi.fn(), click = vi.fn(), gesture = new HoldGesture(hold, click);
    gesture.press(); vi.advanceTimersByTime(300); gesture.cancel(); vi.advanceTimersByTime(1000); gesture.click();
    expect(hold).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled();
    gesture.press(); gesture.release(); gesture.click(); expect(click).toHaveBeenCalledTimes(1);
  });
});
