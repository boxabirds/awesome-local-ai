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

  /**
   * Anchor the manager's "last change" exactly `ms` before the clock reading
   * taken right now, so the next transaction sees an elapsed time of `ms` plus
   * the microseconds it takes to get there. Anchoring is required because
   * lib0/time holds the original `Date.now` reference (captured at module load),
   * so fake timers cannot move yjs's clock: subtracting from `lastChange` after
   * the first insert would let the real time between the two inserts leak into
   * the measured gap.
   */
  function anchorElapsed(ctrl: ReturnType<typeof createUndo>, ms: number) {
    ctrl._manager.lastChange = Date.now() - ms;
  }

  /**
   * Slack used for the "just inside the window" case. The gap is compared
   * against `UNDO_CAPTURE_TIMEOUT_MS` with millisecond precision, so an exact
   * `−1 ms` gap would split whenever the scheduler pauses for a millisecond
   * between two statements; 25 ms keeps the boundary meaningful and the test
   * stable under a loaded machine.
   */
  const INSIDE_WINDOW_SLACK_MS = 25;

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
    anchorElapsed(ctrl, UNDO_CAPTURE_TIMEOUT_MS);
    doc.transact(() => ytext.insert(1, 'b'), LOCAL_ORIGIN);
    ctrl.boundary();

    let steps = 0;
    while (ctrl.canUndo()) { ctrl.undo(); steps++; }
    expect(steps).toBe(2);

    ctrl.destroy();
  });

  it('TC-13b: a pause just inside UNDO_CAPTURE_TIMEOUT_MS → one step', () => {
    const ctrl = createUndo(doc);
    ctrl.boundary();

    doc.transact(() => ytext.insert(0, 'a'), LOCAL_ORIGIN);
    anchorElapsed(ctrl, UNDO_CAPTURE_TIMEOUT_MS - INSIDE_WINDOW_SLACK_MS);
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
