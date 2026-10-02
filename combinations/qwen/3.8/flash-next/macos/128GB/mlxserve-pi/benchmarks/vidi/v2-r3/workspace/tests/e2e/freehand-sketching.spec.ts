// Story 11, e2e: sketching freehand, in real browsers on a real room.
//
// What only a browser can show: that a stroke appears on the screen while the pointer
// is still moving and changes from frame to frame while it does; that nothing of it
// reaches anybody else until the pointer comes up, and then the whole of it arrives at
// once; that the board goes on panning under the wheel while the Pen tool is in hand,
// and no note under the pointer moves when the pen draws over it; and that a finished
// drawing can be clicked on its line, scaled in proportion, dragged about and deleted
// — and is seen to be gone on every other screen.
//
// Every path drawn here is one of the recorded ones in `tests/fixtures/pen-paths.ts`,
// and every measurement is taken from what the page drew: a drawing's box is the box
// the drawing reports (`data-box-*`, in board units), a point on its line is a point
// the painted path says lies on it, and the width of it is the width the browser was
// told to paint. Nothing asserts wall-clock time: a change is waited for, and how long
// it took is printed against the latency budget, as in stories 3, 8 and 10.
import { expect, test, type Page } from '@playwright/test';
import { gotoBoard, setCamera, settle, type ScreenPoint } from './helpers/board';
import { cameraOf, screenOf, selectButton } from './helpers/shapes';
import { createNoteAt, noteCentre, noteState, noteWorldPos, waitForNoteCount } from './helpers/stickies';
import {
  expectEventually,
  expectNoProblems,
  expectSameBoard,
  joinBoard,
  leaveAll,
  newBoard,
  reportLatency,
  type Person,
} from './helpers/participants';
import {
  armPenTool,
  choosePen,
  clickStroke,
  dragThePen,
  drawStroke,
  penButton,
  previewFrames,
  previewLocator,
  previewPath,
  sawStroke,
  startSamplingPreview,
  stopSamplingPreview,
  strokeCorridorOnScreen,
  strokeCount,
  strokeLinePoint,
  strokePen,
  strokePointCount,
  strokeState,
  strokeWidthInBoardUnits,
  strokeWidthOnScreen,
  strokeWorldBox,
  waitForStrokeCount,
  watchStrokes,
} from './helpers/strokes';
import { handwrittenLoop, underline } from '../fixtures/pen-paths';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STICKY_SIZE_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
} from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';

const SCREEN = { width: 1280, height: 800 };
/** The middle of the window, which is where a board that was only opened looks. */
const MIDDLE = { x: SCREEN.width / 2, y: SCREEN.height / 2 };

test.afterEach(() => {
  reportLatency('story 11 changes measured in this test');
});

/** A recorded path, put where a test wants it drawn. The fixtures are written in
 *  board units about the point (320, 240); shifting them is arithmetic the test does
 *  on purpose, so that no path is drawn through the toolbar down the left of the
 *  window or the zoom controls in its corner. */
function shift(path: readonly Point[], dx: number, dy: number): Point[] {
  return path.map((point) => ({ x: point.x + dx, y: point.y + dy }));
}

/** Every `nth` point of a path, always keeping the last: the same line, coarser. A
 *  whole 400-point path dragged one animation frame per point is a test that takes
 *  seven seconds to draw an ellipse; every tenth point is the same ellipse, drawn over
 *  frames that are still one frame each. */
function coarsen(path: readonly Point[], nth: number): Point[] {
  const kept = path.filter((unused, index) => index % nth === 0);
  const last = path[path.length - 1]!;
  if (kept[kept.length - 1] !== last) kept.push(last);
  return kept;
}

/** Board units to the screen pixels the page draws them at, right now. */
async function onto(page: Page, points: readonly Point[]): Promise<ScreenPoint[]> {
  const path: ScreenPoint[] = [];
  for (const point of points) path.push(await screenOf(page, point));
  return path;
}

/** One turn of the fixture's ellipse — the kind a person draws round a thing on the
 *  board — about a point given in board units. */
function loopAbout(centre: Point): Point[] {
  return shift(coarsen(handwrittenLoop(160), 4), centre.x - 320, centre.y - 240);
}

/** The same loop, in clear space with nothing round it: the annotation the product's
 *  own example is drawn with. */
function theLoop(): Point[] {
  return loopAbout({ x: 40, y: 120 });
}

