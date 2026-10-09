import { describe, expect, test, vi } from 'vitest';
import * as Y from 'yjs';
import { createUndo } from '../../src/client/board/undo';
import { getStickyText, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { makeSticky } from '../fixtures/stickies';

// The UndoManager's merge window reads lib0/time's getUnixTime (which binds
// Date.now at import time, so fake timers do not reach it). Driving the module
// directly gives exact control over the boundary values.
const clock = vi.hoisted(() => ({ now: 1_000_000_000_000 }));
vi.mock('lib0/time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lib0/time')>();
  return { ...actual, getUnixTime: () => clock.now };
});

function insertChar(doc: Y.Doc, ytext: Y.Text, index: number, ch: string): void {
  doc.transact(() => ytext.insert(index, ch), LOCAL_ORIGIN);
}

describe('undo.boundaries (capture timeout)', () => {
  test('TC-12 inserts between two boundary() calls form one undo step', () => {
    const doc = new Y.Doc();
    const id = makeSticky(doc, 0, 0);
    const ytext = getStickyText(doc, id);
    if (ytext === undefined) throw new Error('text missing');
    const controller = createUndo(doc);

    // Error path: boundary() on an empty stack is a no-op.
    expect(() => controller.boundary()).not.toThrow();

    controller.boundary();
    insertChar(doc, ytext, 0, 'h');
    for (const [i, ch] of [...'ello'].entries()) {
      clock.now += 100;
      insertChar(doc, ytext, i + 1, ch);
    }
    controller.boundary();

    expect(controller.canRedo()).toBe(false);
    expect(controller.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
    // The whole burst was one step: nothing left to undo.
    expect(controller.canUndo()).toBe(false);
    controller.destroy();
  });

  test('TC-13 exactly UNDO_CAPTURE_TIMEOUT_MS apart splits, one ms less merges', () => {
    const doc = new Y.Doc();
    const id = makeSticky(doc, 0, 0);
    const ytext = getStickyText(doc, id);
    if (ytext === undefined) throw new Error('text missing');

    const merged = createUndo(doc);
    merged.boundary();
    insertChar(doc, ytext, 0, 'a');
    clock.now += UNDO_CAPTURE_TIMEOUT_MS - 1;
    insertChar(doc, ytext, 1, 'b');
    merged.boundary();
    expect(merged.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
    expect(merged.canUndo()).toBe(false); // one step
    merged.destroy();

    const split = createUndo(doc);
    split.boundary();
    insertChar(doc, ytext, 0, 'a');
    clock.now += UNDO_CAPTURE_TIMEOUT_MS;
    insertChar(doc, ytext, 1, 'b');
    split.boundary();
    expect(split.undo()).toBe(true);
    expect(ytext.toString()).toBe('a');
    expect(split.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
    expect(split.canUndo()).toBe(false); // two steps
    split.destroy();
  });
});
