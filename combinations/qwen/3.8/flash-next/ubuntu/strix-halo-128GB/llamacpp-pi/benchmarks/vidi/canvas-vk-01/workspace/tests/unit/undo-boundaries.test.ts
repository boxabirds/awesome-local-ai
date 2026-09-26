import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

import { LOCAL_ORIGIN, initDoc, createSticky, getStickyText } from '../../src/shared/board-model';
import { createUndo } from '../../src/client/board/undo';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';

describe('undo.boundaries', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
  });

  afterEach(() => {
    doc.destroy();
  });

  // TC-12: Keystrokes within capture timeout merge into one undo step
  it('TC-12: keystrokes within capture timeout merge into one step', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    const ytext = getStickyText(doc, id)!;

    // Use UNDO_CAPTURE_TIMEOUT_MS; synchronous inserts are always within the window
    const controller = createUndo(doc, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS });

    controller.boundary();

    // Type characters rapidly (all within the capture window since they're synchronous)
    doc.transact(() => ytext.insert(0, 'H'), LOCAL_ORIGIN);
    doc.transact(() => ytext.insert(1, 'e'), LOCAL_ORIGIN);
    doc.transact(() => ytext.insert(2, 'l'), LOCAL_ORIGIN);
    doc.transact(() => ytext.insert(3, 'l'), LOCAL_ORIGIN);
    doc.transact(() => ytext.insert(4, 'o'), LOCAL_ORIGIN);

    controller.boundary();

    // Should be exactly one undo step
    expect(controller.canUndo()).toBe(true);
    controller.undo();

    // All characters gone
    expect(ytext.toString()).toBe('');
    expect(controller.canUndo()).toBe(false);

    controller.destroy();
  });

  // TC-13a: Two inserts separated by more than capture timeout → two steps
  it('TC-13a: pause exceeding capture timeout creates two steps', async () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    const ytext = getStickyText(doc, id)!;

    // Use a short timeout for test speed; wait past it between inserts
    const controller = createUndo(doc, { captureTimeoutMs: 50 });

    controller.boundary();
    doc.transact(() => ytext.insert(0, 'A'), LOCAL_ORIGIN);
    await new Promise((r) => setTimeout(r, 100)); // definitely > 50ms
    doc.transact(() => ytext.insert(1, 'B'), LOCAL_ORIGIN);
    controller.boundary();

    // Should be two undo steps
    expect(controller.canUndo()).toBe(true);
    controller.undo();
    expect(ytext.toString()).toBe('A');

    expect(controller.canUndo()).toBe(true);
    controller.undo();
    expect(ytext.toString()).toBe('');
    expect(controller.canUndo()).toBe(false);

    controller.destroy();
  });

  // TC-13b: Inserts within capture timeout → one step
  it('TC-13b: inserts within capture timeout merge into one step', () => {
    const id = createSticky(doc, { x: 100, y: 100 });
    const ytext = getStickyText(doc, id)!;

    // 5000ms timeout — synchronous code always finishes within it
    const controller = createUndo(doc, { captureTimeoutMs: 5000 });

    controller.boundary();
    doc.transact(() => ytext.insert(0, 'A'), LOCAL_ORIGIN);
    doc.transact(() => ytext.insert(1, 'B'), LOCAL_ORIGIN);
    controller.boundary();

    // Should be one undo step
    expect(controller.canUndo()).toBe(true);
    controller.undo();
    expect(ytext.toString()).toBe('');
    expect(controller.canUndo()).toBe(false);

    controller.destroy();
  });

  // boundary() on an empty stack is a no-op
  it('boundary() on empty stack is a no-op', () => {
    const controller = createUndo(doc, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS });
    expect(() => controller.boundary()).not.toThrow();
    expect(controller.canUndo()).toBe(false);
    controller.destroy();
  });
});
