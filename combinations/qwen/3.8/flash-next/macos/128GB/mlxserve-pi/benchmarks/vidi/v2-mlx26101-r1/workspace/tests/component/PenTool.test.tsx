// pen.tool component tests (story 11, TC-09 to TC-14).
//
// The Pen tool is the only tool in this app judged on what it *does not* write, so nearly every
// test here reads the document as well as the screen:
//
//  * one press, one stroke, in the ink and nib that were chosen, and the pen still in the hand
//    afterwards — the whole of what distinguishes it from every other tool here (TC-09);
//  * a press that never moved is a dot: one point, in a box the size of the nib, because a box
//    of nothing is no box at all (TC-10);
//  * a press that was interrupted is still a stroke: what a hand made is not thrown away because
//    the browser stopped listening (TC-11);
//  * a path longer than one stroke may hold is cut into two, joined at a shared point (TC-12);
//  * putting the pen down writes nothing that was not already finished (TC-13);
//  * and choosing a new ink changes the next stroke and no other one (TC-14).
//
// Everything is pressed on the tool's own layer, because that is what a pointer is on while the
// pen is held: the layer is a sibling of the board surface, so a test that pressed the surface
// would be testing the Select tool (see `toolLayer` in ./helpers). Screen points are converted
// with the board's own camera rather than guessed at, since the board starts with world 0,0 in
// the middle of the viewport.
//
// One thing this environment cannot measure: `requestAnimationFrame` runs synchronously here
// (./setup), so a dispatch *is* a frame and the once-per-frame repaint rule cannot be counted.
// What is counted instead is the other half of the same promise — that no move goes unpainted.

import { describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { screenToWorld } from '../../src/client/canvas/camera';
import { objectSnapshots } from '../../src/shared/board-model';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
} from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { strokePolyline, type StrokeSnap } from '../../src/shared/objects/stroke';
import { LONG_SPIRAL, handwrittenLoop, underline } from '../fixtures/pen-paths';
import {
  boardDoc,
  clickByRole,
  createNote,
  penOptions,
  readCamera,
  renderBoard,
  strokes,
  toolLayer,
  windowKey,
} from './helpers';

/** The layer the pen is held in. */
const penLayer = () => toolLayer('pen-tool-layer');

/** Pick the pen up with the keyboard, the way the PRD's golden path does. */
function holdPen(): void {
  windowKey('p');
  // The options toolbar is the DOM's way of saying the pen is in the hand.
  screen.getByTestId('pen-toolbar');
}

/** Which tool the rail says is held: the only honest reading of the active tool. */
function toolPressed(name: string): boolean {
  return screen.getByRole('button', { name }).getAttribute('aria-pressed') === 'true';
}

/** The world point a screen point falls on, with the camera the board is rendered with. */
const worldOf = (p: Point): Point => screenToWorld(readCamera(), p);

/** Far apart, in board units. */
const apart = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** The last point of a stroke's line, where the board draws it. */
function endOf(s: StrokeSnap): Point {
  const line = strokePolyline(s);
  return line[line.length - 1]!;
}

/** Dispatch one pointer event and let the board render it. */
function send(
  el: Element | Window,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  at: Point,
): void {
  act(() => {
    fireEvent(
      el as Element,
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: at.x,
        clientY: at.y,
        button: 0,
      }),
    );
  });
}

/** Points delivered per dispatch: what a browser coalesces into one pointer event. */
const BURST = 250;

/**
 * Move the pointer through `points` on the window, where the tool listens.
 *
 * Delivered the way a browser delivers a fast drag: one dispatch per frame carrying every point
 * the pointer passed through since the last one (`getCoalescedEvents`). jsdom has no coalescing,
 * so the test hands the tool the same shape a real pointer event carries — the alternative is one
 * dispatch per point, each repainting the whole path, which is a slow way to test something that
 * is not about painting at all. What the tool reads is the same either way: the points the
 * pointer really passed through, in order.
 */
