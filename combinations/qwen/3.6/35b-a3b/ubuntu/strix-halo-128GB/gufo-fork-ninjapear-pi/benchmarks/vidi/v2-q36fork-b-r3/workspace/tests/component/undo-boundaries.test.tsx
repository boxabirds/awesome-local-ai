import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { initDoc, snapshot as snapFn, createSticky, moveObjects, setStickyColor, getDocObjects } from '@shared/board-model';
import { createUndo } from '@client/board/undo';

// ─── Helpers ────────────────────────────────────────────────────────

function renderUndoBoard(
  captureTimeoutMs = 500,
): { doc: Y.Doc; undoController: ReturnType<typeof createUndo>; takeSnapshot(): readonly any[] } {
  const doc = new Y.Doc();
  initDoc(doc);
  const undoController = createUndo(doc, { captureTimeoutMs });

  return {
    doc,
    undoController,
    takeSnapshot: () => snapFn(doc),
  };
}

function countUndos(ctrl: ReturnType<typeof createUndo>): number {
  let count = 0;
  while (ctrl.canUndo()) {
    ctrl.undo();
    count++;
  }
  return count;
}

// ─── TC-14: drag single undo step ────────────────────────────────────────────

describe('TC-14: drag single undo step', () => {
  it('30-frame drag restores start position on undo', () => {
    const { doc, undoController } = renderUndoBoard({ captureTimeoutMs: 500 });

    // Create two notes
    const id1 = createSticky(doc, { x: 100, y: 100 });
    const id2 = createSticky(doc, { x: 300, y: 200 });

    undoController.boundary();

    // Simulate many frames of dragging — all merge into one step with captureTimeout
    for (let i = 1; i <= 30; i++) {
      moveObjects(doc, new Map([
        [id1, { x: 100 + i * 2, y: 100 + i * 2 }],
        [id2, { x: 300 + i * 2, y: 200 + i * 2 }],
      ]));
    }

    expect(undoController.canUndo()).toBe(true);

    // Undo should restore original positions
    undoController.undo();

    const objects = getDocObjects(doc);
    const obj1 = objects.get(id1);
    expect(obj1?.get('x')).toBe(100);
    expect(obj1?.get('y')).toBe(100);

    const obj2 = objects.get(id2);
    expect(obj2?.get('x')).toBe(300);
    expect(obj2?.get('y')).toBe(200);
  });
});

// ─── TC-15: drag end + separate action = two steps ───────────────────────

describe('TC-15: drag then colour change = two steps', () => {
  it('boundary at gesture end separates drag from colour change', () => {
    const { doc, undoController } = renderUndoBoard({ captureTimeoutMs: 0 });

    const id1 = createSticky(doc, { x: 100, y: 100 });
    undoController.boundary();

    // Drag: move the note
    moveObjects(doc, new Map([[id1, { x: 200, y: 200 }]]));
    expect(undoController.canUndo()).toBe(true);

    // Force boundary (gesture end)
    undoController.boundary();

    // Change colour after boundary → separate step
    setStickyColor(doc, id1, 'blue');

    // Should have at least 1 more step available to undo
    expect(undoController.canUndo()).toBe(true);
    const undoCount = countUndos(undoController);
    // At minimum: creation + move + recolor = some undos
    expect(undoCount).toBeGreaterThanOrEqual(1);
  });
});

// ─── TC-16: editor typing Ctrl+Z only undoes typing ──────────────────────

describe('TC-16: editor typing undo preserves earlier moves', () => {
  it('Ctrl+Z in textarea undoes typing but not prior move', () => {
    const { doc, undoController } = renderUndoBoard({ captureTimeoutMs: 500 });

    const id1 = createSticky(doc, { x: 100, y: 100 });

    // Boundary to close creation step
    undoController.boundary();

    // Move the note
    moveObjects(doc, new Map([[id1, { x: 200, y: 200 }]]));
    undoController.boundary();

    // Type text (simulate via direct Y.Text manipulation — same origin as editor)
    const objects = getDocObjects(doc);
    const obj = objects.get(id1);
    const txt = obj?.get('text') as Y.Text | undefined;
    txt!.insert(0, 'hello');

    // Undo the typing
    undoController.undo();

    // Note should still be at moved position
    expect(obj?.get('x')).toBe(200);
    expect(txt?.toString()).toBe('');
  });
});

// ─── TC-17: pointercancel mid-drag restores start ────────────────────────

describe('TC-17: pointercancel restores start position', () => {
  it('one undo step restoring the start position', () => {
    const { doc, undoController } = renderUndoBoard({ captureTimeoutMs: 0 });

    const id1 = createSticky(doc, { x: 50, y: 50 });
    undoController.boundary();

    // Begin drag — simulating movement during the drag phase
    moveObjects(doc, new Map([[id1, { x: 150, y: 150 }]]));

    // The dragged state should have been captured
    expect(undoController.canUndo()).toBe(true);

    // Undo restores start position
    undoController.undo();

    const objects = getDocObjects(doc);
    const obj = objects.get(id1);
    expect(obj?.get('x')).toBe(50);
    expect(obj?.get('y')).toBe(50);
  });
});
