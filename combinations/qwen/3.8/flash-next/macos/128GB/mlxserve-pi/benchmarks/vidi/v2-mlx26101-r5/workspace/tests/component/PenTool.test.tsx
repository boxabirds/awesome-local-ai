/**
 * TC-09 to TC-14 — the pen: what a drag draws, what a click leaves, what an interruption keeps.
 *
 * These tests are about a tool that holds the pointer, and everything in them follows from the way it holds
 * it. The Pen tool listens on the document, in the capture phase, and takes the event off the board — so
 * the tests dispatch ordinary pointer events at the board's own surface and the questions are asked of what
 * arrived in the document afterwards:
 *
 * — a drag writes one stroke, in the colour and thickness that were lit, and the tool is still the pen
 *   afterwards (TC-09), because a person sketching draws several lines and a tool that put them back to the
 *   arrow pointer between every two of them would be a tool they had to switch back by hand;
 * — a press that did not travel is a dot and not a mistake (TC-10), one point, as wide as its own pen;
 * — an interruption is a *finished* stroke rather than a discarded one (TC-11), which is the opposite of
 *   every other tool on this board and is the difference between losing a sketch to a trackpad pinch and
 *   keeping it;
 * — a drag long enough to be two objects is written as two that join (TC-12), and the join is exact: the
 *   second starts on the point the first ended on;
 * — Escape is the one thing that *does* throw a half-drawn line away (TC-13), because the key that ends a
 *   tool ends its unfinished drags, and a stroke is unfinished until the pen lifts;
 * — and the colour of a stroke is in the stroke (TC-14): picking green after drawing in black recolours
 *   nothing that already exists, which is the same rule a sticky note's palette obeys.
 *
 * jsdom has no layout and no painting, so nothing here asserts where a pixel landed. The preview is asserted
 * as an element with a path in it — its `d` is the drawing, and the numbers in the document are what it was
 * drawn from.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { screenToWorld } from '../../src/client/canvas/camera';
import {
  PEN_COLOR_NAMES,
  PEN_THICKNESS_NAMES,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
} from '../../src/shared/config';
import {
  createStroke,
  isStrokeSnapshot,
  scaledPoints,
  strokeColorOf,
  type StrokeSnapshot,
} from '../../src/shared/objects/stroke';
import {
  act as actOn,
  board,
  click,
  dispatchWheel,
  nextFrame,
  pointer,
  pressKey,
  renderBoard,
  renderedCamera,
  type BoardFixture,
} from './harness';
import { handwrittenLoop, longSpiral } from '../fixtures/pen-paths';
import type { Point } from '../../src/client/canvas/camera';

/** Presses a key where the board listens, and says whether the board swallowed it. */
async function key(k: string): Promise<boolean> {
  let swallowed = true;
  await actOn(async () => {
    // False means somebody called preventDefault, which is the difference between a key the board
    // answered and a key it left for the browser.
    swallowed = !fireEvent.keyDown(window, { key: k });
    await nextFrame();
  });
  return swallowed;
}

/** The tool the board says the pointer is in, read off the board itself. */
const toolOnScreen = (): string | undefined => board().dataset['tool'];

/** The world point a point on the screen is, as the board's own camera says. */
const worldAt = (point: Point): Point => screenToWorld(renderedCamera(), point);

/** Every stroke on the board, in stacking order. */
const strokes = (fixture: BoardFixture): readonly StrokeSnapshot[] => fixture.objects().filter(isStrokeSnapshot);

/** The one stroke on the board, of which there must be exactly one. */
function onlyStroke(fixture: BoardFixture): StrokeSnapshot {
  const list = strokes(fixture);
  if (list.length !== 1) throw new Error(`expected one stroke, found ${list.length}`);
  return list[0] as StrokeSnapshot;
}

/** The path the preview is drawing, or null when nothing is being drawn. */
const previewPath = (): SVGPathElement | null =>
  document.querySelector<SVGPathElement>('[data-testid="pen-preview-path"]');

/** Clicks one of the pen's buttons the way a person does. */
async function pick(testId: string): Promise<void> {
  await actOn(async () => {
    fireEvent.click(screen.getByTestId(testId));
    await nextFrame();
  });
}

/** Chooses a colour and a thickness off the pen's toolbar, in the order they are asked for. */
async function choose(color: string, thickness: string): Promise<void> {
  await pick(`pen-color-${color}`);
  await pick(`pen-thickness-${thickness}`);
}

