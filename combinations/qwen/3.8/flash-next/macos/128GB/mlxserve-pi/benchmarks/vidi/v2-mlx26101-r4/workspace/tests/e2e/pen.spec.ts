/**
 * Sketching freehand with a pen, on a real screen, in front of other people (story 11, TC-17 to TC-20).
 *
 * What these four cases can only be shown in a browser:
 *
 *   - TC-17 — the preview is a thing that happens *between paints*. A jsdom test can say a path element is on
 *     screen; only a real page can say its `d` changed on consecutive animation frames while the pointer
 *     travelled, and that the line stayed where the mouse left it afterwards — painted where its points say it
 *     should be, in the ink and at the nib it was drawn with.
 *   - TC-18 — an in-flight stroke is this page's business alone. Somebody watching sees nothing while the pen
 *     travels (the negative that a preview painted into the shared document would break) and sees the finished
 *     line the moment the pointer lets go. How long that took is written down, not asserted: this machine is
 *     running three browsers, a model and a server at once, and a slow test machine is not a slow board.
 *   - TC-19 — the pen lies over the board and must not interfere with it. A wheel still pans the board while
 *     the pen is in the hand, and a stroke that starts on top of a sticky note is a stroke and not a note that
 *     has been dragged about or opened.
 *   - TC-20 — a finished stroke is an ordinary object: picked up by its line, not by the empty rectangle
 *     around it; resized with its proportions kept and its nib unchanged; carried somewhere else; and deleted
 *     out of everybody's board.
 *
 * Every test sets the camera and reads it back before using it, so board units and screen pixels are converted
 * rather than assumed; everything read out of a page's document is in board units and needs no conversion.
 */
import { expect, test, type Page } from '@playwright/test';

