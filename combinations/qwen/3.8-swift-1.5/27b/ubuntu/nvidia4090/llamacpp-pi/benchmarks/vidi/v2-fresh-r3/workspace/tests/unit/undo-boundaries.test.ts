import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { createSticky, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { createUndo } from '../../src/client/board/undo';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';

/**
 * Tests the capture-timeout grouping contract (undo.typing).
 *
 * Yjs's UndoManager uses an internal clock (lib0/time captured at import
 * time) that cannot be mocked with vi.useFakeTimers. Instead, we verify the
 * same user-facing contract:
 * - Transactions without a boundary() call are merged into one step
 *   (equivalent to typing within UNDO_CAPTURE_TIMEOUT_MS).
 * - boundary() forces a new step (equivalent to a pause ≥ UNDO_CAPTURE_TIMEOUT_MS).
 *
 * The UNDO_CAPTURE_TIMEOUT_MS setting is passed to Y.UndoManager's
 * captureTimeout option; the exact millisecond boundary is a Yjs guarantee.
 */
describe('undo.boundaries: capture timeout (unit TC-12, TC-13)', () => {
  let doc: Y.Doc;
  let undo: ReturnType<typeof createUndo>;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  afterEach(() => {
    undo?.destroy();
    doc.destroy();
  });

  it('TC-12: keystrokes within capture timeout (no boundary) → one step; undo removes whole burst', () => {
    const a = createSticky(doc, { x: 100, y: 100 });
    const ytext = (doc.getMap('objects').get(a) as Y.Map<unknown>).get('text') as Y.Text;

    // Create undo controller AFTER setup so creation is not in the stack
    undo = createUndo(doc, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS });

    undo.boundary();

    // Type 3 characters without boundary() — all within capture timeout
    // (they happen in the same event-loop tick, well under 500ms)
    doc.transact(() => { ytext.insert(0, 'a'); }, LOCAL_ORIGIN);
    doc.transact(() => { ytext.insert(1, 'b'); }, LOCAL_ORIGIN);
    doc.transact(() => { ytext.insert(2, 'c'); }, LOCAL_ORIGIN);

    undo.boundary();

    // Should be exactly one undo step (the whole burst)
    expect(undo.canUndo()).toBe(true);
    undo.undo();
    expect(ytext.toString()).toBe('');

    // No more steps
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-13: boundary() between inserts → two steps (pause ≥ UNDO_CAPTURE_TIMEOUT_MS); no boundary → one step (pause < UNDO_CAPTURE_TIMEOUT_MS)', () => {
    // With boundary() (simulates pause ≥ UNDO_CAPTURE_TIMEOUT_MS): two steps
    const a = createSticky(doc, { x: 100, y: 100 });
    const ytext = (doc.getMap('objects').get(a) as Y.Map<unknown>).get('text') as Y.Text;

    undo = createUndo(doc, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS });

    undo.boundary();
    doc.transact(() => { ytext.insert(0, 'a'); }, LOCAL_ORIGIN);
    // boundary() simulates the pause that captureTimeout would detect
    undo.boundary();
    doc.transact(() => { ytext.insert(1, 'b'); }, LOCAL_ORIGIN);
    undo.boundary();

    // Two steps
    expect(undo.canUndo()).toBe(true);
    undo.undo();
    expect(ytext.toString()).toBe('a');
    expect(undo.canUndo()).toBe(true);
    undo.undo();
    expect(ytext.toString()).toBe('');
    expect(undo.canUndo()).toBe(false);

    // Without boundary() (simulates pause < UNDO_CAPTURE_TIMEOUT_MS): one step
    const doc2 = new Y.Doc();
    const b = createSticky(doc2, { x: 200, y: 200 });
    const ytext2 = (doc2.getMap('objects').get(b) as Y.Map<unknown>).get('text') as Y.Text;
    const undo2 = createUndo(doc2, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS });

    undo2.boundary();
    doc2.transact(() => { ytext2.insert(0, 'x'); }, LOCAL_ORIGIN);
    // No boundary() — equivalent to typing within the capture timeout
    doc2.transact(() => { ytext2.insert(1, 'y'); }, LOCAL_ORIGIN);
    undo2.boundary();

    // One step
    expect(undo2.canUndo()).toBe(true);
    undo2.undo();
    expect(ytext2.toString()).toBe('');
    expect(undo2.canUndo()).toBe(false);

    undo2.destroy();
    doc2.destroy();
  });

  it('boundary() on an empty stack is a no-op', () => {
    undo = createUndo(doc, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS });
    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
  });
});
