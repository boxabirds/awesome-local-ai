import { UNDO_WINDOW_MS } from '@todoodle/shared/limits';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUndo, realClock } from '@/features/undo/createUndo';
import { latestActiveUndo, pushUndo, resetUndoStackForTests } from '@/features/undo/undoStack';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  resetUndoStackForTests();
});

describe('TC-U12 undoStack latest', () => {
  it('push A then B: latest is B; B expires: A; A expires: none', () => {
    const a = createUndo(async () => {}, realClock);
    vi.advanceTimersByTime(3_000);
    const b = createUndo(async () => {}, realClock);
    pushUndo(a);
    pushUndo(b);
    expect(latestActiveUndo()).toBe(b);
    // A is shown first; pausing it lets B (the newer one) run out first.
    a.pause();
    vi.advanceTimersByTime(UNDO_WINDOW_MS);
    expect(b.state).toBe('expired');
    expect(latestActiveUndo()).toBe(a);
    a.resume();
    vi.advanceTimersByTime(UNDO_WINDOW_MS);
    expect(a.state).toBe('expired');
    expect(latestActiveUndo()).toBeUndefined();
  });

  it('a paused toast is still active; an undone one is not', async () => {
    const a = createUndo(async () => {}, realClock);
    pushUndo(a);
    a.pause();
    expect(latestActiveUndo()).toBe(a);
    a.resume();
    await a.undo();
    expect(latestActiveUndo()).toBeUndefined();
  });
});