import {
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { expectPixels, openBoard, settled, setCamera, worldToScreen } from './helpers/board';
import type { Point } from './helpers/board';
import { createNote, notes, stickies } from './helpers/sticky';
import {
  PEN_INKS,
  PLAIN,
  armPenTool,
  armPenToolByKey,
  choosePenColor,
  choosePenThickness,
  drawLine,
  drawWithPen,
  dragSelectionHandle,
  dragStroke,
  inkOf,
  liftPen,
  lowerPen,
  paintedStrokeBox,
  paintedStrokeMiss,
  paintedStrokeStyle,
  penAriaPressed,
  penColorButton,
  penPreview,
  penSheet,
  penStatus,
  penThicknessButton,
  penToolbar,
  penToolButton,
  previewSamples,
  putPenDown,
  retrace,
  selectStroke,
  strokeElement,
  strokeOnPage,
  strokePainted,
  strokePoints,
  strokeSelected,
  strokesOnPage,
  tapPen,
  toolOf,
  watchPreview,
} from './helpers/pen';
import {
  aimCamera,
  closeParticipants,
  expectEventually,
  logLatencies,
  openParticipants,
} from './helpers/participants';
import { handwrittenLoop, letterAStrokes, underline } from '../fixtures/pen-paths';

/** The loop the design's fixtures recorded: a hand-drawn circle, wobble and all. */
const LOOP = handwrittenLoop({ count: 400, radius: 120, x: 300, y: 300, jitter: 1.2, seed: 3 });

/** A line to underline something with, in board units. */
const UNDERLINE = underline({ count: 140, x: 180, y: 200, length: 320, rise: 12, jitter: 1.1, seed: 11 });

test.afterAll(() => {
  logLatencies('story 11 live update latency');
});

test('TC-17: a drag with the pen previews every frame and leaves one stroke behind', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, PLAIN);
  const camera = await settled(page);
  expect(camera.zoom, 'the design runs this case at 100%').toBe(1);

  await armPenTool(page);
  await expect(penToolbar(page), 'the pen brings its own options with it').toBeVisible();

  // The frames are watched from inside the page, because the question is about what is painted between the
  // pointer's own events.
  await watchPreview(page);
  await lowerPen(page, LOOP);

  // While the pointer travels there is a line on the screen and no stroke in the document: the preview is a
  // promise about this page, and a board that wrote the document on every pointermove would put four hundred
  // drawings on five people's boards for one circle.
  await expect(penPreview(page)).toBeVisible();
  expect(await strokesOnPage(page), 'nothing is written to the board while the pen is travelling').toHaveLength(0);

  const samples = await previewSamples(page);
  const drawn = samples.filter((sample) => sample !== '');
  expect(drawn.length, `the preview was painted on ${drawn.length} of ${samples.length} frames`).toBeGreaterThan(2);
  const distinct = [...new Set(drawn)];
  expect(distinct.length, 'the preview is redrawn as the pointer travels, not drawn once at the press').toBeGreaterThan(2);
  // It grew: each frame's line has more of the loop in it than the one before.
  expect(
    drawn[drawn.length - 1]!.length,
    'the last frame holds more line than the first',
  ).toBeGreaterThan(drawn[0]!.length);

  await liftPen(page);

  // The preview was a promise and the document is the answer: nothing is being drawn, and one stroke is there.
  await expect(penPreview(page)).toHaveCount(0);
  const onBoard = await strokesOnPage(page);
  expect(onBoard).toHaveLength(1);
  const stroke = onBoard[0]!;
  expect(stroke.type).toBe('stroke');
  expect(stroke.createdBy, 'the board knows who drew it').not.toBe('');
  // The recorded path is a loop of four hundred points; what is stored is the same loop thinned to the points
  // that carry its shape, which is fewer than the pointer produced and more than a straight line's two.
  expect(stroke.points.length / 2).toBeLessThan(retrace(LOOP).length);
  expect(stroke.points.length / 2).toBeGreaterThan(2);

  // The stroke is where the mouse went: the loop's own extent, plus the nib's own paint, less whatever the
  // smoothing was allowed a screen pixel of. The slack is the smoothing's promise written out — every point the
  // pen visited is within a pixel of the line that was stored — and a stroke that missed by more than that is a
  // stroke whose box does not hold the drawing.
  const extent = extentOf(LOOP);
  const slack = PEN_THICKNESS_WORLD.medium + 4;
  expect(Math.abs(stroke.width - (extent.width + PEN_THICKNESS_WORLD.medium)), 'the box is what the pen covered').toBeLessThan(slack);
  expect(Math.abs(stroke.height - (extent.height + PEN_THICKNESS_WORLD.medium)), 'the box is what the pen covered').toBeLessThan(slack);
  // and it is selected, because the line just drawn is the line a person wants to do something to next.
  expect(await strokeSelected(page, stroke.id)).toBe(true);
  expect(await toolOf(page), 'the pen stays in the hand after a stroke').toBe('pen');

  // Painted where its own points say it should be, in the ink and at the nib it was drawn with.
  const miss = await paintedStrokeMiss(page, stroke.id);
  for (const [name, off] of Object.entries(miss)) {
    expect(Math.abs(off), `the painted line is out by ${off} pixels in ${name}`).toBeLessThan(
      PEN_THICKNESS_WORLD.medium + 2,
    );
  }
  const paint = await paintedStrokeStyle(page, stroke.id);
  expect(paint.fill, 'a drawing is a line and not a shape').toBe('none');
  expect(paint['stroke-linecap']).toBe('round');
  expect(paint['stroke-linejoin']).toBe('round');
  expect(paint['stroke-width']).toBe(String(PEN_THICKNESS_WORLD.medium));
  expect(paint.stroke).toBe(inkOf(stroke.color));
});