/** The preview as the page paints it: its colour, and how wide a line it is. */
function previewPenOf(page: Page): Promise<{ color: string; width: number }> {
  return previewPath(page).evaluate((el) => ({
    color: el.getAttribute('stroke') ?? '',
    width: Number(el.getAttribute('stroke-width')),
  }));
}

/* ── TC-17: an annotation is on the screen while it is being made ────── */

test('TC-17 a loop is drawn on the screen as it is drawn, on every frame, and stays when the pointer comes up', async ({
  page,
}) => {
  await gotoBoard(page);
  await armPenTool(page);

  const path = await onto(page, theLoop());
  await startSamplingPreview(page);
  await dragThePen(page, path);

  // The pointer is still down. Nothing is on the board: a drawing that arrived in
  // pieces would be a drawing that everybody else watched being made.
  expect(await strokeCount(page)).toBe(0);

  // The picture of it was there the whole time, and it moved: more than one animation
  // frame sampled, and a different line on most of them. That is the only meaning
  // "updated every animation frame" can have for a test — a preview that was drawn
  // once, at the end, would be a preview that appeared when the drawing was over.
  const frames = await previewFrames(page);
  expect(frames.frames).toBeGreaterThan(4);
  expect(frames.distinct).toBeGreaterThan(4);
  expect(frames.frames).toBeGreaterThanOrEqual(frames.distinct);

  // The preview is the stroke it is going to become: the pen's colour, and the pen's
  // width as this zoom shows it.
  const pen = await previewPenOf(page);
  const zoom = (await cameraOf(page)).zoom;
  expect(pen.color).toBe(PEN_COLORS.black);
  expect(pen.width).toBeCloseTo(PEN_THICKNESS_WORLD.medium * zoom, 2);

  await page.mouse.up();
  const [id] = await waitForStrokeCount(page, 1);

  // It is still there afterwards — and it is a drawing rather than the drag that made
  // it: no more points than the pointer went through, and the box the pointer covered.
  await settle(page);
  expect(await strokeCount(page)).toBe(1);
  const stored = await strokePointCount(page, id);
  expect(stored).toBeLessThanOrEqual(path.length);
  expect(stored).toBeGreaterThan(2);
  const box = await strokeWorldBox(page, id);
  expect(box.width).toBeGreaterThan(100);
  expect(box.height).toBeGreaterThan(60);
  expect(box.width / box.height).toBeGreaterThan(1.2);

  // The preview is gone: it was the drag, and the drag is over.
  await expect(previewLocator(page)).toHaveCount(0);
  // The board did not move under any of it, and the Pen tool is still in hand.
  expect(await cameraOf(page)).toEqual({ x: -SCREEN.width / 2, y: -SCREEN.height / 2, zoom: 1 });
  await expect(penButton(page)).toHaveAttribute('aria-pressed', 'true');

  // Choosing a pen is not a drawing: the swatches are pressed with the pen in hand,
  // and nothing is left on the board by the pressing.
  await choosePen(page, { color: 'blue', thickness: 'thick' });
  expect(await strokeCount(page)).toBe(1);

  // And the pen drew the next line too, which is what a pen does.
  const second = await drawStroke(page, await onto(page, shift(underline(30), -320, -220)));
  expect(second).not.toBe(id);
  await waitForStrokeCount(page, 2);
  expect(await strokePen(page, second)).toEqual({ color: 'blue', thickness: 'thick' });
  // The first drawing kept the pen it was drawn with.
  expect(await strokePen(page, id)).toEqual({ color: 'black', thickness: 'medium' });

  // Two drawings, two undo steps: one press takes one drawing away.
  await page.keyboard.press('Control+z');
  await expectEventually('one press of Undo leaves one drawing', () => strokeCount(page), 1, 'board');
  await page.keyboard.press('Control+z');
  await expectEventually('two presses leave none', () => strokeCount(page), 0, 'board');
});

/* ── TC-18: a sketch shared as it is finished ────────────────────────── */

