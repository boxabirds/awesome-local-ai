import { UNDO_WINDOW_MS } from '@todoodle/shared/limits';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUndo, realClock } from '@/features/undo/createUndo';
import { clearUndoStackForTests, latestActiveUndo, pushUndo } from '@/features/undo/undoStack';

// Story 6: the undo scheduler (TC-U10, TC-U11) and the undo stack (TC-U12), with fake timers.

beforeEach(() => {
  vi.useFakeTimers();
  expect(UNDO_WINDOW_MS).toBe(10_000);
});
afterEach(() => {
  clearUndoStackForTests();
  vi.useRealTimers();
});

describe('TC-U10 createUndo window', () => {
  it.each([
    ['0 ms', 0, true],
    ['UNDO_WINDOW_MS - 1', UNDO_WINDOW_MS - 1, true],
    ['UNDO_WINDOW_MS', UNDO_WINDOW_MS, false],
  ])('undo at %s -> inverse called: %s', async (_label, at, called) => {
    const inverse = vi.fn(async () => {});
    const handle = createUndo(inverse, realClock);
    vi.advanceTimersByTime(at);
    await handle.undo();
    expect(inverse).toHaveBeenCalledTimes(called ? 1 : 0);
    expect(handle.state).toBe(called ? 'undone' : 'expired');
  });

  it('the inverse is called at most once, even when undo is pressed again while it runs', async () => {
    let finish!: () => void;
    const inverse = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const handle = createUndo(inverse, realClock);
    const first = handle.undo();
    expect(handle.state).toBe('undoing');
    await handle.undo();
    finish();
    await first;
    await handle.undo();
    expect(inverse).toHaveBeenCalledTimes(1);
  });

  it('a failing inverse ends in the failed state (and never rejects)', async () => {
    const onChange = vi.fn();
    const handle = createUndo(() => Promise.reject(new Error('500')), realClock, onChange);
    await expect(handle.undo()).resolves.toBeUndefined();
    expect(handle.state).toBe('failed');
    expect(onChange.mock.calls.map(([state]) => state)).toEqual(['undoing', 'failed']);
  });

  it('expiry is reported through onChange exactly at the window', () => {
    const onChange = vi.fn();
    createUndo(async () => {}, realClock, onChange);
    vi.advanceTimersByTime(UNDO_WINDOW_MS - 1);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledWith('expired');
  });
});

describe('TC-U11 createUndo pause', () => {
  it('pause at 9000 ms, advance 60000 ms, resume, undo 500 ms later -> called', async () => {
    const inverse = vi.fn(async () => {});
    const handle = createUndo(inverse, realClock);
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

  it('a fresh toast paused and resumed expires at exactly 10000 ms of unpaused time', async () => {
    const inverse = vi.fn(async () => {});
    const handle = createUndo(inverse, realClock);
    vi.advanceTimersByTime(4_000);
    handle.pause();
    vi.advanceTimersByTime(30_000);
    handle.resume();
    expect(handle.remaining).toBe(6_000);
    vi.advanceTimersByTime(5_999);
    expect(handle.state).toBe('counting');
    // Then let 1000 ms pass without pausing: the window ends 1 ms into it.
    vi.advanceTimersByTime(1_000);
    expect(handle.state).toBe('expired');
    await handle.undo();
    expect(inverse).not.toHaveBeenCalled();
  });

  it('pause and resume are ignored in the wrong state', () => {
    const handle = createUndo(async () => {}, realClock);
    handle.resume();
    expect(handle.state).toBe('counting');
    handle.pause();
    handle.pause();
    expect(handle.state).toBe('paused');
    vi.advanceTimersByTime(UNDO_WINDOW_MS * 3);
    expect(handle.state).toBe('paused');
  });
});

describe('TC-U12 undoStack latestActiveUndo', () => {
  it('push A then B: latest is B; B expires -> A; A expires -> none', () => {
    // B's window started 3 s before A's, so B (pushed last) expires first.
    const b = createUndo(async () => {}, realClock);
    vi.advanceTimersByTime(3_000);
    const a = createUndo(async () => {}, realClock);
    pushUndo(a);
    pushUndo(b);
    expect(latestActiveUndo()).toBe(b);
    vi.advanceTimersByTime(UNDO_WINDOW_MS - 3_000);
    expect(b.state).toBe('expired');
    expect(latestActiveUndo()).toBe(a);
    vi.advanceTimersByTime(3_000);
    expect(a.state).toBe('expired');
    expect(latestActiveUndo()).toBeUndefined();
  });

  it('a paused handle is still active', () => {
    const a = createUndo(async () => {}, realClock);
    pushUndo(a);
    a.pause();
    vi.advanceTimersByTime(UNDO_WINDOW_MS * 2);
    expect(latestActiveUndo()).toBe(a);
  });

  it('a used handle is skipped', async () => {
    const a = createUndo(async () => {}, realClock);
    const b = createUndo(async () => {}, realClock);
    pushUndo(a);
    pushUndo(b);
    await b.undo();
    expect(latestActiveUndo()).toBe(a);
  });
});
