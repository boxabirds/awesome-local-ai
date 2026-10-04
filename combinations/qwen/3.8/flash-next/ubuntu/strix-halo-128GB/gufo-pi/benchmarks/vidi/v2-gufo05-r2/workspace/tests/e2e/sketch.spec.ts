/**
 * Story 11 end to end: sketching with a real pointer, and what the board does with it.
 *
 * The camera is put at `{x: 0, y: 0, zoom: 1}` for every case, so one board unit is one
 * screen pixel and a fixture path can be replayed — shifted by wherever the surface sits,
 * which is measured rather than assumed. Three things are checked for each sketch, because
 * a stroke is the first object whose drawn form is a curve: the document's record of it,
 * this browser's box for it, and the path itself, which must not be empty, must not contain
 * NaN, and must lie inside the box it was given.
 *
 * TC-17 a loop drawn round a cluster is previewed on every frame and arrives finished ·
 * TC-18 the person watching sees nothing until it is finished, then sees it · TC-19 the
 * wheel still pans while the pen is held, and a drag that starts on a note draws over it ·
 * TC-20 select by the line, resize in proportion, move, delete, on both screens.
 */

import { changeArrives, expect, expectNoErrors, test } from './helpers/live';
import { openBoard, setCamera, type Pixel } from './helpers/board';
import { createNoteByDblClick, endEditing, getNotes, noteBoxes } from './helpers/notes';
import { pickSelectTool } from './helpers/drawing';
import {
  choosePenColor,
  choosePenThickness,
  clickStrokeLine,
  drawnStroke,
  drawPathByPointer,
  expectNothingSelected,
  expectSelected,
  getStrokes,
  penCursorState,
  penPreview,
  pickPenTool,
  pointOnStrokeLine,
  releasePointer,
  seedStrokeOnBoard,
  startPreviewSampler,
  stopPreviewSampler,
  surfaceOrigin,
  toScreen,
} from './helpers/sketch';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../src/shared/config';
import type { StrokeSnapshot } from '../../src/shared/objects/stroke';
import { handwrittenLoop, underline } from '../fixtures/pen-paths';

/** One board unit to one screen pixel, from the board's top-left corner. */
const FLAT = { x: 0, y: 0, zoom: 1 };

/**
 * A stroke's box, with the two fields the base type allows to be missing pinned down.
 *
 * They are never missing on a stroke — the model refuses one without a box — but the
 * common object type is shared with free text, which has none, so arithmetic on a sketch
 * has to say so once, here, rather than exclaiming fourteen times.
 */
function boxOf(stroke: StrokeSnapshot): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return { x: stroke.x, y: stroke.y, width: stroke.width!, height: stroke.height! };
}

/** The loop of the first workflow, thinned to one point in three: still a loop. */
function loopReplay(): Pixel[] {
  return handwrittenLoop({ centre: { x: 420, y: 320 }, wobble: 1.2 }).filter(
    (_, index) => index % 3 === 0,
  );
}

