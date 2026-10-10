/**
 * TC-20 to TC-22 (story 7, sel.marquee_ui): Shift+drag draws a rectangle and
 * selects what fits inside it — and only what fits inside it — while a plain
 * drag still does what it did in story 1: pan the board.
 *
 * The camera is at its default (`zoom: 1`, origin at the viewport's top-left), so
 * a point in the viewport is the same numbers in world units, which is what lets
 * these tests state containment in plain coordinates.
 */
import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Doc } from 'yjs';
import type { Doc as YDoc } from 'yjs';

import type { Point } from '../../src/shared/geometry';
import {
  addNote,
  clickNote,
  flushFrame,
  isPanning,
  noteById,
  pointerEvent,
  readCamera,
  renderStickyBoard,
  selectedIds,
  setCamera,
  viewportElement,
} from './helpers/board';

let doc: YDoc;

beforeEach(async () => {
  doc = new Doc();
  renderStickyBoard(doc);
  // The board opens with its start centred (story 1), which would offset every
  // coordinate below; at the origin, a point on the screen is the same point in
  // the world, so these tests can say where the rectangle goes in plain numbers.
  act(() => setCamera({ x: 0, y: 0, zoom: 1 }));
  await flushFrame();
});

afterEach(cleanup);

const selected = selectedIds;

/** Shift+drag from one corner of the rectangle to the other, drawn on the way. */
function dragMarquee(from: Point, to: Point): void {
  const surface = viewportElement();
  pointerEvent('pointerDown', surface, from, { shiftKey: true });
  pointerEvent('pointerMove', surface, to, { shiftKey: true });
  pointerEvent('pointerUp', surface, to, { shiftKey: true });
}

describe('marquee selection (TC-20, TC-21, TC-22)', () => {
  it('TC-20: a Shift+drag adds the objects fully inside it to the selection', () => {
    const a = addNote(doc, { x: 100, y: 100 });
    const inside = addNote(doc, { x: 500, y: 500 });
    // Its right half falls outside the rectangle that closes at x = 1000.
    const partly = addNote(doc, { x: 900, y: 500 });
    clickNote(doc, a);
    expect(selected()).toEqual([a]);

    dragMarquee({ x: 450, y: 450 }, { x: 1000, y: 1000 });

    // `inside` occupies 500..700 in both axes; `partly` runs to 1100 in x, so it
    // is not selected: partly inside is not "which one did I mean".
    expect(selected()).toEqual([a, inside].sort());
    expect(noteById(partly).dataset.selected).toBe('false');
    expect(screen.getByTestId('selection-bar').dataset.count).toBe('2');
  });

  it('draws the rectangle where the drag took it, and only while it lasts', () => {
    const surface = viewportElement();
    pointerEvent('pointerDown', surface, { x: 200, y: 150 }, { shiftKey: true });
    expect(screen.queryByTestId('marquee-rect')).toBeNull(); // no area yet
    pointerEvent('pointerMove', surface, { x: 500, y: 450 }, { shiftKey: true });

    const rect = screen.getByTestId('marquee-rect');
    expect(rect.style.left).toBe('200px');
    expect(rect.style.top).toBe('150px');
    expect(rect.style.width).toBe('300px');
    expect(rect.style.height).toBe('300px');

    // The rectangle belongs to the drag, not to the board: it is gone once the
    // pointer comes up, because so is the reason to show it.
    pointerEvent('pointerUp', surface, { x: 500, y: 450 }, { shiftKey: true });
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
  });

  it('TC-21: a plain drag pans the board and never starts a marquee', async () => {
    const a = addNote(doc, { x: 100, y: 100 });
    clickNote(doc, a);
    const cameraBefore = readCamera();

    const surface = viewportElement();
    pointerEvent('pointerDown', surface, { x: 900, y: 650 });
    pointerEvent('pointerMove', surface, { x: 980, y: 700 });
    expect(isPanning()).toBe(true);
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    pointerEvent('pointerUp', surface, { x: 980, y: 700 });

    await flushFrame();
    expect(readCamera()).not.toEqual(cameraBefore);
    expect(isPanning()).toBe(false);
    // A pan keeps the selection (story 1's TC-22) and selected nothing new.
    expect(selected()).toEqual([a]);
  });

  it('TC-22: a marquee interrupted by pointercancel leaves the selection alone', () => {
    const a = addNote(doc, { x: 100, y: 100 });
    const inside = addNote(doc, { x: 500, y: 500 });
    clickNote(doc, a);

    const surface = viewportElement();
    pointerEvent('pointerDown', surface, { x: 450, y: 450 }, { shiftKey: true });
    pointerEvent('pointerMove', surface, { x: 1000, y: 1000 }, { shiftKey: true });
    expect(screen.getByTestId('marquee-rect')).not.toBeNull();

    pointerEvent('pointerCancel', surface, { x: 1000, y: 1000 }, { shiftKey: true });

    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    expect(selected()).toEqual([a]);
    // …and the objects the rectangle covered were never touched.
    expect(noteById(inside).dataset.selected).toBe('false');
  });
});