function moveThrough(points: readonly Point[]): void {
  for (let i = 0; i < points.length; i += BURST) {
    const batch = points.slice(i, i + BURST);
    const last = batch[batch.length - 1]!;
    const e = new MouseEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: last.x,
      clientY: last.y,
    });
    Object.defineProperty(e, 'getCoalescedEvents', {
      value: () =>
        batch.map(
          (at) =>
            new MouseEvent('pointermove', {
              button: 0,
              clientX: at.x,
              clientY: at.y,
            }) as unknown as PointerEvent,
        ),
    });
    act(() => {
      fireEvent(window, e);
    });
  }
}

/**
 * Draw a screen path with the pen: press the layer at the first point, move through the rest,
 * release on the window. `end: 'cancel'` stands for a pointercancel; `'none'` leaves the press in
 * the air for the test to finish itself.
 */
function draw(points: readonly Point[], end: 'up' | 'cancel' | 'none' = 'up'): void {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  send(penLayer(), 'pointerdown', first);
  moveThrough(points.slice(1));
  if (end === 'up') send(window, 'pointerup', last);
  else if (end === 'cancel') send(window, 'pointercancel', last);
}

/** The preview's path data, in screen pixels. */
function previewD(): string {
  return screen.getByTestId('pen-preview-path').getAttribute('d') ?? '';
}

/** How many curves the preview is made of: one per interior point of the path. */
function curves(): number {
  return (previewD().match(/Q/g) ?? []).length;
}

