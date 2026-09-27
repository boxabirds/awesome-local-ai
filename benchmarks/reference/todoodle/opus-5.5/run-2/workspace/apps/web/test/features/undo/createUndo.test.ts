import { UNDO_WINDOW_MS } from '@todoodle/shared/limits';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Clock, createUndo } from '@/features/undo/createUndo';

// Vitest's fake timers drive a real Clock implementation.
const clock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('TC-U10 createUndo window', () => {
  it.each([
    ['at 0 ms', 0, true],
    ['at UNDO_WINDOW_MS - 1', UNDO_WINDOW_MS - 1, true],
    ['at UNDO_WINDOW_MS', UNDO_WINDOW_MS, false],
  ])('undo %s: called = %s', async (_label, at, called) => {
    const inverse = vi.fn(async () => {});
    const handle = createUndo(inverse, clock);
    vi.advanceTimersByTime(at);
    await handle.undo();
    expect(inverse).toHaveBeenCalledTimes(called ? 1 : 0);
    expect(handle.state).toBe(called ? 'undone' : 'expired');
  });

  it('calls the inverse only once, even when undone twice', async () => {
    const inverse = vi.fn(async () => {});
    const handle = createUndo(inverse, clock);
    await Promise.all([handle.undo(), handle.undo()]);
    await handle.undo();
    expect(inverse).toHaveBeenCalledTimes(1);
  });

  it('a failing inverse ends in failed and reports it once', async () => {
    const onSettled = vi.fn();
    const handle = createUndo(async () => Promise.reject(new Error('500')), clock, { onSettled });
    await handle.undo();
    expect(handle.state).toBe('failed');
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled.mock.calls[0]![0]).toBe('failed');
  });

  it('cancel ends the window without calling the inverse', async () => {
    const inverse = vi.fn(async () => {});
    const handle = createUndo(inverse, clock);
    handle.cancel();
    await handle.undo();
    expect(handle.state).toBe('cancelled');
    expect(inverse).not.toHaveBeenCalled();
  });
});

describe('TC-U11 createUndo pause', () => {
  it('pause at 9000 ms, 60000 ms pass, resume, undo 500 ms later: the inverse is called', async () => {
    const inverse = vi.fn(async () => {});
    const handle = createUndo(inverse, clock);
    vi.advanceTimersByTime(9_000);
    handle.pause();
    expect(handle.state).toBe('paused');
    vi.advanceTimersByTime(60_000);
    expect(handle.state).toBe('paused');
    handle.resume();
    vi.advanceTimersByTime(500);
    await handle.undo();
    expect(inverse).toHaveBeenCalledTimes(1);
  });

  it('a fresh handle paused and resumed expires at exactly UNDO_WINDOW_MS of unpaused time', () => {
    const onSettled = vi.fn();
    const handle = createUndo(async () => {}, clock, { onSettled });
    vi.advanceTimersByTime(4_000);
    handle.pause();
    vi.advanceTimersByTime(1_000);
    handle.resume();
    vi.advanceTimersByTime(UNDO_WINDOW_MS - 4_000 - 1);
    expect(handle.state).toBe('counting');
    expect(handle.remaining).toBe(1);
    vi.advanceTimersByTime(1);
    expect(handle.state).toBe('expired');
    expect(onSettled).toHaveBeenCalledWith('expired', undefined);
  });
});
