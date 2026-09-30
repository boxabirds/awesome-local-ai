import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  createUndo,
} from '../../src/client/board/undo';
import {
  LOCAL_ORIGIN,
  createSticky as createStickyRaw,
  initDoc,
  snapshot,
} from '../../src/shared/board-model';

function createSticky(doc: Y.Doc, at: { x: number; y: number }, color?: Parameters<typeof createStickyRaw>[2]): string {
  const id = createStickyRaw(doc, at, color);
  if (!id) throw new Error('createSticky failed');
  return id;
}

/**
 * TC-12 and TC-13: capture-timeout unit tests for typing-burst grouping.
 *
 * Yjs captures `Date.now` at module load time (via lib0/time), so fake timers
 * don't affect the internal captureTimeout comparison. Instead, we use extreme
 * captureTimeoutMs values:
 *   - Very large (10_000 ms): all back-to-back changes merge into one step.
 *   - Zero (0 ms): any change creates a new step (no merging).
 * This proves the merge/split behavior without relying on wall-clock timing.
 */
describe('undo.boundaries: capture timeout (TC-12, TC-13)', () => {
  let doc: Y.Doc;

  afterEach(() => {
    doc.destroy();
  });

  // TC-12: keystrokes within capture timeout → one step
  it('TC-12: keystrokes within capture timeout merge into one step', () => {
    doc = new Y.Doc();
    initDoc(doc);
    const controller = createUndo(doc, { captureTimeoutMs: 10_000 });

    const id = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();

    const text = (doc.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text;

    // Simulate typing: 3 keystrokes back-to-back (well within 10s timeout)
    doc.transact(() => { text.insert(0, 'h'); }, LOCAL_ORIGIN);
    doc.transact(() => { text.insert(1, 'e'); }, LOCAL_ORIGIN);
    doc.transact(() => { text.insert(2, 'l'); }, LOCAL_ORIGIN);

    // All three keystrokes should be one undo step
    expect(controller.canUndo()).toBe(true);
    controller.undo();

    // The entire burst should be undone
    const snap = snapshot(doc);
    const note = snap.find((n) => n.id === id)!;
    expect(note.text).toBe('');

    // Only one step was undone (the burst), not three
    expect(controller.canRedo()).toBe(true);
    controller.redo();
    const snap2 = snapshot(doc);
    const note2 = snap2.find((n) => n.id === id)!;
    expect(note2.text).toBe('hel');

    controller.destroy();
  });

  // TC-13: pause >= captureTimeout → two steps
  it('TC-13: changes separated by more than captureTimeout create separate steps', () => {
    doc = new Y.Doc();
    initDoc(doc);
    // Zero timeout: no merging, every transaction is a new step
    const controller = createUndo(doc, { captureTimeoutMs: 0 });

    const id = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();

    const text = (doc.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text;

    // First keystroke
    doc.transact(() => { text.insert(0, 'a'); }, LOCAL_ORIGIN);

    // Second keystroke (new step because captureTimeout is 0)
    doc.transact(() => { text.insert(1, 'b'); }, LOCAL_ORIGIN);

    // Should be two steps
    expect(controller.canUndo()).toBe(true);
    controller.undo();

    // Undo the second step ('b' is removed)
    const snap1 = snapshot(doc);
    const note1 = snap1.find((n) => n.id === id)!;
    expect(note1.text).toBe('a');

    // Undo the first step ('a' is removed)
    expect(controller.canUndo()).toBe(true);
    controller.undo();
    const snap2 = snapshot(doc);
    const note2 = snap2.find((n) => n.id === id)!;
    expect(note2.text).toBe('');

    controller.destroy();
  });

  // TC-13b: boundary() explicitly separates steps even within the timeout
  it('TC-13b: boundary() separates steps within the capture window', () => {
    doc = new Y.Doc();
    initDoc(doc);
    // Large timeout: changes would normally merge
    const controller = createUndo(doc, { captureTimeoutMs: 10_000 });

    const id = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();

    const text = (doc.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text;

    // First keystroke
    doc.transact(() => { text.insert(0, 'a'); }, LOCAL_ORIGIN);

    // Explicitly close the capture window
    controller.boundary();

    // Second keystroke (new step because boundary() was called)
    doc.transact(() => { text.insert(1, 'b'); }, LOCAL_ORIGIN);

    // Should be two steps (boundary separated them)
    expect(controller.canUndo()).toBe(true);
    controller.undo();

    const snap1 = snapshot(doc);
    const note1 = snap1.find((n) => n.id === id)!;
    expect(note1.text).toBe('a');

    expect(controller.canUndo()).toBe(true);
    controller.undo();
    const snap2 = snapshot(doc);
    const note2 = snap2.find((n) => n.id === id)!;
    expect(note2.text).toBe('');

    controller.destroy();
  });

  // boundary() on an empty stack is a no-op
  it('boundary() on empty stack is a no-op', () => {
    doc = new Y.Doc();
    initDoc(doc);
    const controller = createUndo(doc);
    expect(() => controller.boundary()).not.toThrow();
    expect(controller.canUndo()).toBe(false);
    controller.destroy();
  });
});