test('TC-17: the pen draws one line after another, and a fresh line is drawn on top', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, PLAIN);
  await armPenToolByKey(page);
  expect(await toolOf(page)).toBe('pen');

  // The letter A: three strokes of a pen, with the pen lifted between them.
  for (const stroke of letterAStrokes(1.5)) await drawWithPen(page, stroke);

  const onBoard = await strokesOnPage(page);
  expect(onBoard).toHaveLength(3);
  expect(onBoard.map((entry) => entry.createdBy === onBoard[0]!.createdBy)).toEqual([true, true, true]);
  // In the order they were drawn, which is the order they are stacked in.
  expect(onBoard.map((entry) => entry.z)).toEqual([...onBoard.map((entry) => entry.z)].sort((a, b) => a - b));
  expect(await toolOf(page), 'a pen that stepped aside after the first line would have to be picked up again').toBe('pen');

  // Each line is painted, and each is painted in the same ink the panel says is in the pen.
  await expect(strokePainted(page, onBoard[0]!.id)).toBeVisible();
  await expect(strokePainted(page, onBoard[2]!.id)).toBeVisible();
  expect(await penStatus(page)).toBe('black medium pen');

  // Undo takes them back one line at a time, which is what a boundary after each commit is for.
  await page.keyboard.press('Control+z');
  await expect.poll(() => strokesOnPage(page).then((entries) => entries.length)).toBe(2);
  await page.keyboard.press('Control+z');
  await expect.poll(() => strokesOnPage(page).then((entries) => entries.length)).toBe(1);
  await page.keyboard.press('Control+z');
  await expect.poll(() => strokesOnPage(page).then((entries) => entries.length)).toBe(0);
});

test('TC-18: a person watching sees nothing while the pen travels and the line when it lifts', async ({ browser }) => {
  const [drawer, watcher] = await openParticipants(browser, 2);
  try {
    await aimCamera(drawer, PLAIN);
    await aimCamera(watcher, PLAIN);
    await armPenTool(drawer.page);

    // The two agree about the board before anything is timed, so the measurement below is of a change travelling
    // and not of a page still loading.
    expect(await strokesOnPage(watcher.page)).toHaveLength(0);

    await lowerPen(drawer.page, UNDERLINE);
    // The drawer has a line on their screen…
    await expect(penPreview(drawer.page)).toBeVisible();
    // …and the watcher has nothing at all: no stroke in the board, and no drawing painted on their screen. A
    // preview written into the document would show up here as a line being dragged about in front of them.
    expect(await strokesOnPage(watcher.page), 'an in-flight stroke is not shared').toHaveLength(0);
    await expect(watcher.page.getByTestId('stroke-object')).toHaveCount(0);

    const since = Date.now();
    await liftPen(drawer.page);
    const drawn = await strokesOnPage(drawer.page);
    expect(drawn).toHaveLength(1);

    // How long the finished line took to appear is written down against the budget, not asserted: the budget is
    // a fact about a shared board and this machine is running the browsers, the model and the server at once.
    await expectEventually(
      `${watcher.name} sees the finished drawing`,
      () => strokesOnPage(watcher.page).then((entries) => entries.length),
      { since },
    ).toBe(1);
    const measured = (await strokesOnPage(watcher.page))[0]!;
    expect(measured.id).toBe(drawn[0]!.id);
    expect(measured.color).toBe(drawn[0]!.color);
    expect(measured.thickness).toBe(drawn[0]!.thickness);
    expect(measured.points).toEqual(drawn[0]!.points);
    expect(measured).toEqual(drawn[0]!);

    // And it is painted on their screen too, at the place their own camera says it should be.
    await expect(strokePainted(watcher.page, measured.id)).toBeVisible();
    const onWatcher = await paintedStrokeBox(watcher.page, measured.id);
    const first = worldToScreen(await settled(watcher.page), (await strokePoints(watcher.page, measured.id))[0]!);
    expect(Math.abs(onWatcher.x - (first.x - PEN_THICKNESS_WORLD.medium / 2))).toBeLessThan(
      PEN_THICKNESS_WORLD.medium + 2,
    );
    // Nothing was drawn twice, and the watcher's own pen was never in the hand.
    expect(await strokesOnPage(watcher.page)).toHaveLength(1);
    expect(await toolOf(watcher.page)).not.toBe('pen');
    expect(watcher.errors, `${watcher.name}'s board said nothing that was an error`).toEqual([]);
    expect(drawer.errors).toEqual([]);
  } finally {
    await closeParticipants([drawer, watcher]);
  }
});

