/**
 * Drawing with the pen (story 11, TC-09 to TC-14).
 *
 * Five things can go wrong with a tool that draws, and there is a test for each:
 *
 *   - TC-09 — a tool that writes on every pointermove puts four hundred drawings on five people's boards while
 *     one line is being drawn. So: a preview while the pointer travels, the document empty the whole way, and
 *     one stroke when the pointer lets go.
 *   - TC-10 — a pen that commits nothing when the pointer goes down and up again does not draw dots, and a
 *     drawing that cannot be a dot is a drawing that cannot be a period.
 *   - TC-11 — a pen lifted is a line finished, not a line thrown away: the stroke is in the document after a
 *     `pointercancel` too.
 *   - TC-12 — one gesture longer than a stroke may hold becomes two strokes that share the point where the
 *     split happened, so the line goes on and does not jump.
 *   - TC-13/TC-14 — the options belong to the pen and not to the board: Escape abandons the tool without
 *     writing anything, and choosing a new ink changes the next line and never the last one.
 *
 * Everything is done on the tool's own sheet, because with the pen armed the sheet is what the browser's
 * pointer is over; the moves and the release go to the window, because a hand that draws off the edge of the
 * window still has to finish the line it was drawing. Each test frames the camera on the world origin, so the
 * board points it presses are the numbers the design writes.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import {
  activeTool,
  addStroke,
  armPenTool,
  frameAtOrigin,
  penDraw,
  penDown,
  penPressed,
  penPreviewD,
  penPreviewPaint,
  penSheet,
  penStatus,
  penTap,
  penToolbar,
  penTrace,
  pressKey,
  pressPenColor,
  pressPenThickness,
  scaledPoints,
  screenOf,
  strokes,
  upWindow,
} from './helpers/tools';
import {
  around,
  cancelWindow,
  objectById,
  outlinedIds,
  pressEscape,
  marqueeAround,
  screenRect,
} from './helpers/selection';
import { createSticky } from '../../src/shared/board-model';
import { doc, renderBoard, stickies, surface } from './helpers/stickyBoard';
import { STROKE_MAX_POINTS } from '../../src/shared/config';
import { count, extent, firstOf, lastOf, letterAStrokes, longSpiral, underline } from '../fixtures/pen-paths';

describe('drawing with the pen (TC-09 to TC-12)', () => {
  beforeEach(() => {
    renderBoard();
    frameAtOrigin();
  });

  it('TC-09: previews while the pointer travels and commits once when it lets go', async () => {
    await armPenTool();
    pressPenColor('red');
    pressPenThickness('thick');

    // A hand-drawn underline: a hundred and twenty points that wander a little off the straight.
    const path = underline({ count: 120, x: 100, y: 120, length: 300 });
    penDown(firstOf(path));
    // The preview is drawn straight away, so there is never a gap where the pen is down and nothing is seen.
    expect(screen.getByTestId('pen-preview-path')).toBeInTheDocument();
    // …and the document is empty: the gesture belongs to this tab and to no one's board yet.
    expect(strokes()).toHaveLength(0);

    penTrace(path.slice(1, 60));
    expect(strokes()).toHaveLength(0);
    // The preview has followed the pointer: it is longer than it was after the press.
    const drawn = penPreviewD() ?? '';
    expect(drawn.split(' ').length).toBeGreaterThan(1);
    // It is drawn in the ink that is chosen, at the size that is chosen, in screen units: the nib is four
    // board units and the board is drawn 1:1, so eight screen pixels is what the thick pen paints.
    expect(penPreviewPaint()).toMatchObject({ stroke: '#E53935', width: '8' });

    penTrace(path.slice(60));
    expect(strokes()).toHaveLength(0);
    upWindow(screenOf(lastOf(path)));

    await waitFor(() => expect(strokes()).toHaveLength(1));
    const stroke = strokes()[0]!;
    expect(stroke).toMatchObject({ type: 'stroke', color: 'red', thickness: 'thick' });
    // Who drew it is recorded, anonymised to this board's own client id: the test board has no identity, and a
    // stroke that claimed nobody drew it would be a stroke no collaborator could attribute.
    expect(stroke.createdBy).not.toBe('');
    // The line it drew: in board units, relative to its own box, and shorter than the pointer's path because
    // the smoothing is allowed a screen pixel of slack. The box still covers the wobble.
    expect(stroke.points.length).toBeGreaterThanOrEqual(2);
    expect(stroke.points.length).toBeLessThan(count(path) * 2);
    // The box covers everything the pen visited, with the nib's own paint accounted for: half a nib of four
    // board units on each side, and not a pixel more, because a box wider than that is handles floating away
    // from the drawing and a box narrower one is a drawing with its edges cut off.
    expect(stroke.width).toBeGreaterThanOrEqual(extent(path).width);
    expect(stroke.width).toBeLessThan(extent(path).width + 8 + 1);
    expect(stroke.height).toBeGreaterThan(0);

    // The preview was a promise and the document is the answer: the sheet is still there and nothing is being
    // drawn on it.
    expect(screen.queryByTestId('pen-preview-path')).toBeNull();
    // The line is selected, so the six inks apply to it if you want them and Delete takes it away.
    await waitFor(() => expect(outlinedIds()).toEqual([stroke.id]));
    // …and the pen is still in your hand, which is the whole difference between a pen and a stamp.
    expect(activeTool()).toBe('pen');
    expect(penSheet()).toBeInTheDocument();
    expect(penToolbar()).toBeInTheDocument();
  });

  it('TC-09: the pen draws one stroke after another without being picked up again', async () => {
    await armPenTool();
    // The letter A: three strokes, because a hand lifts the pen between them and a lifted pen ends a stroke.
    const strokesOfA = letterAStrokes(1);
    for (const [index, path] of strokesOfA.entries()) {
      penDraw(path);
      await waitFor(() => expect(strokes()).toHaveLength(index + 1));
    }
    expect(strokes().map((entry) => entry.thickness)).toEqual(['medium', 'medium', 'medium']);
    expect(activeTool()).toBe('pen');
    expect(screen.queryByTestId('pen-preview-path')).toBeNull();
  });

  it('TC-10: a press and a release with no movement draws a dot', async () => {
    await armPenTool();
    pressPenThickness('thick');
    penTap({ x: 240, y: 180 });

    await waitFor(() => expect(strokes()).toHaveLength(1));
    const dot = strokes()[0]!;
    // One point is all a dot is, stored the way every other stroke is stored; the box is the nib's own square,
    // which is why the dot has a size at all.
    expect(dot.points).toHaveLength(2);
    expect(dot).toMatchObject({ thickness: 'thick' });
    expect(dot.width).toBeGreaterThan(0);
    expect(dot.height).toBeGreaterThan(0);
    expect(activeTool()).toBe('pen');
  });

  it('TC-10: a dot drawn with no movement is drawn as a dot and not as nothing', async () => {
    await armPenTool();
    penTap({ x: 240, y: 180 });
    await waitFor(() => expect(strokes()).toHaveLength(1));
    const dot = strokes()[0]!;
    // A path of a single point goes 'M x y L x y': zero long, and round-capped, so it is a dot on the screen
    // rather than nothing at all. The numbers are read rather than the string compared, because the path is
    // rounded to two decimals and where the dot is is the assertion, not how many digits it has.
    const element = document.querySelector(`[data-stroke-id="${dot.id}"] [data-testid="stroke-path"]`);
    const numbers = (element?.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g) ?? [];
    expect(numbers.slice(0, 2)).toEqual(numbers.slice(2, 4));
    expect(element?.getAttribute('stroke-linecap')).toBe('round');
  });

  it('TC-11: a pointercancel mid-stroke commits the stroke drawn so far', async () => {
    await armPenTool();
    const path = underline({ count: 40, x: 100, y: 100, length: 200 });
    penDown(firstOf(path));
    penTrace(path.slice(1, 20));
    // The browser took the pointer away — a system gesture, the window losing focus, a pen hovering out of
    // range. The line is finished, not thrown away: the pointer is not the only thing that can end a stroke.
    cancelWindow(screenOf(path[19]!));

    await waitFor(() => expect(strokes()).toHaveLength(1));
    expect(strokes()[0]!.points.length).toBeGreaterThanOrEqual(2);
    // The pen was not cancelled with it: it is still armed, with nothing being drawn.
    expect(activeTool()).toBe('pen');
    expect(screen.queryByTestId('pen-preview-path')).toBeNull();
  });

  it('TC-12: a gesture longer than a stroke may hold is committed as a second stroke', async () => {
    await armPenTool();
    // Ten points more than a stroke can hold, delivered in five hundred batches: the same shape of input as
    // five hundred milliseconds of a tablet at a thousand points a second, with no frame between them.
    const path = longSpiral(10);
    expect(count(path)).toBe(STROKE_MAX_POINTS + 10);

    penDown(firstOf(path));
    for (let at = 0; at < count(path); at += 500) penTrace(path.slice(at, at + 500));
    expect(strokes()).toHaveLength(0);
    upWindow(screenOf(lastOf(path)));

    await waitFor(() => expect(strokes()).toHaveLength(2));
    const [first, second] = strokes();
    // Neither record is over the limit, and both are shorter than the pointer's own path, because the line is
    // thinned on the way in: the limit is on the points *sampled*, and what reaches the document is the
    // smoothed line the design's `pen.smooth` promises.
    expect(first!.points.length / 2).toBeLessThanOrEqual(STROKE_MAX_POINTS);
    expect(second!.points.length / 2).toBeLessThanOrEqual(STROKE_MAX_POINTS);
    expect((first!.points.length + second!.points.length) / 2).toBeLessThan(count(path));
    // The two share the point where the split happened, to within the rounding of a stored number: the line
    // goes on from where it stopped rather than jumping.
    const joins = scaledPoints(first!);
    const resumes = scaledPoints(second!);
    expect(firstOf(resumes).x).toBeCloseTo(lastOf(joins).x, 2);
    expect(firstOf(resumes).y).toBeCloseTo(lastOf(joins).y, 2);
    // The first was drawn first, so it is underneath, which is what the second one's overlap hides.
    expect(first!.z).toBeLessThan(second!.z);
    // Both halves came from the same pen in the same gesture, which is what makes them one line.
    expect(first!.createdBy).not.toBe('');
    expect(second!.createdBy).toBe(first!.createdBy);
  });
});

describe("the pen's options and the tool that owns them (TC-13, TC-14)", () => {
  beforeEach(() => {
    renderBoard();
    frameAtOrigin();
  });

  it('TC-13: Escape abandons the pen without drawing, and the stroke drawn before it stays', async () => {
    const drawn = addStroke([
      { x: 100, y: 100 },
      { x: 300, y: 160 },
    ]);
    await armPenTool();
    // Put the pen down and then change your mind with the keyboard rather than with a lift.
    penDown({ x: 400, y: 300 });
    penTrace([{ x: 420, y: 320 }]);
    expect(screen.getByTestId('pen-preview-path')).toBeInTheDocument();

    pressEscape();

    // The preview goes with the tool, and nothing was ever written: an abandoned line is not a drawing.
    expect(screen.queryByTestId('pen-preview-path')).toBeNull();
    expect(penToolbar()).toBeNull();
    expect(activeTool()).toBe('select');
    expect(strokes().map((stroke) => stroke.id)).toEqual([drawn]);
  });

  it('TC-13: choosing another tool abandons the line being drawn, and V does the same', async () => {
    await armPenTool();
    penDown({ x: 400, y: 300 });
    penTrace([{ x: 420, y: 320 }]);

    // Clicking Select is the other half of the same promise: the line in flight is dropped, not committed.
    fireEvent.click(screen.getByTestId('tool-select'));
    expect(screen.queryByTestId('pen-preview-path')).toBeNull();
    expect(strokes()).toHaveLength(0);

    // `V` is another way back to Select, and it goes through the same door.
    pressKey('p');
    await waitFor(() => expect(penSheet()).toBeInTheDocument());
    penDown({ x: 400, y: 300 });
    penTrace([{ x: 420, y: 320 }]);
    pressKey('v');
    await waitFor(() => expect(activeTool()).toBe('select'));
    expect(strokes()).toHaveLength(0);
  });

  it('TC-14: the inks and nibs are six and three, one pressed, with the choice said out loud', async () => {
    await armPenTool();
    expect(penToolbar()).toBeInTheDocument();
    expect(penPressed()).toEqual({
      colors: ['black'],
      thicknesses: ['medium'],
    });
    expect(penStatus()).toBe('black medium pen');

    pressPenColor('purple');
    pressPenThickness('thin');
    expect(penPressed()).toEqual({ colors: ['purple'], thicknesses: ['thin'] });
    // What was chosen is said in the live region, so a screen reader hears it without the panel moving.
    expect(penStatus()).toBe('purple thin pen');

    // The panel is the pen's: put the pen down and it goes.
    pressEscape();
    expect(penToolbar()).toBeNull();
  });

  it('TC-14: choosing an ink changes the next line and never the one just drawn', async () => {
    await armPenTool();
    penDraw([
      { x: 100, y: 100 },
      { x: 240, y: 140 },
    ]);
    await waitFor(() => expect(strokes()).toHaveLength(1));
    const first = strokes()[0]!;
    expect(first.color).toBe('black');

    pressPenColor('blue');
    pressPenThickness('thick');

    // The drawing that is already on the board is untouched: not its ink, not its size, not its place, not its
    // words. A board that re-drew everybody's strokes on every click would be a board where choosing an ink
    // was an edit of other people's work.
    expect(strokes()[0]!).toEqual(first);

    penDraw([
      { x: 100, y: 200 },
      { x: 240, y: 240 },
    ]);
    await waitFor(() => expect(strokes()).toHaveLength(2));
    expect(strokes()[1]!.color).toBe('blue');
    expect(strokes()[1]!.thickness).toBe('thick');
  });

  it('TC-14: a new line is drawn on top of the line before it, in the ink chosen at the time', async () => {
    await armPenTool();
    for (const color of ['red', 'green', 'orange'] as const) {
      pressPenColor(color);
      penDraw([
        { x: 120, y: 120 },
        { x: 320, y: 180 },
      ]);
    }
    await waitFor(() => expect(strokes()).toHaveLength(3));
    expect(strokes().map((stroke) => stroke.color)).toEqual(['red', 'green', 'orange']);
    // In the order they were drawn, which is the order the board stacks them.
    expect(strokes().map((stroke) => stroke.z)).toEqual([...strokes().map((stroke) => stroke.z)].sort((a, b) => a - b));
  });

  it('TC-13: with the pen armed the board double-click is borrowed, not withdrawn', async () => {
    await armPenTool();
    // A stroke ends with a click, and a quick pair of strokes ends with a double-click — which in Select mode
    // means "a note here". While the pen is up that gesture belongs to the pen, and a board that made a note
    // out of it would be making an object out of the tail of a drawing.
    fireEvent.doubleClick(surface(), { clientX: 300, clientY: 220 });
    expect(stickies()).toHaveLength(0);

    pressEscape();
    fireEvent.doubleClick(surface(), { clientX: 300, clientY: 220 });
    await waitFor(() => expect(stickies()).toHaveLength(1));
  });
});


describe('what the pen takes from the board underneath it (TC-19)', () => {
  beforeEach(() => {
    renderBoard();
    frameAtOrigin();
  });

  it('TC-19: a press where a resize handle is drawn is still a stroke', async () => {
    // The selection draws its handles *over* the board, and a selected object has one at every corner — including
    // the corner the next stroke starts from, because somebody signing a line starts the next one where the last
    // one ended. A handle that took that press would resize the stroke already there instead of drawing the one
    // that was meant to happen.
    const first = await addStroke(underline({ count: 20, x: 100, y: 100, length: 200, jitter: 1 }));
    const where = objectById(first);
    marqueeAround(around(objectById(first), 20), surface());
    await waitFor(() => expect(outlinedIds()).toEqual([first]));
    expect(screen.queryByTestId('resize-handle-se')).toBeTruthy();

    await armPenTool();
    const corner = screenOf({ x: 300, y: 180 });
    penDraw([corner, { x: corner.x + 30, y: corner.y + 20 }, { x: corner.x + 60, y: corner.y + 40 }]);

    await waitFor(() => expect(strokes()).toHaveLength(2));
    // The stroke that was already there is exactly the stroke that was already there: four numbers about a box,
    // untouched, while a second line appeared next to it.
    expect(objectById(first)).toMatchObject({ id: first, x: where.x, y: where.y, width: where.width, height: where.height });
    expect(strokes()[1]!.points.length).toBeGreaterThan(2);
    expect(strokes()[1]!.x).toBeGreaterThan(200);
    // The handle is not there while the pen is in the hand — a control that cannot be taken is not offered — and
    // it comes back when the pen is put down.
    expect(screen.queryByTestId('resize-handle-se')).toBeNull();
  });

  it('TC-19: a stroke that starts on top of a note commits a stroke and leaves the note alone', async () => {
    // The pen lies over the board, so a press that lands on a sticky note is a pen going down and nothing else:
    // not the note being dragged, not the note being opened, not the note being picked up.
    // createSticky centres a note on the point it is given, so this one's box starts at (100, 100) — and the pen
    // is about to go down at (200, 180), which is squarely on it.
    const sticky = createSticky(doc(), { x: 200, y: 200 });
    await waitFor(() => expect(stickies()).toHaveLength(1));
    const where = screenRect(objectById(sticky));
    expect(where).toMatchObject({ x: 100, y: 100 });
    await armPenTool();

    const from = screenOf({ x: 200, y: 180 });
    penDraw([from, { x: from.x + 80, y: from.y - 30 }, { x: from.x + 160, y: from.y + 10 }]);

    await waitFor(() => expect(strokes()).toHaveLength(1));
    expect(stickies()).toHaveLength(1);
    expect(screenRect(objectById(sticky))).toEqual(where);
    expect(outlinedIds()).toEqual([strokes()[0]!.id]);
    expect(screen.queryByTestId('sticky-textarea')).toBeNull();
    expect(objectById(sticky).x).toBe(100);
  });
});