test('TC-18 the person watching sees nothing while the pen moves, and the whole drawing once it stops', async ({
  browser,
  request,
}) => {
  const boardId = await newBoard(request);
  const priya: Person = await joinBoard(browser, 'Priya', boardId);
  const sam: Person = await joinBoard(browser, 'Sam', boardId);
  const people = [priya, sam];

  await watchStrokes(sam.page);
  await armPenTool(priya.page);
  const path = await onto(sam.page, theLoop());

  // Draw a quarter of the loop. The watcher's board is still a board with nothing on
  // it, and the drawer's is the same: an unfinished stroke is nobody's stroke.
  await dragThePen(priya.page, path.slice(0, 12));
  expect(await strokeCount(sam.page)).toBe(0);
  expect(await strokeCount(priya.page)).toBe(0);

  const releasedAt = Date.now();
  await priya.page.mouse.up();
  const [id] = await waitForStrokeCount(priya.page, 1);

  // The finished stroke arrives. How long it took is printed against the budget, and
  // not asserted: the wait is for the drawing to be there, which it always is.
  await expectEventually('the watcher sees the finished drawing', () => sawStroke(sam.page, id, releasedAt - 100), true, 'Sam');
  const asDrawn = await strokeState(priya.page, id);
  await expectEventually('the watcher draws the same drawing', () => strokeState(sam.page, id), asDrawn, 'Sam');

  // One drawing, on both screens, and nothing else came with it.
  expect(await strokeCount(priya.page)).toBe(1);
  expect(await strokeCount(sam.page)).toBe(1);

  // The pen travelled with the drawing: a second stroke in another pen is seen by the
  // watcher as two different pens on the board, not as one board that changed colour.
  await choosePen(priya.page, { color: 'red', thickness: 'thick' });
  const secondReleasedAt = Date.now();
  const second = await drawStroke(priya.page, await onto(priya.page, shift(underline(30), -300, -160)));
  await expectEventually(
    'the watcher sees the second drawing',
    () => sawStroke(sam.page, second, secondReleasedAt - 100),
    true,
    'Sam',
  );
  expect(await strokePen(sam.page, second)).toEqual({ color: 'red', thickness: 'thick' });
  expect(await strokePen(sam.page, id)).toEqual({ color: 'black', thickness: 'medium' });

  await expectSameBoard(people, 'both people agree on the board after two sketches');
  await leaveAll(people);
  expectNoProblems(people);
});

/* ── TC-19: the board still navigates while the pen is in hand ───────── */

test('TC-19 the wheel pans the board with the Pen tool in hand, and a stroke drawn over a note leaves the note where it was', async ({
  page,
}) => {
  await gotoBoard(page);
  const note = await createNoteAt(page, { x: 520, y: 400 }, 'under the pen');
  await waitForNoteCount(page, 1);
  await armPenTool(page);

  // A wheel is not a pointer, and the Pen tool has no business with it. The board
  // scrolls as it always did — a pen that disabled navigation would be a pen that
  // trapped everybody at one corner of the board.
  const before = await cameraOf(page);
  const noteOnScreenBefore = await noteCentre(page, note);
  await page.mouse.move(760, 500);
  await page.mouse.wheel(0, 200);
  await settle(page);
  const panned = await cameraOf(page);
  const noteOnScreenAfter = await noteCentre(page, note);
  expect(panned.zoom).toBe(before.zoom);
  expect(Math.abs(panned.y - before.y)).toBeGreaterThan(1);
  // Everything slid about with the board, because the board moved and nothing on it
  // did — which is the difference between panning and dragging.
  expect(Math.abs(noteOnScreenAfter.y - noteOnScreenBefore.y)).toBeCloseTo(
    Math.abs(panned.y - before.y) * before.zoom,
    0,
  );

  // Now draw across the note. The board does not pan under the stroke, the note does
  // not move, and the note was not even touched by the press that began the stroke:
  // the pen had it first.
  const cameraBefore = await cameraOf(page);
  const noteInBoardBefore = await noteWorldPos(page, note);
  const noteStateBefore = await noteState(page, note);
  const id = await drawStroke(page, await onto(page, shift(underline(30), -190, -400)));

  expect(await cameraOf(page)).toEqual(cameraBefore);
  expect(await noteWorldPos(page, note)).toEqual(noteInBoardBefore);
  // The note was not even touched by the press that began the stroke: it is in the same
  // state it was in, which is not pressed and not dragging. A pen that selected what it
  // drew over would be a pen that moved the board's contents by accident.
  expect(await noteState(page, note)).toBe(noteStateBefore);
  expect(await noteState(page, note)).not.toBe('pressed');
  expect(await noteState(page, note)).not.toBe('dragging');
  expect(await strokeCount(page)).toBe(1);
  // The drawing is over the note, in the units of the board.
  const box = await strokeWorldBox(page, id);
  expect(box.x).toBeLessThan(noteInBoardBefore.x + STICKY_SIZE_WORLD);
  expect(box.x + box.width).toBeGreaterThan(noteInBoardBefore.x);
  expect(box.y).toBeLessThan(noteInBoardBefore.y + STICKY_SIZE_WORLD);
  expect(box.y + box.height).toBeGreaterThan(noteInBoardBefore.y);

  // Zoom is answered by the board too, and a stroke drawn afterwards is still a
  // stroke in the units of the board: the box it is stored with does not care that the
  // screen it was drawn on changed scale, and the line is painted as much wider while
  // the corridor round it is not — which is the story 9 lesson, drawn with a pen.
  await setCamera(page, { x: -320, y: -200, zoom: 2 });
  await settle(page);
  const zoomed = await cameraOf(page);
  expect(zoomed.zoom).toBe(2);
  const second = await drawStroke(page, await onto(page, shift(underline(30), -240, -500)));
  expect((await strokeWorldBox(page, second)).width).toBeGreaterThan(100);
  // The pen is stored in the units of the board, and painted as much wider as the
  // board is magnified: a drawing keeps its proportions however it is looked at.
  expect(await strokeWidthInBoardUnits(page, second)).toBe(PEN_THICKNESS_WORLD.medium);
  expect(await strokeWidthOnScreen(page, second)).toBeCloseTo(
    PEN_THICKNESS_WORLD.medium * zoomed.zoom,
    2,
  );
  // At 200 % the corridor is still the same six screen pixels each side: a drawing is
  // no harder to hit when the board is magnified, because it is the same drawing.
  expect(await strokeCorridorOnScreen(page, second)).toBeCloseTo(STROKE_HIT_TOLERANCE_PX * 2, 1);
});