test('TC-19: with the pen in hand the wheel still pans and a stroke over a note leaves the note alone', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, PLAIN);
  const note = await createNote(page, { x: 260, y: 320 }, 'review before Friday');
  const before = (await stickies(page)).find((entry) => entry.id === note)!;
  const noteOnScreen = worldToScreen(await settled(page), { x: before.x + 60, y: before.y + 40 });

  await armPenTool(page);

  // Scrolling is the board's, whatever tool is up: the pen holds the pointer, not the wheel.
  await page.mouse.move(noteOnScreen.x, noteOnScreen.y);
  await page.mouse.wheel(0, 120);
  const panned = await settled(page);
  expect(panned.y, 'the wheel moved the board while the pen was armed').not.toBe(PLAIN.y);
  expect(panned.x, 'a vertical wheel does not move the board sideways').toBe(PLAIN.x);
  expect(panned.zoom, 'a wheel without a modifier key does not zoom').toBe(1);
  expect(await toolOf(page), 'the pen is still in the hand').toBe('pen');

  // A stroke that starts on top of the note: the press belongs to the pen, and nothing else.
  const across: Point[] = [
    { x: before.x + 60, y: before.y + 40 },
    { x: before.x + 200, y: before.y + 10 },
    { x: before.x + 300, y: before.y + 90 },
  ];
  await drawWithPen(page, across);

  await expect.poll(() => strokesOnPage(page).then((entries) => entries.length)).toBe(1);
  const stroke = (await strokesOnPage(page))[0]!;
  // The line went where the mouse went, in board units, starting over the note: the same slack as the
  // smoothing is given, and a line that long cannot be anything but the drag.
  expect(Math.abs(stroke.x - (Math.min(...across.map((at) => at.x)) - PEN_THICKNESS_WORLD.medium / 2))).toBeLessThan(4);
  expect(stroke.width).toBeGreaterThan(100);
  expect(stroke.height).toBeGreaterThan(20);

  const after = (await stickies(page)).find((entry) => entry.id === note)!;
  expect({ x: after.x, y: after.y, z: after.z, text: after.text }).toEqual({
    x: before.x,
    y: before.y,
    z: before.z,
    text: before.text,
  });
  // The note was not so much as opened for typing, or selected: a press that was never aimed at it must not
  // leave its mark on the selection either.
  await expect(page.getByTestId('sticky-textarea')).toHaveCount(0);
  const outlines = await page.locator('[data-testid="selection-outline"]').evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset.objectId ?? ''),
  );
  expect(outlines, 'the drawing is what is selected, not the note under the pen').toEqual([stroke.id]);
  expect(await notes(page).count()).toBe(1);
});

