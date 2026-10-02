/**
 * Unit tests for undo.boundaries capture-timeout (TC-12, TC-13).
 * Uses direct UndoManager.lastChange manipulation since lib0/time captures
 * Date.now at module load time, which vi.mock cannot intercept from yjs.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { createUndo } from '../../src/client/board/undo';

describe('undo.boundaries (capture timeout)', () => {
  let doc: Y.Doc;
  let ytext: Y.Text;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    ytext = new Y.Text();
    doc.transact(() => {
      const m = new Y.Map<unknown>();
      m.set('type', 'sticky');
      m.set('x', 0);
      m.set('y', 0);
      m.set('text', ytext);
      m.set('z', 1);
      m.set('createdAt', 0);
      doc.getMap('objects').set('note-1', m);
    }, LOCAL_ORIGIN);
  });

  afterEach(() => {
    doc.destroy();
  });

  /** Backdate lastChange to simulate time having passed. */
  function simulateElapsed(ctrl: ReturnType<typeof createUndo>, ms: number) {
    ctrl._manager.lastChange -= ms;
  }

  it('TC-12: keystrokes 100ms apart between two boundaries → one undo step', () => {
    const ctrl = createUndo(doc);
    ctrl.boundary();

    for (const ch of 'hello') {
      doc.transact(() => ytext.insert(ytext.length, ch), LOCAL_ORIGIN);
      simulateElapsed(ctrl, 100);
    }

    ctrl.boundary();

    let steps = 0;
    while (ctrl.canUndo()) { ctrl.undo(); steps++; }
    expect(steps).toBe(1);
    expect(ytext.toString()).toBe('');

    ctrl.destroy();
  });

  it('TC-13: two inserts separated by exactly UNDO_CAPTURE_TIMEOUT_MS → two steps', () => {
    const ctrl = createUndo(doc);
    ctrl.boundary();

    doc.transact(() => ytext.insert(0, 'a'), LOCAL_ORIGIN);
    simulateElapsed(ctrl, UNDO_CAPTURE_TIMEOUT_MS);
    doc.transact(() => ytext.insert(1, 'b'), LOCAL_ORIGIN);
    ctrl.boundary();

    let steps = 0;
    while (ctrl.canUndo()) { ctrl.undo(); steps++; }
    expect(steps).toBe(2);

    ctrl.destroy();
  });

  it('TC-13b: two inserts separated by UNDO_CAPTURE_TIMEOUT_MS − 1ms → one step', () => {
    const ctrl = createUndo(doc);
    ctrl.boundary();

    doc.transact(() => ytext.insert(0, 'a'), LOCAL_ORIGIN);
    simulateElapsed(ctrl, UNDO_CAPTURE_TIMEOUT_MS - 1);
    doc.transact(() => ytext.insert(1, 'b'), LOCAL_ORIGIN);
    ctrl.boundary();

    let steps = 0;
    while (ctrl.canUndo()) { ctrl.undo(); steps++; }
    expect(steps).toBe(1);

    ctrl.destroy();
  });

  it('boundary() on an empty stack is a no-op', () => {
    const ctrl = createUndo(doc);
    expect(() => ctrl.boundary()).not.toThrow();
    expect(ctrl.canUndo()).toBe(false);
    ctrl.destroy();
  });
});
