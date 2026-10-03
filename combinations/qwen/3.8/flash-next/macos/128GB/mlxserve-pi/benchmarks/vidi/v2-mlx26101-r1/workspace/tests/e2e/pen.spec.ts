// Story 11 e2e: sketching freehand with the pen, in a browser, and across two browsers.
//
// The unit tests cover the arithmetic (how far a simplified path lies from the one a hand drew),
// and the component tests cover the tool's every branch in a fast loop. What only a browser can
// prove is the part this story is actually about: that a real pointer's pressure-free drag paints a
// line on *one* screen while it is happening and on *every* screen once it is over — with nothing
// of the unfinished stroke in between, because an unfinished stroke that travelled would be an
// object in other people's boards, in their undo history, and in their way.
//
// Paths are the recorded fixtures from tests/fixtures/pen-paths, shifted into the middle of the
// window: the pen's own options panel sits on the left, and a press that lands on it is a press on
// a button (pen.options). Every number is stated in screen pixels and compared in board units, with
// the conversion done through the live camera — board units are what the document stores and what
// the other person's screen draws.

import { expect, test } from '@playwright/test';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  PEN_THICKNESS_WORLD,
} from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { handwrittenLoop, underline } from '../fixtures/pen-paths';
import { createBoard, gotoBoard } from './helpers/board';
import {
  createParticipants,
  expectEventually,
  type Participant,
} from './helpers/participants';
import {
  beginStroke,
  clickStrokeLine,
  drawStroke,
  dragStrokeBody,
  endStroke,
  expectStrokeGone,
  holdPen,
  moveStroke,
  moveStrokePerFrame,
  penCursorOf,
  penIsDrawing,
  penLayer,
  penToolbar,
  previewD,
  seedStrokeOnBoard,
  startPreviewSampler,
  stopPreviewSampler,
  strokeIdsOn,
  strokeInkPaint,
  strokeOf,
  strokeScreenBox,
  strokeSelected,
  strokesOn,
  strokeWidthOnScreen,
  waitForNewStroke,
  worldAllOfScreen,
  worldOfScreen,
} from './helpers/pen';
import { cameraOf, deleteSelection, pressTool } from './helpers/shape';
import {
  dragHandle,
  noteTestId,
  noteWorldPos,
  resizeHandle,
  seedNotesAtScreen,
} from './helpers/sticky';