/* ── TC-20: tidying up afterwards ───────────────────────────────────── */

test('TC-20 a drawing is clicked on its line, scaled in proportion, moved, and deleted on every screen', async ({
  browser,
  request,
}) => {
  const boardId = await newBoard(request);
  const priya: Person = await joinBoard(browser, 'Priya', boardId);
  const sam: Person = await joinBoard(browser, 'Sam', boardId);
  const people = [priya, sam];
  const page = priya.page;

  await armPenTool(page);
  await choosePen(page, { color: 'green', thickness: 'thick' });
  const id = await drawStroke(page, await onto(page, shift(underline(40), -220, -300)));
  const pen = await strokePen(page, id);
  expect(pen).toEqual({ color: 'green', thickness: 'thick' });
  await waitForStrokeCount(sam.page, 1);

  // The pen is put down, and the drawing is picked up where it can be felt: on its
  // line, not anywhere in the box around it.
  await selectButton(page).click();
  await expect(selectButton(page)).toHaveAttribute('aria-pressed', 'true');
  await clickStroke(page, id);

  // A drawing has handles to scale it, and no text to type into.
  const handle = page.getByTestId('resize-handle-se');
  await expect(handle).toBeVisible();
  await expect(page.getByTestId('text-editor')).toHaveCount(0);

  // Drag the corner outwards. The proportions hold, because a drawing is a picture,
  // and a picture stretched out of shape is a different picture.
  const before = await strokeWorldBox(page, id);
  const handleBox = await handle.boundingBox();
  if (handleBox === null) throw new Error('a selected drawing has no corner to drag');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 80, handleBox.y + handleBox.height / 2 + 60, {
    steps: 6,
  });
  await page.mouse.up();

  const grown = await strokeWorldBox(page, id);
  expect(grown.width).toBeGreaterThan(before.width);
  expect(grown.height).toBeGreaterThan(before.height);
  expect(Math.abs(grown.width / grown.height / (before.width / before.height) - 1)).toBeLessThan(0.01);
  // The corner it was dragged from is the corner it grew from.
  expect(Math.abs(grown.x - before.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(grown.y - before.y)).toBeLessThanOrEqual(1);
  // And the pen it was drawn with is untouched by the drawing having been made bigger:
  // the same width of line, only a longer one.
  expect(await strokePen(page, id)).toEqual(pen);
  expect(await strokeWidthOnScreen(page, id)).toBeCloseTo(
    PEN_THICKNESS_WORLD.thick * (await cameraOf(page)).zoom,
    2,
  );

  // Drag the line itself: the drawing moves, and its size does not. The hold is taken
  // a quarter of the way along the line, and not at its middle, because the middle of a
  // drawing that is nearly a straight line is where the top and bottom resize handles
  // are — and a test that grabbed a handle would be a test that resized the drawing and
  // called it a move.
  const onLine = await strokeLinePoint(page, id, 0.25);
  const zoom = (await cameraOf(page)).zoom;
  for (const handle of ['n', 's', 'w', 'nw', 'sw']) {
    const boxOfHandle = await page.getByTestId(`resize-handle-${handle}`).boundingBox();
    if (boxOfHandle === null) continue;
    expect(
      Math.hypot(
        boxOfHandle.x + boxOfHandle.width / 2 - onLine.x,
        boxOfHandle.y + boxOfHandle.height / 2 - onLine.y,
      ),
    ).toBeGreaterThan(20);
  }
  await page.mouse.move(onLine.x, onLine.y);
  await page.mouse.down();
  await page.mouse.move(onLine.x - 70, onLine.y + 90, { steps: 6 });
  await page.mouse.up();
  const moved = await strokeWorldBox(page, id);
  expect(Math.abs(moved.x - (grown.x - 70 / zoom))).toBeLessThanOrEqual(1);
  expect(Math.abs(moved.y - (grown.y + 90 / zoom))).toBeLessThanOrEqual(1);
  expect(moved.width).toBeCloseTo(grown.width, 1);
  expect(moved.height).toBeCloseTo(grown.height, 1);

  // And it goes away, in one press, on both screens.
  await page.keyboard.press('Delete');
  await expectEventually('the drawer’s board has no drawing', () => strokeCount(page), 0, 'board');
  await expectEventually('the watcher’s board has no drawing', () => strokeCount(sam.page), 0, 'Sam');
  await expect(page.getByTestId('selection-bounding-box')).toHaveCount(0);

  await leaveAll(people);
  expectNoProblems(people);
});

