/**
 * Unit tests TC-12 and TC-13: undo.boundaries (capture timeout / typing bursts)
 *
 * Yjs captures `Date.now` at module load time. We use `vi.hoisted` to set up
 * fake timers before any module evaluation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fake timers must be active before Yjs captures Date.now
vi.hoisted(() => { vi.useFakeTimers(); });

import * as Y from 'yjs';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { LOCAL_ORIGIN, initDoc } from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';

describe('undo.boundaries (capture timeout)', () => {
  let doc: Y.Doc;
  let ctrl: UndoController;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  afterEach(() => {
    ctrl?.destroy();
    doc.destroy();
  });

  function makeTextNote(d: Y.Doc, id: string): Y.Text {
    const objects = d.getMap('objects');
    const entry = new Y.Map<unknown>();
    const ytext = new Y.Text();
    entry.set('type', 'sticky');
    entry.set('x', 0);
    entry.set('y', 0);
    entry.set('color', 'yellow');
    entry.set('z', 1);
    entry.set('text', ytext);
    entry.set('createdAt', 0);
    d.transact(() => { objects.set(id, entry); }, LOCAL_ORIGIN);
    return ytext;
  }

  // TC-12: keystrokes 100ms apart between two boundary() calls → one step
  it('TC-12: keystrokes 100ms apart within a boundary → one step', () => {
    ctrl = createUndo(doc, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS });

    const ytext = makeTextNote(doc, 'note1');
    ctrl.destroy();
    ctrl = createUndo(doc, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS });

    // Start editing
    ctrl.boundary();

    // Type characters 100ms apart (all within UNDO_CAPTURE_TIMEOUT_MS of each other)
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(100);
      doc.transact(() => {
        ytext.insert(ytext.length, 'x');
      }, LOCAL_ORIGIN);
    }

    ctrl.boundary();

    expect(ytext.toString()).toBe('xxxxx');
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo();
    expect(ytext.toString()).toBe('');
  });

  // TC-13: two inserts separated by >= UNDO_CAPTURE_TIMEOUT_MS → two steps;
  //        separated by < UNDO_CAPTURE_TIMEOUT_MS → one step
  it('TC-13: pause >= timeout → two steps; pause < timeout → one step', () => {
    ctrl = createUndo(doc, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS });

    const ytext = makeTextNote(doc, 'note1');
    ctrl.destroy();
    ctrl = createUndo(doc, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS });

    ctrl.boundary();

    // First insert
    doc.transact(() => { ytext.insert(0, 'a'); }, LOCAL_ORIGIN);

    // Advance past UNDO_CAPTURE_TIMEOUT_MS → NOT captured together
    vi.advanceTimersByTime(UNDO_CAPTURE_TIMEOUT_MS + 1);

    // Second insert
    doc.transact(() => { ytext.insert(1, 'b'); }, LOCAL_ORIGIN);

    ctrl.boundary();

    expect(ytext.toString()).toBe('ab');

    // Two steps: undo first removes 'b', undo second removes 'a'
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo();
    expect(ytext.toString()).toBe('a');
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo();
    expect(ytext.toString()).toBe('');

    ctrl.destroy();

    // Test 2: UNDO_CAPTURE_TIMEOUT_MS - 1 apart → one step (merged)
    const doc2 = new Y.Doc();
    initDoc(doc2);
    const ytext2 = makeTextNote(doc2, 'note1');

    const ctrl2 = createUndo(doc2, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS });
    ctrl2.boundary();

    // First insert
    doc2.transact(() => { ytext2.insert(0, 'c'); }, LOCAL_ORIGIN);

    // Advance UNDO_CAPTURE_TIMEOUT_MS - 1 → should capture together
    vi.advanceTimersByTime(UNDO_CAPTURE_TIMEOUT_MS - 1);

    // Second insert
    doc2.transact(() => { ytext2.insert(1, 'd'); }, LOCAL_ORIGIN);

    ctrl2.boundary();

    expect(ytext2.toString()).toBe('cd');

    // One step: undo removes both characters
    ctrl2.undo();
    expect(ytext2.toString()).toBe('');

    ctrl2.destroy();
    doc2.destroy();
  });

  // boundary() on empty stack is a no-op
  it('boundary() on empty stack is a no-op', () => {
    ctrl = createUndo(doc, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS });
    expect(() => ctrl.boundary()).not.toThrow();
    expect(ctrl.canUndo()).toBe(false);
  });
});
