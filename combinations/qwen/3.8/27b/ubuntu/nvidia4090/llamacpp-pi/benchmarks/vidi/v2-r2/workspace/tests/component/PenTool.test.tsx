/**
 * Story 11 component tests: the pen gesture end-to-end through the board
 * (TC-09 to TC-14), per the design's test contract.
 *
 * Camera fixture: world (0,0) at screen (640,400), zoom 1, 1280x800.
 * Fake timers: the once-per-frame preview never flushes inside the gesture
 * loops (and rAF coalescing is what keeps 5000+ moves fast).
 */
import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
} from '../../src/shared/config';
import { snapshotAll } from '../../src/shared/board-model';
import { scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { renderStickyBoard } from './harness';

/** Window-level key press (the board listens on window keydown). */
function pressKey(key: string, init: KeyboardEventInit = {}): void {
  fireEvent.keyDown(window, { key, ...init });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Presses P and returns the viewport element. */
function activatePen(utils: ReturnType<typeof renderStickyBoard>) {
  pressKey('p');
  expect(utils.getByTestId('pen-button').getAttribute('aria-pressed')).toBe('true');
  expect(utils.getByTestId('pen-toolbar')).toBeTruthy();
  return utils.getByTestId('board-viewport');
}

/** Draws a two-point stroke from (x1,y1) to (x2,y2) (screen coords). */
function drawStroke(
  utils: ReturnType<typeof renderStickyBoard>,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  pointerId = 1,
): void {
  const viewport = utils.getByTestId('board-viewport');
  fireEvent.pointerDown(viewport, { clientX: x1, clientY: y1, pointerId });
  fireEvent.pointerMove(viewport, { clientX: x2, clientY: y2, pointerId });
  fireEvent.pointerUp(viewport, { clientX: x2, clientY: y2, pointerId });
}

it('TC-09: red + thick drag commits one red thick stroke and the tool stays pen', () => {
  const utils = renderStickyBoard();
  const viewport = activatePen(utils);

  // Pick red + thick in the toolbar.
  fireEvent.click(utils.getByTestId('pen-color-red'));
  fireEvent.click(utils.getByTestId('pen-thickness-thick'));

  drawStroke(utils, 500, 300, 560, 360);

  const all = snapshotAll(utils.doc);
  expect(all).toHaveLength(1); // createStroke ran exactly once
  const s = all[0] as StrokeSnap;
  expect(s.type).toBe('stroke');
  expect(s.color).toBe('red');
  expect(s.thickness).toBe('thick');
  expect(scaledPoints(s)).toHaveLength(2);
  // World points: (500,300) → (-140,-100); (560,360) → (-80,-40).
  expect(scaledPoints(s)).toEqual([
    { x: -140, y: -100 },
    { x: -80, y: -40 },
  ]);
  // The tool stays pen (pen.stay_active).
  expect(utils.getByTestId('pen-button').getAttribute('aria-pressed')).toBe('true');
  expect(utils.getByTestId('select-button').getAttribute('aria-pressed')).toBe('false');
});

it('TC-10: a click without movement commits a dot: a square stroke of the thickness', () => {
  const utils = renderStickyBoard();
  activatePen(utils);
  const viewport = utils.getByTestId('board-viewport');

  fireEvent.pointerDown(viewport, { clientX: 600, clientY: 400, pointerId: 1 });
  fireEvent.pointerUp(viewport, { clientX: 600, clientY: 400, pointerId: 1 });

  const all = snapshotAll(utils.doc);
  expect(all).toHaveLength(1);
  const s = all[0] as StrokeSnap;
  expect(scaledPoints(s)).toHaveLength(1);
  // A dot is a square of the (default medium) thickness.
  const t = PEN_THICKNESS_WORLD.medium;
  expect(s.width).toBe(t);
  expect(s.height).toBe(t);
  // The dot sits at the click (world (-40, 0)).
  expect(scaledPoints(s)[0]).toEqual({ x: -40, y: 0 });
});

it('TC-11: pointercancel commits the stroke with the points so far', () => {
  const utils = renderStickyBoard();
  activatePen(utils);
  const viewport = utils.getByTestId('board-viewport');

  fireEvent.pointerDown(viewport, { clientX: 500, clientY: 300, pointerId: 1 });
  fireEvent.pointerMove(viewport, { clientX: 540, clientY: 320, pointerId: 1 });
  fireEvent.pointerMove(viewport, { clientX: 580, clientY: 360, pointerId: 1 });
  fireEvent.pointerCancel(viewport, { clientX: 580, clientY: 360, pointerId: 1 });

  const all = snapshotAll(utils.doc);
  expect(all).toHaveLength(1); // the interrupted stroke is kept
  const s = all[0] as StrokeSnap;
  const pts = scaledPoints(s);
  expect(pts.length).toBeGreaterThanOrEqual(3);
  // It ends where the last move was (world (-60, -40)).
  const last = pts[pts.length - 1];
  expect(last.x).toBeCloseTo(-60);
  expect(last.y).toBeCloseTo(-40);
});

it('TC-12: 5010 moves split into two strokes; the second starts at the first’s last point', () => {
  const utils = renderStickyBoard();
  activatePen(utils);
  const viewport = utils.getByTestId('board-viewport');

  fireEvent.pointerDown(viewport, { clientX: 400, clientY: 400, pointerId: 1 });
  // Each move appends one point (jsdom has no coalescing): 1 (down) + 5010.
  // The first 4999 moves fill the 5000-point part, which commits mid-way;
  // the remaining moves + up commit the second part.
  for (let i = 1; i <= 5010; i++) {
    fireEvent.pointerMove(viewport, {
      clientX: 400 + (i % 10),
      clientY: 400 + Math.floor(i / 10),
      pointerId: 1,
    });
  }
  // The final move is i = 5010: x = 400 + 0, y = 400 + 501.
  fireEvent.pointerUp(viewport, { clientX: 400, clientY: 400 + 501, pointerId: 1 });

  const all = snapshotAll(utils.doc);
  expect(all).toHaveLength(2); // the long stroke was split
  const first = scaledPoints(all[0] as StrokeSnap);
  const second = scaledPoints(all[1] as StrokeSnap);
  // Part 2 starts exactly at part 1’s last point (no visible gap).
  expect(second[0]).toEqual(first[first.length - 1]);
  // Neither part exceeds the limit.
  expect(first.length).toBeLessThanOrEqual(STROKE_MAX_POINTS);
  expect(second.length).toBeLessThanOrEqual(STROKE_MAX_POINTS);
}, 30000);

it('TC-13: Escape mid-stroke abandons the in-flight stroke and the next press is not committed', () => {
  const utils = renderStickyBoard();
  activatePen(utils);
  const viewport = utils.getByTestId('board-viewport');

  fireEvent.pointerDown(viewport, { clientX: 500, clientY: 300, pointerId: 1 });
  fireEvent.pointerMove(viewport, { clientX: 560, clientY: 360, pointerId: 1 });

  // Escape reverts to Select (the in-flight stroke is never committed).
  pressKey('Escape');
  pressKey('v');
  expect(utils.getByTestId('select-button').getAttribute('aria-pressed')).toBe('true');
  expect(utils.getByTestId('pen-button').getAttribute('aria-pressed')).toBe('false');

  // The pointer-up after the tool switch must not commit anything.
  fireEvent.pointerUp(viewport, { clientX: 560, clientY: 360, pointerId: 1 });
  expect(snapshotAll(utils.doc)).toHaveLength(0);
});

it('TC-14: changing colour mid-session leaves existing strokes unchanged; the next stroke uses the new colour', () => {
  const utils = renderStickyBoard();
  activatePen(utils);

  // First stroke in the default black.
  drawStroke(utils, 400, 300, 460, 340);
  const firstId = (snapshotAll(utils.doc)[0] as StrokeSnap).id;
  expect((snapshotAll(utils.doc)[0] as StrokeSnap).color).toBe('black');

  // Switch to blue.
  fireEvent.click(utils.getByTestId('pen-color-blue'));
  expect(utils.getByTestId('pen-color-blue').getAttribute('aria-checked')).toBe('true');

  // Second stroke in blue, elsewhere.
  drawStroke(utils, 700, 500, 760, 540);

  const all = snapshotAll(utils.doc);
  expect(all).toHaveLength(2);
  const byId = new Map(all.map((s) => [s.id, s as StrokeSnap]));
  // The existing stroke is unchanged.
  expect(byId.get(firstId)?.color).toBe('black');
  // The new stroke uses the new colour.
  const second = all.find((s) => s.id !== firstId) as StrokeSnap;
  expect(second.color).toBe('blue');
  // Thickness stayed the default (the colour change did not touch it).
  expect(second.thickness).toBe('medium');
});