/** A fixture moved into the middle of the screen, clear of the pen's options panel. */
function drawn(points: readonly Point[], dx = 320, dy = 0): Point[] {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/**
 * Every `every`-th point of a fixture. A real pointer reports tens of points a second rather than
 * hundreds, and a browser test pays a round trip for each move it makes, so the e2e paths are the
 * fixtures taken at a hand's real sampling rate. Nothing about the assertions depends on it: the
 * box a stroke is stored in is computed from the points that were actually moved through.
 */
function sampled(points: readonly Point[], every: number): Point[] {
  return points.filter((_, i) => i % every === 0);
}

/** The numbers in a path's `d` attribute: a line with more numbers in it is a longer line. */
function numbers(d: string | null): number[] {
  return (d ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
}

/** A path's extent in screen pixels: what the pointer covered, to the pixel. */
function extent(points: readonly Point[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/** How far a stored board measurement is from what the pointer covered. */
function deviation(actual: number, expected: number): number {
  return Math.abs(actual - expected);
}

async function closeAll(people: readonly Participant[]): Promise<void> {
  await Promise.all(people.map((p) => p.close()));
}

test.describe('pen: drawing by hand', () => {
  // TC-17 (pen.tool): a real mouse, a recorded path, and a preview measured while the pointer is
  // still moving. The line a person is drawing appears on their own screen as they draw it — the
  // preview's path exists mid-drag and grows as the pointer goes on — and nothing of it is in the
  // document while the pointer is down. When the pointer comes up the stroke is on the board, in
  // the place the pointer covered, and the pen is still in the hand for the next line.
  test('TC-17 the line follows the pointer, then stays on the board', async ({ page }) => {
    // A drag is a lot of real mouse moves, and on a loaded machine each one is a round trip.
    test.setTimeout(90_000);
    await gotoBoard(page);
    await holdPen(page);

    // A pen in the hand writes nothing by itself, and it says what it is holding: a round nib.
    expect(await strokesOn(page), 'the pen does not draw by existing').toHaveLength(0);
    expect(await penCursorOf(page)).toContain('data:image/svg+xml');
    expect(await penIsDrawing(page)).toBe(false);

    const loop = drawn(sampled(handwrittenLoop(320), 5));
    const midway = Math.round(loop.length * 0.6);
    await beginStroke(page, loop[0]!);
    await moveStroke(page, loop.slice(1, midway));

    // Mid-drag: a path is painted, in screen pixels, starting where the press started.
    const paintedSoFar = await previewD(page);
    expect(
      paintedSoFar,
      'the line a person is drawing is painted while they draw it',
    ).toMatch(/^M \d/);
    expect(await penIsDrawing(page), 'the press is the pen\'s own').toBe(true);
    // None of it is in the document. An in-progress stroke that travelled would be an unfinished
    // object on everybody else's board and in everybody's undo history (pen.tool).
    expect(await strokesOn(page), 'a stroke is written once, when the pointer lifts').toHaveLength(0);

    // And it is painted on the frames, which is the only reason a line keeps up with a hand. The
    // page is asked to watch its own animation frames, because a test that sampled the preview
    // between two of its own calls would be sampling it whenever the browser got round to it.
    await startPreviewSampler(page);
    await moveStrokePerFrame(page, loop.slice(midway));
    const frames = await stopPreviewSampler(page);
    const painted = frames.filter((d): d is string => d !== null);
    expect(
      painted.length,
      'a line is on screen on almost every frame of the drag',
    ).toBeGreaterThan(frames.length - 2);
    const distinct = [...new Set(painted)];
    expect(
      distinct.length,
      'the line is repainted as the pointer goes on, not once at the end',
    ).toBeGreaterThan(3);
    expect(
      numbers(distinct[distinct.length - 1]!).length,
      'the painted line grows as the pointer goes on',
    ).toBeGreaterThan(numbers(paintedSoFar).length);
    expect(await strokesOn(page)).toHaveLength(0);

    const before = await strokesOn(page);
    await endStroke(page);
    const stroke = await waitForNewStroke(page, before);

    // The preview is gone; what it was showing is a drawing on the board now.
    await expect(page.getByTestId('pen-preview')).toHaveCount(0);
    expect(await penIsDrawing(page)).toBe(false);
    await expect(page.getByTestId(`stroke-${stroke.id}`)).toBeVisible();
    // It persists: a moment later it is still there, and still the only thing anybody drew.
    await page.waitForTimeout(200);
    expect(await strokesOn(page)).toHaveLength(1);

    // And it is the drawing the pointer made: the stored box is the box the pointer covered, plus
    // the nib that sticks out of it, give or take the pixel the smoothing was allowed to move a
    // point by.
    const covered = extent(await worldAllOfScreen(page, loop));
    const nib = PEN_THICKNESS_WORLD[stroke.thickness];
    expect(
      deviation(stroke.x, covered.minX - nib / 2),
      'the drawing starts where the pointer started',
    ).toBeLessThan(2);
    expect(deviation(stroke.y, covered.minY - nib / 2), 'and where it started vertically').toBeLessThan(2);
    expect(
      deviation(stroke.width, covered.maxX - covered.minX + nib),
      'the drawing is as wide as the pointer went',
    ).toBeLessThan(2);
    expect(
      deviation(stroke.height, covered.maxY - covered.minY + nib),
      'and as tall',
    ).toBeLessThan(2);
    // It is a drawing, not a recording: the points kept are a fraction of the ones the pointer
    // made, which is the only reason this object is small enough to sync.
    expect(stroke.points.length / 2, 'the stroke is simplified').toBeLessThan(loop.length);
    expect(stroke.color).toBe(DEFAULT_PEN_COLOR);
    expect(stroke.thickness).toBe(DEFAULT_PEN_THICKNESS);

    // The pen is still in the hand: the next line needs no second press of the letter.
    const second = await drawStroke(page, drawn(sampled(underline(120), 4)), 1);
    expect(second.id, 'a second press is a second drawing').not.toBe(stroke.id);
    expect(await strokesOn(page)).toHaveLength(2);
  });

  // TC-18 (pen.tool): Priya draws while Sam watches. While the line is being drawn, Sam's board is
  // empty and his screen holds no trace of it — no object, no half object, no preview. When the pen
  // lifts, his screen gets exactly the line Priya's screen has, and how long that took is printed
  // against the live latency budget rather than asserted: on a shared machine a slow second is a
  // fact about the machine, while a change that never arrives is a fact about the code.
  test('TC-18 the watcher sees the finished line and nothing of the unfinished one', async ({
    browser,
    request,
  }) => {
    test.setTimeout(90_000);
    const boardId = await createBoard(request);
    const [priya, sam] = await createParticipants(browser, boardId, ['Priya', 'Sam']);

    await holdPen(priya.page);
    expect(await strokesOn(sam.page), 'the watcher starts with an empty board').toHaveLength(0);

    const loop = drawn(sampled(handwrittenLoop(300), 6));
    const partway = Math.round(loop.length * 0.4);
    await beginStroke(priya.page, loop[0]!);
    await moveStroke(priya.page, loop.slice(1, partway));

    // One screen has a line under the pointer. The other has nothing at all.
    expect(await previewD(priya.page), 'the drawer sees their own line').toMatch(/^M \d/);
    expect(await strokesOn(sam.page)).toHaveLength(0);
    await expect(sam.page.getByTestId('pen-preview')).toHaveCount(0);
    await expect(penLayer(sam.page)).toHaveAttribute('data-pen-drawing', 'false');
    // Sam is not holding a pen: the tool a person has in their hand is a fact about their tab, not
    // about the board, so it is not something the drawer's choice puts on his screen (pen.options).
    await expect(penToolbar(sam.page)).toHaveCount(0);

    await moveStroke(priya.page, loop.slice(partway));
    const before = await strokesOn(priya.page);
    await endStroke(priya.page);
    const stroke = await waitForNewStroke(priya.page, before);

    const { value: seen, ms } = await expectEventually(
      () => strokesOn(sam.page),
      (list) => list.length === 1,
      E2E_EVENTUAL_TIMEOUT_MS,
      'the finished stroke never reached the watcher',
    );
    console.log(
      `TC-18 finished stroke reached the watcher in ${ms}ms ` +
        `(live budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`,
    );

    expect(seen[0]!.id, 'the watcher sees the same drawing, not a copy of it').toBe(stroke.id);
    expect(seen[0]!.points).toEqual(stroke.points);
    expect(seen[0]!.color).toBe(stroke.color);
    expect(seen[0]!.width).toBeCloseTo(stroke.width, 1);
    expect(seen[0]!.height).toBeCloseTo(stroke.height, 1);
    await expect(sam.page.getByTestId(`stroke-${stroke.id}`)).toBeVisible();
    // Both screens drew it with the same ink, and neither of them had an unfinished object in
    // between: the watcher's model went from nothing to a finished stroke in one step.
    expect(await strokeInkPaint(sam.page, stroke.id)).toEqual(
      await strokeInkPaint(priya.page, stroke.id),
    );

    expect(priya.pageErrors, 'the drawer\'s page threw').toEqual([]);
    expect(sam.pageErrors, 'the watcher\'s page threw').toEqual([]);
    await closeAll([priya, sam]);
  });

  // TC-19 (pen.tool): a wheel while the pen is held still moves the board, and a stroke that starts
  // on a sticky note draws over it instead of moving it. Both are the same decision — the pen's
  // layer takes the press for the pen and leaves the board's own gestures alone — and both are
  // things a real browser can do differently from a test double: the wheel has to reach the pen's
  // layer and be turned into a pan by it, and a drag that begins over a note must not become a
  // note drag.
  test('TC-19 the wheel still moves the board, and a note under the pen stays put', async ({
    page,
  }) => {
    await gotoBoard(page);
    const [noteId] = await seedNotesAtScreen(page, [{ x: 420, y: 380 }]);
    if (!noteId) throw new Error('the note was not seeded');
    await holdPen(page);

    const cameraBefore = await cameraOf(page);
    const noteBefore = await noteWorldPos(page, noteId);

    // A wheel over the board, with the pen's layer in the way of everything.
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 240);
    const cameraPanned = await cameraOf(page);
    expect(
      cameraPanned.y,
      'the board pans under the pen, because the pen forwards what it is not for',
    ).toBeGreaterThan(cameraBefore.y);
    expect(
      await noteWorldPos(page, noteId),
      'panning moves the view, not the note',
    ).toEqual(noteBefore);

    // A drag that starts on the note. The press belongs to the pen: the note is not picked up, not
    // selected, and the line is drawn across it.
    const painted = await page.getByTestId(noteTestId(noteId)).boundingBox();
    if (!painted) throw new Error('the note is not drawn');
    const across = [
      { x: painted.x + 12, y: painted.y + 12 },
      { x: painted.x + painted.width / 2, y: painted.y + painted.height / 2 },
      { x: painted.x + painted.width - 8, y: painted.y + painted.height - 20 },
      { x: painted.x + painted.width + 90, y: painted.y + painted.height + 30 },
    ];
    const stroke = await drawStroke(page, across, 4);

    expect(
      await noteWorldPos(page, noteId),
      'a stroke drawn over a note leaves the note where it was',
    ).toEqual(noteBefore);
    expect(await cameraOf(page), 'a stroke does not move the view either').toEqual(cameraPanned);
    expect(await page.getByTestId(noteTestId(noteId)).getAttribute('data-selected')).toBe('false');
    expect(stroke.thickness).toBe(DEFAULT_PEN_THICKNESS);

    // And a wheel over the *preview* mid-stroke still pans: the pen keeps its line and lets go of
    // the wheel, so drawing on a big board is still navigation.
    await beginStroke(page, { x: 500, y: 250 });
    await moveStroke(page, [{ x: 560, y: 300 }, { x: 620, y: 260 }]);
    const beforeWheel = await cameraOf(page);
    await page.mouse.wheel(0, -120);
    expect((await cameraOf(page)).y).toBeLessThan(beforeWheel.y);
    expect(await previewD(page), 'the wheel did not interrupt the line being drawn').toMatch(
      /^M \d/,
    );
    await endStroke(page);
    expect(await strokeIdsOn(page)).toHaveLength(2);

    // The line drawn across the note is stored where the pointer went: its right edge is the last
    // point the pointer made, plus half the nib, because that is what a box is drawn around.
    const last = await worldOfScreen(page, across[3]!);
    const nib = PEN_THICKNESS_WORLD[stroke.thickness];
    expect(
      deviation(stroke.x + stroke.width, last.x + nib / 2),
      'the drawing reaches the end of the drag',
    ).toBeLessThan(3);
  });

  // TC-20 (stroke.object): a drawing is an object, and this is the proof. Priya clicks its *line*
  // (its box is not a target: it is mostly empty board), resizes it from a corner, which keeps the
  // width-to-height ratio it had and leaves the nib the thickness it was, moves it by dragging the
  // line, and deletes it. Sam watches all of it and ends up with a board that has nothing on it.
  test('TC-20 click its line, resize in proportion, move it, delete it: on both screens', async ({
    browser,
    request,
  }) => {
    const boardId = await createBoard(request);
    const [priya, sam] = await createParticipants(browser, boardId, ['Priya', 'Sam']);
    const page = priya.page;

    const id = await seedStrokeOnBoard(page, drawn(sampled(handwrittenLoop(240), 6)));
    await expectEventually(
      () => strokesOn(sam.page),
      (list) => list.length === 1,
      E2E_EVENTUAL_TIMEOUT_MS,
      'the drawing never reached the watcher',
    );

    await pressTool(page, 'V');
    const box = await strokeScreenBox(page, id);
    // The middle of a loop's box is empty board: a press there is a press on the board, which is
    // why a stroke is picked by its line and not by its rectangle (stroke.object).
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect(
      await strokeSelected(page, id),
      'the middle of a drawing\'s box is board, not drawing',
    ).toBe(false);

    // A press on the line itself selects it, and brings the resize handles with it.
    await clickStrokeLine(page, id);
    expect(await strokeSelected(page, id)).toBe(true);
    await expect(resizeHandle(page, 'se')).toBeVisible();

    // Resize from the south-east corner. The ratio is what an aspect-locked object keeps; the nib
    // is what `pen.resize` says it does not touch.
    const before = await strokeOf(page, id);
    const nib = PEN_THICKNESS_WORLD[before.thickness];
    const ratio = before.width / before.height;
    await dragHandle(page, 'se', 150, 150);
    const resized = await strokeOf(page, id);
    expect(resized.width, 'the drag grew the drawing').toBeGreaterThan(before.width);
    expect(
      Math.abs(resized.width / resized.height / ratio - 1),
      'a corner drag scales a drawing in proportion, never stretches it',
    ).toBeLessThan(0.01);
    expect(
      Math.abs((await strokeWidthOnScreen(page, id)) - nib),
      'resizing a drawing does not thicken its line',
    ).toBeLessThan(0.5);
    // The stored path is the path that was drawn: the resize moved the box around it, which is how
    // the same drawing can be scaled again tomorrow without losing anything.
    expect(resized.points, 'the resize scales the box, not the recorded path').toEqual(before.points);
    const grown = await strokeScreenBox(page, id);
    expect(
      Math.abs(grown.width - resized.width),
      'the drawing is painted as wide as the box the resize made',
    ).toBeLessThan(2);

    // Move it by the only part of it a press can catch: the line.
    const moved = { x: resized.x + 80, y: resized.y + 55 };
    await dragStrokeBody(page, id, 80, 55);
    const after = await strokeOf(page, id);
    expect(
      deviation(after.x, moved.x),
      'the drawing follows a drag of its line',
    ).toBeLessThan(2);
    expect(deviation(after.y, moved.y), 'in both directions').toBeLessThan(2);
    expect(after.width, 'moving a drawing does not resize it').toBe(resized.width);
    expect(await strokeSelected(page, id)).toBe(true);

    // Delete it, and the watcher's board loses it in the same step.
    await deleteSelection(page);
    await expectStrokeGone(page, id);
    await expectStrokeGone(sam.page, id);
    expect(await strokeIdsOn(sam.page)).toHaveLength(0);
    await expect(resizeHandle(page, 'se')).toHaveCount(0);
    // The drawing is gone from the document, not merely hidden: the watcher's model has no stroke
    // whose box he could still click in.
    expect(await strokesOn(sam.page)).toEqual([]);

    expect(priya.pageErrors, 'the drawer\'s page threw').toEqual([]);
    expect(sam.pageErrors, 'the watcher\'s page threw').toEqual([]);
    await closeAll([priya, sam]);
  });
});
