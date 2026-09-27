// sel.marquee_ui (story 7): TC-20 to TC-22.
//
// Shift+drag on empty board space draws a marquee that additively selects
// the objects lying entirely inside it. A plain drag pans; a pointercancel
// cancels the marquee with no selection change.

import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushRaf, installResizeObserverMock, viewportEl, worldTransform } from './helpers';
import { board, dispatchOn, keyedPointerEvent, noteAt, noteEls, selectionCount, screenX, screenY } from './story7-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  installResizeObserverMock();
});

afterEach(() => {
  cleanup();
});

/** Shift+drag a marquee from world (x0,y0) to world (x1,y1). */
function marquee(container: HTMLElement, x0: number, y0: number, x1: number, y1: number): void {
  const vp = viewportEl(container);
  dispatchOn(vp, keyedPointerEvent('pointerdown', screenX(x0), screenY(y0), true));
  dispatchOn(vp, keyedPointerEvent('pointermove', screenX(x1), screenY(y1), true));
  dispatchOn(vp, keyedPointerEvent('pointerup', screenX(x1), screenY(y1), true));
}

function plainDrag(container: HTMLElement, x0: number, y0: number, x1: number, y1: number): void {
  const vp = viewportEl(container);
  dispatchOn(vp, keyedPointerEvent('pointerdown', screenX(x0), screenY(y0)));
  dispatchOn(vp, keyedPointerEvent('pointermove', screenX(x1), screenY(y1)));
  dispatchOn(vp, keyedPointerEvent('pointerup', screenX(x1), screenY(y1)));
}

describe('sel.marquee_ui', () => {
  it('TC-20 Shift+drag adds fully-inside ids to the existing selection', async () => {
    const { container } = await board();
    act(() => {
      noteAt(0, 0); // note a: world 0..200
      noteAt(400, 400); // note b: world 400..600
    });
    const [a] = noteEls(container);
    // Pre-select a (click).
    dispatchOn(a!, keyedPointerEvent('pointerdown', 740, 500));
    dispatchOn(a!, keyedPointerEvent('pointerup', 740, 500));
    expect(a!.hasAttribute('data-selected')).toBe(true);
    // The aria-live region announces the count for any selection; the multi-bar only appears at >= 2.
    expect(selectionCount(container)).toBe('1 selected');

    // Marquee a box fully containing b and not a.
    marquee(container, 350, 350, 650, 650);

    expect(noteEls(container).filter((n) => n.hasAttribute('data-selected'))).toHaveLength(2);
    expect(selectionCount(container)).toBe('2 selected');
  });

  it('TC-20b marquee over nothing leaves the selection unchanged (additive, empty result)', async () => {
    const { container } = await board();
    act(() => {
      noteAt(0, 0);
    });
    const [a] = noteEls(container);
    dispatchOn(a!, keyedPointerEvent('pointerdown', 740, 500));
    dispatchOn(a!, keyedPointerEvent('pointerup', 740, 500));
    expect(a!.hasAttribute('data-selected')).toBe(true);

    // Marquee an empty region far from the note.
    marquee(container, 1000, 1000, 1200, 1200);

    expect(noteEls(container).filter((n) => n.hasAttribute('data-selected'))).toHaveLength(1);
  });

  it('TC-21 plain drag (no Shift) pans the board and never starts a marquee', async () => {
    const { container } = await board();
    const before = worldTransform(container);
    plainDrag(container, 100, 100, 260, 180);
    await flushRaf(); // the camera coalesces pan moves through rAF
    const after = worldTransform(container);
    expect(after).not.toBe(before);
    expect(container.querySelector('[data-testid="marquee-rect"]')).toBeNull();
  });

  it('TC-22 pointercancel mid-marquee → the marquee drops and the selection is unchanged', async () => {
    const { container } = await board();
    act(() => {
      noteAt(400, 400);
    });
    const [b] = noteEls(container);
    expect(b!.hasAttribute('data-selected')).toBe(false);

    const vp = viewportEl(container);
    dispatchOn(vp, keyedPointerEvent('pointerdown', screenX(350), screenY(350), true));
    dispatchOn(vp, keyedPointerEvent('pointermove', screenX(650), screenY(650), true));
    // The marquee is visible while in flight.
    expect(container.querySelector('[data-testid="marquee-rect"]')).not.toBeNull();

    dispatchOn(vp, keyedPointerEvent('pointercancel', screenX(650), screenY(650), true));
    expect(container.querySelector('[data-testid="marquee-rect"]')).toBeNull();
    expect(b!.hasAttribute('data-selected')).toBe(false);
    expect(selectionCount(container)).toBeNull();
  });
});
