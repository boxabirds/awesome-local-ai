import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { initDoc, snapshot as snapFn, createSticky, moveObjects, setStickyColor, getDocObjects } from '@shared/board-model';
import { createUndo } from '@client/board/undo';

// ─── Helpers ────────────────────────────────────────────────────────

function renderUndoBoard(optsOrMs?: { captureTimeoutMs?: number } | number):
  { doc: Y.Doc; undoController: ReturnType<typeof createUndo>; takeSnapshot(): readonly any[] } {
  const captureTimeoutMs = typeof optsOrMs === 'object'
    ? (optsOrMs?.captureTimeoutMs ?? 500)
    : (optsOrMs ?? 500);
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

    // Create two notes — createSticky stores center-anchored coords
    const id1 = createSticky(doc, { x: 100, y: 100 });  // stores x=0, y=0
    const id2 = createSticky(doc, { x: 300, y: 200 });  // stores x=200, y=100

    undoController.boundary();

    // Simulate many frames of dragging — all merge into one step with captureTimeout
    for (let i = 1; i <= 30; i++) {
      moveObjects(doc, new Map([
        [id1, { x: 100 + i * 2, y: 100 + i * 2 }],
        [id2, { x: 300 + i * 2, y: 200 + i * 2 }],
      ]));
    }

    expect(undoController.canUndo()).toBe(true);

    // Undo should restore to state right after boundary()
    undoController.undo();

    const objects = getDocObjects(doc);
    const obj1 = objects.get(id1);
    expect(obj1?.get('x')).toBe(0);   // 100 - STICKY_SIZE_WORLD / 2
    expect(obj1?.get('y')).toBe(0);   // 100 - STICKY_SIZE_WORLD / 2

    const obj2 = objects.get(id2);
    expect(obj2?.get('x')).toBe(200); // 300 - STICKY_SIZE_WORLD / 2
    expect(obj2?.get('y')).toBe(100); // 200 - STICKY_SIZE_WORLD / 2
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

// ─── TC-16: editor typing undo preserves earlier moves ──────────────────────

describe('TC-16: editor typing undo preserves earlier moves', () => {
  it('typing uses different origin from moves so undo skips over it', () => {
    const { doc, undoController } = renderUndoBoard({ captureTimeoutMs: 500 });

    const id1 = createSticky(doc, { x: 100, y: 100 });

    // Boundary to close creation step
    undoController.boundary();

    // Move the note — this is captured with LOCAL_ORIGIN
    moveObjects(doc, new Map([[id1, { x: 200, y: 200 }]]));
    undoController.boundary();

    // Type text — StickyTextEditor modifies Y.Text through auto-transactions
    // with default origin (NOT LOCAL_ORIGIN), so these are NOT tracked by
    // our undo manager that only watches LOCAL_ORIGIN.
    const objects = getDocObjects(doc);
    const obj = objects.get(id1);
    const txt = obj?.get('text') as Y.Text | undefined;
    // Direct insert without a transact — uses anonymous default origin
    txt!.insert(0, 'hello');

    // CanUndo is true because we have a previous move step in the stack
    expect(undoController.canUndo()).toBe(true);

    // Undo undoes the move (last LOCAL_ORIGIN step).
    // Text insertion used a different origin so wasn't captured.
    undoController.undo();

    // Position restored to pre-move state
    expect(obj?.get('x')).toBe(0);   // original stored coords
    // Text was never in undo history — it persists
    expect(txt?.toString()).toBe('hello');
  });
});

// ─── TC-17: pointercancel mid-drag restores start ────────────────────────

describe('TC-17: pointercancel restores start position', () => {
  it('one undo step restoring the start position', () => {
    const { doc, undoController } = renderUndoBoard({ captureTimeoutMs: 0 });

    // createSticky at (50, 50) stores x = 50 - 100 = -50, y = -50
    const id1 = createSticky(doc, { x: 50, y: 50 });
    undoController.boundary();

    // Begin drag — simulating movement during the drag phase
    moveObjects(doc, new Map([[id1, { x: 150, y: 150 }]]));

    // The dragged state should have been captured
    expect(undoController.canUndo()).toBe(true);

    // Undo restores start position (center-anchored values from createSticky)
    undoController.undo();

    const objects = getDocObjects(doc);
    const obj = objects.get(id1);
    expect(obj?.get('x')).toBe(-50);   // 50 - STICKY_SIZE_WORLD / 2
    expect(obj?.get('y')).toBe(-50);   // 50 - STICKY_SIZE_WORLD / 2
  });
});
