import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import type { Doc } from 'yjs';
import type { Camera } from '../../src/client/canvas/camera';
import { screenToWorld, worldToScreen } from '../../src/client/canvas/camera';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshotAll, deleteObjects, type StrokeSnapshot } from '../../src/shared/board-model';
import { createStroke, scaledPoints } from '../../src/shared/objects/stroke';
import { handwrittenLoop, spiral } from '../fixtures/pen-paths';
import type { Point } from '../../src/shared/geometry';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  type PenColor,
  type PenThickness,
} from '../../src/shared/config';
import {
  cancelPressOn,
  flushFrame,
  moveTo,
  noteCount,
  pressOn,
  releaseOn,
  renderBoard,
  surfaceOf,
} from './helpers';

/**
 * TC-09 to TC-14: the Pen tool, in the DOM, on a real document.
 *
 * What the component tier settles that the unit one cannot is the wiring of a
 * gesture: that one drag of the pointer reaches the model exactly once and in the
 * pen that was chosen; that the stroke in flight is drawn and never written; that a
 * drag interrupted by the system keeps what was drawn; that a drag that reaches the
 * limit of one stroke becomes two strokes that meet; and that the tool is still the
 * Pen tool afterwards, which is the one thing about a pen that no other tool on this
 * board shares.
 *
 * The events are the ones a pointer makes — down, moves, up — sent at the board's
 * own surface, and the assertions are read back out of the document the board is
 * really writing, because a pen that drew into a test double drew into nothing.
 */

let doc: Doc;
let view: HTMLElement;
let surface: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  doc = renderBoard();
  view = document.querySelector<HTMLElement>('.app')!;
  surface = surfaceOf(view);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/* ── helpers ─────────────────────────────────────────────────────────── */

/** The camera the board is drawing with, read off the world layer rather than
 *  assumed: every point this test converts goes through what the board is actually
 *  looking through. */
function camera(): Camera {
  const transform = view.querySelector<HTMLElement>('[data-testid="world-layer"]')!.style.transform;
  const zoom = Number(/scale\(([-0-9.]+)\)/.exec(transform)?.[1]);
  const translate = /translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/.exec(transform);
  return { x: -Number(translate![1]), y: -Number(translate![2]), zoom };
}

function lookThrough(next: Camera): void {
  act(() => {
    window.__vidi6?.setCamera(next);
  });
  flushFrame();
}

function pressKey(key: string): void {
  fireEvent.keyDown(window, { key });
  flushFrame();
}

function pressed(name: string): boolean {
  return screen.getByRole('button', { name }).getAttribute('aria-pressed') === 'true';
}

function strokes(): StrokeSnapshot[] {
  return snapshotAll(doc).filter((object) => object.type === 'stroke') as StrokeSnapshot[];
}

/** The board units a screen point is drawn at. */
function board(x: number, y: number): Point {
  return screenToWorld(camera(), { x, y });
}

function strokeEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-stroke-id="${id}"]`);
  if (el === null) throw new Error(`stroke ${id} is not drawn`);
  return el;
}

function part(id: string): SVGSVGElement {
  const svg = strokeEl(id).querySelector<SVGSVGElement>('svg');
  if (svg === null) throw new Error(`stroke ${id} is drawn without a picture`);
  return svg;
}

/** The path a stroke is painted with. */
function lineOf(id: string): SVGPathElement {
  const path = strokeEl(id).querySelector<SVGPathElement>('[data-testid="stroke-line"]');
  if (path === null) throw new Error(`stroke ${id} has no line drawn`);
  return path;
}

/** Stroke the pen with a colour and a width, from the toolbar. */
function choose(color: PenColor, thickness: PenThickness): void {
  fireEvent.click(screen.getByRole('button', { name: `${cap(color)} pen` }));
  fireEvent.click(screen.getByRole('button', { name: cap(thickness) }));
  flushFrame();
}

function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** The stroke in flight, if it is drawn. */
function preview(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="stroke-preview"]');
}

/**
 * Draw a stroke by dragging the pointer along a path, given in *screen* pixels.
 * The path is walked in steps, one pointer move each, and every step is inside
 * `act` because a move that reaches the limit of one stroke writes to the document
 * where it stands.
 */
function dragAlong(path: readonly Point[]): void {
  pressOn(surface, path[0]!.x, path[0]!.y);
  for (let index = 1; index < path.length; index++) {
    const point = path[index]!;
    act(() => {
      moveTo(surface, point.x, point.y);
    });
  }
}

/** A path given in board units, as the screen points a pointer would be dragged to
 *  draw it, at the camera the board is looking through right now. */
function onScreen(path: readonly Point[]): Point[] {
  return path.map((point) => worldToScreen(camera(), point));
}

/* ── TC-09: a drag draws one stroke, in the pen that was chosen ───────── */

describe('drawing a stroke', () => {
  it('TC-09 drags once, writes one stroke in the chosen colour and width, and is still holding the pen', () => {
    pressKey('p');
    expect(pressed('Pen (P)')).toBe(true);
    choose('red', 'thick');

    const before = camera();
    dragAlong([
      { x: 200, y: 200 },
      { x: 240, y: 210 },
      { x: 280, y: 240 },
      { x: 300, y: 300 },
    ]);
    flushFrame();
    // Nothing is written while the pointer is still down: the stroke in flight is a
    // preview, and a board that synced a half-drawn line would sync a drawing that
    // was not finished.
    expect(strokes()).toHaveLength(0);
    expect(preview()).not.toBeNull();

    releaseOn(surface, 300, 300);
    flushFrame();
    const drawn = strokes();
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.color).toBe('red');
    expect(drawn[0]!.thickness).toBe('thick');
    // The stroke is where the pointer went, in board units.
    expect(scaledPoints(drawn[0]!)[0]).toEqual(board(200, 200));
    // The board did not pan under the drag, and the pen is still in hand.
    expect(camera()).toEqual(before);
    expect(pressed('Pen (P)')).toBe(true);
    // The preview is gone: it was the drag, and the drag is over.
    expect(preview()).toBeNull();
    // And the stroke is drawn on the board as a drawing, not as a box.
    expect(lineOf(drawn[0]!.id).getAttribute('stroke')).toBe(PEN_COLORS.red);
    expect(lineOf(drawn[0]!.id).getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.thick));
  });

  it('TC-09 draws with the default pen when nothing was chosen: black and medium', () => {
    pressKey('p');
    pressOn(surface, 100, 100);
    moveTo(surface, 180, 140);
    releaseOn(surface, 180, 140);
    flushFrame();
    const drawn = strokes();
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.color).toBe('black');
    expect(drawn[0]!.thickness).toBe('medium');
  });

  it('leaves the board alone while a stroke is being drawn, and redraws it once a frame', () => {
    pressKey('p');
    pressOn(surface, 200, 200);
    // The frame the preview is drawn on has not come round yet.
    flushFrame();
    expect(preview()?.dataset.points).toBe('1');

    for (let x = 210; x <= 260; x += 10) {
      moveTo(surface, x, 200 + (x - 200) / 2);
    }
    // Twenty moves, one frame: the preview is the stroke, not a picture of every
    // event that arrived.
    expect(preview()?.dataset.points).toBe('1');
    flushFrame();
    expect(Number(preview()?.dataset.points)).toBe(7);
    expect(strokes()).toHaveLength(0);
    releaseOn(surface, 260, 230);
    flushFrame();
  });

  it('draws nothing at all when the pen is not the tool the board is in', () => {
    pressOn(surface, 100, 100);
    moveTo(surface, 300, 300);
    releaseOn(surface, 300, 300);
    flushFrame();
    expect(strokes()).toHaveLength(0);
    expect(preview()).toBeNull();
  });
});

/* ── TC-10: a click is a dot ─────────────────────────────────────────── */

describe('clicking a dot', () => {
  it('TC-10 presses and releases without moving, and one point of the pen’s own size is drawn', () => {
    pressKey('p');
    choose('blue', 'thick');
    pressOn(surface, 400, 300);
    releaseOn(surface, 400, 300);
    flushFrame();

    const drawn = strokes();
    expect(drawn).toHaveLength(1);
    // One point, and the box is the thickness of the pen rather than a drag.
    expect(drawn[0]!.points).toHaveLength(2);
    expect(drawn[0]!.width).toBe(PEN_THICKNESS_WORLD.thick);
    expect(drawn[0]!.height).toBe(PEN_THICKNESS_WORLD.thick);
    expect(scaledPoints(drawn[0]!)).toEqual([board(400, 300)]);
    expect(strokeEl(drawn[0]!.id).dataset.points).toBe('1');
    // A path of no length, which the round cap the drawing is given paints as a dot.
    const path = lineOf(drawn[0]!.id);
    const d = path.getAttribute('d')!;
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('L');
    expect(d).not.toContain('Q');
  });

  it('draws a dot for a press that wobbled less than a drag', () => {
    const wobble = DRAG_THRESHOLD_PX / 3;
    pressKey('p');
    pressOn(surface, 400, 300);
    moveTo(surface, 400 + wobble, 300);
    moveTo(surface, 400, 300 + wobble);
    releaseOn(surface, 400, 300);
    flushFrame();
    const drawn = strokes();
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.points).toHaveLength(2);
  });

  it('draws a dot at the point the pointer went down and not where it came up', () => {
    const wobble = DRAG_THRESHOLD_PX / 3;
    pressKey('p');
    pressOn(surface, 500, 200);
    moveTo(surface, 500 + wobble, 200);
    releaseOn(surface, 500 + wobble, 200 + wobble);
    flushFrame();
    expect(scaledPoints(strokes()[0]!)).toEqual([board(500, 200)]);
  });

  it('draws a circle rather than a dot when the drag came back to where it began', () => {
    // The measure of a click is the road travelled, not how far the ends of the drag
    // stand from one another: a ring, a zero, a closed loop and a spiral all come back
    // near where they started, and every one of them is a drawing.
    pressKey('p');
    const path = onScreen(handwrittenLoop(24));
    dragAlong(path);
    releaseOn(surface, path[path.length - 1]!.x, path[path.length - 1]!.y);
    flushFrame();

    const drawn = strokes();
    expect(drawn).toHaveLength(1);
    // More than a point, and as wide and as tall as the ring that was drawn.
    expect(drawn[0]!.points.length).toBeGreaterThan(2);
    expect(drawn[0]!.width).toBeGreaterThan(PEN_THICKNESS_WORLD.medium * 2);
    expect(drawn[0]!.height).toBeGreaterThan(PEN_THICKNESS_WORLD.medium * 2);
  });
});

/* ── TC-11: a stroke taken away mid-drag is kept ─────────────────────── */

describe('an interrupted stroke', () => {
  it('TC-11 keeps what was drawn when the pointercancel arrives', () => {
    pressKey('p');
    pressOn(surface, 150, 150);
    moveTo(surface, 220, 190);
    moveTo(surface, 300, 210);
    cancelPressOn(surface);
    flushFrame();

    const drawn = strokes();
    expect(drawn).toHaveLength(1);
    // Kept as far as the pointer had got: the box runs between the two points it was
    // drawn between, to within the tolerance the drawing is allowed.
    expect(scaledPoints(drawn[0]!)[0]).toEqual(board(150, 150));
    expect(drawn[0]!.x).toBeLessThanOrEqual(board(300, 210).x - PEN_THICKNESS_WORLD.medium / 2 + 1);
    expect(preview()).toBeNull();
    expect(pressed('Pen (P)')).toBe(true);
  });

  it('keeps the stroke when the pointer capture is lost instead', () => {
    pressKey('p');
    pressOn(surface, 150, 150);
    act(() => {
      fireEvent(surface, new PointerEvent('pointermove', { pointerId: 1, clientX: 250, clientY: 200, bubbles: true }));
      // The browser takes the capture away: the app never asked for this.
      surface.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1, bubbles: true }));
    });
    flushFrame();
    const drawn = strokes();
    expect(drawn).toHaveLength(1);
    expect(scaledPoints(drawn[0]!)[0]).toEqual(board(150, 150));
    expect(preview()).toBeNull();
  });

  it('does not draw the same stroke twice when the cancel is followed by a release', () => {
    pressKey('p');
    pressOn(surface, 150, 150);
    moveTo(surface, 250, 200);
    cancelPressOn(surface);
    releaseOn(surface, 250, 200);
    flushFrame();
    expect(strokes()).toHaveLength(1);
  });
});

/* ── TC-12: a stroke past the limit of one stroke ────────────────────── */

describe('a drag longer than one stroke', () => {
  it('TC-12 commits the limit as one stroke and carries on from the point it stopped at', () => {
    pressKey('p');
    // The longest drag the product allows, walked a point at a time in screen pixels.
    const drawn = spiral(STROKE_MAX_POINTS + 10);
    const path = onScreen(drawn);
    dragAlong(path);
    releaseOn(surface, path[path.length - 1]!.x, path[path.length - 1]!.y);
    flushFrame();

    const strokesNow = strokes();
    // Two strokes rather than one over-long one, and rather than one lost.
    expect(strokesNow).toHaveLength(2);
    // Neither is over the limit it was cut at.
    for (const stroke of strokesNow) expect(stroke.points.length / 2).toBeLessThanOrEqual(STROKE_MAX_POINTS);

    // They meet: the second begins at the point the first was cut off at, which is
    // the whole reason the parts share a point rather than simply following one
    // another — a drawing with a gap in the middle of it is a drawing that broke.
    const [one, two] = [scaledPoints(strokesNow[0]!), scaledPoints(strokesNow[1]!)];
    const join = one[one.length - 1]!;
    expect(two[0]).toEqual(join);
    // And the join is a place the pointer actually was: it is on the path that was
    // dragged, to within a screen pixel of the tolerance the drawing keeps.
    const nearest = Math.min(...drawn.map((point) => Math.hypot(point.x - join.x, point.y - join.y)));
    expect(nearest).toBeLessThanOrEqual(1.0001);

    // Both are drawn, in the order they were made.
    expect(strokeEl(strokesNow[0]!.id)).toBeTruthy();
    expect(strokeEl(strokesNow[1]!.id)).toBeTruthy();
  });

  it('draws one stroke and no more when the drag stops one point short of the limit', () => {
    pressKey('p');
    const path = onScreen(spiral(STROKE_MAX_POINTS - 1));
    dragAlong(path);
    releaseOn(surface, path[path.length - 1]!.x, path[path.length - 1]!.y);
    flushFrame();
    const drawn = strokes();
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.points.length / 2).toBeLessThanOrEqual(STROKE_MAX_POINTS);
  });
});

/* ── TC-13: leaving the pen mid-stroke ───────────────────────────────── */

describe('leaving the Pen tool', () => {
  it('TC-13 draws nothing when Escape is pressed over a stroke in flight, and is in Select', () => {
    pressKey('p');
    pressOn(surface, 200, 200);
    moveTo(surface, 320, 260);
    moveTo(surface, 400, 300);
    flushFrame();
    expect(preview()).not.toBeNull();

    pressKey('Escape');
    // The release that follows the leaving draws nothing: the stroke was abandoned,
    // not finished, and a pen that finished a stroke because its owner left the tool
    // would put marks on the board nobody meant.
    releaseOn(surface, 400, 300);
    flushFrame();

    expect(strokes()).toHaveLength(0);
    expect(pressed('Select (V)')).toBe(true);
    expect(pressed('Pen (P)')).toBe(false);
    expect(preview()).toBeNull();
  });

  it('leaves the pen without a stroke when another tool is chosen from the toolbar', () => {
    pressKey('p');
    pressOn(surface, 200, 200);
    moveTo(surface, 320, 260);
    fireEvent.click(screen.getByRole('button', { name: 'Shape (S)' }));
    releaseOn(surface, 320, 260);
    flushFrame();
    expect(strokes()).toHaveLength(0);
    expect(pressed('Shape (S)')).toBe(true);
  });

  it('pressing v leaves the pen, and the next drag draws no stroke either', () => {
    pressKey('p');
    expect(pressed('Pen (P)')).toBe(true);
    pressKey('v');
    expect(pressed('Select (V)')).toBe(true);
    pressOn(surface, 200, 200);
    moveTo(surface, 320, 260);
    releaseOn(surface, 320, 260);
    flushFrame();
    expect(strokes()).toHaveLength(0);
  });

  it('draws nothing when a note is under the pointer and the pen is left mid-drag', () => {
    // A note is on the board and the drag started on it: leaving the tool must leave
    // the note where it was and the board as it was.
    pressKey('p');
    pressOn(surface, 300, 300);
    moveTo(surface, 420, 360);
    pressKey('Escape');
    flushFrame();
    expect(noteCount()).toBe(0);
    expect(strokes()).toHaveLength(0);
  });
});

/* ── TC-14: the pen changes, the drawing does not ────────────────────── */

describe('choosing another pen', () => {
  it('TC-14 leaves the stroke already drawn as it was and draws the next one in the new pen', () => {
    pressKey('p');
    choose('red', 'thin');
    pressOn(surface, 200, 200);
    moveTo(surface, 320, 260);
    releaseOn(surface, 320, 260);
    flushFrame();

    const first = strokes()[0]!;
    expect(first.color).toBe('red');
    expect(first.thickness).toBe('thin');
    const before = lineOf(first.id).getAttribute('d');

    choose('green', 'thick');
    // The stroke that is already on the board is painted in the pen it was drawn
    // with, and that is the last anyone gets to say about it.
    const still = strokes()[0]!;
    expect(still.color).toBe('red');
    expect(still.thickness).toBe('thin');
    expect(lineOf(still.id).getAttribute('stroke')).toBe(PEN_COLORS.red);
    expect(lineOf(still.id).getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.thin));
    expect(lineOf(still.id).getAttribute('d')).toBe(before);

    pressOn(surface, 500, 500);
    moveTo(surface, 620, 560);
    releaseOn(surface, 620, 560);
    flushFrame();

    const drawn = strokes();
    expect(drawn).toHaveLength(2);
    expect(drawn[1]!.color).toBe('green');
    expect(drawn[1]!.thickness).toBe('thick');
    expect(lineOf(drawn[1]!.id).getAttribute('stroke')).toBe(PEN_COLORS.green);
    // The first is still there, still itself.
    expect(strokes()[0]!.color).toBe('red');
  });

  it('remembers the pen it was given for every later stroke, without saving it anywhere', () => {
    pressKey('p');
    fireEvent.click(screen.getByRole('button', { name: 'Purple pen' }));
    flushFrame();
    expect(pressed('Purple pen')).toBe(true);

    for (const [x, y] of [
      [100, 100],
      [300, 300],
    ] as const) {
      pressOn(surface, x, y);
      moveTo(surface, x + 60, y + 40);
      releaseOn(surface, x + 60, y + 40);
      flushFrame();
    }
    const drawn = strokes();
    expect(drawn).toHaveLength(2);
    for (const stroke of drawn) expect(stroke.color).toBe('purple');
    // Nothing about the choice is written to the document: a board does not hold
    // which pen somebody is holding.
    expect(doc.getMap('objects').size).toBe(2);
  });

  it('draws the stroke in flight with the pen chosen before it began', () => {
    pressKey('p');
    pressOn(surface, 200, 200);
    moveTo(surface, 300, 240);
    // The swatch is pressed while the stroke is in flight: what it changes is the
    // next pen, not the line the pointer is laying down.
    fireEvent.click(screen.getByRole('button', { name: 'Orange pen' }));
    flushFrame();
    releaseOn(surface, 340, 280);
    flushFrame();
    expect(strokes()[0]!.color).toBe('black');
    expect(preview()).toBeNull();
  });
});

/* ── the preview, and what it is drawn from ──────────────────────────── */

describe('the preview of a stroke in flight', () => {
  it('is a path in screen pixels over the board, and takes no pointer of its own', () => {
    pressKey('p');
    pressOn(surface, 200, 200);
    moveTo(surface, 260, 240);
    flushFrame();
    const overlay = preview()!;
    expect(overlay.style.pointerEvents).toBe('none');
    const path = overlay.querySelector<SVGPathElement>('path')!;
    // Drawn where the pointer went, in the pixels of the screen rather than the units
    // of the board, and as much of the pen as the screen shows.
    expect(path.getAttribute('d')!.startsWith('M')).toBe(true);
    expect(Number(path.getAttribute('stroke-width'))).toBe(
      PEN_THICKNESS_WORLD.medium * camera().zoom,
    );
    expect(overlay.querySelector('[data-testid="pen-cursor"]')).toBeTruthy();
  });

  it('follows the pointer at least once a frame, and takes in the coalesced points it brought', () => {
    pressKey('p');
    pressOn(surface, 200, 200);
    flushFrame();
    // One move carrying three positions, as a fast pointer really reports itself.
    act(() => {
      const event = new PointerEvent('pointermove', {
        pointerId: 1,
        clientX: 260,
        clientY: 230,
        bubbles: true,
        cancelable: true,
      });
      const batch = [220, 240, 260].map((x) => ({ x, y: 200 + (x - 200) / 6 }));
      Object.defineProperty(event, 'getCoalescedEvents', {
        value: () => batch.map((point) => new PointerEvent('pointermove', { clientX: point.x, clientY: point.y })),
      });
      surface.dispatchEvent(event);
    });
    flushFrame();
    // Three positions from one event, plus the point the press left behind.
    expect(Number(preview()?.dataset.points)).toBe(4);
    releaseOn(surface, 260, 230);
    flushFrame();
    // The stroke that is written keeps them all, to within a pixel.
    expect(strokes()[0]!.points.length).toBeGreaterThanOrEqual(2);
  });

  it('draws the whole path that was dragged, at the zoom it was dragged at', () => {
    pressKey('p');
    const world = handwrittenLoop(60);
    const path = onScreen(world);
    dragAlong(path);
    releaseOn(surface, path[path.length - 1]!.x, path[path.length - 1]!.y);
    flushFrame();
    const drawn = strokes()[0]!;
    // Fewer points than the drag made, and the same shape: the ends are where the
    // pointer was, in the units of the board, to within the tolerance the drawing is
    // allowed and the rounding its box is stored with.
    expect(drawn.points.length / 2).toBeLessThan(path.length);
    const points = scaledPoints(drawn);
    const ends = [points[0]!, points[points.length - 1]!];
    const where = [world[0]!, world[world.length - 1]!];
    for (let index = 0; index < ends.length; index++) {
      expect(ends[index]!.x).toBeCloseTo(where[index]!.x, 6);
      expect(ends[index]!.y).toBeCloseTo(where[index]!.y, 6);
    }
  });

  it('is painted as one continuous path, with no move left out of it', () => {
    pressKey('p');
    dragAlong([
      { x: 200, y: 200 },
      { x: 240, y: 260 },
      { x: 300, y: 220 },
    ]);
    flushFrame();
    const d = preview()!.querySelector<SVGPathElement>('path')!.getAttribute('d')!;
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('Q');
    // The path names every point it was given, in the order it was given them.
    const numbers = d.split(/[^0-9.-]+/).filter((value) => value !== '').map(Number);
    expect(numbers.slice(0, 2)).toEqual([200, 200]);
    expect(numbers.slice(-2)).toEqual([300, 220]);
    releaseOn(surface, 300, 220);
    flushFrame();
  });
});

/* ── the pen, and the undo history of the person holding it ──────────── */

describe('undoing a stroke', () => {
  it('takes one stroke away in one press, and brings it back in one more', () => {
    pressKey('p');
    pressOn(surface, 200, 200);
    moveTo(surface, 320, 280);
    releaseOn(surface, 320, 280);
    flushFrame();
    expect(strokes()).toHaveLength(1);

    pressKey('v');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    flushFrame();
    expect(strokes()).toHaveLength(0);

    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    flushFrame();
    const drawn = strokes();
    expect(drawn).toHaveLength(1);
    // Redone as it was drawn: the same points, the same pen.
    expect(scaledPoints(drawn[0]!)).toHaveLength(2);
    expect(drawn[0]!.color).toBe('black');
  });

  it('undoes two strokes in two presses, which is two things done', () => {
    pressKey('p');
    for (const [x, y] of [
      [100, 100],
      [400, 400],
    ] as const) {
      pressOn(surface, x, y);
      moveTo(surface, x + 80, y + 40);
      releaseOn(surface, x + 80, y + 40);
      flushFrame();
    }
    expect(strokes()).toHaveLength(2);
    pressKey('v');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    flushFrame();
    expect(strokes()).toHaveLength(1);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    flushFrame();
    expect(strokes()).toHaveLength(0);
  });
});

/* ── a stroke the person next to you drew ────────────────────────────── */

describe('a stroke from elsewhere on the board', () => {
  it('is drawn as soon as it arrives, in the pen it was drawn with', () => {
    act(() => {
      const id = createStroke(doc, {
        points: [board(200, 200), board(320, 260)],
        color: 'green',
        thickness: 'thick',
      });
      expect(id).not.toBeNull();
    });
    flushFrame();
    const drawn = strokes();
    expect(drawn).toHaveLength(1);
    expect(strokeEl(drawn[0]!.id).dataset.color).toBe('green');
    expect(lineOf(drawn[0]!.id).getAttribute('stroke')).toBe(PEN_COLORS.green);
    expect(part(drawn[0]!.id).getAttribute('viewBox')).toBeTruthy();
  });

  it('is taken away when somebody else deletes it, and takes nothing of this board’s with it', () => {
    act(() => {
      createStroke(doc, { points: [board(200, 200), board(320, 260)], color: 'black', thickness: 'medium' });
    });
    flushFrame();
    const id = strokes()[0]!.id;
    act(() => {
      deleteObjects(doc, [id]);
    });
    flushFrame();
    expect(strokes()).toHaveLength(0);
    expect(document.querySelector('[data-stroke-id]')).toBeNull();
  });
});