/** The numbers a path string is made of: the coordinates a browser is told to draw. */
function numbers(d: string): number[] {
  return (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** A screen point as a path writes it: two decimals, because a path cannot say more. */
const drawn = (p: Point): number[] => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100];

/** Every object in the document, whatever its type: the honest "did anything get written?". */
function boardObjects(): number {
  return objectSnapshots(boardDoc()).length;
}

describe('Pen tool (pen.tool)', () => {
  it('TC-09 draws one stroke in the chosen ink and nib, and stays the pen afterwards', () => {
    renderBoard();
    holdPen();
    clickByRole('red pen');
    clickByRole('Thick');
    expect(penOptions()).toEqual({ color: 'red', thickness: 'thick' });

    const path = underline(40);
    draw(path);

    const made = strokes();
    expect(made).toHaveLength(1);
    const stroke = made[0]!;
    // The pen's two settings are the stroke's, stored under the names the toolbar offered.
    expect(stroke.color).toBe('red');
    expect(stroke.thickness).toBe('thick');

    // And the line is where the pointer was. The ends of a simplified path are always its ends,
    // so they land on the press point and the release point to within a rounding.
    const line = strokePolyline(stroke);
    expect(apart(line[0]!, worldOf(path[0]!))).toBeLessThan(0.01);
    expect(apart(endOf(stroke), worldOf(path[path.length - 1]!))).toBeLessThan(0.01);

    // The pen is still in the hand — the rail says so — and the proof of that is that it draws
    // again without being picked up (pen.stay_active).
    expect(toolPressed('Pen (P)')).toBe(true);
    expect(toolPressed('Select (V)')).toBe(false);
    screen.getByTestId('pen-toolbar');

    draw(handwrittenLoop(30));
    expect(strokes()).toHaveLength(2);
    expect(strokes()[1]!.color).toBe('red');
  });

  it('TC-10 draws a dot for a press that never moved, in a box the size of the nib', () => {
    renderBoard();
    holdPen();
    clickByRole('Thick');
    const at = { x: 300, y: 250 };
    send(penLayer(), 'pointerdown', at);
    send(window, 'pointerup', at);

    const made = strokes();
    expect(made).toHaveLength(1);
    const stroke = made[0]!;
    // One point: not two at the same place, and not nothing. The tool decides that, and the
    // model gives the box its size — a dot's box is a square the width of the nib, which is the
    // only way a stroke with no length has a place on the board, and a round cap on a
    // zero-length subpath is what makes it round as well (pen.dot).
    expect(stroke.points).toHaveLength(2);
    const nib = PEN_THICKNESS_WORLD.thick;
    expect(stroke.width).toBe(nib);
    expect(stroke.height).toBe(nib);
    expect(apart(strokePolyline(stroke)[0]!, worldOf(at))).toBeLessThan(0.01);
  });

  it('a press that drifted inside the button slop is a dot too', () => {
    renderBoard();
    holdPen();
    const at = { x: 400, y: 300 };
    // Travel below DRAG_THRESHOLD_PX: a thumb rolling on a trackpad, not a stroke.
    draw([at, { x: at.x + DRAG_THRESHOLD_PX / 2, y: at.y + DRAG_THRESHOLD_PX / 3 }]);
    expect(strokes()).toHaveLength(1);
    expect(strokes()[0]!.points).toHaveLength(2);
  });

  it('TC-11 keeps the points drawn so far when the press is cancelled', () => {
    renderBoard();
    holdPen();
    const drawnSoFar = underline(30).slice(0, 12);
    send(penLayer(), 'pointerdown', drawnSoFar[0]!);
    moveThrough(drawnSoFar.slice(1));
    send(window, 'pointercancel', drawnSoFar[drawnSoFar.length - 1]!);

    const made = strokes();
    expect(made).toHaveLength(1);
    // The stroke ends at the last point the pointer actually reached — not at a point that was
    // never drawn, and not nowhere at all (pen.interrupted).
    expect(apart(endOf(made[0]!), worldOf(drawnSoFar[drawnSoFar.length - 1]!))).toBeLessThan(0.01);
    // Nothing of the press is left on the screen either: the preview went with the press.
    expect(screen.queryByTestId('pen-preview')).toBeNull();
    expect(penLayer().getAttribute('data-pen-drawing')).toBe('false');
  });

  it('TC-12 cuts a press that goes past the point limit into two strokes that join', () => {
    renderBoard();
    holdPen();
    // More points than one stroke may hold, so the path has to be cut at least once.
    expect(LONG_SPIRAL.length).toBeGreaterThan(STROKE_MAX_POINTS);
    draw(LONG_SPIRAL);

    const made = strokes();
    expect(made).toHaveLength(2);
    const [first, second] = made as [StrokeSnap, StrokeSnap];
    // Neither part holds more than the limit: the limit is on what is stored, not on what a hand
    // happens to send. The path is counted once per frame and then thinned by the smoothing, so
    // the part that crossed the limit may be carrying the points that frame arrived with.
    expect(first.points.length / 2).toBeLessThanOrEqual(STROKE_MAX_POINTS + BURST);
    expect(second.points.length / 2).toBeLessThanOrEqual(STROKE_MAX_POINTS);
    // And the seam is invisible because it is the same point: the second stroke begins exactly
    // where the first one ended, so one round cap lies on the other (pen.long_stroke).
    expect(apart(endOf(first), strokePolyline(second)[0]!)).toBeLessThan(1e-6);
  });

  it('TC-13 puts the pen down on Escape and writes nothing that was not finished', () => {
    renderBoard();
    holdPen();
    // Nothing was ever pressed, so nothing is written — and then V is pressed, which is the same
    // answer arriving by a different road.
    windowKey('Escape');
    expect(toolPressed('Select (V)')).toBe(true);
    expect(toolPressed('Pen (P)')).toBe(false);
    expect(screen.queryByTestId('pen-toolbar')).toBeNull();
    windowKey('v');
    expect(strokes()).toHaveLength(0);
    expect(boardObjects()).toBe(0);
  });

  it('a press still held when the pen is put down becomes a stroke', () => {
    renderBoard();
    holdPen();
    const path = underline(20);
    send(penLayer(), 'pointerdown', path[0]!);
    moveThrough(path.slice(1, 9));
    // Reaching for another tool mid-line is an interruption like any other: the line a hand made
    // is kept, because the alternative is losing work to a keystroke (pen.interrupted).
    windowKey('v');
    expect(strokes()).toHaveLength(1);
    expect(screen.queryByTestId('pen-preview')).toBeNull();
    // And the release that arrives afterwards writes nothing more: that press is already over.
    send(window, 'pointerup', path[9]!);
    expect(strokes()).toHaveLength(1);
  });

  it('TC-14 gives the next stroke the new ink and every earlier stroke its own', () => {
    renderBoard();
    holdPen();
    draw(underline(25));
    const drawn = strokes()[0]!;
    expect(drawn.color).toBe(DEFAULT_PEN_COLOR);

    clickByRole('blue pen');
    draw(handwrittenLoop(25));
    const [first, second] = strokes() as [StrokeSnap, StrokeSnap];

    // The stroke that was already there is untouched: the pen's settings are a promise about the
    // next stroke and not a style sheet over the board (pen.options).
    expect(first.color).toBe(DEFAULT_PEN_COLOR);
    expect(second.color).toBe('blue');
    // Including the ink it is painted with, which is what a person is looking at.
    expect(screen.getByTestId(`stroke-${first.id}`).getAttribute('data-stroke-color')).toBe(
      DEFAULT_PEN_COLOR,
    );
    expect(screen.getByTestId(`stroke-${second.id}`).getAttribute('data-stroke-color')).toBe('blue');
  });

  it('remembers the pen for this visit and not one reload longer', () => {
    renderBoard();
    holdPen();
    clickByRole('green pen');
    clickByRole('Thin');
    expect(penOptions()).toEqual({ color: 'green', thickness: 'thin' });

    // A new visit to the same board — the same component, mounted again — starts with the default
    // pen, because the choice was written down nowhere that outlives the tab (pen.options).
    cleanup();
    renderBoard();
    holdPen();
    expect(penOptions()).toEqual({
      color: DEFAULT_PEN_COLOR,
      thickness: DEFAULT_PEN_THICKNESS,
    });
  });

  it('draws with the ink chosen during the press, not the one held when it began', () => {
    renderBoard();
    holdPen();
    const path = underline(20);
    send(penLayer(), 'pointerdown', path[0]!);
    moveThrough(path.slice(1, 8));
    // A hand that reaches for another ink mid-line gets the ink it reached for: the settings are
    // read when the stroke is written, which is the only moment there is a stroke to give them to.
    clickByRole('red pen');
    moveThrough(path.slice(8));
    send(window, 'pointerup', path[path.length - 1]!);
    expect(strokes()[0]!.color).toBe('red');
  });

  it('paints the line as it goes and keeps it out of the document (pen.share)', () => {
    renderBoard();
    holdPen();
    const path = handwrittenLoop(60);
    send(penLayer(), 'pointerdown', path[0]!);

    // The preview exists from the first press, is painted in screen pixels, and is not in the
    // world layer: it belongs to this screen and to nobody else.
    expect(numbers(previewD()).slice(0, 2)).toEqual(drawn(path[0]!));
    expect(screen.getByTestId('pen-preview').closest('[data-testid="world-layer"]')).toBeNull();
    expect(screen.getByTestId('pen-preview-path').getAttribute('stroke')).toBe(
      PEN_COLORS[DEFAULT_PEN_COLOR],
    );
    expect(strokes()).toHaveLength(0);

    moveThrough(path.slice(1, 20));
    const midway = previewD();
    // The line begins where the press began, and has grown since.
    expect(numbers(midway).slice(0, 2)).toEqual(drawn(path[0]!));
    expect(numbers(midway).length).toBeGreaterThan(2);
    // Still nothing in the document: not a stroke, not a partial one, not a draft of one.
    expect(strokes()).toHaveLength(0);
    expect(boardObjects()).toBe(0);

    moveThrough(path.slice(20));
    send(window, 'pointerup', path[path.length - 1]!);
    // Now there is one, and the preview is gone: the line a person was watching becomes the thing
    // on the board, in the same place, without ever being two things at once.
    expect(strokes()).toHaveLength(1);
    expect(screen.queryByTestId('pen-preview')).toBeNull();
  });

  it('leaves no move unpainted as the line follows the pointer', () => {
    renderBoard();
    holdPen();
    const path = underline(60);
    send(penLayer(), 'pointerdown', path[0]!);
    // Two points are a straight run, not a curve yet, so the counting starts after the second.
    send(window, 'pointermove', path[1]!);
    send(window, 'pointermove', path[2]!);
    let before = curves();
    expect(before).toBe(1);
    for (const at of path.slice(3)) {
      send(window, 'pointermove', at);
      const after = curves();
      // One curve per interior point: a move that was not painted would leave this the same.
      expect(after).toBe(before + 1);
      before = after;
    }
    // And the line ends at the point the pointer is on right now.
    expect(numbers(previewD()).slice(-2)).toEqual(drawn(path[path.length - 1]!));
  });

  it('holds a round cursor the size of the nib, and a new one with a new nib', () => {
    renderBoard();
    holdPen();
    const cursor = () => penLayer().style.cursor;
    // A round cursor of the nib's size on the screen: CSS has no shape for "a circle this
    // diameter", and a crosshair says nothing about the pen in the hand (pen.draw).
    expect(cursor()).toContain('data:image/svg+xml');
    expect(cursor()).toContain('circle');
    expect(cursor()).toMatch(/,\s*crosshair$/);
    const thin = cursor();
    clickByRole('Thick');
    expect(cursor()).not.toBe(thin);
    expect(cursor()).toContain(encodeURIComponent('width="8"'));
  });

  it('leaves the board navigable while the pen is held (pen.navigation)', () => {
    renderBoard();
    holdPen();
    const before = readCamera();

    // A wheel is dispatched to the element under the pointer, which while the pen is held is the
    // tool's layer and not the board — so the layer has to hand the wheel on, or picking up a pen
    // would take scrolling away.
    act(() => {
      penLayer().dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: 120,
          clientX: 300,
          clientY: 200,
        }),
      );
    });
    expect(readCamera().y).toBeGreaterThan(before.y);

    // Ctrl/Cmd + wheel zooms, as it does on the board, and about the point under the pointer.
    act(() => {
      penLayer().dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: -300,
          ctrlKey: true,
          clientX: 300,
          clientY: 200,
        }),
      );
    });
    expect(readCamera().zoom).toBeGreaterThan(before.zoom);
  });

  it('takes the press for itself: the board does not pan and nothing under it moves', () => {
    renderBoard();
    const note = createNote(20, 20);
    const cameraBefore = readCamera();
    const noteBefore = objectSnapshots(boardDoc()).find((o) => o.id === note)!;
    holdPen();

    // A press that begins over the note and drags across it: with the Select tool that is a drag
    // of the note; with the pen it is a line drawn over it, and neither the note nor the camera
    // moves a pixel, because the press never leaves the pen's layer (pen.navigation).
    draw([
      { x: 700, y: 500 },
      { x: 760, y: 470 },
      { x: 820, y: 440 },
    ]);

    expect(readCamera()).toEqual(cameraBefore);
    const after = objectSnapshots(boardDoc()).find((o) => o.id === note)!;
    expect([after.x, after.y]).toEqual([noteBefore.x, noteBefore.y]);
    expect(strokes()).toHaveLength(1);
    // The note was passed over and not picked, either.
    expect(screen.getByTestId(`sticky-note-${note}`).getAttribute('data-selected')).toBe('false');
  });

  it('turns a double-click into two dots and not into a sticky note', () => {
    renderBoard();
    holdPen();
    const at = { x: 250, y: 500 };
    // Story 9's double-click-to-create belongs to the board surface; while the pen is held a
    // double-click is two dots, which is what a hand making two dots means.
    send(penLayer(), 'pointerdown', at);
    send(window, 'pointerup', at);
    fireEvent.doubleClick(penLayer(), { clientX: at.x, clientY: at.y });
    send(penLayer(), 'pointerdown', at);
    send(window, 'pointerup', at);
    expect(strokes()).toHaveLength(2);
    expect(objectSnapshots(boardDoc()).some((o) => o.type === 'sticky')).toBe(false);
  });
});
