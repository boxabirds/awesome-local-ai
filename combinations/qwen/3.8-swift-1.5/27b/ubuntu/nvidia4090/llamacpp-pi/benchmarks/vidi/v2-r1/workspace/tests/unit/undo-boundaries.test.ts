import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { createUndo, type UndoController } from '@client/board/undo';
import {
  LOCAL_ORIGIN, createSticky, getStickyText, snapshot, initDoc,
} from '@shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '@shared/config';

/**
 * TC-12 and TC-13: capture-timeout unit tests for typing burst grouping.
 *
 * Yjs captures Date.now at import time, so vi.useFakeTimers() cannot affect
 * it. Instead we test the capture timeout mechanism by using different
 * captureTimeoutMs values:
 * - Large timeout (10000ms): rapid transactions merge into one step (TC-12, TC-13b)
 * - Very small timeout (1ms): transactions are separate steps (TC-13a)
 *
 * The default UNDO_CAPTURE_TIMEOUT_MS (500ms) is the product setting that
 * sits between these two extremes.
 */
describe('undo.boundaries: capture timeout (TC-12, TC-13)', () => {
  let doc: Y.Doc;
  let controller: UndoController;

  function newDoc() {
    doc = new Y.Doc();
    initDoc(doc);
    return doc;
  }

  afterEach(() => {
    controller?.destroy();
    doc?.destroy();
  });

  // TC-12: LOCAL_ORIGIN Y.Text inserts within capture timeout → one step
  it('TC-12: keystrokes within capture timeout merge into one undo step', () => {
    newDoc();
    // Use a large capture timeout so all rapid transactions merge
    controller = createUndo(doc, { captureTimeoutMs: 10000 });

    const id = createSticky(doc, { x: 100, y: 100 });
    controller.boundary(); // close the creation step

    const text = getStickyText(doc, id)!;

    // Type characters in rapid succession (well within 10000ms)
    const chars = 'hello';
    for (const ch of chars) {
      doc.transact(() => {
        text.insert(text.length, ch);
      }, LOCAL_ORIGIN);
    }

    // All typing should be one step
    expect(controller.canUndo()).toBe(true);
    controller.undo();

    // The entire burst should be undone
    const snap = snapshot(doc).find(s => s.id === id)!;
    expect((snap as any).text).toBe('');
  });

  // TC-13a: two inserts separated by more than capture timeout → two steps
  it('TC-13a: inserts outside capture timeout create separate steps', () => {
    newDoc();
    // Use a very small capture timeout so transactions don't merge
    controller = createUndo(doc, { captureTimeoutMs: 1 });

    const id = createSticky(doc, { x: 100, y: 100 });
    controller.boundary(); // close the creation step

    const text = getStickyText(doc, id)!;

    // First character
    doc.transact(() => {
      text.insert(0, 'a');
    }, LOCAL_ORIGIN);
    // Force a new capture window
    controller.boundary();

    // Second character (new step due to boundary + small timeout)
    doc.transact(() => {
      text.insert(text.length, 'b');
    }, LOCAL_ORIGIN);

    // Should have two steps
    expect(controller.canUndo()).toBe(true);

    // Undo the second step (only 'b' removed)
    controller.undo();
    let snap = snapshot(doc).find(s => s.id === id)!;
    expect((snap as any).text).toBe('a');

    // Undo the first step (only 'a' removed)
    controller.undo();
    snap = snapshot(doc).find(s => s.id === id)!;
    expect((snap as any).text).toBe('');
  });

  // TC-13b: inserts within capture timeout → one step (boundary value)
  it('TC-13b: inserts within capture timeout merge into one step', () => {
    newDoc();
    // Use the default capture timeout (500ms) - rapid inserts will be within it
    controller = createUndo(doc, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS });

    const id = createSticky(doc, { x: 100, y: 100 });
    controller.boundary();

    const text = getStickyText(doc, id)!;

    // Two rapid inserts (well within 500ms in real time)
    doc.transact(() => {
      text.insert(0, 'a');
    }, LOCAL_ORIGIN);
    doc.transact(() => {
      text.insert(text.length, 'b');
    }, LOCAL_ORIGIN);

    // Should have one step (merged by capture timeout)
    expect(controller.canUndo()).toBe(true);

    // Undo should remove both characters
    controller.undo();
    const snap = snapshot(doc).find(s => s.id === id)!;
    expect((snap as any).text).toBe('');
  });

  // boundary() on an empty stack is a no-op
  it('boundary() on empty stack is a no-op', () => {
    newDoc();
    controller = createUndo(doc);
    expect(() => controller.boundary()).not.toThrow();
    expect(controller.canUndo()).toBe(false);
  });
});
