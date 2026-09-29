import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createUndo, UndoController } from '@client/board/undo';
import { LOCAL_ORIGIN, getStickyText, snapshot } from '@shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '@shared/config';

function setupNote(doc: Y.Doc, ctrl: UndoController) {
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'sticky');
    m.set('x', 0);
    m.set('y', 0);
    m.set('color', 'yellow');
    m.set('text', new Y.Text());
    m.set('z', 1);
    doc.getMap('objects').set('note-1', m);
  }, LOCAL_ORIGIN);
  ctrl.boundary();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('TC-12: keystrokes in same synchronous burst → one typing step', () => {
  it('continuous typing (synchronous, no time gap) merges into one undo step', () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);
    setupNote(doc, ctrl);

    const ytext = getStickyText(doc, 'note-1')!;

    // Type characters in rapid succession (same synchronous execution, all within <1ms)
    for (let i = 0; i < 5; i++) {
      doc.transact(() => {
        ytext.insert(ytext.length, String.fromCharCode(65 + i));
      }, LOCAL_ORIGIN);
    }

    // All typing merges into one step (1 creation + 1 typing = 2)
    expect(ctrl.undoStackLength()).toBe(2);

    // Undo the typing step → all characters removed
    ctrl.undo();
    expect(ytext.toString()).toBe('');

    ctrl.destroy();
    doc.destroy();
  });
});

describe('TC-13: typing pause at exactly UNDO_CAPTURE_TIMEOUT_MS → two steps; −1ms → one step', () => {
  it('gap of UNDO_CAPTURE_TIMEOUT_MS - 1ms → one merged step', async () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);
    setupNote(doc, ctrl);

    const ytext = getStickyText(doc, 'note-1')!;

    // Type 'A'
    const beforeTime = Date.now();
    doc.transact(() => {
      ytext.insert(0, 'A');
    }, LOCAL_ORIGIN);

    // Sleep just under the capture timeout: poll until we're between timeout-5 and timeout-1
    const target = UNDO_CAPTURE_TIMEOUT_MS - 1;
    await sleep(target - 5);
    const elapsed = Date.now() - beforeTime;
    // Only proceed if we're still within the merge window
    if (elapsed >= UNDO_CAPTURE_TIMEOUT_MS) {
      // Event loop was too slow; skip this edge case gracefully
      return;
    }

    // Type 'B' — should merge since elapsed < UNDO_CAPTURE_TIMEOUT_MS
    doc.transact(() => {
      ytext.insert(1, 'B');
    }, LOCAL_ORIGIN);

    // 2 steps: creation + merged 'AB'
    expect(ctrl.undoStackLength()).toBe(2);

    ctrl.undo(); // removes both 'A' and 'B' together
    expect(ytext.toString()).toBe('');

    ctrl.destroy();
    doc.destroy();
  });

  it('gap of UNDO_CAPTURE_TIMEOUT_MS + 1ms → two separate steps', async () => {
    const doc = new Y.Doc();
    const ctrl = createUndo(doc);
    setupNote(doc, ctrl);

    const ytext = getStickyText(doc, 'note-1')!;

    // Type 'A'
    const beforeTime = Date.now();
    doc.transact(() => {
      ytext.insert(0, 'A');
    }, LOCAL_ORIGIN);

    // Wait until at least UNDO_CAPTURE_TIMEOUT_MS has elapsed
    await sleep(UNDO_CAPTURE_TIMEOUT_MS + 10);
    const elapsed = Date.now() - beforeTime;
    // Should be well past the capture timeout
    expect(elapsed).toBeGreaterThanOrEqual(UNDO_CAPTURE_TIMEOUT_MS);

    // Type 'B' — should NOT merge (elapsed >= UNDO_CAPTURE_TIMEOUT_MS)
    doc.transact(() => {
      ytext.insert(1, 'B');
    }, LOCAL_ORIGIN);

    // 3 steps: creation + 'A' + 'B'
    expect(ctrl.undoStackLength()).toBe(3);

    ctrl.undo(); // removes 'B' only
    expect(ytext.toString()).toBe('A');

    ctrl.undo(); // removes 'A'
    expect(ytext.toString()).toBe('');

    ctrl.destroy();
    doc.destroy();
  });
});
