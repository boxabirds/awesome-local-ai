// Sketching freehand, in a real browser, with a real pointer (story 11).
//
// What a browser is the only witness to is timing and coverage. Whether a drawing keeps up
// with the hand while it is being drawn, whether the other person's screen stays clean until
// the line is finished, whether the sheet the pen draws on really lies above the notes — a
// jsdom board can be told any of that happened, because in jsdom nothing has to be *seen* for
// it to have happened. These four tests are the parts of the story that only a screen answers.
//
// Two conventions from `helpers/shapes.ts` are kept, because a test that breaks them stops
// measuring the board and starts measuring the zoom it happens to run at. Board units are
// read from the places board units live (`style.left`, a path's `d`, its `stroke-width`, and
// the SVG's own `getBBox()`, all of them above the world layer's transform and untouched by
// it); screen pixels come from the camera the board reports through the test hook. And where
// the honest answer is "not now, but soon", the test waits for the change with
// `expectEventually` and prints how long it took against the budget, rather than putting a
// timeout into the assertion.
//
// The person who draws is called Alex and the one who watches Sam, which is the name list the
// e2e helpers hold. The design's "Priya draws while Sam watches" is the same test with one
// name from a list this repository does not have.
//
// Spec: spec/stories/011-sketch-freehand-with-a-pen/design.md
import { expect, test, type Browser } from '@playwright/test';
import {
  PEN_THICKNESS_WORLD,
  STROKE_MIN_SIZE_WORLD,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../src/shared/config';
import type { PenColor, PenThickness } from '../../src/shared/config';
import { setCamera } from './helpers/board';
import {
  consoleErrorsOf,
  createNote,
  expectEventually,
  openParticipantAt,
  positionOf,
  printLatencyReport,
  stopEditing,
  type Participant,
} from './helpers/participants';
import { settle } from './helpers/board';
import { pressKey } from './helpers/shapes';
import {
  clickStroke,
  dragHandle,
  drawStroke,
  onlyStroke,
  penColorPressed,
  penCursorSize,
  penMoveThrough,
  penOptionCounts,
  penOptionsAreUp,
  penDownAt,
  penSheetCoversBoard,
  penSheetIsUp,
  penThicknessPressed,
  dragStroke,
  noteCentreOnBoard,
  penUp,
  pickPenColor,
  pickPenThickness,
  pressPen,
  pressSelect,
  previewPathD,
  selectedStrokeIds,
  startPreviewSampling,
  stopPreviewSampling,
  stroke,
  strokeAndSelection,
  strokeCentre,
  strokeCount,
  strokeIds,
  toolIsOn,
  viewAt,
  viewOf,
  waitForStrokeGone,
  waitForStrokeIds,
  wheel,
  type Point,
} from './helpers/pen';
import { handwrittenLoop, underline } from '../fixtures/pen-paths';

test.afterAll(() => {
  printLatencyReport('The pen: a drawing, and when the other person sees it');
});

test.describe('drawing freehand', () => {
  // TC-17: draw a loop with a real drag; the preview keeps up with the pointer, and what is
  // left when the pointer comes up is a stroke. Measured with the page's own frame clock, so
  // "keeps up" is a count of frames rather than an impression.
  //
  // This runs on Chromium, Firefox and Webkit alike: the projects in `playwright.config.ts`
  // put every test in this file in all three browsers, which is what the design asks for —
  // `getCoalescedEvents()` is exactly the kind of thing one engine gets differently.
  test('TC-17 draws a loop whose preview follows the pointer, and leaves a stroke behind', async ({
    browser,
  }) => {
    const alex = await onePerson(browser);
    const loop = handwrittenLoop({ x: 0, y: 0 }, 160, 60);
    await setCamera(alex.page, viewAt({ x: 0, y: 0 }, 1));

    await pressPen(alex);
    expect(await toolIsOn(alex, 'pen')).toBe(true);
    expect(await penSheetIsUp(alex)).toBe(true);
    expect(await penOptionsAreUp(alex)).toBe(true);
    // The pen's own panel is up beside the rail: six colours, three thicknesses.
    expect(await penOptionCounts(alex)).toEqual({ colors: 6, thicknesses: 3 });

    await startPreviewSampling(alex);
    await penDownAt(alex, loop[0] as Point);
    await penMoveThrough(alex, loop.slice(1, 20), { every: 2, delayMs: 12 });

    // While the pen is down there is a round mark at its point, as wide on the screen as the
    // thickness is in board units at this zoom: the person can see what they are drawing with.
    expect(await penCursorSize(alex)).toBeCloseTo(PEN_THICKNESS_WORLD.medium, 1);
    await penMoveThrough(alex, loop.slice(20), { every: 2, delayMs: 12 });

    // Halfway through, on the screen that is doing the drawing, there is a drawing.
    const midway = await previewPathD(alex);
    expect(midway).not.toBeNull();
    expect(midway).toContain('M');

    await penUp(alex);
    const frames = await stopPreviewSampling(alex);

    // The preview was on screen for frame after frame, and it was not the same drawing on
    // each of them: the line grew while the hand moved, which is the only way a person can
    // tell the pen is drawing rather than waiting.
    expect(frames.frames).toBeGreaterThan(10);
    expect(frames.withPreview).toBeGreaterThan(10);
    expect(frames.distinct).toBeGreaterThan(3);
    const lengths = frames.lengths;
    expect(lengths[lengths.length - 1] as number).toBeGreaterThan(lengths[0] as number);

    // And when the pointer came up, the preview is gone and a stroke is what the board holds.
    expect(await previewPathD(alex)).toBeNull();
    const ids = await strokeIds(alex);
    expect(ids.length).toBe(1);
    const drawn = await onlyStroke(alex);
    expect(drawn.d).toContain('M');
    expect(drawn.d).toContain('Q'); // smoothed into curves, not a polyline of the samples
    expect(drawn.color).toBe('black'); // what a fresh pen is set to
    expect(drawn.thickness).toBe('medium');
    expect(await toolIsOn(alex, 'pen')).toBe(true); // the pen stays in the hand after a stroke
    expect(await penSheetIsUp(alex)).toBe(true);

    // What is on the board is where the hand went, in board units: the painted line's own box
    // sits where the loop was drawn, within the allowance the smoothing is given to trade points
    // for faithfulness. At this zoom one screen pixel is one board unit, which is why the
    // allowance is the constant and not a number invented here.
    const extents = extentsOf(loop);
    expect(
      within(drawn.paint.x, extents.x, SMOOTHING_ALLOWANCE),
      `the line starts too far in: ${drawn.d}`,
    ).toBe(true);
    expect(within(drawn.paint.y, extents.y, SMOOTHING_ALLOWANCE), 'the line is too low').toBe(true);
    expect(within(drawn.paint.width, extents.width, SMOOTHING_ALLOWANCE), 'the line is too narrow').toBe(
      true,
    );
    expect(within(drawn.paint.height, extents.height, SMOOTHING_ALLOWANCE), 'the line is too flat').toBe(
      true,
    );

    expect(consoleErrorsOf([alex])).toEqual([]);
  });

  // TC-18: the other person sees nothing until the stroke is finished. The mid-drag check is
  // a negative, which is why this needs two real screens: in jsdom there is no other screen
  // to be missing something from.
  test('TC-18 keeps a drawing to itself while it is drawn, then shows it to the other screen', async ({
    browser,
  }) => {
    const [alex, sam] = await twoPeople(browser);
    const line = underline({ x: -150, y: 0 }, 300, 40);
    await setCamera(alex.page, viewAt({ x: 0, y: 0 }, 1));
    await setCamera(sam.page, viewAt({ x: 0, y: 0 }, 1));

    await pressPen(alex);
    expect(await strokeCount(sam)).toBe(0);

    // Alex is in the middle of the line: on Alex's screen it is there, and on Sam's there is
    // neither a stroke nor a preview of one. Not seeing it now is the feature.
    await penDownAt(alex, line[0] as Point);
    await penMoveThrough(alex, line.slice(1, 21), { every: 2, delayMs: 12 });
    expect(await previewPathD(alex)).not.toBeNull();
    await settle(sam.page);
    expect(await strokeCount(sam)).toBe(0);
    expect(await previewPathD(sam)).toBeNull();

    // The rest of the line, and the pointer comes up.
    await penMoveThrough(alex, line.slice(21), { every: 3, delayMs: 8 });
    await penUp(alex);
    const ids = await strokeIds(alex);
    expect(ids.length).toBe(1);
    const id = ids[0] as string;

    // Sam's screen gets the finished stroke, and gets it as the same drawing: the same colour,
    // the same thickness, the same box in board units, the same painted path. The wait is the
    // eventual kind, and how long it took is printed against the budget, not asserted here.
    const drawn = await onlyStroke(alex);
    const seen = await expectEventually(
      `the finished stroke "${id}"`,
      async () => await stroke(sam, id),
      {
        is: (other) =>
          other !== null &&
          other.color === drawn.color &&
          other.thickness === drawn.thickness &&
          Math.abs(other.box.x - drawn.box.x) <= 1 &&
          Math.abs(other.box.y - drawn.box.y) <= 1,
        description: `Sam's screen has not drawn the stroke that was finished`,
      },
    );
    if (seen === null) throw new Error('the finished stroke never reached this screen');
    expect(seen.color).toBe(drawn.color);
    expect(seen.thickness).toBe(drawn.thickness);
    await waitForStrokeIds(sam, [id]);
    expect((await stroke(sam, id))?.d).toBe(drawn.d);

    // Nothing on either console. A preview that leaked onto the wire would show up here as
    // noise of its own, which is the second reason this is an e2e test.
    expect(consoleErrorsOf([alex, sam])).toEqual([]);
  });

  // pen.share: the colour and the thickness the drawer chose come with the finished stroke,
  // and do not travel any further than the stroke itself.
  test('pen.share the finished drawing arrives with the colour and thickness it was drawn in', async ({
    browser,
  }) => {
    const [alex, sam] = await twoPeople(browser);
    const loop = handwrittenLoop({ x: 0, y: 0 }, 150, 50);
    await setCamera(alex.page, viewAt({ x: 0, y: 0 }, 1));
    await setCamera(sam.page, viewAt({ x: 0, y: 0 }, 1));

    await pressPen(alex);
    await pickPen(alex, 'red', 'thick');
    const ids = await drawStroke(alex, loop, { pressTool: false });
    expect(ids.length).toBe(1);
    const drawn = await onlyStroke(alex);
    expect(drawn.color).toBe('red');
    expect(drawn.thickness).toBe('thick');
    expect(drawn.strokeWidth).toBeCloseTo(PEN_THICKNESS_WORLD.thick, 6);

    await waitForStrokeIds(sam, ids);
    const arrived = await stroke(sam, ids[0] as string);
    if (arrived === null) throw new Error('the drawing never arrived');
    expect(arrived.color).toBe('red');
    expect(arrived.thickness).toBe('thick');
    expect(arrived.strokeWidth).toBeCloseTo(PEN_THICKNESS_WORLD.thick, 6);
    expect(Math.round(arrived.box.x)).toBe(Math.round(drawn.box.x));
    expect(Math.round(arrived.box.y)).toBe(Math.round(drawn.box.y));
    expect(arrived.paint.width).toBeCloseTo(drawn.paint.width, 0);
    expect(arrived.paint.height).toBeCloseTo(drawn.paint.height, 0);

    // The pen's own settings are a local habit, not something the board carries: Sam's pen is
    // still whatever a fresh pen is, although Sam is looking at a red drawing.
    await pressPen(sam);
    expect(await penColorPressed(sam, 'black')).toBe(true);
    expect(await penThicknessPressed(sam, 'medium')).toBe(true);
    expect(await penColorPressed(sam, 'red')).toBe(false);

    expect(consoleErrorsOf([alex, sam])).toEqual([]);
  });

  // TC-19: the pen's sheet is the thing under the pointer, wherever the pointer is. A wheel
  // moves the board rather than the pen; a drag that starts on a sticky note draws instead of
  // pushing the note, and does not nudge the board either.
  test('TC-19 keeps the board under the pen: a wheel pans, a drag on a note draws and moves nothing', async ({
    browser,
  }) => {
    const alex = await onePerson(browser);
    const noteId = await createNote(alex, 500, 300, 'Sketch round this');
    await stopEditing(alex);
    await pressKey(alex, 'Escape'); // the note may stay chosen; the toolbar over it should not
    await pressPen(alex);
    expect(await penSheetCoversBoard(alex)).toBe(true);

    // A plain wheel with the pen up pans the board: the camera moves, the zoom does not, and
    // the pen is still in the hand.
    const before = await viewOf(alex);
    const noteBefore = await notePosition(alex, noteId);
    await wheel(alex, { x: 640, y: 400 }, { y: 240 });
    const panned = await viewOf(alex);
    expect(panned.zoom).toBeCloseTo(before.zoom, 6);
    expect(Math.abs(panned.y - before.y)).toBeGreaterThan(1);
    expect(panned.x).toBeCloseTo(before.x, 6);
    expect(await toolIsOn(alex, 'pen')).toBe(true);
    expect(await penSheetIsUp(alex)).toBe(true);
    // A board that moved under a note leaves the note where it is on the board.
    expect((await notePosition(alex, noteId)).left).toBeCloseTo(noteBefore.left, 3);

    // A drag that starts on the sticky note, with the pen up, draws. The note does not go with
    // the pointer, and neither does the board.
    const cameraBefore = await viewOf(alex);
    const centre = await noteCentreOnBoard(alex, noteId);
    const wander = handwrittenLoop(centre, 55, 24);
    const ids = await drawStroke(alex, wander, { pressTool: false });

    expect(ids.length).toBe(1);
    const drawn = await stroke(alex, ids[0] as string);
    if (drawn === null) throw new Error('the drag that started on a note made no drawing');
    expect(await strokeCount(alex)).toBe(1);
    const after = await notePosition(alex, noteId);
    expect(after.left).toBeCloseTo(noteBefore.left, 3);
    expect(after.top).toBeCloseTo(noteBefore.top, 3);
    const cameraAfter = await viewOf(alex);
    expect(cameraAfter.x).toBeCloseTo(cameraBefore.x, 3);
    expect(cameraAfter.y).toBeCloseTo(cameraBefore.y, 3);
    expect(await toolIsOn(alex, 'pen')).toBe(true);

    // And Sam, who is not here, sees the same note in the same place and one new drawing —
    // which is the same fact from the other side: nothing was sent but the stroke.
    expect(consoleErrorsOf([alex])).toEqual([]);
  });

  // pen.pen: a click on empty board space with the pen up is a dot, not a sticky note. The
  // sheet is between the pointer and the board's own gestures, so the note-creating path is
  // never taken.
  test('pen.pen a click on empty board space with the pen up makes a dot and no note', async ({
    browser,
  }) => {
    const alex = await onePerson(browser);
    const noteId = await createNote(alex, 400, 260, 'A neighbour');
    await stopEditing(alex);
    await pressKey(alex, 'Escape');

    const notesBefore = await noteCount(alex);
    const noteBefore = await notePosition(alex, noteId);
    await pressPen(alex);
    expect(await toolIsOn(alex, 'pen')).toBe(true);

    // A real click, on empty space far from the note: down and up in one place.
    await alex.page.mouse.click(900, 520);
    await settle(alex.page);

    expect(await noteCount(alex)).toBe(notesBefore);
    expect(await strokeCount(alex)).toBe(1);
    const dot = await onlyStroke(alex);
    // A dot is the smallest thing the board lets a drawing be, and it is a drawing: the ink is
    // one point, so the path has no curve in it.
    expect(dot.box.width).toBeCloseTo(STROKE_MIN_SIZE_WORLD, 3);
    expect(dot.box.height).toBeCloseTo(STROKE_MIN_SIZE_WORLD, 3);
    expect(dot.d).toContain('M');
    expect(dot.d).not.toContain('Q');
    // Where the pointer went is where the dot is: the right-hand half of the board, and the
    // note is exactly where it always was.
    expect((await strokeCentre(alex, dot.id)).x).toBeGreaterThan(0);
    expect(await notePosition(alex, noteId)).toEqual(noteBefore);
    expect(await toolIsOn(alex, 'pen')).toBe(true);

    expect(consoleErrorsOf([alex])).toEqual([]);
  });

  // TC-20: tidy up. A drawing is chosen by clicking its line, kept in proportion when a corner
  // is pulled, moved by its line, and deleted on both screens. The proportion is read off the
  // painted line's own geometry, which is in board units whatever the zoom is, so this says
  // something about the drawing rather than about the camera.
  test('TC-20 chooses a drawing by its line, keeps its proportions, moves it, and deletes it', async ({
    browser,
  }) => {
    const [alex, sam] = await twoPeople(browser);
    const loop = handwrittenLoop({ x: 0, y: 0 }, 140, 40);
    await setCamera(alex.page, viewAt({ x: 0, y: 0 }, 1));
    await setCamera(sam.page, viewAt({ x: 0, y: 0 }, 1));

    const ids = await drawStroke(alex, loop);
    expect(ids.length).toBe(1);
    const id = ids[0] as string;
    await waitForStrokeIds(sam, [id]);

    // Put the pen away and click the line, which is the only place a drawing may be clicked —
    // and, once it is chosen, a place on the line that is not underneath one of the selection's
    // grips, because a closed drawing's line passes under the grips on the edges of its box.
    await pressSelect(alex);
    expect(await penSheetIsUp(alex)).toBe(false);
    await clickStroke(alex, id);
    const chosen = await strokeAndSelection(alex, id);
    expect(chosen.selected).toBe(true);
    expect(chosen.handles).toContain('se');
    expect(await selectedStrokeIds(alex)).toEqual([id]);

    const before = chosen.stroke;
    const proportion = before.paint.width / before.paint.height;
    expect(before.strokeWidth).toBeCloseTo(PEN_THICKNESS_WORLD.medium, 6);

    // Pull a corner by a lopsided amount: 90 units across, 40 units down. Locked proportions
    // mean the drawing comes out the same shape it went in, so a 1% check says whether the
    // lock exists without needing to know what the lock decided to do about it.
    await dragHandle(alex, 'se', 90, 40);
    const grown = await stroke(alex, id);
    if (grown === null) throw new Error('the drawing went away when its corner was pulled');
    expect(grown.paint.width).toBeGreaterThan(before.paint.width);
    expect(grown.paint.height).toBeGreaterThan(before.paint.height);
    expect(grown.paint.width / grown.paint.height / proportion).toBeCloseTo(1, 2);
    // Thickness is board units, so a resize that "fixed" it in pixels would show here.
    expect(grown.strokeWidth).toBeCloseTo(before.strokeWidth, 6);
    // The drawing itself is untouched: same number of curves, same ink held by the board.
    expect(curves(grown.d)).toBe(curves(before.d));

    // Move it by its line, in board units, and it is the same single drawing afterwards.
    await dragStroke(alex, id, 120, -60);
    const moved = await stroke(alex, id);
    if (moved === null) throw new Error('the drawing went away when it was moved');
    expect(moved.box.x).toBeCloseTo(grown.box.x + 120, 1);
    expect(moved.box.y).toBeCloseTo(grown.box.y - 60, 1);
    expect(moved.paint.width / moved.paint.height / proportion).toBeCloseTo(1, 2);
    expect(await strokeCount(alex)).toBe(1);

    // One delete, on both screens.
    await pressKey(alex, 'Delete');
    await waitForStrokeGone(alex, id);
    await waitForStrokeGone(sam, id);
    expect(await selectedStrokeIds(alex)).toEqual([]);
    expect(await selectedStrokeIds(sam)).toEqual([]);
    expect(await strokeCount(sam)).toBe(0);

    expect(consoleErrorsOf([alex, sam])).toEqual([]);
  });
});

// --- helpers local to this file ----------------------------------------------

/**
 * One person, on a board of their own. `openParticipantAt` with `create` arrives the way a
 * person does, by making a board from home, and brings its console with it.
 */
async function onePerson(browser: Browser): Promise<Participant> {
  return openParticipantAt(browser, '/', 'Alex', { create: true });
}

/** Two people on one board, the first of them the one who made it. */
async function twoPeople(browser: Browser): Promise<[Participant, Participant]> {
  const alex = await openParticipantAt(browser, '/', 'Alex', { create: true });
  const sam = await openParticipantAt(browser, await addressOf(alex), 'Sam');
  return [alex, sam];
}

/** The address of the board this person is on, for somebody else to come to. */
async function addressOf(who: Participant): Promise<string> {
  const path = await who.page.evaluate(() => window.location.pathname);
  if (!path.startsWith('/b/')) throw new Error(`that page is not a board (${path})`);
  return path;
}

/** The pen's colour and thickness, from the panel that only the pen shows. */
async function pickPen(who: Participant, color: PenColor, thickness: PenThickness): Promise<void> {
  await pickPenColor(who, color);
  await pickPenThickness(who, thickness);
}

/** The box a recorded path covers, in board units. */
function extentsOf(path: Point[]): { x: number; y: number; width: number; height: number } {
  const xs = path.map((point) => point.x);
  const ys = path.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * How far a painted line may sit from the hand that drew it and still be that drawing: the
 * smoothing's own allowance, twice over — once for a curve leaning away from the furthest
 * sample, once for the midpoint between two samples it is pulled to. The smoothing runs at
 * `STROKE_SIMPLIFY_TOLERANCE_PX` screen pixels divided by the zoom, and every test here draws
 * at zoom 1, where a pixel is a board unit.
 */
const SMOOTHING_ALLOWANCE = STROKE_SIMPLIFY_TOLERANCE_PX * 2;

function within(actual: number, expected: number, allowance: number): boolean {
  return Math.abs(actual - expected) <= allowance;
}

/** How many curves a path holds, which is how much drawing the board still has in it. */
function curves(d: string): number {
  return (d.match(/Q/g) ?? []).length;
}

/** How many sticky notes this screen holds: the thing a pen click must not make. */
function noteCount(who: Participant): Promise<number> {
  return who.page.evaluate(() => document.querySelectorAll('[data-testid="note-object"]').length);
}

/**
 * Where a note sits on the board, in board units. `positionOf` hands back "no such note" as
 * `undefined`, which for these tests would mean the board lost the scenery, so it is an error
 * here rather than a value to compare with.
 */
async function notePosition(who: Participant, id: string): Promise<{ left: number; top: number }> {
  const at = await positionOf(who, id);
  if (at === undefined) throw new Error(`there is no note "${id}" on this screen`);
  return at;
}