test('TC-20: a drawing is picked up by its line, scaled with its proportions, moved and deleted', async ({ browser }) => {
  const [drawer, watcher] = await openParticipants(browser, 2);
  try {
    await aimCamera(drawer, PLAIN);
    await aimCamera(watcher, PLAIN);
    await armPenTool(drawer.page);
    await drawWithPen(drawer.page, LOOP);
    await expectEventually(
      `${watcher.name} sees the drawing`,
      () => strokesOnPage(watcher.page).then((entries) => entries.length),
    ).toBe(1);
    const id = (await strokesOnPage(drawer.page))[0]!.id;

    // The pen goes back and the line is picked up where it is *drawn*, not in the rectangle around it.
    await drawer.page.keyboard.press('v');
    await expect(penSheet(drawer.page)).toHaveCount(0);
    await selectStroke(drawer.page, id, 0.5);
    expect(await strokeSelected(drawer.page, id)).toBe(true);

    // Half a pen-width away from the line, well outside what a pointer can reach at this zoom, a click finds
    // nothing: the box around a drawing is a bounding box and does not answer to the pointer.
    await drawer.page.keyboard.press('Escape');
    const off = await offLineEdit(drawer.page, id);
    await drawer.page.mouse.click(off.x, off.y);
    expect(await strokeSelected(drawer.page, id), 'a click away from the line selects nothing').toBe(false);

    // A corner handle: proportions kept, and the nib unchanged.
    await selectStroke(drawer.page, id, 0.5);
    const before = await strokeOnPage(drawer.page, id);
    const ratio = before.width / before.height;
    const drawnBefore = extentOf(await strokePoints(drawer.page, id));
    await dragSelectionHandle(drawer.page, 'se', { x: 120, y: 30 });
    const grown = await strokeOnPage(drawer.page, id);
    expect(grown.width, 'the drawing got bigger').toBeGreaterThan(before.width);
    expect(Math.abs(grown.width / grown.height - ratio) / ratio, 'the proportions are kept to within 1%').toBeLessThan(0.01);
    expect(grown.thickness, 'making a drawing bigger is not drawing it again with a thicker pen').toBe(before.thickness);
    expect((await paintedStrokeStyle(drawer.page, id))['stroke-width']).toBe(String(PEN_THICKNESS_WORLD[before.thickness]));
    // The held corner stayed put and the drawing grew with the box, out of a resize that wrote four numbers and
    // not one per point: the stored drawing is byte for byte what it was, and the line on the board is bigger.
    expect(grown.x, 'the corner the pointer did not touch stayed put').toBeCloseTo(before.x, 1);
    expect((await strokeOnPage(drawer.page, id)).points).toEqual(before.points);
    const drawnAfter = extentOf(await strokePoints(drawer.page, id));
    expect(
      drawnAfter.width - drawnBefore.width,
      'every point moved with the box it was given',
    ).toBeGreaterThan((grown.width - before.width) - 2);
    expect(drawnAfter.height, 'the other axis followed it').toBeGreaterThan(drawnBefore.height);
    await expectEventually(
      `${watcher.name} sees the drawing resized`,
      async () => (await strokeOnPage(watcher.page, id)).width,
      { since: Date.now() },
    ).toBe(grown.width);

    // Pick it up by the line and carry it: the box moves, the points inside it do not.
    const pointsBefore = await strokePoints(drawer.page, id);
    await dragStroke(drawer.page, id, { x: 90, y: 60 });
    const moved = await strokeOnPage(drawer.page, id);
    expectPixels(moved.x, grown.x + 90, 'the drawing went where the mouse carried it');
    expectPixels(moved.y, grown.y + 60, 'the drawing went where the mouse carried it');
    expect(moved.points, 'the drawing itself was not rewritten').toEqual(grown.points);
    expect(Math.abs((await strokePoints(drawer.page, id))[0]!.x - pointsBefore[0]!.x)).toBeGreaterThan(50);
    await expectEventually(
      `${watcher.name} sees the drawing moved`,
      async () => (await strokeOnPage(watcher.page, id)).x,
    ).toBe(moved.x);

    // And it goes away for everybody: one press, and neither screen has it.
    await drawer.page.keyboard.press('Delete');
    await expectEventually(`${drawer.name} has no drawing left`, () => strokesOnPage(drawer.page).then((entries) => entries.length)).toBe(0);
    await expectEventually(`${watcher.name} has no drawing left`, () => strokesOnPage(watcher.page).then((entries) => entries.length)).toBe(0);
    await expect(strokeElement(drawer.page, id)).toHaveCount(0);
    await expect(strokeElement(watcher.page, id)).toHaveCount(0);
    expect(await drawer.errors).toEqual([]);
    expect(await watcher.errors).toEqual([]);
  } finally {
    await closeParticipants([drawer, watcher]);
  }
});

