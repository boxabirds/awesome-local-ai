// Shift+drag marquee selection (sel.marquee_ui, ui-component).
//
// The marquee is drawn from the board surface's Shift+pointer-down and committed on
// release; only objects lying *fully* inside are added, additively to any current
// selection. A plain (unshifted) drag pans instead, and a marquee cancelled
// mid-drag leaves the selection exactly as it was.

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { worldToScreen } from '../../src/client/canvas/camera';
import {
  clickNote,
  createNote,
  marqueeDrag,
  noteBounds,
  noteSelected,
  pointer,
  readCamera,
  renderBoard,
  selectionBarEl,
} from './helpers';

/** Screen-space rect (client px) that fully encloses a note's world bounds. */
function screenBoxOf(id: string, pad = 20): {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
} {
  const cam = readCamera();
  const b = noteBounds(id);
  const tl = worldToScreen(cam, { x: b.x, y: b.y });
  const br = worldToScreen(cam, { x: b.x + b.width, y: b.y + b.height });
  return {
    x0: Math.min(tl.x, br.x) - pad,
    y0: Math.min(tl.y, br.y) - pad,
    x1: Math.max(tl.x, br.x) + pad,
    y1: Math.max(tl.y, br.y) + pad,
  };
}

describe('sel.marquee_ui (ui-component)', () => {
  // TC-20: a Shift+drag adds every fully-inside object to the current selection.
  it('TC-20 adds fully-inside objects to the existing selection', () => {
    renderBoard();
    const a = createNote(0, 0);
    const b = createNote(600, 0);
    const c = createNote(3000, 0);
    clickNote(a); // selection = {a}

    const box = screenBoxOf(b);
    marqueeDrag([box.x0, box.y0], [box.x1, box.y1]);

    expect(noteSelected(a)).toBe(true); // still selected (additive)
    expect(noteSelected(b)).toBe(true); // added by the marquee
    expect(noteSelected(c)).toBe(false); // far outside, untouched
  });

  // TC-21 (negative): a plain drag pans the board and never starts a marquee.
  it('TC-21 pans instead of marquee-selecting when Shift is not held', () => {
    renderBoard();
    createNote(0, 0);
    const camBefore = readCamera();

    // Drag across empty board without Shift.
    pointer(screen.getByTestId('board-viewport'), 'pointerdown', 100, 100);
    pointer(screen.getByTestId('board-viewport'), 'pointermove', 400, 400);
    pointer(screen.getByTestId('board-viewport'), 'pointerup', 400, 400);

    const camAfter = readCamera();
    expect(camAfter).not.toEqual(camBefore); // the board panned
    expect(screen.queryByTestId('marquee')).toBeNull(); // no marquee was drawn
    expect(selectionBarEl()).toBeNull(); // and nothing got selected
  });

  // TC-22: a marquee cancelled mid-drag leaves the selection unchanged.
  it('TC-22 leaves the selection unchanged when the marquee is cancelled', () => {
    renderBoard();
    const b = createNote(600, 0);
    const box = screenBoxOf(b);

    marqueeDrag([box.x0, box.y0], [box.x1, box.y1], 'cancel');

    expect(noteSelected(b)).toBe(false); // nothing added
    expect(screen.queryByTestId('marquee')).toBeNull(); // the box is gone
    expect(selectionBarEl()).toBeNull();
  });
});
