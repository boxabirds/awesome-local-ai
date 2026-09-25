import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

/**
 * Yjs measures the capture window with `lib0/time.getUnixTime`, which is a
 * reference to the *original* `Date.now` captured at module load — vitest's
 * fake `Date` (installed later) does not reach it. Re-point it at the global
 * `Date.now` so `vi.useFakeTimers({ toFake: ['Date'] })` controls the window.
 */
vi.mock('lib0/time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lib0/time')>();
  return { ...actual, getUnixTime: () => Date.now() };
});
import {
  createSticky,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { createUndo } from '../../src/client/board/undo';

/**
 * undo.boundaries (story 8, task 7): the typing-burst capture window, tested
 * against fake system time (the window is measured with `Date.now`).
 *
 * The Yjs UndoManager merges local transactions whose gap is strictly less
 * than `captureTimeout` into one stack item; at exactly `captureTimeout` it
 * starts a new one. `boundary()` (`stopCapturing`) forces a new item either
 * way — that is how the client keeps one step per user action.
 */

/** One tracked local text insert at the end of the note's Y.Text. */
const typeChar = (doc: Y.Doc, id: string): void => {
  const text = getStickyText(doc, id)!;
  doc.transact(() => {
    text.insert(text.length, 'a');
  }, LOCAL_ORIGIN);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('undo.boundaries (TC-12 to TC-13)', () => {
  it('TC-12 LOCAL_ORIGIN inserts 100 ms apart between two boundary() calls → exactly one undo step', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    const undo = createUndo(doc);
    const text = getStickyText(doc, id)!;

    undo.boundary();
    for (let i = 0; i < 5; i++) {
      typeChar(doc, id);
      if (i < 4) vi.advanceTimersByTime(100);
    }
    undo.boundary();

    // The whole burst is one step: a single undo removes it all.
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-13 inserts separated by exactly UNDO_CAPTURE_TIMEOUT_MS → two steps; one ms less → one step', () => {
    // Exactly the timeout: the merge condition is `gap < captureTimeout`,
    // so this starts a second step.
    {
      const doc = new Y.Doc();
      initDoc(doc);
      const id = createSticky(doc, { x: 0, y: 0 });
      const undo = createUndo(doc);
      const text = getStickyText(doc, id)!;

      undo.boundary();
      typeChar(doc, id);
      vi.advanceTimersByTime(UNDO_CAPTURE_TIMEOUT_MS);
      typeChar(doc, id);
      undo.boundary();

      expect(undo.undo()).toBe(true);
      expect(undo.undo()).toBe(true); // two separate steps
      expect(undo.canUndo()).toBe(false);
      expect(text.toString()).toBe('');
    }

    // One ms inside the window: still one burst, one step.
    {
      const doc = new Y.Doc();
      initDoc(doc);
      const id = createSticky(doc, { x: 0, y: 0 });
      const undo = createUndo(doc);
      const text = getStickyText(doc, id)!;

      undo.boundary();
      typeChar(doc, id);
      vi.advanceTimersByTime(UNDO_CAPTURE_TIMEOUT_MS - 1);
      typeChar(doc, id);
      undo.boundary();

      expect(undo.undo()).toBe(true);
      expect(undo.canUndo()).toBe(false); // merged into the same step
      expect(text.toString()).toBe('');
    }
  });

  it('boundary() on an empty stack is a no-op (error path)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = createUndo(doc);

    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    // A following action is still captured normally.
    const id = createSticky(doc, { x: 0, y: 0 });
    expect(getStickyText(doc, id)).toBeDefined();
    undo.boundary();
    typeChar(doc, id);
    undo.boundary();
    expect(undo.canUndo()).toBe(true);
  });
});
