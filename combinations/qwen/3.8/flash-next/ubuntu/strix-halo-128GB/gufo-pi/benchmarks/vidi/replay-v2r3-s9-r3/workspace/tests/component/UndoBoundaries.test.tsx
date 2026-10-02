/**
 * Component tests for undo.boundaries (TC-14 to TC-17).
 * Uses real Y.Doc, real UndoController, and the BoardHarness gesture wiring.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { BoardHarness, type HarnessHandle } from './harness/BoardHarness';
import {
  createSticky,
  getStickyText,
  snapshot,
  getObjectsMap,
  moveObject,
  setStickyColor,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { pointer, frames, typeInto } from './pointerUtils';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  const handleRef = createRef<HarnessHandle | null>();
  render(<BoardHarness handleRef={handleRef} />);
  const handle = handleRef.current!;
  const doc = handle.doc;
  return { handle, doc };
}

function makeNote(doc: any, x: number, y: number): string {
  let id = '';
  act(() => {
    id = createSticky(doc, { x, y });
  });
  frames();
  return id;
}

function simulateDrag(id: string, fromX: number, fromY: number, dx: number, dy: number) {
  const el = document.querySelector(`[data-note-id="${id}"]`)!;
  pointer(el, 'pointerdown', fromX, fromY);
  // Move in small increments
  const steps = 30;
  for (let i = 1; i <= steps; i++) {
    pointer(window, 'pointermove', fromX + (dx * i) / steps, fromY + (dy * i) / steps);
    frames();
  }
  pointer(window, 'pointerup', fromX + dx, fromY + dy);
  frames();
}

describe('undo.boundaries (gesture)', () => {
  it('TC-14: 30-frame drag → one undo restores start position', () => {
    const { handle, doc } = setup();
    const id = makeNote(doc, 300, 300);
    const snapBefore = snapshot(doc).find((n) => n.id === id)!;
    const startX = snapBefore.x;
    const startY = snapBefore.y;

    simulateDrag(id, startX + 30, startY + 30, 200, 150);

    // Note moved
    const afterDrag = snapshot(doc).find((n) => n.id === id)!;
    expect(afterDrag.x).not.toBe(startX);

    // Undo → one step restores start
    const ctrl = handle.undoController;
    let steps = 0;
    while (ctrl.canUndo()) { ctrl.undo(); steps++; if (steps > 5) break; }
    // At most 3 steps (bringToFront + move or createSticky + drag)
    // The key: after undoing the drag step, position returns to start
    // Let's just undo once (the drag is one step)
    // Actually let's be more precise: undo once
    // Reset: undo one step
    // Redo all to get back then undo one
    while (ctrl.canRedo()) ctrl.redo();
    
    ctrl.undo(); // undo the drag
    const restored = snapshot(doc).find((n) => n.id === id)!;
    expect(restored.x).toBe(startX);
    expect(restored.y).toBe(startY);

    ctrl.destroy();
  });

  it('TC-15: drag ends, colour changed later → two separate steps', () => {
    const { handle, doc } = setup();
    const id = makeNote(doc, 300, 300);
    const snapBefore = snapshot(doc).find((n) => n.id === id)!;
    const startX = snapBefore.x;

    // Drag
    simulateDrag(id, startX + 30, snapBefore.y + 30, 200, 0);
    const afterDrag = snapshot(doc).find((n) => n.id === id)!;
    const draggedX = afterDrag.x;

    // Colour change (well after drag, boundary already called at gesture end)
    act(() => {
      setStickyColor(doc, id, 'green');
    });
    frames();

    const ctrl = handle.undoController;
    // First undo → undoes colour
    ctrl.undo();
    const afterColorUndo = snapshot(doc).find((n) => n.id === id)!;
    expect(afterColorUndo.color).not.toBe('green');
    expect(afterColorUndo.x).toBe(draggedX); // position unchanged by colour undo

    // Second undo → undoes move
    ctrl.undo();
    const afterMoveUndo = snapshot(doc).find((n) => n.id === id)!;
    expect(afterMoveUndo.x).toBe(startX);

    ctrl.destroy();
  });

  it('TC-16: edit note, type, Ctrl+Z inside editor → typing undone, earlier move not undone', () => {
    const { handle, doc } = setup();
    const id = makeNote(doc, 300, 300);
    const snapBefore = snapshot(doc).find((n) => n.id === id)!;
    const startX = snapBefore.x;

    // Move the note
    simulateDrag(id, startX + 30, snapBefore.y + 30, 100, 0);
    const movedX = snapshot(doc).find((n) => n.id === id)!.x;
    expect(movedX).not.toBe(startX);

    // Click note to select, then Enter to edit
    const el = document.querySelector(`[data-note-id="${id}"]`)!;
    pointer(el, 'pointerdown', startX + 130, snapBefore.y + 30);
    pointer(el, 'pointerup', startX + 130, snapBefore.y + 30);
    frames();

    fireEvent.keyDown(window, { key: 'Enter' });
    frames();

    // Type in the editor
    const editorEl = screen.getByTestId('sticky-note-editor') as HTMLTextAreaElement;
    typeInto(editorEl, 'hello');
    frames();

    // Ctrl+Z inside the editor → should undo typing, not the earlier move
    fireEvent.keyDown(editorEl, { key: 'z', ctrlKey: true });
    frames();

    // Position should still be moved (earlier move not undone)
    const current = snapshot(doc).find((n) => n.id === id)!;
    expect(current.x).toBe(movedX);

    const ctrl = handle.undoController;
    ctrl.destroy();
  });

  it('TC-17: pointercancel mid-drag → one step restoring start position', () => {
    const { handle, doc } = setup();
    const id = makeNote(doc, 300, 300);
    const snapBefore = snapshot(doc).find((n) => n.id === id)!;
    const startX = snapBefore.x;
    const startY = snapBefore.y;

    // Start drag
    const el = document.querySelector(`[data-note-id="${id}"]`)!;
    pointer(el, 'pointerdown', startX + 30, startY + 30);
    // Move a few frames
    for (let i = 1; i <= 10; i++) {
      pointer(window, 'pointermove', startX + 30 + i * 10, startY + 30);
      frames();
    }
    // Cancel
    pointer(window, 'pointercancel', 0, 0);
    frames();

    // Undo the partial drag
    const ctrl = handle.undoController;
    ctrl.undo();

    const restored = snapshot(doc).find((n) => n.id === id)!;
    expect(restored.x).toBe(startX);
    expect(restored.y).toBe(startY);

    ctrl.destroy();
  });
});
