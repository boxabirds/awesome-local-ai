/**
 * Story 8 — undo.typing / undo.boundaries unit tests (TC-12, TC-13, task 7).
 *
 * Yjs merges tracked transactions into one undo step when the gap between
 * them is below the capture timeout (500 ms); `boundary()`
 * (stopCapturing) forces the next transaction to start a new step.
 *
 * yjs binds lib0's `getUnixTime` (= Date.now) at module load, so
 * vi.useFakeTimers() cannot move the clock yjs sees. Instead, lib0/time is
 * mocked with a controllable hoisted clock: exact millisecond control, no
 * real waiting.
 */
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
  snapshot,
} from '../../src/shared/board-model';
import { createUndo } from '../../src/client/board/undo';

const T0 = 1_700_000_000_000;

/** Controllable clock seen by yjs (lib0/time.getUnixTime). */
const clock = vi.hoisted(() => ({ now: 1_700_000_000_000 }));

vi.mock('lib0/time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lib0/time')>();
  return {
    ...actual,
    getUnixTime: () => clock.now,
  };
});

function makeDocWithNote(): { doc: Y.Doc; id: string; text: () => string } {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 0, y: 0 });
  return {
    doc,
    id,
    text: () => getStickyText(doc, id)?.toString() ?? '',
  };
}

/** One LOCAL_ORIGIN insert per character, advancing the clock between them. */
function type(doc: Y.Doc, id: string, chars: string, gapMs: number): void {
  const t = getStickyText(doc, id)!;
  for (let i = 0; i < chars.length; i++) {
    doc.transact(() => {
      t.insert(t.length, chars[i]);
    }, LOCAL_ORIGIN);
    if (i < chars.length - 1) {
      clock.now += gapMs;
    }
  }
}

describe('undo.typing / undo.boundaries (TC-12, TC-13)', () => {
  it('TC-12: a burst of typing 100 ms apart is one undo step', () => {
    clock.now = T0;
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = createUndo(doc); // before the create: the create is a step
    const id = createSticky(doc, { x: 0, y: 0 });
    const text = (): string => getStickyText(doc, id)?.toString() ?? '';

    undo.boundary(); // after the create step
    type(doc, id, 'hello', 100); // 4 gaps × 100 ms = 400 ms
    undo.boundary(); // edit end

    expect(text()).toBe('hello');
    // One undo removes the whole burst…
    expect(undo.undo()).toBe(true);
    expect(text()).toBe('');
    // …and one more undoes the create step: exactly two steps total.
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)).toHaveLength(0);
    expect(undo.canUndo()).toBe(false);
    doc.destroy();
  });

  it('TC-13: exactly 500 ms apart is two steps; 499 ms apart is one step', () => {
    // --- exactly 500 ms: two separate steps ---
    clock.now = T0;
    const exact = makeDocWithNote();
    const undoExact = createUndo(exact.doc);
    undoExact.boundary();
    type(exact.doc, exact.id, 'a', 0);
    clock.now += 500;
    type(exact.doc, exact.id, 'b', 0);
    undoExact.boundary();
    expect(exact.text()).toBe('ab');
    expect(undoExact.undo()).toBe(true);
    expect(exact.text()).toBe('a'); // only the second step undone
    expect(undoExact.undo()).toBe(true);
    expect(exact.text()).toBe(''); // the first step
    exact.doc.destroy();

    // --- 499 ms: one merged step ---
    clock.now = T0;
    const near = makeDocWithNote();
    const undoNear = createUndo(near.doc);
    undoNear.boundary();
    type(near.doc, near.id, 'a', 0);
    clock.now += 499;
    type(near.doc, near.id, 'b', 0);
    undoNear.boundary();
    expect(near.text()).toBe('ab');
    expect(undoNear.undo()).toBe(true);
    expect(near.text()).toBe(''); // both characters in one step
    near.doc.destroy();
  });

  it('boundary() on an empty stack is a no-op', () => {
    clock.now = T0;
    const doc = new Y.Doc();
    const undo = createUndo(doc);
    expect(() => {
      undo.boundary();
      undo.boundary();
    }).not.toThrow();
    expect(undo.canUndo()).toBe(false);
    doc.destroy();
  });
});
