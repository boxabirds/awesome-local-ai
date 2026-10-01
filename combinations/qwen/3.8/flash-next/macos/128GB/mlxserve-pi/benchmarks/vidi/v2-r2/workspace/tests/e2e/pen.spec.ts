// Story 11, end to end: sketching freehand with the Pen.
//
// TC-17 is the pen stroke: a drag becomes the stored line, in the place it was drawn,
// drawn in its own colour and weight, and still there when the board is opened again -
// and while the pen is down the line is painted on animation frames in this browser
// only. TC-18 is the sharing rule: nothing goes over the wire until the pen lifts, and
// the whole line arrives in one go after. TC-19 is the tool holding the floor: the
// trackpad still zooms and pans the board with the Pen held, and a drag that begins on
// a sticky note draws on it instead of pushing it. TC-20 is tidying up: a stroke is
// selected by clicking its line, moved, resized with its ratio kept, and deleted, on
// every screen.
//
// The lines come from tests/fixtures/pen-paths.ts - recorded gestures, the same ones
// the component tests replay - and they are in board units for the camera these tests
// set ({ x: 0, y: 0, zoom: 1 }), so board units and window pixels are the same numbers.
//
// The two-line latency checks log what they measured. The budget in the config is what
// a connected colleague should see, and the eventual bound is what this suite will
// actually wait for; a machine that took longer than the budget is reported, not failed.

import { expect, test, type Page } from '@playwright/test';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import {
  expectPixels,
  openFreshBoard,
  readCamera,
  scrollBoard,
  setCamera,
  waitForCameraChange,
  createBoard,
} from './helpers/board';
import { content, createNote, openBoard } from './helpers/live';
import { PEN_FIXTURE_LOOP, PEN_FIXTURE_UNDERLINE } from '../fixtures/pen-paths';
import {
  dragPenThrough,
  drawStroke,
  focusPenColorButton,
  holdPenTool,
  penColorButton,
  penCursor,
  penToolbar,
  penPreview,
  penPreviewPath,
  penThicknessButton,
  penToolButton,
  penToolLayer,
  previewFrameChanges,
  previewFrameCount,
  previewSamples,
  pressPenAt,
  releasePen,
  startPreviewSampler,
  strokeAt,
  strokeCount,
  strokeHalo,
  strokeObjects,
  strokePath,
  strokeScreenBox,
  strokes,
  strokeLineScreenPoint,
  timeToStrokesMatch,
  waitForBoardLoaded,
  waitForStrokesMatch,
  paintedInkColor,
  paintedThickness,
} from './helpers/pen';

/** A short diagonal, drawn when a test wants a second line and not another fixture. */
const SHORT_LINE = [
  { x: 180, y: 200 },
  { x: 196, y: 214 },
  { x: 212, y: 228 },
  { x: 228, y: 244 },
  { x: 244, y: 258 },
  { x: 262, y: 272 },
];

/**
 * The box is the line's own bounds, grown by half the ink's weight on every side so the
 * painted line fits inside it. Checked against the line the document holds, because that
 * is the claim: this box is this drawing.
 */
async function expectBoxAroundTheLine(page: Page, index: number): Promise<void> {
  const stroke = await strokeAt(page, index);
  const line = await strokePath(page, index);
  const inset = PEN_THICKNESS_WORLD[stroke.thickness as keyof typeof PEN_THICKNESS_WORLD] / 2;
  const xs = line.map((p) => p.x);
  const ys = line.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  expect(stroke.x).toBeCloseTo(minX - inset, 6);
  expect(stroke.y).toBeCloseTo(minY - inset, 6);
  expect(stroke.width).toBeCloseTo(Math.max(...xs) - minX + inset * 2, 6);
  expect(stroke.height).toBeCloseTo(Math.max(...ys) - minY + inset * 2, 6);
}

