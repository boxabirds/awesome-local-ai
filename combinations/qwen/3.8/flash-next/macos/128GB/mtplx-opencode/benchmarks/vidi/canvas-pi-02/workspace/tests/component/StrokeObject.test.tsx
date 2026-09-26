/**
 * Component tests for the stroke *object* (story 11, design TC-15, TC-16, TC-21).
 *
 * A drawn stroke is a board object, which means the three things every object on
 * this board has to answer for: how it is picked, what it sits on, and what
 * happens when somebody else removes it. All three are decided by geometry rather
 * than by a DOM box, and jsdom has no layout — so the tests drive the same
 * geometry the running app uses (the camera maps screen pixels to world units, and
 * `hitTestStroke` is the function the board itself calls) instead of pretending
 * the browser is there.
 */
import { describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { deleteObjects, objectBounds, snapshot } from '../../src/shared/board-model';
import { hitTestStroke, toPoints } from '../../src/shared/objects/stroke';
import { flush, renderApp, type AppHarness } from './appHarness';
import { dispatch } from './harness';
import {
  circle,
  clickAt,
  draw,
  drawFast,
  handsOff,
  penOn,
  pointer,
  selectedIds,
  strokeElements,
  strokes,
} from './penScene';

/** The ink of a stroke, in world coordinates: its own points, moved into place. */
function inkInWorld(snap: { x: number; y: number; points: readonly number[] }) {
  return toPoints(snap.points).map((point) => ({
    x: snap.x + point.x,
    y: snap.y + point.y,
  }));
}

/**
 * A point `distance` screen pixels off the ink, measured square to it, expressed
 * as a screen coordinate at `zoom`. The middle of the line is used rather than an
 * end, and the offset is perpendicular, because "within six pixels of a stroke's
 * line" is a distance from the line and not a distance from its box.
 */
function offTheLine(
  snap: { x: number; y: number; points: readonly number[] },
  zoom: number,
  distance: number,
): { x: number; y: number } {
  const ink = inkInWorld(snap);
  const middle = Math.floor(ink.length / 2);
  const from = ink[middle - 1]!;
  const to = ink[middle]!;
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  // The unit normal of that segment, pointing to one side of the ink.
  const normal = { x: -(to.y - from.y) / length, y: (to.x - from.x) / length };
  const anchor = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const world = {
    x: anchor.x + (normal.x * distance) / zoom,
    y: anchor.y + (normal.y * distance) / zoom,
  };
  // The camera is parked at the origin in these tests, so screen = world × zoom.
  return { x: world.x * zoom, y: world.y * zoom };
}

/** A point that is on the ink: the middle of it, square to it. */
function onTheLine(
  snap: { x: number; y: number; points: readonly number[] },
  zoom: number,
): { x: number; y: number } {
  const ink = inkInWorld(snap);
  const middle = Math.floor(ink.length / 2);
  const anchor = {
    x: (ink[middle - 1]!.x + ink[middle]!.x) / 2,
    y: (ink[middle - 1]!.y + ink[middle]!.y) / 2,
  };
  return { x: anchor.x * zoom, y: anchor.y * zoom };
}

/**
 * A press and a lift on one element, which is how a pointer reaches a note: the
 * note listens on itself, so the event has to start there.
 */
async function pressOn(element: HTMLElement, x: number, y: number): Promise<void> {
  await dispatch(element, pointer('pointerdown', x, y, 1));
  await dispatch(element, pointer('pointerup', x, y, 0));
  await flush();
}

/** Park the camera at the origin at `zoom`, without touching the tool. */
async function zoomTo(harness: AppHarness, zoom: number): Promise<void> {
  await act(async () => {
    window.__vidi6?.setCamera({ x: 0, y: 0, zoom });
  });
  await flush();
  expect(harness.camera().zoom).toBe(zoom);
}

/** Look at the board with the select tool, at a given zoom. */
async function lookAt(harness: AppHarness, zoom: number): Promise<void> {
  await handsOff(harness);
  await zoomTo(harness, zoom);
}

describe('picking a stroke up by its line (TC-15)', () => {
  it('takes a short, thin line where the ink is, and nowhere else', async () => {
    const harness = renderApp();
    await penOn(harness);
    // A hand's width of empty board above and below it.
    await draw(harness, [
      { x: 300, y: 300 },
      { x: 340, y: 302 },
      { x: 380, y: 300 },
    ]);
    const drawn = strokes(harness);
    expect(drawn).toHaveLength(1);
    const id = drawn[0]!.id;

    // Drawing leaves the stroke selected, and a selected thing is deleted by a
    // `Delete` whether or not anything is under the cursor. Put that down first:
    // what a click does is the thing under test.
    await handsOff(harness);
    expect(selectedIds(harness)).toEqual([]);

    // Forty units above the ink is a click on the board.
    await clickAt(harness, 340, 342);
    expect(selectedIds(harness)).toEqual([]);
    await dispatch(window, new KeyboardEvent('keydown', { key: 'Delete' }));
    await flush();
    expect(strokes(harness)).toHaveLength(1);

    // A click on the ink takes it, and `Delete` answers.
    await clickAt(harness, 340, 301);
    expect(selectedIds(harness)).toEqual([id]);
    await dispatch(window, new KeyboardEvent('keydown', { key: 'Delete' }));
    await flush();
    expect(strokes(harness)).toHaveLength(0);
    expect(strokeElements(harness)).toHaveLength(0);
  });

  it('gives the same six pixels of slack at 50% and at 200%', async () => {
    const harness = renderApp();
    await penOn(harness);
    // One straight run of ink, so "five pixels off the line" has an exact meaning
    // at every zoom, and so the 200% case cannot pass by luck.
    await draw(harness, [
      { x: 200, y: 300 },
      { x: 250, y: 310 },
      { x: 300, y: 320 },
      { x: 350, y: 330 },
      { x: 400, y: 340 },
    ]);
    const stroke = strokes(harness)[0]!;

    for (const zoom of [1, 2, 0.5]) {
      await lookAt(harness, zoom);

      // Square on the ink: the drawing is under the cursor, so it is the drawing
      // the click belongs to.
      const onInk = onTheLine(stroke, zoom);
      await clickAt(harness, onInk.x, onInk.y);
      expect(selectedIds(harness)).toEqual([stroke.id]);

      await lookAt(harness, zoom);

      // Five screen pixels off it: still the line, because six is the allowance
      // and it is paid in screen pixels, not world units.
      const near = offTheLine(stroke, zoom, 5);
      await clickAt(harness, near.x, near.y);
      expect(selectedIds(harness)).toEqual([stroke.id]);

      await lookAt(harness, zoom);

      // And seven is the board.
      const away = offTheLine(stroke, zoom, 7);
      await clickAt(harness, away.x, away.y);
      expect(selectedIds(harness)).toEqual([]);
    }
  });

  it('takes a ring by its edge and lets the middle go', async () => {
    const harness = renderApp();
    await penOn(harness);
    await drawFast(harness, circle(400, 300, 90));
    const drawn = strokes(harness);
    expect(drawn).toHaveLength(1);
    const id = drawn[0]!.id;
    expect((drawn[0] as unknown as { closed: boolean }).closed).toBe(true);
    await handsOff(harness);

    // The middle of a ring is a hole. The pen draws through it, and so does a
    // click: a closed line is a line, not a filled shape.
    await clickAt(harness, 400, 300);
    expect(selectedIds(harness)).toEqual([]);

    // The top of that same ring is ink.
    await clickAt(harness, 400, 210);
    expect(selectedIds(harness)).toEqual([id]);
  });

  it('keeps its box the box of the ink, and its reach wider than that', async () => {
    const harness = renderApp();
    await penOn(harness);
    // A straight diagonal, so the gesture box and the ink box are one thing.
    await draw(harness, [
      { x: 200, y: 200 },
      { x: 300, y: 300 },
    ]);
    const stroke = strokes(harness)[0]!;
    const points = toPoints((stroke as unknown as { points: number[] }).points);
    const bounds = objectBounds(stroke as never);
    const ink = {
      width:
        Math.max(...points.map((point) => point.x)) -
        Math.min(...points.map((point) => point.x)),
      height:
        Math.max(...points.map((point) => point.y)) -
        Math.min(...points.map((point) => point.y)),
    };
    // The box the board reports is the box of the drawing. That is not an
    // oversight: the resize gesture measures this box and writes it back, so a
    // padding here would land in the ratio a proportional resize has to keep.
    expect(bounds.width).toBeCloseTo(ink.width, 6);
    expect(bounds.height).toBeCloseTo(ink.height, 6);
    expect(bounds.x).toBeCloseTo(stroke.x, 6);

    // The reach is a different matter, and it is wider: six screen pixels either
    // side of the ink is still the line, and further than that is the board.
    const onInk = { x: 51.5, y: 48.5 };
    const nearly = { x: 47.5, y: 52.5 };
    const offInk = { x: 50, y: 30 };
    // The distances are taken from the line, not from the box: the diagonal runs
    // through (50, 50), so these are 2.1, 3.5 and 14.1 units square to the ink.
    expect(hitTestStroke(stroke as never, onInk, 1)).toBe(true);
    expect(hitTestStroke(stroke as never, nearly, 1)).toBe(true);
    expect(hitTestStroke(stroke as never, offInk, 1)).toBe(false);
    // And the allowance is paid in screen pixels, which is the part a fixed world
    // width cannot say: the same 3.5 units are five pixels at 100% and seven at
    // 200%, so the second one is board.
    expect(hitTestStroke(stroke as never, onInk, 2)).toBe(true);
    expect(hitTestStroke(stroke as never, nearly, 2)).toBe(false);
    // Seen smaller, the same allowance is more world, which is what keeps a stroke
    // drawn small clickable when it is seen small.
    expect(hitTestStroke(stroke as never, nearly, 0.5)).toBe(true);
    expect(hitTestStroke(stroke as never, offInk, 0.5)).toBe(false);
  });
});

describe('what a stroke sits on (TC-16)', () => {
  it('lets a click in its empty box fall through to the note underneath', async () => {
    const harness = renderApp([{ x: 200, y: 200 }]);
    const note = harness.notes()[0]!;
    await penOn(harness);
    // Park the camera at the origin first: the drawing and the note are placed by
    // their world coordinates, and the empty spot between them is only provable if
    // both are read in the same frame of reference. The pen stays on: this is a
    // drawing, not a look.
    await zoomTo(harness, 1);
    // A "V" across the note: the middle of its box is a hundred units of nothing.
    await draw(harness, [
      { x: 210, y: 210 },
      { x: 300, y: 390 },
      { x: 395, y: 215 },
    ]);
    const drawn = strokes(harness);
    expect(drawn).toHaveLength(1);
    const stroke = drawn[0]!;
    const bounds = objectBounds(stroke as never);
    // The empty spot really is inside the stroke's box and really is over the
    // note, which is the whole point of the case.
    const empty = { x: 240, y: 320 };
    expect(empty.x).toBeGreaterThan(bounds.x);
    expect(empty.y).toBeGreaterThan(bounds.y + bounds.height / 2);
    expect(empty.x).toBeLessThan(bounds.x + bounds.width);
    expect(empty.y).toBeLessThan(bounds.y + bounds.height);
    expect(empty.x).toBeGreaterThan(note.x);
    expect(empty.y).toBeGreaterThan(note.y);

    await handsOff(harness);

    // A press on the note, in the empty half of the drawing's box, belongs to the
    // note: a stroke's box is not a target, and its layer never intercepts a
    // pointer (`pointer-events: none` on the ink).
    await pressOn(harness.noteElement(note.id), 240, 320);
    expect(selectedIds(harness)).toEqual([note.id]);

    await handsOff(harness);

    // And a press on the ink, dispatched the way it arrives — on the board,
    // because the ink does not take pointers — takes the drawing.
    await clickAt(harness, 250, 290);
    expect(selectedIds(harness)).toEqual([stroke.id]);
  });
});

describe('a stroke removed by somebody else (TC-21)', () => {
  it('lets go of a drawing that was deleted while it was selected', async () => {
    const harness = renderApp();
    await penOn(harness);
    await draw(harness, [
      { x: 200, y: 200 },
      { x: 260, y: 240 },
      { x: 320, y: 210 },
    ]);
    const stroke = strokes(harness)[0]!;
    await handsOff(harness);
    await clickAt(harness, 260, 240);
    expect(selectedIds(harness)).toEqual([stroke.id]);

    // The other person's client removes it. Nothing about this board is held
    // anywhere else, so this is the whole of the event.
    await act(async () => {
      expect(deleteObjects(harness.doc, [stroke.id])).toBe(1);
    });
    await flush();

    // The selection frame goes with it, rather than sitting on nothing: story 7's
    // stale-id handling, which a stroke has to be able to rely on.
    expect(selectedIds(harness)).toEqual([]);
    expect(strokeElements(harness)).toHaveLength(0);
    expect(snapshot(harness.doc).some((entry) => entry.id === stroke.id)).toBe(false);

    // And the board still answers: the next press selects, the next Delete deletes.
    await clickAt(harness, 100, 100);
    expect(selectedIds(harness)).toEqual([]);
  });

  it('moves a selected stroke without redrawing it', async () => {
    const harness = renderApp();
    await penOn(harness);
    await draw(harness, [
      { x: 200, y: 200 },
      { x: 260, y: 240 },
      { x: 320, y: 210 },
    ]);
    const before = strokes(harness)[0]!;
    const ink = toPoints((before as unknown as { points: number[] }).points);
    await handsOff(harness);
    await clickAt(harness, 260, 240);
    expect(selectedIds(harness)).toEqual([before.id]);

    // The arrows nudge the selection, which is the shortest way to ask whether a
    // stroke travels with it.
    await dispatch(window, new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await dispatch(window, new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    await flush();
    const after = strokes(harness)[0]!;
    expect(after.x).not.toBe(before.x);
    expect(after.y).not.toBe(before.y);
    // The ink came along whole: the same points, in the same order, in a box that
    // only moved.
    expect(toPoints((after as unknown as { points: number[] }).points)).toEqual(ink);
  });
});