test('TC-20 a click in the middle of a drawing’s box belongs to whatever the drawing is drawn over', async ({
  page,
}) => {
  await gotoBoard(page);
  // A note to draw round, in the middle of the window: this test is about the one place
  // a drawing is not — its own empty middle.
  const note = await createNoteAt(page, MIDDLE, 'inside the circle');
  await waitForNoteCount(page, 1);
  await armPenTool(page);

  // The ellipse, drawn round the note as a person circles the thing they mean: the
  // fixture is a loop about the point (320, 240) in board units, so it is put about
  // the middle of the note, which is where the thing being circled is.
  const noteInBoard = await noteWorldPos(page, note);
  const id = await drawStroke(
    page,
    await onto(page, loopAbout({ x: noteInBoard.x + STICKY_SIZE_WORLD / 2, y: noteInBoard.y + STICKY_SIZE_WORLD / 2 })),
  );
  const box = await strokeWorldBox(page, id);
  await selectButton(page).click();

  // The middle of the box is inside the drawing and nowhere near its line.
  const middle = await screenOf(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  const onLine = await strokeLinePoint(page, id);
  expect(Math.hypot(onLine.x - middle.x, onLine.y - middle.y)).toBeGreaterThan(
    STROKE_HIT_TOLERANCE_PX * 2,
  );
  // The corridor the paint offers is the corridor the model answers with.
  expect(await strokeCorridorOnScreen(page, id)).toBeCloseTo(STROKE_HIT_TOLERANCE_PX * 2, 1);

  await page.mouse.click(middle.x, middle.y);
  // The note was chosen and the drawing was not — which is what the two corridors
  // agreeing is worth: the drawing is not a sheet of glass laid over the board.
  await expectEventually(
    'a click in a drawing’s empty middle selects the note under it',
    () =>
      page.evaluate((id: string) => {
        const drawing = document.querySelector(`[data-stroke-id="${id}"]`);
        const sticky = document.querySelector('[data-note-id]');
        return [drawing?.getAttribute('data-selected') ?? 'gone', sticky?.getAttribute('data-selected') ?? 'gone'].join(
          '|',
        );
      }, id),
    'false|true',
    'board',
  );

  // And the line is still clickable, at this same zoom, where it actually is.
  await clickStroke(page, id);
  expect(await strokePointCount(page, id)).toBeLessThanOrEqual(STROKE_MAX_POINTS);
});