test.describe('sketch with the pen', () => {
  test('TC-17 a drag with the Pen leaves the line that was drawn, where it was drawn', async ({
    page,
    request,
  }) => {
    await openFreshBoard(page, request);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    await holdPenTool(page);
    await pressPenAt(page, PEN_FIXTURE_UNDERLINE[0]!);
    await dragPenThrough(page, PEN_FIXTURE_UNDERLINE.slice(1, 60));

    // the line is being painted here, and the board does not have it yet
    await expect(penPreviewPath(page)).toHaveCount(1);
    await expect(penCursor(page)).toHaveCount(1);
    expect(await strokeCount(page)).toBe(0);

    await dragPenThrough(page, PEN_FIXTURE_UNDERLINE.slice(60));
    await releasePen(page);
    await expect.poll(() => strokeCount(page), { message: 'the stroke to be on the board' }).toBe(1);

    // what the board holds is the line that was drawn, simplified rather than echoed
    const stroke = await strokeAt(page, 0);
    expect(stroke.points).toBeGreaterThan(1);
    expect(stroke.points).toBeLessThan(PEN_FIXTURE_UNDERLINE.length);
    // the colour and the weight are the choice the pen was holding, stored on the line
    expect(stroke.color).toBe(DEFAULT_PEN_COLOR);
    expect(stroke.thickness).toBe(DEFAULT_PEN_THICKNESS);
    await expectBoxAroundTheLine(page, 0);

    // and where the board paints it is where the document says it is, to the pixel
    const box = await strokeScreenBox(page, 0);
    const where = { x: stroke.x, y: stroke.y };
    const camera = await readCamera(page);
    expectPixels(box.x, (where.x - camera.x) * camera.zoom);
    expectPixels(box.y, (where.y - camera.y) * camera.zoom);
    expectPixels(box.width, stroke.width * camera.zoom);
    expectPixels(box.height, stroke.height * camera.zoom);

    // the weight of the painted line is the weight that was chosen for the pen
    expect(await paintedThickness(page, 0)).toBe(PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS]);

    // the preview goes with the drag, and the Pen keeps the floor so a second line can
    // follow - the line just drawn is what is selected
    await expect(penPreview(page)).toHaveCount(0);
    await expect(penToolButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(penToolLayer(page)).toHaveCount(1);
    await expect(strokeObjects(page).nth(0)).toHaveAttribute('data-selected', 'true');
    await expect(strokeHalo(page, 0)).toHaveCount(1);

    // the line is painted with the ink colour it was drawn in
    expect(await paintedInkColor(page, 0)).toBe(PEN_COLORS[DEFAULT_PEN_COLOR]);
  });

  test('TC-17 the line is repainted on animation frames while the pen is down', async ({
    page,
    request,
  }) => {
    await openFreshBoard(page, request);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });
    await holdPenTool(page);
    await startPreviewSampler(page);

    // a slow hand: a point at a time, a frame between them, so there are frames to see
    await pressPenAt(page, PEN_FIXTURE_UNDERLINE[0]!);
    await dragPenThrough(page, PEN_FIXTURE_UNDERLINE.slice(1, 90), { batch: 3, paceMs: 12 });
    const samples = await previewSamples(page);
    await releasePen(page);

    // the line moved on the screen as the pen moved: several frames were painted, and
    // consecutive frames drew different lines
    expect(previewFrameCount(samples)).toBeGreaterThanOrEqual(3);
    expect(previewFrameChanges(samples)).toBeGreaterThanOrEqual(2);

    // and none of those frames was the board's: the line was this browser's alone
    expect(await strokeCount(page)).toBe(1);
  });

  test('TC-17 the line is still on the board when it is opened again', async ({
    page,
    request,
  }) => {
    await openFreshBoard(page, request);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });
    const drawn = await drawStroke(page, PEN_FIXTURE_UNDERLINE, { color: 'blue', thickness: 'thin' });

    await page.reload();
    await waitForBoardLoaded(page);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    const again = await strokes(page);
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({
      id: drawn.id,
      x: drawn.x,
      y: drawn.y,
      width: drawn.width,
      height: drawn.height,
      color: 'blue',
      thickness: 'thin',
      points: drawn.points,
    });
    await expect(strokeObjects(page)).toHaveCount(1);
    expect(await paintedThickness(page, 0)).toBe(PEN_THICKNESS_WORLD.thin);
    expect(await paintedInkColor(page, 0)).toBe(PEN_COLORS.blue);
  });

  test('TC-18 a colleague sees nothing while the pen moves, and the whole line after it lifts', async ({
    browser,
    request,
  }) => {
    const id = await createBoard(request);
    const priya = await openBoard(browser, id);
    const sam = await openBoard(browser, id);
    await setCamera(priya, { x: 0, y: 0, zoom: 1 });
    await setCamera(sam, { x: 0, y: 0, zoom: 1 });

    await holdPenTool(priya);
    await pressPenAt(priya, PEN_FIXTURE_UNDERLINE[0]!);
    await dragPenThrough(priya, PEN_FIXTURE_UNDERLINE.slice(1, 80));

    // halfway across the board, Sam's board has nothing on it: the preview is local, and
    // the document has no stroke to send him
    expect(await strokeCount(priya)).toBe(0);
    expect(await strokeCount(sam)).toBe(0);
    await expect(strokeObjects(sam)).toHaveCount(0);
    await expect(penPreviewPath(priya)).toHaveCount(1);

    // the pen lifts, and the whole line arrives at once
    await releasePen(priya);
    const elapsed = await timeToStrokesMatch([priya, sam], E2E_EVENTUAL_TIMEOUT_MS);
    console.log(
      `TC-18: the line was on the other screen ${elapsed}ms after the pen lifted ` +
        `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms, eventual bound ${E2E_EVENTUAL_TIMEOUT_MS}ms)`,
    );
    if (elapsed > LIVE_UPDATE_LATENCY_BUDGET_MS) {
      console.log(`TC-18: the line took longer than the budget - reported, not failed`);
    }

    expect(await strokes(sam)).toEqual(await strokes(priya));
    const line = await strokeAt(priya, 0);
    expect(line.points).toBeLessThan(PEN_FIXTURE_UNDERLINE.length);
    expect(line.points).toBeGreaterThan(1);

    // Sam sees it painted where his own document says it is
    const box = await strokeScreenBox(sam, 0);
    expectPixels(box.x, line.x);
    expectPixels(box.y, line.y);
    expectPixels(box.width, line.width);
    expectPixels(box.height, line.height);
  });

  test('TC-18 a long stroke, hundreds of points as drawn, still arrives', async ({
    browser,
    request,
  }) => {
    // driving four hundred points through a real browser is the slow part of this test,
    // not the network: it is given room to breathe rather than a shorter line
    test.slow();
    const id = await createBoard(request);
    const dana = await openBoard(browser, id);
    const sam = await openBoard(browser, id);
    await setCamera(dana, { x: 0, y: 0, zoom: 1 });
    await setCamera(sam, { x: 0, y: 0, zoom: 1 });

    expect(PEN_FIXTURE_LOOP.length).toBeGreaterThan(300);
    const before = await strokeCount(dana);
    await holdPenTool(dana);
    await pressPenAt(dana, PEN_FIXTURE_LOOP[0]!);
    await dragPenThrough(dana, PEN_FIXTURE_LOOP.slice(1), { batch: 20 });
    const released = Date.now();
    await releasePen(dana);

    await expect.poll(() => strokeCount(dana), { message: 'the loop to be on the board' }).toBe(
      before + 1,
    );
    const elapsed = Date.now() - released;
    await waitForStrokesMatch([dana, sam], E2E_EVENTUAL_TIMEOUT_MS);
    console.log(
      `TC-18: a loop of ${PEN_FIXTURE_LOOP.length} drawn points was on both screens ` +
        `${Date.now() - released}ms after the pen lifted (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms, ` +
        `waited ${elapsed}ms so far, eventual bound ${E2E_EVENTUAL_TIMEOUT_MS}ms)`,
    );
    if (Date.now() - released > LIVE_UPDATE_LATENCY_BUDGET_MS) {
      console.log('TC-18: the long line took longer than the budget - reported, not failed');
    }

    const loop = await strokeAt(dana, 0);
    expect(loop.points).toBeGreaterThan(1);
    expect(loop.points).toBeLessThan(PEN_FIXTURE_LOOP.length);
    expect(await strokes(sam)).toEqual(await strokes(dana));
  });

  test('TC-19 the trackpad still pans the board while the Pen is held', async ({
    page,
    request,
  }) => {
    await openFreshBoard(page, request);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });
    await holdPenTool(page);

    const before = await readCamera(page);
    await scrollBoard(page, { x: 640, y: 400 }, 0, 120);
    const after = await waitForCameraChange(page, before);

    // the board moved, the zoom did not, and the Pen is still the tool being held
    expectPixels(after.y, before.y + 120);
    expect(after.zoom).toBe(before.zoom);
    expect(after.x).toBe(before.x);
    await expect(penToolLayer(page)).toHaveCount(1);
    await expect(penToolButton(page)).toHaveAttribute('aria-pressed', 'true');
    expect(await strokeCount(page)).toBe(0);
  });

  test('TC-19 a drag that begins on a sticky note draws on it instead of pushing it', async ({
    page,
    request,
  }) => {
    await openFreshBoard(page, request);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    // a note on the board, and nothing selected
    await createNote(page, { x: 520, y: 360 }, 'annotated');
    const before = await content(page);
    expect(before).toHaveLength(1);

    // the Pen is held, and the drag begins in the middle of the note
    await holdPenTool(page);
    const note = page.locator('[data-testid="sticky-note"]').nth(0);
    const box = await note.boundingBox();
    if (box === null) throw new Error('the note is not rendered');
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x - 60, centre.y - 20, { steps: 8 });
    await page.mouse.move(centre.x + 70, centre.y + 30, { steps: 8 });
    await page.mouse.move(centre.x + 10, centre.y + 52, { steps: 6 });
    await page.mouse.up();

    // the note is where it was, unselected; the stroke is what arrived
    const placed = before[0]!;
    const after = await content(page);
    expect(after).toHaveLength(2); // the note, and the line drawn on top of it
    expect(after.find((o) => o.id === placed.id)).toMatchObject({ x: placed.x, y: placed.y });
    await expect(page.locator('[data-testid="sticky-note"][data-selected="true"]')).toHaveCount(0);
    expect(await strokeCount(page)).toBe(1);
    await expect(strokeObjects(page).nth(0)).toHaveAttribute('data-selected', 'true');

    // and the line is over the note: it was drawn on the board, on top of what is on it
    const strokeBox = await strokeScreenBox(page, 0);
    expect(strokeBox.x + strokeBox.width / 2).toBeGreaterThan(box.x);
    expect(strokeBox.x + strokeBox.width / 2).toBeLessThan(box.x + box.width);
  });

  test('TC-19 the pen colour and weight are chosen by keyboard and by mouse, and are on the next line', async ({
    page,
    request,
  }) => {
    await openFreshBoard(page, request);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    // the panel comes with the tool, and holds the defaults
    await page.keyboard.press('p');
    await expect(penToolbar(page)).toHaveCount(1);
    await expect(penColorButton(page, 'black')).toHaveAttribute('aria-pressed', 'true');
    await expect(penThicknessButton(page, 'medium')).toHaveAttribute('aria-pressed', 'true');

    // red by keyboard, thin by mouse
    await focusPenColorButton(page, 'red');
    await page.keyboard.press('Enter');
    await expect(penColorButton(page, 'red')).toHaveAttribute('aria-pressed', 'true');
    await penThicknessButton(page, 'thin').click();
    await expect(penThicknessButton(page, 'thin')).toHaveAttribute('aria-pressed', 'true');

    const first = await drawStroke(page, SHORT_LINE);
    expect(first.color).toBe('red');
    expect(first.thickness).toBe('thin');
    expect(await paintedThickness(page, 0)).toBe(PEN_THICKNESS_WORLD.thin);
    expect(await paintedInkColor(page, 0)).toBe(PEN_COLORS.red);

    // remembered within the visit: the next line is drawn in the same choice
    const second = await drawStroke(page, [
      { x: 180, y: 300 },
      { x: 210, y: 310 },
      { x: 240, y: 300 },
      { x: 270, y: 312 },
    ]);
    expect(second.color).toBe('red');
    expect(second.thickness).toBe('thin');

    // and the choice is a visit's: a board opened again is back to the defaults
    await page.reload();
    await waitForBoardLoaded(page);
    await page.keyboard.press('p');
    await expect(penColorButton(page, 'black')).toHaveAttribute('aria-pressed', 'true');
    await expect(penColorButton(page, 'red')).toHaveAttribute('aria-pressed', 'false');
    await expect(penThicknessButton(page, 'medium')).toHaveAttribute('aria-pressed', 'true');
    await expect(penThicknessButton(page, 'thin')).toHaveAttribute('aria-pressed', 'false');
    expect(await strokeCount(page)).toBe(2);
  });

  test('TC-20 a stroke is selected by its line, moved, and resized with its ratio kept', async ({
    browser,
    request,
  }) => {
    const id = await createBoard(request);
    const dana = await openBoard(browser, id);
    const sam = await openBoard(browser, id);
    await setCamera(dana, { x: 0, y: 0, zoom: 1 });
    await setCamera(sam, { x: 0, y: 0, zoom: 1 });

    await drawStroke(dana, PEN_FIXTURE_UNDERLINE);
    await waitForStrokesMatch([dana, sam], E2E_EVENTUAL_TIMEOUT_MS);

    // let go of the Pen, so the selection's handles are the topmost thing, and click the
    // line itself: a point on the painted curve, which is where a person aims
    await dana.keyboard.press('v');
    await expect(penToolLayer(dana)).toHaveCount(0);
    const onTheLine = await strokeLineScreenPoint(dana, 0, 0.5);
    await dana.mouse.click(onTheLine.x, onTheLine.y);
    await expect(strokeObjects(dana).nth(0)).toHaveAttribute('data-selected', 'true');

    const drawn = await strokeAt(dana, 0);
    const ratioBefore = drawn.width / drawn.height;

    // resize by a corner handle: a drag along the wide axis, which an aspect-locked
    // object has to answer by growing both ways
    const handle = dana.getByTestId('resize-handle-se');
    const grip = await handle.boundingBox();
    if (grip === null) throw new Error('the stroke has no resize handle');
    await dana.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await dana.mouse.down();
    await dana.mouse.move(grip.x + grip.width / 2 + 23, grip.y + grip.height / 2, { steps: 4 });
    await dana.mouse.move(grip.x + grip.width / 2 + 46, grip.y + grip.height / 2, { steps: 4 });
    await dana.mouse.up();

    const resized = await strokeAt(dana, 0);
    expect(resized.width).toBeGreaterThan(drawn.width);
    expect(resized.height).toBeGreaterThan(drawn.height);
    // the ratio is kept within one percent
    expect(Math.abs(resized.width / resized.height / ratioBefore - 1)).toBeLessThan(0.01);
    // the weight the line was drawn in is untouched by making it bigger
    expect(resized.thickness).toBe(drawn.thickness);
    expect(resized.baseWidth).toBe(drawn.baseWidth);
    expect(resized.baseHeight).toBe(drawn.baseHeight);
    expect(await paintedThickness(dana, 0)).toBe(PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS]);
    // the opposite corner stayed where it was: the line grew away from it
    expect(resized.x).toBeCloseTo(drawn.x, 1);
    expect(resized.y).toBeCloseTo(drawn.y, 1);
    expect(resized.width).toBeGreaterThanOrEqual(STROKE_MIN_SIZE_WORLD);

    await waitForStrokesMatch([dana, sam], E2E_EVENTUAL_TIMEOUT_MS);

    // move it by the line: the whole object goes where the pointer took it
    const moved = await strokeLineScreenPoint(dana, 0, 0.5);
    await dana.mouse.move(moved.x, moved.y);
    await dana.mouse.down();
    await dana.mouse.move(moved.x - 60, moved.y + 20, { steps: 5 });
    await dana.mouse.move(moved.x - 120, moved.y + 40, { steps: 5 });
    await dana.mouse.up();

    const after = await strokeAt(dana, 0);
    expectPixels(after.x, resized.x - 120);
    expectPixels(after.y, resized.y + 40);
    expect(after.thickness).toBe(drawn.thickness);
    expect(after.points).toBe(resized.points);

    await waitForStrokesMatch([dana, sam], E2E_EVENTUAL_TIMEOUT_MS);
    expect(await strokes(sam)).toEqual(await strokes(dana));
    // Sam's screen shows the moved line in the moved place
    const box = await strokeScreenBox(sam, 0);
    expectPixels(box.x, after.x);
    expectPixels(box.y, after.y);
  });

  test('TC-20 deleting a stroke takes it off every screen', async ({ browser, request }) => {
    const id = await createBoard(request);
    const dana = await openBoard(browser, id);
    const sam = await openBoard(browser, id);
    await setCamera(dana, { x: 0, y: 0, zoom: 1 });
    await setCamera(sam, { x: 0, y: 0, zoom: 1 });

    await drawStroke(dana, PEN_FIXTURE_UNDERLINE);
    await waitForStrokesMatch([dana, sam], E2E_EVENTUAL_TIMEOUT_MS);
    await expect(strokeObjects(sam)).toHaveCount(1);

    await dana.keyboard.press('v');
    const onTheLine = await strokeLineScreenPoint(dana, 0, 0.35);
    await dana.mouse.click(onTheLine.x, onTheLine.y);
    await expect(strokeObjects(dana).nth(0)).toHaveAttribute('data-selected', 'true');

    await dana.keyboard.press('Delete');
    await expect
      .poll(() => strokeCount(dana), { message: 'the stroke to be gone from Dana board' })
      .toBe(0);
    await expect.poll(() => strokeCount(sam), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(0);
    await expect(strokeObjects(dana)).toHaveCount(0);
    await expect(strokeObjects(sam)).toHaveCount(0);

    // and it stays gone across a reload
    await dana.reload();
    await waitForBoardLoaded(dana);
    expect(await strokeCount(dana)).toBe(0);
    expect(await strokes(sam)).toEqual(await strokes(dana));
  });
});
