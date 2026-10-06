/**
 * The pen, in a browser, drawing a line.
 *
 * These four tests are the parts of story 11 that only a browser can answer. Everything that can be settled
 * with a document and a synthetic pointer is settled in `tests/component` — what a stroke stores, what a
 * click finds, what the tool does with a `pointercancel`. What jsdom cannot say is what happens *between*
 * the pointer events, and that is most of what a pen is:
 *
 * — TC-17 is the frame rate. The line a person watches themselves draw is repainted from the points
 *   collected so far, once an animation frame, and the test proves it by having the page sample its own
 *   preview inside `requestAnimationFrame` for the length of the drag: a preview that appeared once, at the
 *   end, would pass every assertion about the finished stroke and fail this one.
 * — TC-18 is the network. A stroke is a preview that never leaves the machine it was drawn on and one
 *   transaction when the pen lifts, so the person watching has to see *nothing* while the pen is down and
 *   the *finished* line afterwards — never half a circle, never a line arriving point by point.
 * — TC-19 is the two gestures that have to keep working while a drawing tool is lit: the wheel, which is
 *   still the board's, and a press that starts on somebody else's sticky note, which is still the pen's.
 * — TC-20 is what a stroke is once it exists: an object, selected by its line rather than by its box,
 *   resized without being distorted, moved without being redrawn, and deleted on both screens.
 *
 * The paths are the recorded ones in `tests/fixtures/pen-paths.ts`, replayed point by point rather than
 * interpolated, because the wobble in them is what the simplifier is measured against.
 *
 * Design matrix: TC-17 (preview every frame, persists after release), TC-18 (silent while drawing, shared
 * on release), TC-19 (wheel pans with the pen lit; a drag begun on a note draws instead of moving), TC-20
 * (select by line, proportional resize, move, delete — across participants).
 */
import { expect, test } from '@playwright/test';

import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { handwrittenLoop, underline } from '../fixtures/pen-paths';
import {
  closeParticipants,
  expectChangeToArrive,
  expectEventually,
  expectNoConsoleErrors,
  logLatency,
  newBoard,
  openParticipants,
  resetLatencySamples,
  writeLatencyReport,
} from './helpers/participants';
import {
  doubleClickCreate,
  expectCamera,
  expectNoteCount,
  handleScreen,
  noteScreenBox,
  noteWorld,
  openBoard,
  readCamera,
  selectionOverlay,
  setCamera,
  wheelAt,
} from './helpers/board';
import { expectShapeCount, expectTool, previewBox } from './helpers/shapes';
import {
  clickStroke,
  drawStroke,
  dragStroke,
  enterPenTool,
  expectStrokeCount,
  frameChanges,
  framesWithLine,
  frameSamples,
  hasStroke,
  inkBox,
  penColorOnScreen,
  penCursor,
  penPreview,
  penThicknessOnScreen,
  penToolbar,
  pickPenColor,
  pickPenThickness,
  previewState,
  screenOfWorld,
  screenPath,
  startFrameSampler,
  stopFrameSampler,
  strokeCount,
  strokeDrawing,
  strokeIds,
  strokeScreenBox,
  strokeState,
  toolOnScreen,
  waitForStrokeAtRest,
} from './helpers/pen';

/**
 * The camera that puts the recorded loop where a person can draw it: its centre, world (300, 220), lands in
 * the middle of this 1280 × 800 screen. The loop then fills screen x 380…900, y 230…570 — clear of the
 * toolbar down the left, of the pen's own swatches beside it, and of the zoom controls in the corner, none
 * of which a drawing tool is supposed to steal clicks from.
 */
const LOOP_CAMERA = { x: 300 - 640, y: 220 - 400, zoom: 1 };

/** The same for the underline: its centre, world (220, 500), at the middle of the screen. */
const LINE_CAMERA = { x: 220 - 640, y: 500 - 400, zoom: 1 };

/** Two sticky notes, clicked where they are to stand: the cluster the loop is drawn round. */
const NOTE_LEFT = { x: 540, y: 400 };
const NOTE_RIGHT = { x: 740, y: 400 };

/** A point of the underline a pointer can catch: three quarters along, on the ink rather than in its box. */
const ON_THE_LINE: Point = underline[90] as Point;

