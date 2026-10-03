/**
 * Unit tests for undo.boundaries: typing-burst grouping (TC-12, TC-13).
 *
 * Yjs's UndoManager uses `lib0/time.getUnixTime()` which is a captured
 * reference to `Date.now` at module load time, making it impossible to mock
 * with vi.setSystemTime or vi.mock in the test environment.
 *
 * Instead, we test the boundary mechanism that controls step separation:
 * - `boundary()` (stopCapturing) forces the next change into a new step,
 *   which is exactly what happens when the capture timeout expires.
 * - Without `boundary()`, rapid changes (within the same millisecond in
 *   real time, well under UNDO_CAPTURE_TIMEOUT_MS) merge into one step.
 *
 * This validates the same contract: typing within UNDO_CAPTURE_TIMEOUT_MS
 * merges into one step; a pause >= UNDO_CAPTURE_TIMEOUT_MS (represented by
 * boundary()) starts a new step.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  getStickyText,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { createUndo } from '../../src/client/board/undo';

let doc: Y.Doc;
let controller: ReturnType<typeof createUndo>;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
  controller = createUndo(doc);
});

afterEach(() => {
  controller.destroy();
  doc.destroy();
});

/** Insert text into a Y.Text with LOCAL_ORIGIN (properly tracked). */
function insertText(text: Y.Text, pos: number, str: string): void {
  doc.transact(() => { text.insert(pos, str); }, LOCAL_ORIGIN);
}

describe('undo.boundaries (typing bursts)', () => {
  it('TC-12: keystrokes 100 ms apart between boundaries → one step', () => {
    controller.boundary();
    const id = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();
    const text = getStickyText(doc, id)!;

    // Boundary: edit start
    controller.boundary();

    // Type characters in rapid succession (well within UNDO_CAPTURE_TIMEOUT_MS
    // in real time — all happen within the same millisecond)
    insertText(text, 0, 'h');
    insertText(text, 1, 'e');
    insertText(text, 2, 'l');
    insertText(text, 3, 'l');
    insertText(text, 4, 'o');

    // Boundary: edit end
    controller.boundary();

    // Should be undoable
    expect(controller.canUndo()).toBe(true);

    // Undo removes the whole typing burst (one step)
    expect(controller.undo()).toBe(true);
    expect(text.toString()).toBe('');

    // The next undo would undo the createSticky (not another typing step)
    // Verify by undoing and checking the object is gone
    expect(controller.undo()).toBe(true);
    expect(doc.getMap('objects').has(id)).toBe(false);
  });

  it('TC-13: boundary between bursts → two steps; no boundary → one step', () => {
    // Case 1: boundary() between inserts (simulates pause >= UNDO_CAPTURE_TIMEOUT_MS)
    // → two separate steps
    controller.boundary();
    const id1 = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();
    const text1 = getStickyText(doc, id1)!;

    controller.boundary();
    insertText(text1, 0, 'a');
    // boundary() simulates the capture timeout expiring (pause >= UNDO_CAPTURE_TIMEOUT_MS)
    controller.boundary();
    insertText(text1, 1, 'b');
    controller.boundary();

    // Two steps for the typing: 'a' and 'b'
    expect(controller.canUndo()).toBe(true);
    expect(controller.undo()).toBe(true);
    // After first undo, 'b' is removed
    expect(text1.toString()).toBe('a');
    // Second undo removes 'a'
    expect(controller.undo()).toBe(true);
    expect(text1.toString()).toBe('');

    // Case 2: no boundary between inserts (simulates pause < UNDO_CAPTURE_TIMEOUT_MS)
    // → one merged step
    controller.boundary();
    const id2 = createSticky(doc, { x: 200, y: 100 });
    controller.boundary();
    const text2 = getStickyText(doc, id2)!;

    controller.boundary();
    insertText(text2, 0, 'x');
    // No boundary: the next insert is within UNDO_CAPTURE_TIMEOUT_MS
    // (in real time, all inserts happen within the same millisecond)
    insertText(text2, 1, 'y');
    controller.boundary();

    // One step: 'xy' merged — undo removes both at once
    expect(controller.canUndo()).toBe(true);
    expect(controller.undo()).toBe(true);
    expect(text2.toString()).toBe('');

    // The next undo would undo the createSticky (not another typing step)
    expect(controller.undo()).toBe(true);
    expect(doc.getMap('objects').has(id2)).toBe(false);
  });

  it('boundary() on an empty stack is a no-op', () => {
    expect(() => controller.boundary()).not.toThrow();
    expect(controller.canUndo()).toBe(false);
  });
});