/**
 * A drag, in screen pixels, point by point.
 *
 * Every point is its own pointer event, and the frames are let through at the ends of the drag rather than
 * in the middle of it — which is what a fast mouse does to a browser that paints sixty times a second. What
 * the pen is asked to do with the events — record every one of them, draw once a frame — is the thing under
 * test, and a test that waited a frame between every point would be testing a slow mouse instead.
 */
async function drag(points: readonly Point[], pointerId = 1): Promise<void> {
  const first = points[0] as Point;
  const last = points[points.length - 1] as Point;
  pointer('pointerDown', board(), { ...first, pointerId });
  await actOn(nextFrame);
  for (const point of points.slice(1, -1)) {
    pointer('pointerMove', board(), { ...point, pointerId });
  }
  await actOn(nextFrame);
  pointer('pointerUp', board(), { ...last, pointerId });
  await actOn(nextFrame);
}

/** The same drag, stopped in the middle by the system taking the pointer back. */
async function interrupted(points: readonly Point[], event: 'pointerCancel' | 'lostPointerCapture'): Promise<void> {
  const first = points[0] as Point;
  const last = points[points.length - 1] as Point;
  pointer('pointerDown', board(), first);
  await actOn(nextFrame);
  for (const point of points.slice(1, -1)) {
    pointer('pointerMove', board(), point);
  }
  await actOn(nextFrame);
  // The two ways a pen comes off the paper without anybody lifting it: the system cancels the pointer, or it
  // takes back the capture the tool asked for. Neither is a person changing their mind.
  fireEvent[event](board(), { pointerId: 1, clientX: last.x, clientY: last.y });
  await actOn(nextFrame);
}

/** The spiral of the fixture, moved into the middle of the screen and scaled to fit the window. */
const spiral = (count: number): Point[] =>
  longSpiral
    .slice(0, count)
    .map((point) => ({ x: 200 + Math.round(point.x * 100) / 100, y: 200 + Math.round(point.y * 100) / 100 }));

/** A line long enough to be a drag, in screen pixels. */
const strokePoints: readonly Point[] = [
  { x: 300, y: 200 },
  { x: 340, y: 240 },
  { x: 380, y: 230 },
  { x: 420, y: 280 },
  { x: 460, y: 260 },
];