/** The box a path fills, in world units. */
function bboxOf(path: readonly Point[]): { x: number; y: number; width: number; height: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of path) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** How many curves a rendered path is made of: the shape of a drawing, independent of its size. */
const curves = (d: string): number => d.split('Q').length - 1;

test.describe('sketching with the pen', () => {
  // TC-17: the preview is live while the pen is down, and the stroke it was promising is on the board
  // afterwards — with the notes it was drawn round exactly where they were.
  test('a drag round a cluster of notes is drawn on every animation frame, and is a stroke afterwards', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openBoard(page);

    // The camera the fixture is drawn under comes first, because the cluster is placed in screen pixels and
    // has to end up inside the loop: under this camera the two notes stand at world (200, 220) and
    // (400, 220), which is the left and right shoulder of a circle centred between them.
    await setCamera(page, LOOP_CAMERA);

    // A cluster of two notes, so that the loop's box is a box full of other people's things — which is the
    // case the whole design of a stroke's hit test exists for.
    const left = await doubleClickCreate(page, NOTE_LEFT.x, NOTE_LEFT.y);
    await page.keyboard.type('Draft');
    await page.keyboard.press('Escape');
    const right = await doubleClickCreate(page, NOTE_RIGHT.x, NOTE_RIGHT.y);
    await page.keyboard.type('Final');
    await page.keyboard.press('Escape');
    await expectNoteCount(page, 2);
    const notesBefore = { left: await noteWorld(page, left), right: await noteWorld(page, right) };

    await enterPenTool(page);
    await pickPenColor(page, 'blue');
    await pickPenThickness(page, 'thick');

    // The page watches its own preview, once per animation frame, for as long as the drag lasts.
    await startFrameSampler(page);
    const tip = await screenOfWorld(page, handwrittenLoop[handwrittenLoop.length - 1] as Point);
    const id = await drawStroke(page, handwrittenLoop, {
      whileDown: async () => {
        const during = await previewState(page);
        expect(during, 'the preview is on the screen while the pen is down').not.toBeNull();
        expect(during!.d.startsWith('M '), 'a path starts where the pen came down').toBe(true);
        // The pen's width on this glass: the world width of the ink at this zoom, which at 100 % is the
        // same number and at any other zoom is that number times the zoom.
        expect(during!.width).toBeCloseTo(PEN_THICKNESS_WORLD.thick * LOOP_CAMERA.zoom, 5);
        // The end of the preview is where the pen is. Not to the pixel: the preview is painted from the
        // points the last frame managed to collect, and one frame of this drag is a few tens of pixels of
        // pointer travel — which is exactly the lag a frame budget buys, and exactly why a line is allowed
        // to be a frame behind a hand.
        expect(Math.hypot(during!.tipX - tip.x, during!.tipY - tip.y)).toBeLessThan(80);
      },
    });
    const frames = await frameSamples(page);
    await stopFrameSampler(page);

    // The line grew as the pen moved: dozens of frames of a two-second drag, most of them a longer line than
    // the frame before. A preview drawn once at the end would leave a handful of distinct values here, and a
    // preview that never appeared would leave none.
    const painted = framesWithLine(frames);
    expect(frames.length, 'the page saw frames while the pen was down').toBeGreaterThan(10);
    expect(painted, 'the preview was on screen for most of the drag').toBeGreaterThan(frames.length / 2);
    expect(
      frameChanges(frames),
      'the preview changed from one frame to the next as the line was drawn',
    ).toBeGreaterThan(Math.floor(painted / 3));

    // The stroke the preview promised is the stroke that got drawn, and it is where the pen went.
    await expectStrokeCount(page, 1);
    const state = await strokeState(page, id as string);
    const drawn = bboxOf(handwrittenLoop);
    const ink = PEN_THICKNESS_WORLD.thick;
    // The box is the drawn box padded by half the ink on every side — and the simplifier is allowed to pull
    // a point by up to one screen pixel, one world unit at this zoom, so the two units of slack here are the
    // tolerance being stated rather than the test being loose.
    expect(state.x).toBeCloseTo(drawn.x - ink / 2, 0);
    expect(state.y).toBeCloseTo(drawn.y - ink / 2, 0);
    expect(state.width).toBeCloseTo(drawn.width + ink, 0);
    expect(state.height).toBeCloseTo(drawn.height + ink, 0);
    expect(state.color).toBe('blue');
    expect(state.colorValue).toBe(PEN_COLORS.blue);
    expect(state.thickness).toBe('thick');
    // Simplified: the pen was told about four hundred places along this circle and the board holds fewer,
    // which is the only reason a two-second sketch is a document anybody can load. How much fewer is the
    // simplifier's own business, measured in tests/unit; what matters on this side is that a wobbly circle
    // keeps its wobble, so the saving cannot have come from throwing the line away.
    expect(state.points, 'the line was simplified').toBeLessThan(handwrittenLoop.length);
    expect(state.points, 'and not flattened into a straight line').toBeGreaterThan(20);

    // The ink on the screen is the loop, at the width it was drawn at — measured in the one space a browser
    // can measure it in.
    const inkOnGlass = await inkBox(page, id as string);
    // Five percent of the loop's width is twenty-five world units. That is not the test being loose: the
    // line the browser paints is the simplified line, and near the extremes of a wobbly circle a
    // simplifier with a one-pixel tolerance trades a handful of points for a chord, which the smoothing
    // that turns it into a curve then pulls back inside the box the pen made. What the five percent rules
    // out is a straight line, a quarter of a circle, or a circle drawn somewhere else.
    expect(Math.abs(inkOnGlass.width - (drawn.width + ink)) / drawn.width).toBeLessThan(0.05);
    expect(Math.abs(inkOnGlass.height - (drawn.height + ink)) / drawn.height).toBeLessThan(0.05);
    const picture = await strokeDrawing(page, id as string);
    expect(picture.stroke).toBe(PEN_COLORS.blue);
    expect(picture.strokeWidth).toBe(ink);
    // A pointer catches this line six screen pixels wide on either side of it: twelve world units of
    // invisible stroke over eight units of ink, at this zoom.
    expect(picture.hitWidth).toBeCloseTo((STROKE_HIT_TOLERANCE_PX * 2) / LOOP_CAMERA.zoom, 5);

    // The pen is still the pen. A person sketching draws several strokes in a row, and a tool that handed the
    // pointer back to the arrow after every one of them would have a key press in the middle of every line.
    expect(await previewState(page)).toBeNull();
    await expect(penPreview(page)).toHaveCount(0);
    expect(await toolOnScreen(page)).toBe('pen');
    expect(await penColorOnScreen(page)).toBe('blue');
    expect(await penThicknessOnScreen(page)).toBe('thick');

    // And the cluster it was drawn over is a cluster: two notes, unmoved, and a board that did not pan.
    await expectNoteCount(page, 2);
    expect(await noteWorld(page, left)).toEqual(notesBefore.left);
    expect(await noteWorld(page, right)).toEqual(notesBefore.right);
    await expectCamera(page, LOOP_CAMERA);

    // The half of the hit rule jsdom could not reach: a click *inside* the drawing's box, on a note, selects
    // the note. The browser did the hit testing here and found the note, because a drawing's box is
    // transparent to the pointer and its line is nowhere near this point.
    await page.keyboard.press('v');
    await expectTool(page, 'select');
    await page.mouse.click(NOTE_LEFT.x, NOTE_LEFT.y);
    await expect(page.locator(`[data-object-id="${left}"][data-selected="true"]`)).toBeVisible();
    expect((await strokeState(page, id as string)).selected).toBe(false);

    // The other side of the same click: on the ink, the drawing is what comes back. The point is a point of
    // the recorded path itself — a quarter of the way round the lap, on its right shoulder, where there is no
    // note to catch the pointer either.
    const onInk = await screenOfWorld(page, handwrittenLoop[100] as Point);
    await page.mouse.click(onInk.x, onInk.y);
    expect((await strokeState(page, id as string)).selected).toBe(true);
  });

  // TC-18: the person watching sees nothing while the pen is down, and the finished line after it lifts.
  test('a stroke arrives whole in the other person’s browser, and only when the pen lifts', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    resetLatencySamples();
    const boardId = newBoard();
    const [priya, sam] = await openParticipants(browser, ['Priya', 'Sam'], boardId);
    await setCamera(priya.page, LINE_CAMERA);

    await enterPenTool(priya.page);
    await pickPenColor(priya.page, 'red');
    await pickPenThickness(priya.page, 'medium');

    // The pen goes down and the line grows for a while, with Sam looking on.
    const screen = await screenPath(priya.page, underline);
    await priya.page.mouse.move(screen[0]!.x, screen[0]!.y);
    await priya.page.mouse.down();
    for (const point of screen.slice(1, 60)) await priya.page.mouse.move(point.x, point.y);

    // Halfway through, the watcher's board is empty and has nothing on it that could become a stroke: no
    // drawing element, and no preview of the kind the drawer is looking at. This is the negative half of the
    // story — the preview lives in the drawer's component state and there is nothing in the document for the
    // sync layer to carry, which is why a pen can be repainted sixty times a second without a network.
    expect(await strokeCount(sam.page), 'the watcher saw a drawing while the pen was down').toBe(0);
    expect(await sam.page.locator('[data-testid="pen-preview"]').count()).toBe(0);
    // The drawer is watching something, and has no stroke yet either: the line exists only as a preview
    // until the pen lifts.
    expect(await strokeCount(priya.page), 'the drawer also has no stroke yet').toBe(0);
    const preview = await previewState(priya.page);
    expect(preview, 'the drawer sees the line growing').not.toBeNull();
    expect(preview!.d.length, 'sixty points is a long path').toBeGreaterThan(200);

    for (const point of screen.slice(60)) await priya.page.mouse.move(point.x, point.y);
    await priya.page.mouse.up();

    // The drawer sees the stroke as soon as the pen lifts — no round trip, because it is a local change.
    const [id] = await expectStrokeCount(priya.page, 1);

    // The watcher sees it when the update arrives. The wait is the generous functional one; the duration is a
    // measurement, printed rather than asserted, because these two browsers and the server that joins them
    // share one machine.
    const arrived = await expectEventually(sam, 'the finished stroke arrived', () =>
      strokeCount(sam.page).then((count) => count === 1),
    );
    logLatency(testInfo, [arrived]);

    // And what arrives is the finished line and not a stage of it: the same box, the same pen, the same
    // number of points, in both browsers.
    const here = await strokeState(priya.page, id as string);
    await expectEventually(sam, 'the stroke Sam holds is the one Priya drew', async () => {
      const [watched] = await strokeIds(sam.page);
      if (watched === undefined) return false;
      const there = await strokeState(sam.page, watched);
      return (
        here.x === there.x &&
        here.y === there.y &&
        here.width === there.width &&
        here.height === there.height &&
        here.points === there.points &&
        here.color === there.color &&
        here.thickness === there.thickness
      );
    });
    expect(await strokeState(sam.page, (await strokeIds(sam.page))[0] as string)).toMatchObject({
      color: 'red',
      thickness: 'medium',
    });
    // The pen the drawer is holding is still the pen they chose: drawing a stroke does not spend the choice.
    expect(await penColorOnScreen(priya.page)).toBe('red');
    expect(await penThicknessOnScreen(priya.page)).toBe('medium');

    await expectNoConsoleErrors([priya, sam]);
    await writeLatencyReport(testInfo, 'release to visible');
    await closeParticipants([priya, sam]);
  });

  // TC-19: with the pen lit the wheel still belongs to the board, and a drag that starts on a sticky note
  // belongs to the pen — and moves nothing.
  test('the wheel still pans with the pen lit, and a drag begun on a note draws a stroke instead of moving it', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openBoard(page);
    const note = await doubleClickCreate(page, 640, 400);
    await page.keyboard.type('Scroll me');
    await page.keyboard.press('Escape');

    await enterPenTool(page);

    // A wheel over the board, with a drawing tool lit, is still a wheel: the board pans by the delta divided
    // by the zoom. The pen takes the pointer and leaves everything else alone.
    const before = await readCamera(page);
    await wheelAt(page, { x: 640, y: 400 }, 200);
    await expectCamera(page, { x: before.x, y: before.y + 200, zoom: before.zoom });
    expect(await strokeCount(page), 'a wheel is not a stroke').toBe(0);

    // Now the pen's own half: a press that starts *on the note*. The pen takes it — in the capture phase, off
    // the note and off the board in the same breath — so what comes out is a stroke, the note stays where it
    // was, and the board does not pan.
    const noteScreenBefore = await noteScreenBox(page, note);
    const noteWorldBefore = await noteWorld(page, note);
    const cameraBefore = await readCamera(page);
    // The recorded underline, moved in world units so that it begins at the middle of the note. That middle
    // is the world origin — the board opens centred on it, and a double-click makes a note under the pointer
    // that made it — so this is a stroke that starts on top of somebody else's object, which is the case the
    // capture-phase listeners were written for.
    const squiggle = underline.slice(20, 80);
    const shift = { x: -squiggle[0]!.x, y: -squiggle[0]!.y };
    const id = await drawStroke(
      page,
      squiggle.map((point) => ({ x: point.x + shift.x, y: point.y + shift.y })),
    );

    await expectStrokeCount(page, 1);
    expect(await noteScreenBox(page, note), 'the note was not dragged').toEqual(noteScreenBefore);
    expect(await noteWorld(page, note), 'the note did not move on the board').toEqual(noteWorldBefore);
    const after = await readCamera(page);
    expect(after.x, 'a pen drag does not pan the board').toBe(cameraBefore.x);
    expect(after.y).toBe(cameraBefore.y);

    // The stroke is the top of the stack: a sketch is an annotation, and an annotation that went underneath
    // the thing it annotates annotates nothing.
    const drawing = await strokeState(page, id as string);
    expect(drawing.z).toBeGreaterThan(noteWorldBefore.z);
    // And it lies over the note it started on, which is what "a drag starting on a sticky creates a stroke"
    // means in the one space a browser can be asked about: the drawing begins inside the note's box.
    const strokeBox = await strokeScreenBox(page, id as string);
    expect(strokeBox.x, 'the stroke begins on the note').toBeGreaterThan(noteScreenBefore.x);
    expect(strokeBox.x).toBeLessThan(noteScreenBefore.x + noteScreenBefore.width);
    expect(strokeBox.y).toBeGreaterThan(noteScreenBefore.y);
    expect(strokeBox.y).toBeLessThan(noteScreenBefore.y + noteScreenBefore.height);
    expect(await penCursor(page).isVisible()).toBe(true);
  });

  // TC-20: once it exists a stroke is an object — selected by its line, resized without distortion, moved
  // without being redrawn, deleted on both screens.
  test('a finished stroke is selected by its line, grows in proportion, moves as one line, and goes when deleted', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    resetLatencySamples();
    const boardId = newBoard();
    const [priya, sam] = await openParticipants(browser, ['Priya', 'Sam'], boardId);
    await setCamera(priya.page, LINE_CAMERA);
    await setCamera(sam.page, LINE_CAMERA);

    const id = (await drawStroke(priya.page, underline, { color: 'black', thickness: 'thin' })) as string;
    // The pen is left the way it was left — active — and the person who wants to move what they drew presses
    // V for the arrow, which is the only way a stroke gets selected at all.
    expect(await toolOnScreen(priya.page)).toBe('pen');
    await priya.page.keyboard.press('v');
    await expectTool(priya.page, 'select');

    // The ink is what a pointer catches. There is no matching case here of a click in the box that finds
    // nothing, and there cannot be one drawn like this: an underline is ten units tall, so every point of its
    // box is within six units of the line and the whole box is on the drawing. The empty-box case is TC-17's,
    // where the sketch is a loop and the middle of it is a couple of sticky notes.
    const grab = await screenOfWorld(priya.page, ON_THE_LINE);
    await priya.page.mouse.click(grab.x, grab.y);
    await expect(priya.page.locator(`[data-object-id="${id}"][data-selected="true"]`)).toBeVisible();
    // The pen's swatches went when the pen did: they are the options of a tool and not a palette for
    // painting whatever happens to be selected, which is why selecting this drawing does not bring them back.
    expect(await penToolbar(priya.page).count()).toBe(0);

    const before = await strokeState(priya.page, id);
    const ratio = before.width / before.height;
    const picture = await strokeDrawing(priya.page, id);

    // A corner, pulled out — by thirty pixels of width and three of height, which on a sketch three hundred
    // and sixty units long and ten tall is the amount that makes it bigger without making it enormous. A
    // resize that keeps proportions takes the axis that moved most in proportion to its own size, and the
    // axis that moves most in proportion on an underline is always the short one: the same pull with a
    // hundred and sixty on it multiplies this drawing sixteen times and sends it off the screen, which is
    // what the board does and not what this test is measuring. What it measures is that the ratio is the
    // same ratio — a sketch that a resize stretched is a sketch ruined — and one percent is the difference
    // between "kept" and "kept, by a hand that was holding a mouse".
    const corner = await handleScreen(priya.page, 'se');
    await priya.page.mouse.move(corner.x, corner.y);
    await priya.page.mouse.down();
    await priya.page.mouse.move(corner.x + 30, corner.y + 3, { steps: 5 });
    await priya.page.mouse.up();
    const grown = await waitForStrokeAtRest(priya.page, id);
    expect(grown.width).toBeGreaterThan(before.width);
    expect(grown.height).toBeGreaterThan(before.height);
    expect(Math.abs((grown.width / grown.height) / ratio - 1)).toBeLessThan(0.01);

    // The pen is not part of the shape, so a bigger sketch is not a sketch drawn with a bigger pen: the ink
    // is the width it always was and the drawing still has the same number of points in it.
    expect(grown.thickness).toBe(before.thickness);
    expect(grown.points).toBe(before.points);
    // The line inside the bigger box is the same line at the new size: the same curves, in the same order.
    // It is not the same numbers, and it would be wrong to want that — a drawing keeps its points relative to
    // its own box, so a resize rewrites every coordinate of it, which is what makes a resize one transaction
    // about geometry rather than a redraw of the line.
    const afterResize = await strokeDrawing(priya.page, id);
    expect(afterResize.strokeWidth).toBe(picture.strokeWidth);
    expect(curves(afterResize.d)).toBe(curves(picture.d));

    // The whole sketch reached the other browser at the size it grew to.
    await expectChangeToArrive([sam], 'the resized sketch', async (person) => {
      const [watched] = await strokeIds(person.page);
      if (watched === undefined) return false;
      const state = await strokeState(person.page, watched);
      return state.width === grown.width && state.height === grown.height;
    });

    // A move of the line itself. The point grabbed is the one grabbed before the resize, scaled the way the
    // sketch was scaled — which is also the assertion that a resize scales a sketch about the corner the drag
    // started from. The click that follows is what proves it: were this point not on the ink, the sketch
    // would not be selected by it.
    const scale = grown.width / before.width;
    const movedGrab: Point = {
      x: grown.x + (ON_THE_LINE.x - before.x) * scale,
      y: grown.y + (ON_THE_LINE.y - before.y) * scale,
    };
    await clickStroke(priya.page, movedGrab);
    expect((await strokeState(priya.page, id)).selected).toBe(true);

    await dragStroke(priya.page, movedGrab, 120, -60);
    const moved = await waitForStrokeAtRest(priya.page, id);
    expect(moved.x).toBeCloseTo(grown.x + 120, 1);
    expect(moved.y).toBeCloseTo(grown.y - 60, 1);
    // Moved, not redrawn: a sketch in a new place is the same path data in a new place, which is the only
    // reason moving a drawing of three thousand points costs the same as moving a dot.
    expect((await strokeDrawing(priya.page, id)).d).toBe(afterResize.d);
    await expectChangeToArrive([sam], 'the moved sketch', async (person) => {
      const [watched] = await strokeIds(person.page);
      if (watched === undefined) return false;
      const state = await strokeState(person.page, watched);
      return state.x === moved.x && state.y === moved.y;
    });

    // Deleted, on both screens: the person who did not press the key sees the same empty board the person
    // who did, and the selection went with the drawing it was drawn around.
    await priya.page.keyboard.press('Delete');
    await expectStrokeCount(priya.page, 0);
    await expectEventually(sam, 'the deletion arrived', () => hasStroke(sam.page, id).then((seen) => !seen));
    expect(await strokeIds(sam.page)).toEqual([]);
    expect(await selectionOverlay(priya.page).count()).toBe(0);

    // Nothing else was disturbed on the way: no shape was drawn by any of this, and no preview was left
    // behind on either screen.
    await expectShapeCount(priya.page, 0);
    expect(await previewBox(priya.page)).toBeNull();
    await expectNoConsoleErrors([priya, sam]);
    await writeLatencyReport(testInfo, 'sketch shared');
    await closeParticipants([priya, sam]);
  });
});