test('TC-20: the inks and nibs are on screen with the pen and only with the pen', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, PLAIN);

  // Six inks, three nibs, one of each pressed, and the whole panel is the pen's.
  await penToolButton(page).click();
  await expect(penToolbar(page)).toBeVisible();
  expect(await penAriaPressed(page)).toEqual({ colors: ['black'], thicknesses: ['medium'] });
  for (const ink of PEN_INKS) await expect(penColorButton(page, ink)).toBeVisible();
  for (const nib of ['thin', 'medium', 'thick']) await expect(penThicknessButton(page, nib)).toBeVisible();

  await choosePenColor(page, 'red');
  await choosePenThickness(page, 'thin');
  expect(await penAriaPressed(page)).toEqual({ colors: ['red'], thicknesses: ['thin'] });
  expect(await penStatus(page)).toBe('red thin pen');

  // Drawn with what was chosen: the ink and the nib are in the record, not in a pixel.
  await drawLine(page, { x: 200, y: 420 }, { x: 420, y: 470 });
  const stroke = (await strokesOnPage(page))[0]!;
  expect(stroke.color).toBe('red');
  expect(stroke.thickness).toBe('thin');
  expect((await paintedStrokeStyle(page, stroke.id)).stroke).toBe('#E53935');

  // A dot: the pen down and up again, without travelling.
  await tapPen(page, { x: 520, y: 520 });
  await expect.poll(() => strokesOnPage(page).then((entries) => entries.length)).toBe(2);
  const dot = (await strokesOnPage(page))[1]!;
  expect(dot.points).toHaveLength(2);
  expectPixels(dot.width, PEN_THICKNESS_WORLD.thin, 'a dot is the nib, and the nib is a square');
  expectPixels(dot.height, PEN_THICKNESS_WORLD.thin, 'a dot is the nib, and the nib is a square');
  expect(await strokeSelected(page, dot.id)).toBe(true);

  // Put the pen down and the panel goes with it.
  await putPenDown(page);
  expect(await toolOf(page)).toBe('select');
});

test('TC-20: a drawing cannot be pulled below its own minimum, and stays a drawing', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, PLAIN);
  await armPenTool(page);
  await drawWithPen(page, underline({ count: 60, x: 200, y: 300, length: 160, jitter: 0.8 }));
  const id = (await strokesOnPage(page))[0]!.id;

  await page.keyboard.press('v');
  await selectStroke(page, id);
  await dragSelectionHandle(page, 'se', { x: -4000, y: -4000 });

  const stroke = await strokeOnPage(page, id);
  expect(stroke.width, 'the drawing stopped shrinking before it disappeared').toBeGreaterThanOrEqual(STROKE_MIN_SIZE_WORLD);
  expect(stroke.height).toBeGreaterThanOrEqual(STROKE_MIN_SIZE_WORLD);
  expect(stroke.thickness).toBe('medium');
  expect(stroke.points.length / 2, 'the line itself is untouched by a resize').toBeGreaterThan(2);
  // Still painted, and still a line: a minimum is a limit and not a deletion.
  await expect(strokePainted(page, id)).toBeVisible();
  expect((await paintedStrokeStyle(page, id))['stroke-width']).toBe(String(PEN_THICKNESS_WORLD.medium));
});

// ---------------------------------------------------------------------------
// The two measurements this file's cases are written around
// ---------------------------------------------------------------------------

/** The board-unit extent of a recorded path: how wide and how tall the hand travelled. */
function extentOf(path: readonly Point[]): { width: number; height: number } {
  const xs = path.map((point) => point.x);
  const ys = path.map((point) => point.y);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/**
 * A point on this page's screen that is far from a drawing's line but inside its box.
 *
 * The box is padded by half a nib, so "far" is measured against what a pointer can actually reach at this
 * zoom — the hit tolerance — and is placed at the widest empty place the drawing leaves, which for a loop is
 * the middle of the hole.
 */
async function offLineEdit(page: Page, id: string): Promise<Point> {
  const points = await strokePoints(page, id);
  const stroke = await strokeOnPage(page, id);
  const camera = await settled(page);
  const centre = { x: stroke.x + stroke.width / 2, y: stroke.y + stroke.height / 2 };
  // The middle of a loop's hole is as far from its line as the drawing ever gets.
  expect(
    Math.min(...points.map((point) => Math.hypot(point.x - centre.x, point.y - centre.y))),
    'this fixture is a loop, so its middle is far from its line',
  ).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX / camera.zoom);
  return worldToScreen(camera, centre);
}

