import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createIdleTimer } from '../../js/commit.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createIdleTimer', () => {
  it('fires 2800ms after pen-up with no further activity', () => {
    const onFire = vi.fn();
    const t = createIdleTimer(2800, onFire);
    t.penDown(); t.activity(); t.penUp();
    vi.advanceTimersByTime(2799);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFire).toHaveBeenCalledTimes(1);
  });
  it('does not fire while the pen is down', () => {
    const onFire = vi.fn();
    const t = createIdleTimer(2800, onFire);
    t.penDown(); t.activity();
    vi.advanceTimersByTime(5000);
    expect(onFire).not.toHaveBeenCalled();
  });
  it('resets the countdown when a new stroke starts', () => {
    const onFire = vi.fn();
    const t = createIdleTimer(2800, onFire);
    t.penUp();
    vi.advanceTimersByTime(2000);
    t.penDown(); t.penUp(); // new activity resets
    vi.advanceTimersByTime(2000);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(800);
    expect(onFire).toHaveBeenCalledTimes(1);
  });
});