function bounds(points: readonly Pixel[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

test.describe('sketch', () => {
  test.beforeEach(async ({ page }) => {
    await openBoard(page);
    await setCamera(page, FLAT);
  });

  test('TC-17: a loop is previewed as it is drawn and arrives finished', async ({ page }) => {
    const path = loopReplay();
    const before = new Set((await getStrokes(page)).map((stroke) => stroke.id));

    await pickPenTool(page);
    const onScreen = await toScreen(page, path);
    await page.mouse.move(onScreen[0]!.x, onScreen[0]!.y);
    await page.mouse.down();
    await startPreviewSampler(page);
    for (const point of onScreen.slice(1)) await page.mouse.move(point.x, point.y);
    const frames = await stopPreviewSampler(page);

    // The line followed the pointer: not one picture taken at the end, but a path that
    // grew, frame after frame, while the hand was moving (PRD pen.draw).
    await expect(penPreview(page)).toHaveCount(1);
    const drawn = frames.filter((d): d is string => d !== null);
    expect(drawn.length).toBeGreaterThanOrEqual(5);
    expect(new Set(drawn).size).toBeGreaterThanOrEqual(3);
    let changes = 0;
    for (let i = 1; i < drawn.length; i += 1) if (drawn[i] !== drawn[i - 1]) changes += 1;
    expect(changes).toBeGreaterThanOrEqual(Math.max(2, Math.floor(drawn.length / 4)));
    expect(drawn[drawn.length - 1]).not.toBe(drawn[0]);
    // Nothing has been written to the board yet: the preview is this browser's business.
    expect((await getStrokes(page)).filter((s) => !before.has(s.id))).toHaveLength(0);

    await page.mouse.up();

    const created = (await getStrokes(page)).filter((stroke) => !before.has(stroke.id));
    expect(created).toHaveLength(1);
    const stroke = created[0]!;
    await expect(penPreview(page)).toHaveCount(0);

    // The finished sketch is the loop that was drawn: its box is the drawn bounds padded
    // by half the pen, within the pixel of faithfulness the simplifier promises.
    const edge = bounds(path);
    const half = PEN_THICKNESS_WORLD.medium / 2;
    const box = boxOf(stroke);
    expect(box.x).toBeGreaterThanOrEqual(edge.minX - half - 2);
    expect(box.x).toBeLessThanOrEqual(edge.minX + 2);
    expect(box.y).toBeGreaterThanOrEqual(edge.minY - half - 2);
    expect(box.y).toBeLessThanOrEqual(edge.minY + 2);
    expect(box.x + box.width).toBeGreaterThanOrEqual(edge.maxX - 2);
    expect(box.x + box.width).toBeLessThanOrEqual(edge.maxX + half + 2);
    expect(box.y + box.height).toBeGreaterThanOrEqual(edge.maxY - 2);
    expect(box.y + box.height).toBeLessThanOrEqual(edge.maxY + half + 2);
    // The hand's 134 points became fewer, because a stroke stores what the line needs.
    expect(stroke.points.length / 2).toBeLessThan(path.length);

    // And this browser drew it where the document says, inside its own box.
    const origin = await surfaceOrigin(page);
    const drawnBox = await drawnStroke(page, stroke.id);
    expect(Math.abs(drawnBox.x - (origin.x + box.x))).toBeLessThanOrEqual(1);
    expect(Math.abs(drawnBox.y - (origin.y + box.y))).toBeLessThanOrEqual(1);
    expect(Math.abs(drawnBox.width - box.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(drawnBox.height - box.height)).toBeLessThanOrEqual(1);

    // The pen is still in hand for the next line (PRD pen.stay_active).
    await expect(page.getByTestId('pen-tool-layer')).toBeVisible();
  });

  test('TC-17b: the ring is the pen, in the colour and weight chosen', async ({ page }) => {
    await pickPenTool(page);
    const origin = await surfaceOrigin(page);
    await page.mouse.move(origin.x + 500, origin.y + 300);
    const medium = await penCursorState(page);
    expect(medium.visible).toBe(true);
    // A 4-unit pen at 100% is a 4 pixel ring, and the ring is round.
    expect(Math.abs(medium.width - PEN_THICKNESS_WORLD.medium)).toBeLessThanOrEqual(2);
    expect(Math.abs(medium.width - medium.height)).toBeLessThanOrEqual(1);

    await choosePenThickness(page, 'thick');
    await choosePenColor(page, 'red');
    await page.mouse.move(origin.x + 501, origin.y + 301);
    const thick = await penCursorState(page);
    expect(Math.abs(thick.width - PEN_THICKNESS_WORLD.thick)).toBeLessThanOrEqual(2);
    expect(thick.borderColor).toBe('rgb(229, 57, 53)');

    // The next stroke is drawn with what the ring says.
    const line = underline({ centre: { x: 300, y: 560 } }).filter((_, i) => i % 4 === 0);
    await drawPathByPointer(page, await toScreen(page, line));
    const strokes = await getStrokes(page);
    expect(strokes).toHaveLength(1);
    const stroke = strokes[0]!;
    expect(stroke).toMatchObject({ color: 'red', thickness: 'thick' });
    const ink = await drawnStroke(page, stroke.id);
    expect(ink.stroke.toUpperCase()).toBe(PEN_COLORS.red.toUpperCase());
    expect(ink.strokeWidth).toBe(PEN_THICKNESS_WORLD.thick);
    expect(ink.linecap).toBe('round');
    expect(ink.linejoin).toBe('round');
    expect(ink.fill).toBe('none');
  });

  test('TC-19: the wheel pans while the pen is held, and a note under the pen stays put', async ({
    page,
  }) => {
    // A note to draw over, made the ordinary way, then left alone: deselected, so that
    // "no note toolbar later on" means the pen's drag did not select it.
    const noteId = await createNoteByDblClick(page, { x: 640, y: 400 });
    await endEditing(page);
    await pickSelectTool(page);
    await page.mouse.click(1150, 700);
    await expect(page.getByTestId('note-toolbar')).toHaveCount(0);
    const note = (await getNotes(page)).find((entry) => entry.id === noteId)!;

    await pickPenTool(page);
    const screenBefore = (await noteBoxes(page))[noteId]!;

    // A wheel over the board while the pen owns the pointer: the board pans, because the
    // pen layer sits inside the surface and lets the wheel through to it, rather than
    // re-implementing story 1 (PRD pen.navigation).
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, -240);
    const screenAfter = (await noteBoxes(page))[noteId]!;
    expect(Math.abs(screenAfter.y - screenBefore.y)).toBeGreaterThan(100);
    expect(Math.abs(screenAfter.x - screenBefore.x)).toBeLessThanOrEqual(2);
    expect(await getStrokes(page)).toHaveLength(0);
    await expect(penPreview(page)).toHaveCount(0);

    // And a drag that starts in the middle of the note belongs to the pen: a line appears
    // over the note, and the note has neither moved nor been selected (PRD tool.owns_gesture).
    const resting = (await noteBoxes(page))[noteId]!;
    const centre = { x: resting.x + resting.width / 2, y: resting.y + resting.height / 2 };
    const before = new Set((await getStrokes(page)).map((stroke) => stroke.id));
    await drawPathByPointer(page, [
      centre,
      { x: centre.x + 60, y: centre.y - 40 },
      { x: centre.x + 140, y: centre.y + 20 },
    ]);

    expect((await getStrokes(page)).filter((s) => !before.has(s.id))).toHaveLength(1);
    const still = (await getNotes(page)).find((entry) => entry.id === noteId)!;
    expect({ x: still.x, y: still.y }).toEqual({ x: note.x, y: note.y });
    const restingAfter = (await noteBoxes(page))[noteId]!;
    expect(Math.abs(restingAfter.width - resting.width)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(restingAfter.height - resting.height)).toBeLessThanOrEqual(0.5);
    await expect(page.getByTestId('note-toolbar')).toHaveCount(0);
    await expect(page.getByTestId('pen-tool-layer')).toBeVisible();
  });
});

test.describe('sketch, live', () => {
  test('TC-18: the finished sketch arrives; the drawing does not', async ({ liveBoards }) => {
    const { people } = await liveBoards.open(['Priya', 'Sam']);
    const [priya, sam] = people;
    if (!priya || !sam) throw new Error('two people are needed to watch a sketch arrive');
    await setCamera(priya.page, FLAT);
    await setCamera(sam.page, FLAT);

    await pickPenTool(priya.page);
    const path = handwrittenLoop({ centre: { x: 420, y: 320 } })
      .filter((_, index) => index % 4 === 0)
      .slice(0, 40);
    // Priya is halfway round the loop, still holding the pointer.
    await drawPathByPointer(priya.page, await toScreen(priya.page, path), { hold: true });
    await expect(penPreview(priya.page)).toHaveCount(1);

    // Sam sees an empty board: no stroke, and no half-drawn line of somebody else's
    // (PRD pen.share). This is a negative, so it is checked again after the frames an
    // update would have needed to arrive.
    await expect(sam.page.getByTestId('pen-preview-path')).toHaveCount(0);
    expect(await getStrokes(sam.page)).toHaveLength(0);
    await sam.page.waitForTimeout(200);
    expect(await getStrokes(sam.page)).toHaveLength(0);

    // Letting go is what shares it. The delivery time is logged, not asserted: model,
    // browsers and server are all on this one machine.
    const before = new Set((await getStrokes(priya.page)).map((stroke) => stroke.id));
    await changeArrives(
      'TC-18 sketch visible to Sam',
      () => releasePointer(priya.page),
      async () => (await getStrokes(sam.page)).length === 1,
    );

    // Both screens hold the same sketch, and both draw it in the same box.
    const id = (await getStrokes(priya.page)).find((stroke) => !before.has(stroke.id))!.id;
    const hers = (await getStrokes(priya.page)).find((stroke) => stroke.id === id)!;
    const his = (await getStrokes(sam.page)).find((stroke) => stroke.id === id)!;
    expect(his).toEqual(hers);
    const origin = await surfaceOrigin(sam.page);
    const drawn = await drawnStroke(sam.page, id);
    const hisBox = boxOf(his);
    expect(Math.abs(drawn.x - (origin.x + hisBox.x))).toBeLessThanOrEqual(1);
    expect(Math.abs(drawn.width - hisBox.width)).toBeLessThanOrEqual(1);
    await expect(sam.page.getByTestId('pen-preview-path')).toHaveCount(0);

    expectNoErrors(people);
  });

  test('TC-20: select by the line, resize in proportion, move, delete', async ({
    liveBoards,
  }) => {
    const { people } = await liveBoards.open(['Priya', 'Sam']);
    const [priya, sam] = people;
    if (!priya || !sam) throw new Error('two people are needed to watch a sketch disappear');
    await setCamera(priya.page, FLAT);
    await setCamera(sam.page, FLAT);

    // A sketch is on the board — the loop of the first workflow, placed through the app's
    // own hook so the test is about what happens next rather than about drawing it again.
    const id = await seedStrokeOnBoard(priya.page, loopReplay());
    await expect(sam.page.getByTestId(`stroke-${id}`)).toBeVisible();

    // A click in the middle of the loop selects nothing; a click on the ink selects it.
    await pickSelectTool(priya.page);
    const box = await drawnStroke(priya.page, id);
    await priya.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expectNothingSelected(priya.page);
    await clickStrokeLine(priya.page, id, 0.2);
    await expectSelected(priya.page);

    const first = (await getStrokes(priya.page)).find((stroke) => stroke.id === id)!;
    const before = boxOf(first);
    const ratio = before.width / before.height;
    const thicknessBefore = first.thickness;

    // Drag a corner: the sketch grows in proportion, and the pen's weight does not change
    // with it (PRD pen.resize).
    const handle = priya.page.locator('[data-resize-handle="se"]');
    const at = await handle.boundingBox();
    if (!at) throw new Error('the sketch has no resize handle');
    await priya.page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await priya.page.mouse.down();
    await priya.page.mouse.move(at.x + at.width / 2 + 150, at.y + at.height / 2 + 90, {
      steps: 8,
    });
    await priya.page.mouse.up();

    const resized = (await getStrokes(priya.page)).find((stroke) => stroke.id === id)!;
    const grown = boxOf(resized);
    expect(grown.width).toBeGreaterThan(before.width + 50);
    expect(Math.abs(grown.width / grown.height - ratio) / ratio).toBeLessThan(0.01);
    expect(resized.thickness).toBe(thicknessBefore);
    expect((await drawnStroke(priya.page, id)).strokeWidth).toBe(
      PEN_THICKNESS_WORLD[thicknessBefore],
    );

    // Drag the body: the same path, somewhere else on the board.
    const onLine = await pointOnStrokeLine(priya.page, id, 0.5);
    await priya.page.mouse.move(onLine.x, onLine.y);
    await priya.page.mouse.down();
    await priya.page.mouse.move(onLine.x + 80, onLine.y - 60, { steps: 6 });
    await priya.page.mouse.up();

    const afterMove = (await getStrokes(priya.page)).find((stroke) => stroke.id === id)!;
    const moved = boxOf(afterMove);
    expect(Math.abs(moved.x - (grown.x + 80))).toBeLessThanOrEqual(1);
    expect(Math.abs(moved.y - (grown.y - 60))).toBeLessThanOrEqual(1);
    expect(moved.width).toBe(grown.width);
    // Moving an idea keeps its points where they were, relative to the box (PRD pen.move):
    // the path is not rewritten to follow the new position.
    expect(afterMove.points).toEqual(resized.points);
    expect(await getStrokes(sam.page)).toHaveLength(1);

    // Delete takes it off both screens.
    await changeArrives(
      'TC-20 sketch gone for Sam',
      () => priya.page.keyboard.press('Delete'),
      async () => (await getStrokes(sam.page)).every((stroke) => stroke.id !== id),
    );
    await expect(priya.page.locator(`[data-object-id="${id}"]`)).toHaveCount(0);
    await expect(sam.page.locator(`[data-object-id="${id}"]`)).toHaveCount(0);

    expectNoErrors(people);
  });
});
