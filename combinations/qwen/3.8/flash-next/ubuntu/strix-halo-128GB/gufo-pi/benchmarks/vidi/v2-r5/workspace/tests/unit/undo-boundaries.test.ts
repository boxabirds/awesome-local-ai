import { describe, expect, it, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  initDoc,
  LOCAL_ORIGIN,
  createSticky,
  getStickyText,
} from '../../src/shared/board-model';
import { createUndo, type UndoController } from '../../src/client/board/undo';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('undo.boundaries (capture timeout)', () => {
  let doc: Y.Doc;
  let ctrl: UndoController;

  afterEach(() => {
    ctrl?.destroy();
    doc?.destroy();
  });

  // TC-12: keystrokes within capture timeout → one step
  it('TC-12: typing within capture timeout is one undo step', async () => {
    const captureMs = 80;
    doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    ctrl = createUndo(doc, { captureTimeoutMs: captureMs });

    const text = getStickyText(doc, id)!;

    // Type characters 15ms apart (all well within 80ms capture window)
    const chars = ['h', 'e', 'l', 'l', 'o'];
    for (const ch of chars) {
      doc.transact(() => text.insert(text.length, ch), LOCAL_ORIGIN);
      await delay(15);
    }

    ctrl.boundary();

    // Should be exactly one undo step for typing
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo();
    expect(text.toString()).toBe('');
    expect(ctrl.canUndo()).toBe(false);
  });

  // TC-13: pause >= capture timeout → two steps
  it('TC-13: pause at or above capture timeout creates two steps', async () => {
    const captureMs = 80;
    doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    ctrl = createUndo(doc, { captureTimeoutMs: captureMs });

    const text = getStickyText(doc, id)!;

    // Type first character
    doc.transact(() => text.insert(text.length, 'a'), LOCAL_ORIGIN);

    // Wait longer than capture timeout
    await delay(captureMs + 20);

    // Type second character
    doc.transact(() => text.insert(text.length, 'b'), LOCAL_ORIGIN);

    ctrl.boundary();

    // Should be two undo steps
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo();
    expect(text.toString()).toBe('a');
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo();
    expect(text.toString()).toBe('');
    expect(ctrl.canUndo()).toBe(false);
  });

  it('TC-13b: pause below capture timeout stays as one step', async () => {
    const captureMs = 200;
    doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    ctrl = createUndo(doc, { captureTimeoutMs: captureMs });

    const text = getStickyText(doc, id)!;

    // Type first character
    doc.transact(() => text.insert(text.length, 'a'), LOCAL_ORIGIN);

    // Wait less than capture timeout
    await delay(captureMs - 50);

    // Type second character
    doc.transact(() => text.insert(text.length, 'b'), LOCAL_ORIGIN);

    ctrl.boundary();

    // Should be one undo step (merged)
    expect(ctrl.canUndo()).toBe(true);
    ctrl.undo();
    expect(text.toString()).toBe('');
    expect(ctrl.canUndo()).toBe(false);
  });

  it('boundary on empty stack is a no-op', () => {
    doc = new Y.Doc();
    initDoc(doc);
    ctrl = createUndo(doc);
    // Should not throw
    expect(() => ctrl.boundary()).not.toThrow();
    expect(ctrl.canUndo()).toBe(false);
  });
});
