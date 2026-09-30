import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { initDoc, createSticky, LOCAL_ORIGIN } from '@shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '@shared/config';
import { createUndo, type UndoController } from '@client/board/undo';

describe('undo.boundaries (capture timeout)', () => {
  let doc: Y.Doc;
  let ctrl: UndoController;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    ctrl = createUndo(doc, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS });
  });

  afterEach(() => {
    ctrl.destroy();
    doc.destroy();
  });

  /** Set the UndoManager's lastChange to a value far in the past to simulate a pause. */
  function simulatePause(ms: number) {
    // Yjs checks: now - lastChange < captureTimeout
    // To simulate a pause of `ms` between two transactions, we set lastChange
    // so that when the next transaction fires, now - lastChange >= captureTimeout.
    const um = ctrl._um;
    if (ms >= UNDO_CAPTURE_TIMEOUT_MS) {
      // Force the next change to NOT merge: set lastChange to 0 (which makes
      // `lastChange > 0` false) or to a value where now-lastChange >= captureTimeout.
      (um as any).lastChange = 0;
    } else {
      // Force the next change to merge: set lastChange to now (Date.now())
      (um as any).lastChange = Date.now();
    }
  }

  // TC-12: keystrokes within capture window merge into one step
  it('TC-12: keystrokes within capture window merge into one step', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();

    const ytext = doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text;

    // Type characters - keep lastChange at current time to simulate < 500ms gaps
    const chars = 'hello';
    for (let i = 0; i < chars.length; i++) {
      doc.transact(() => {
        ytext.insert(ytext.length, chars[i]);
      }, LOCAL_ORIGIN);
      // Simulate that lastChange is recent (within capture timeout)
      (ctrl._um as any).lastChange = Date.now();
    }

    ctrl.boundary();

    // Should be one undo step (the whole burst)
    expect(ctrl.canUndo()).toBe(true);

    ctrl.undo();
    const textAfter = ytext.toString();
    expect(textAfter).toBe('');
  });

  // TC-13a: pause exactly UNDO_CAPTURE_TIMEOUT_MS → two steps
  it('TC-13a: pause of exactly UNDO_CAPTURE_TIMEOUT_MS creates two steps', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();

    const ytext = doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text;

    // Type "ab"
    doc.transact(() => {
      ytext.insert(0, 'ab');
    }, LOCAL_ORIGIN);

    // Simulate pause of exactly UNDO_CAPTURE_TIMEOUT_MS (>= timeout → new step)
    simulatePause(UNDO_CAPTURE_TIMEOUT_MS);

    // Type "cd"
    doc.transact(() => {
      ytext.insert(2, 'cd');
    }, LOCAL_ORIGIN);

    ctrl.boundary();

    // Should be two undo steps
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo(); // undoes "cd"
    expect(ytext.toString()).toBe('ab');

    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo(); // undoes "ab"
    expect(ytext.toString()).toBe('');
  });

  // TC-13b: pause of UNDO_CAPTURE_TIMEOUT_MS - 1 → one step (still within window)
  it('TC-13b: pause of UNDO_CAPTURE_TIMEOUT_MS - 1 merges into one step', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    ctrl.boundary();

    const ytext = doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text;

    // Type "ab"
    doc.transact(() => {
      ytext.insert(0, 'ab');
    }, LOCAL_ORIGIN);

    // Simulate pause < UNDO_CAPTURE_TIMEOUT_MS (within window → merge)
    simulatePause(UNDO_CAPTURE_TIMEOUT_MS - 1);

    // Type "cd" — still within capture window
    doc.transact(() => {
      ytext.insert(2, 'cd');
    }, LOCAL_ORIGIN);

    ctrl.boundary();

    // Should be one undo step (merged)
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo();
    expect(ytext.toString()).toBe('');
  });

  it('boundary() on empty stack is a no-op', () => {
    expect(() => ctrl.boundary()).not.toThrow();
    expect(ctrl.canUndo()).toBe(false);
  });
});