describe('the Pen tool', () => {
  it('TC-09 drags a line in the colour and thickness that were lit, and stays the pen', async () => {
    const fixture = renderBoard();
    expect(await key('p')).toBe(true);
    expect(toolOnScreen()).toBe('pen');
    await choose('red', 'thick');

    await drag(strokePoints);

    const stroke = onlyStroke(fixture);
    expect(stroke.color).toBe('red');
    expect(stroke.thickness).toBe('thick');
    // The points it wrote are the ones that were drawn, in world units: the same path, converted once, and
    // the whole of the drawing the drag made.
    const drawn = strokePoints.map(worldAt);
    const kept = scaledPoints(stroke);
    expect(kept[0]).toEqual(drawn[0]);
    expect(kept[kept.length - 1]).toEqual(drawn[drawn.length - 1]);

    // The pen is still the pen. This is the assertion the whole tool is organised around: nothing hands the
    // pointer back, so the next drag is another stroke and not a click on the board.
    expect(toolOnScreen()).toBe('pen');
    expect(screen.getByTestId('tool-pen').getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-09 writes nothing into the document while the pen is down, and the preview on the screen', async () => {
    const fixture = renderBoard();
    await key('p');
    // Nothing is being drawn until the pen touches the paper.
    expect(previewPath()).toBeNull();

    pointer('pointerDown', board(), strokePoints[0] as Point);
    await actOn(nextFrame);
    for (const point of strokePoints.slice(1)) {
      pointer('pointerMove', board(), point);
    }
    await actOn(nextFrame);

    // The line is on the screen — a path, smoothed through the points, in the pen's colour and width.
    const path = previewPath();
    expect(path).not.toBeNull();
    expect(path?.getAttribute('d')).toMatch(/^M/);
    expect(path?.getAttribute('stroke')).toBe(strokeColorOf('black'));
    expect(path?.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.medium * renderedCamera().zoom));
    // …and it is nowhere in the document, which is the whole of why nobody else sees a stroke being drawn:
    // there is nothing in the document for the sync layer to carry.
    expect(strokes(fixture)).toHaveLength(0);

    pointer('pointerUp', board(), strokePoints[strokePoints.length - 1] as Point);
    await actOn(nextFrame);

    expect(strokes(fixture)).toHaveLength(1);
    // The preview goes away when the object arrives: one line on the screen, not two.
    expect(previewPath()).toBeNull();
  });

  it('TC-10 leaves a dot where the pen was pressed and lifted', async () => {
    const fixture = renderBoard();
    await key('p');
    await choose('blue', 'thick');

    const at = { x: 400, y: 300 };
    pointer('pointerDown', board(), at);
    await actOn(nextFrame);
    // A tremor between down and up is not a line: a few pixels of jitter is still a press and a release.
    pointer('pointerMove', board(), { x: at.x + 2, y: at.y + 1 });
    pointer('pointerUp', board(), { x: at.x + 1, y: at.y + 2 });
    await actOn(nextFrame);

    const stroke = onlyStroke(fixture);
    expect(stroke.color).toBe('blue');
    expect(stroke.thickness).toBe('thick');
    // One point, which the round cap draws as a circle; the box is the dot's own square, exactly as wide as
    // the pen that made it and no wider.
    expect(scaledPoints(stroke)).toHaveLength(1);
    expect(scaledPoints(stroke)[0]).toEqual(worldAt(at));
    expect(stroke.width).toBe(PEN_THICKNESS_WORLD.thick);
    expect(stroke.height).toBe(PEN_THICKNESS_WORLD.thick);
  });

  it('TC-10 writes no stroke for a press on the pen toolbar itself', async () => {
    const fixture = renderBoard();
    // A press on a swatch is a press on the pen's own controls and draws nothing, whatever tool is lit —
    // the same rule every tool obeys, because a toolbar the pen draws through is a toolbar that stopped
    // working.
    await key('p');
    await pick('pen-color-red');
    expect(strokes(fixture)).toHaveLength(0);
    expect(toolOnScreen()).toBe('pen');
  });

  it('TC-11 keeps the points drawn when the system cancels the pointer', async () => {
    const fixture = renderBoard();
    await key('p');

    await interrupted(strokePoints, 'pointerCancel');

    // The line somebody drew is worth more than the interruption that ended it: it is finished, not thrown
    // away, and it is finished from the points that arrived.
    const stroke = onlyStroke(fixture);
    const kept = scaledPoints(stroke);
    expect(kept.length).toBeGreaterThan(1);
    expect(kept[0]).toEqual(worldAt(strokePoints[0] as Point));
    expect(strokes(fixture)).toHaveLength(1);
    // …and the tool is still the pen, because an interruption is not a person asking for the arrow back.
    expect(toolOnScreen()).toBe('pen');
  });

  it('TC-11 keeps the points drawn when the pointer capture is lost', async () => {
    const fixture = renderBoard();
    await key('p');

    await interrupted(strokePoints, 'lostPointerCapture');

    const stroke = onlyStroke(fixture);
    const kept = scaledPoints(stroke);
    expect(kept[0]).toEqual(worldAt(strokePoints[0] as Point));
    // The last point that arrived is the last point kept: the capture went away at the end of the drag, and
    // everything up to there is on the board.
    expect(kept[kept.length - 1]).toEqual(worldAt(strokePoints[strokePoints.length - 1] as Point));
  });

  it('TC-11 writes nothing when a stray pointer comes back with no stroke behind it', async () => {
    const fixture = renderBoard();
    await key('p');
    // A capture lost on a pointer the pen never took: there is nothing to finish, and finishing it must not
    // invent a stroke out of the absence of one.
    fireEvent.lostPointerCapture(board(), { pointerId: 7, clientX: 100, clientY: 100 });
    pointer('pointerUp', board(), { x: 100, y: 100, pointerId: 7 });
    await actOn(nextFrame);
    expect(strokes(fixture)).toHaveLength(0);
  });

  it('TC-12 writes a drag past the limit as two strokes that join at the same point', async () => {
    const fixture = renderBoard();
    await key('p');

    // The fixture is a spiral of 5,010 points and the limit is 5,000. Every point is dispatched as its own
    // event, because a point missed on the way in is a corner missing from the drawing.
    const points = spiral(STROKE_MAX_POINTS + 10);
    expect(points.length).toBe(STROKE_MAX_POINTS + 10);
    await drag(points);

    const list = strokes(fixture);
    expect(list).toHaveLength(2);
    const first = scaledPoints(list[0] as StrokeSnapshot);
    const second = scaledPoints(list[1] as StrokeSnapshot);
    // The join. Not "close to" in the sense of "near": the point the first stroke ends on is the point the
    // second starts on, to the last decimal the box can carry — which is what "the two parts meet" means
    // once the points are stored relative to a box that is padded by half the ink on every side.
    expect(second[0]!.x).toBeCloseTo(first[first.length - 1]!.x, 9);
    expect(second[0]!.y).toBeCloseTo(first[first.length - 1]!.y, 9);
    // Both parts are within the limit, and between them they hold the ends of what was drawn.
    expect(first.length).toBeLessThanOrEqual(STROKE_MAX_POINTS);
    expect(second.length).toBeLessThanOrEqual(STROKE_MAX_POINTS);
    expect(first[0]).toEqual(worldAt(points[0] as Point));
    expect(second[second.length - 1]).toEqual(worldAt(points[points.length - 1] as Point));
  });

  it('TC-12 writes one stroke for a drag that stops one point short of the limit', async () => {
    const fixture = renderBoard();
    await key('p');
    await drag(spiral(STROKE_MAX_POINTS - 1));
    expect(strokes(fixture)).toHaveLength(1);
  });

  it('TC-13 throws the half-drawn line away on Escape, and takes the pen with it', async () => {
    const fixture = renderBoard();
    await key('p');

    pointer('pointerDown', board(), strokePoints[0] as Point);
    await actOn(nextFrame);
    for (const point of strokePoints.slice(1)) {
      pointer('pointerMove', board(), point);
    }
    await actOn(nextFrame);
    expect(previewPath()).not.toBeNull();

    expect(await key('Escape')).toBe(true);
    expect(toolOnScreen()).toBe('select');
    // The key that ends a tool ends its unfinished drags. The line that was half drawn wrote nothing, and the
    // preview that was showing it is gone with the tool that drew it.
    expect(strokes(fixture)).toHaveLength(0);
    expect(previewPath()).toBeNull();

    // And the letter that follows is a tool change rather than a stroke: the pointer is a pointer again.
    expect(await key('v')).toBe(true);
    expect(toolOnScreen()).toBe('select');
    expect(strokes(fixture)).toHaveLength(0);
  });

  it('TC-13 stops drawing the moment another tool is chosen, and writes nothing after', async () => {
    const fixture = renderBoard();
    await key('p');
    pointer('pointerDown', board(), strokePoints[0] as Point);
    await actOn(nextFrame);
    pointer('pointerMove', board(), strokePoints[1] as Point);
    await actOn(nextFrame);

    await key('s');
    expect(toolOnScreen()).toBe('shape');
    expect(strokes(fixture)).toHaveLength(0);

    // The release that belongs to a tool that is no longer there writes nothing either: the pointer went
    // down as a pen and came up under a shape tool, and neither of them asked for a stroke.
    pointer('pointerUp', board(), strokePoints[2] as Point);
    await actOn(nextFrame);
    expect(strokes(fixture)).toHaveLength(0);
  });

  it('TC-14 leaves the stroke already drawn alone when the colour changes, and uses the new one next', async () => {
    const fixture = renderBoard();
    await key('p');

    await drag(strokePoints);
    const before = onlyStroke(fixture);
    expect(before.color).toBe('black');
    const box = fixture.boundsOf(before.id);
    const points = scaledPoints(before);

    await pick('pen-color-green');

    // The colour of a stroke is in the stroke. Choosing a different pen is not a paint bucket: the line that
    // was drawn in black is black, in the document and in the element that draws it, until somebody deletes
    // it.
    expect(onlyStroke(fixture).color).toBe('black');
    expect(fixture.boundsOf(before.id)).toEqual(box);
    expect(scaledPoints(onlyStroke(fixture))).toEqual(points);
    const el = fixture.objectEl(before.id);
    expect(el?.getAttribute('data-color')).toBe('black');

    const rest = strokePoints.map((point) => ({ x: point.x, y: point.y + 120 }));
    await drag(rest);

    const list = strokes(fixture);
    expect(list).toHaveLength(2);
    expect((list[1] as StrokeSnapshot).color).toBe('green');
    // …and the thickness it was drawn with is the one that was lit then, not now.
    expect((list[1] as StrokeSnapshot).thickness).toBe('medium');
  });

  it('TC-14 keeps the choice for every later stroke, and for nothing else', async () => {
    const fixture = renderBoard();
    await key('p');
    await choose('purple', 'thin');

    await drag(strokePoints);
    await drag(strokePoints.map((point) => ({ x: point.x + 40, y: point.y + 40 })));

    const list = strokes(fixture);
    expect(list).toHaveLength(2);
    for (const stroke of list) {
      expect(stroke.color).toBe('purple');
      expect(stroke.thickness).toBe('thin');
    }
  });

  it('offers six colours and three thicknesses, lit at the ones the next stroke will use', async () => {
    renderBoard();
    await key('p');

    expect(screen.getAllByTestId(/^pen-color-/)).toHaveLength(PEN_COLOR_NAMES.length);
    expect(screen.getAllByTestId(/^pen-thickness-/)).toHaveLength(PEN_THICKNESS_NAMES.length);
    // The names the toolbar says out loud are the names the model stores: six "<colour> pen" buttons and
    // three buttons called Thin, Medium and Thick.
    for (const name of PEN_COLOR_NAMES) {
      expect(screen.getByRole('button', { name: `${name} pen` })).not.toBeNull();
    }
    for (const name of ['Thin', 'Medium', 'Thick']) {
      expect(screen.getByRole('button', { name })).not.toBeNull();
    }

    // Black and Medium, which is what an untouched toolbar has lit, and which is the state a stroke drawn
    // without touching anything comes out in.
    expect(screen.getByTestId('pen-color-black').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('pen-thickness-medium').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('pen-color-red').getAttribute('aria-pressed')).toBe('false');

    await pick('pen-color-red');
    await pick('pen-thickness-thin');
    expect(screen.getByTestId('pen-color-red').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('pen-color-black').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('pen-thickness-thin').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('pen-thickness-medium').getAttribute('aria-pressed')).toBe('false');
  });

  it('shows its toolbar only while the pen is the tool', async () => {
    renderBoard();
    // The pen's rows answer a question that only means something while the pen is lit, so they are not on
    // the screen at any other time.
    expect(screen.queryByTestId('pen-toolbar')).toBeNull();
    await key('p');
    expect(screen.queryByTestId('pen-toolbar')).not.toBeNull();
    await key('Escape');
    expect(screen.queryByTestId('pen-toolbar')).toBeNull();
    await key('t');
    expect(screen.queryByTestId('pen-toolbar')).toBeNull();
  });

  it('says what its button is, and puts a dot the size of the pen under the pointer', async () => {
    renderBoard();
    const button = screen.getByTestId('tool-pen');
    expect(button.getAttribute('title')).toBe('Pen – or press P');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('disabled')).toBeNull();

    await key('p');
    expect(screen.getByTestId('tool-pen').getAttribute('aria-pressed')).toBe('true');

    // The cursor is the pen: a round dot as wide as the ink is on this screen, which is the thickness times
    // the zoom. Nothing in CSS can size a cursor from a document setting, so the tool draws one.
    const zoom = renderedCamera().zoom;
    const cursor = screen.getByTestId('pen-cursor');
    expect(cursor.style.width).toBe(`${PEN_THICKNESS_WORLD.medium * zoom}px`);
    expect(cursor.style.height).toBe(`${PEN_THICKNESS_WORLD.medium * zoom}px`);
    expect(cursor.style.borderRadius).toBe('50%');
    expect(cursor.style.visibility).toBe('hidden');

    await pick('pen-thickness-thick');
    expect(screen.getByTestId('pen-cursor').style.width).toBe(`${PEN_THICKNESS_WORLD.thick * zoom}px`);

    // It follows the pointer, centred on it, without a render per move.
    pointer('pointerMove', board(), { x: 500, y: 260 });
    await actOn(nextFrame);
    const moved = screen.getByTestId('pen-cursor');
    expect(moved.style.visibility).toBe('visible');
    expect(moved.style.transform).toBe(
      `translate(${500 - (PEN_THICKNESS_WORLD.thick * zoom) / 2}px, ${260 - (PEN_THICKNESS_WORLD.thick * zoom) / 2}px)`,
    );
  });

  it('pans the board on a wheel while the pen is lit, which is the one thing still navigating', async () => {
    const fixture = renderBoard();
    await key('p');
    const before = renderedCamera();

    dispatchWheel(board(), { deltaY: 120 });
    await actOn(nextFrame);

    expect(renderedCamera().y).not.toBe(before.y);
    // …and nothing was drawn by a wheel that was never a drag.
    expect(strokes(fixture)).toHaveLength(0);

    // Ctrl+wheel zooms, exactly as it does with every other tool lit: the pen takes pointer drags, and the
    // wheel was never one.
    const zoomBefore = renderedCamera().zoom;
    dispatchWheel(board(), { deltaY: -100, ctrlKey: true });
    await actOn(nextFrame);
    expect(renderedCamera().zoom).toBeGreaterThan(zoomBefore);
  });

  it('takes a drag that starts on a sticky note and leaves the note where it was', async () => {
    const fixture = renderBoard();
    const note = await fixture.create(640, 400);
    await key('p');

    const onNote = fixture.screenOf(note);
    const before = fixture.boundsOf(note);
    await drag([
      { x: onNote.x, y: onNote.y },
      { x: onNote.x + 60, y: onNote.y + 40 },
      { x: onNote.x + 120, y: onNote.y + 20 },
    ]);

    // The note did not move, and it is not selected: the press that began the stroke was not a press on it.
    expect(fixture.boundsOf(note)).toEqual(before);
    expect(fixture.selection().size).toBe(0);
    expect(strokes(fixture)).toHaveLength(1);
  });

  it('draws a circle round a cluster without moving anything in it', async () => {
    const fixture = renderBoard();
    const note = await fixture.create(640, 400);
    const noteBox = fixture.boundsOf(note);
    await actOn(async () => {
      createStroke(
        fixture.doc(),
        { points: [{ x: 700, y: 300 }, { x: 900, y: 500 }], color: 'red', thickness: 'thick' },
        'sam',
      );
      await nextFrame();
    });
    const drawn = strokes(fixture)[0] as StrokeSnapshot;
    const drawnBox = fixture.boundsOf(drawn.id);
    await key('p');

    // A circle drawn round a cluster starts on something in the cluster, which is the case the whole
    // capture-phase hold exists for.
    await drag(handwrittenLoop.map((point) => ({ x: 240 + point.x * 0.4, y: 160 + point.y * 0.4 })));

    expect(fixture.boundsOf(note)).toEqual(noteBox);
    expect(fixture.boundsOf(drawn.id)).toEqual(drawnBox);
    expect(strokes(fixture)).toHaveLength(2);
    expect(toolOnScreen()).toBe('pen');
  });

  it('writes one undo step per stroke, whatever the drag looked like on the way', async () => {
    const fixture = renderBoard();
    await key('p');
    await drag(strokePoints);
    expect(strokes(fixture)).toHaveLength(1);

    // One drag is one thing a person did, and one thing is one step: the five pointer events that made it
    // are not five things they now have to take back.
    pressKey('z');
    await actOn(nextFrame);
    expect(strokes(fixture)).toHaveLength(0);

    // …and one press puts the whole line back, because it was never five strokes in the first place.
    pressKey('y');
    await actOn(nextFrame);
    expect(strokes(fixture)).toHaveLength(1);
  });

  it('leaves the selection it found alone, because the pen is still what a person is holding', async () => {
    const fixture = renderBoard();
    const note = await fixture.create(640, 400);
    // Clicked rather than pressed and held: a pointer that is down on a note is not a pointer that is drawing
    // with a pen, and the board is right to finish the first before it starts the second.
    await click(fixture.objectEl(note) as HTMLElement);
    expect(fixture.selection().selectedId).toBe(note);

    await key('p');
    await drag(strokePoints);

    // The pen neither clears the selection it found nor claims the stroke it made: the note is still
    // selected, the stroke is not, and the tool is still the pen — which is the state a second stroke needs
    // to be one stroke rather than a move of the first.
    expect(fixture.selection().ids.has(note)).toBe(true);
    expect(fixture.selection().size).toBe(1);
    expect(strokes(fixture)).toHaveLength(1);
    expect(toolOnScreen()).toBe('pen');
  });

  it('is entered by P and left by the toolbar, like every other tool', async () => {
    const fixture = renderBoard();
    expect(await key('p')).toBe(true);
    expect(toolOnScreen()).toBe('pen');

    // Clicking the pen's button again is not a toggle: a tool button chooses a tool, it does not cycle one
    // off, and the board that is already on the pen stays on the pen.
    await actOn(async () => {
      fireEvent.click(screen.getByTestId('tool-pen'));
      await nextFrame();
    });
    expect(toolOnScreen()).toBe('pen');

    await actOn(async () => {
      fireEvent.click(screen.getByTestId('tool-select'));
      await nextFrame();
    });
    expect(toolOnScreen()).toBe('select');
    expect(strokes(fixture)).toHaveLength(0);
  });
});
