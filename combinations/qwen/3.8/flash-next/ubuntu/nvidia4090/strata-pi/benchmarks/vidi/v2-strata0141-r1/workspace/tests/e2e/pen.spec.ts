import { expect, test } from '@playwright/test';
import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  PEN_THICKNESS_WORLD,
} from '../../src/shared/config';
import { near, openBoard, getCamera, type ScreenPoint } from './helpers/board';
import { dragHandle, setFlatCamera } from './helpers/selection';
import { createNoteAt, getNotes, noteAttribute, noteCentre } from './helpers/sticky';
import { joinBoard, newLiveBoardId } from './helpers/live';
import {
  clickPenColor,
  clickPenThickness,
  dragStrokeBy,
  drawnStroke,
  getStrokes,
  measureStrokeConvergence,
  penColorPressed,
  penCursor,
  penDragThrough,
  penFrames,
  penOptionsVisible,
  penPreviewPresent,
  penThicknessPressed,
  pressPenTool,
  strokeCard,
  strokeLinePoint,
  strokeOf,
  waitForSameStrokes,
  waitForStroke,
  waitForStrokeCount,
  waitForStrokeSelected,
  startPreviewSampling,
  stopPreviewSampling,
} from './helpers/pen';
import { decimate, handwrittenLoop, underlinePath } from '../fixtures/pen-paths';

/**
 * Story 11 - sketching freehand with the Pen tool, in real browsers (task 6).
 *
 * Anchors: `pen.tool`, `pen.draw` (`pen.smooth`, TC-17), `pen.share` (TC-18),
 * `pen.navigation` (TC-19) and `pen.select` / `pen.resize` (TC-20).
 *
 * The drags are replays of paths recorded in `tests/fixtures/pen-paths.ts` - the
 * same fixtures the unit tests measure the simplifier with - so a pointer moves the
 * way a hand moved: one input event per recorded point.
 *
 * TC-17 also names Firefox and WebKit. Those projects run wherever `.e2e/browser.json`
 * lists them; on this machine only Chromium is installed (`scripts/prepare-e2e.mjs`
 * writes what it finds, and `NOTES.md` records why the other two are never skipped
 * silently), so the assertions below are written against the behaviour, not against a
 * browser: nothing here is Chromium specific except that it runs at all.
 */

/** The box a list of points covers. */
function boundsOf(points: readonly ScreenPoint[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Move a recorded path so its top-left lands on `at`. */
function placeFixture(points: readonly ScreenPoint[], at: ScreenPoint): ScreenPoint[] {
  const bounds = boundsOf(points);
  return points.map((point) => ({ x: at.x + point.x - bounds.minX, y: at.y + point.y - bounds.minY }));
}

/** A handwritten loop, thinned for a pointer replay and put inside the viewport. */
const LOOP = placeFixture(decimate(handwrittenLoop(), 10), { x: 240, y: 220 });

/** The same loop, thinned harder for the tests that only need a drawing to exist. */
const SHORT_LOOP = placeFixture(decimate(handwrittenLoop(), 16), { x: 240, y: 220 });

/** A pen underline, same treatment. */
const UNDERLINE = placeFixture(decimate(underlinePath(), 4), { x: 220, y: 340 });

test.describe('sketching freehand with the pen', () => {
  /*
   * Serial on purpose (the same choice `share.spec.ts`'s restart test makes, and for
   * the same reason): these four tests are the heavy ones in the suite - long
   * pointer replays, rAF sampling in the page, two live pages each in TC-18 and
   * TC-20 - and one worker running them keeps the machine's other workers free for
   * the tests that measure something in the browser.
   */
  test.describe.configure({ mode: 'serial' });
  test('TC-17: a drag redraws the stroke on consecutive animation frames, and what the pen leaves is the stroke the board keeps', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openBoard(page);
    await setFlatCamera(page);
    await pressPenTool(page, 'toolbar');
    expect(await penOptionsVisible(page)).toBe(true);
    await clickPenColor(page, 'red');
    await clickPenThickness(page, 'medium');
    expect(await penColorPressed(page, 'red')).toBe(true);
    expect(await penThicknessPressed(page, 'medium')).toBe(true);

    const loop = LOOP;
    const bounds = boundsOf(loop);

    await page.mouse.move(loop[0]!.x, loop[0]!.y);
    await page.mouse.down();

    // The claim being tested is about *frames*: every animation frame while the pen
    // moves, the page is asked what the preview path says (`pen.smooth`, TC-17).
    await startPreviewSampling(page);
    for (const point of loop.slice(1)) {
      await page.mouse.move(point.x, point.y);
      // Each point gets its own animation frames, so this measures frames rather
      // than guessing at how long a frame takes on a busy machine.
      await penFrames(page, 2);
    }

    // Mid-drag: a preview on this screen, and nothing on the board (`pen.share`).
    expect(await penPreviewPresent(page)).toBe(true);
    expect((await getStrokes(page)).length).toBe(0);
    expect(await page.locator('[data-testid^="stroke-object-"]').count()).toBe(0);
    // The pen tip is a round dot in the pen's colour, at the pen's thickness.
    expect(await penCursor(page).count()).toBe(1);

    const samples = await stopPreviewSampling(page);
    await page.mouse.up();
    await page.waitForTimeout(150);

    const frames = samples.filter((value): value is string => value !== null);
    // Frames really were displayed while the pen moved - at least one per point -
    // and the preview was on nearly all of them.
    expect(samples.length).toBeGreaterThanOrEqual(loop.length);
    expect(frames.length / samples.length).toBeGreaterThan(0.6);

    // Consecutive frames hold different paths, and the path grew as it went: the
    // line moved with the pointer, once per displayed frame rather than once per
    // input event or once at the end.
    const changed = frames.filter(
      (value, index) => index === 0 || value !== frames[index - 1],
    );
    expect(changed.length).toBeGreaterThan(loop.length * 0.7);
    let previousNumbers = 0;
    let rawNumbers = 0;
    const firstNumbers = (changed[0]?.match(/-?\d+(?:\.\d+)?/gu) ?? []).length;
    for (const value of changed) {
      expect(value.startsWith('M')).toBe(true);
      // smoothPath emits one quadratic per recorded point, so the number of
      // coordinates in the preview says how many points the drag recorded.
      const numbers = value.match(/-?\d+(?:\.\d+)?/gu)?.length ?? 0;
      expect(numbers).toBeGreaterThanOrEqual(previousNumbers);
      previousNumbers = numbers;
      rawNumbers = numbers;
    }
    // Over the whole drag the line gained a coordinate pair for nearly every point
    // the replay moved through.
    expect(rawNumbers).toBeGreaterThanOrEqual(firstNumbers + loop.length);

    // What the pen left behind is one stroke, with the options the toolbar was on.
    const [stroke] = await waitForStrokeCount(page, 1);
    if (!stroke) {
      throw new Error('the drag committed no stroke');
    }
    expect(stroke.color).toBe('red');
    expect(stroke.thickness).toBe('medium');
    // The model stores a stroke's points flattened, two numbers per point.
    expect(stroke.points.length % 2).toBe(0);
    const committedPoints = stroke.points.length / 2;
    expect(committedPoints).toBeGreaterThan(10);
    // smoothPath emits one quadratic per recorded point, so the preview line says
    // how many points the drag really recorded.
    const rawPoints = rawNumbers / 4 + 1;
    console.log(
      `[pen.smooth] the preview line recorded ${rawPoints} points; the committed stroke holds ${committedPoints}`,
    );
    // Simplified: the line the model keeps is no longer than the line that was
    // drawn, and for a curved path it is measurably shorter (`pen.smooth`, TC-02).
    expect(committedPoints).toBeLessThanOrEqual(rawPoints);

    // `pen.render`: the stroke the board keeps is drawn where it was drawn, in the
    // pen's colour, at the pen's thickness.
    const drawn = await drawnStroke(page, stroke.id);
    expect(drawn.d.startsWith('M')).toBe(true);
    expect(near(drawn.box.x, bounds.minX, 14)).toBe(true);
    expect(near(drawn.box.y, bounds.minY, 14)).toBe(true);
    expect(near(drawn.box.width, bounds.width, 28)).toBe(true);
    expect(near(drawn.box.height, bounds.height, 28)).toBe(true);
    expect(await strokeCard(page, stroke.id).getAttribute('data-color')).toBe('red');
    expect(drawn.strokeWidth).toBe(PEN_THICKNESS_WORLD.medium);
    await expect(strokeCard(page, stroke.id)).toBeVisible();

    // The preview was a drawing aid: it is gone, and only the stroke is on screen.
    expect(await penPreviewPresent(page)).toBe(false);
    expect(await page.getByTestId('pen-preview').count()).toBe(0);
  });

  test('TC-18: the sketch reaches the other board when the pen is lifted, and never while it is drawing', async ({
    context,
  }) => {
    test.setTimeout(120_000);
    const boardId = newLiveBoardId();
    const priya = await joinBoard(context, boardId);
    const sam = await joinBoard(context, boardId);
    await setFlatCamera(priya);
    await setFlatCamera(sam);

    await pressPenTool(priya);

    const wave = UNDERLINE;
    await priya.mouse.move(wave[0]!.x, wave[0]!.y);
    await priya.mouse.down();
    for (const point of wave.slice(1)) {
      await priya.mouse.move(point.x, point.y);
      await penFrames(priya, 1);
    }

    // Priya is mid-stroke. Her screen has the line she is drawing; Sam's has nothing
    // at all - not the preview, not a partial stroke.
    expect(await penPreviewPresent(priya)).toBe(true);
    expect(await penPreviewPresent(sam)).toBe(false);
    expect((await getStrokes(sam)).length).toBe(0);
    expect(await sam.locator('[data-testid^="stroke-object-"]').count()).toBe(0);
    expect(await sam.locator('[data-testid^="pen-preview"]').count()).toBe(0);

    // Release, and time the stroke arriving on Sam's board.
    const { ms, stroke } = await measureStrokeConvergence(priya, sam, async () => {
      await priya.mouse.up();
    });
    console.log(
      `[pen.share] pen lifted on Priya's board -> finished stroke on Sam's board: ${ms} ms ` +
        `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms)`,
    );

    // Nothing of the preview ever crossed the wire, on either side.
    expect(await penPreviewPresent(sam)).toBe(false);
    expect(await sam.locator('[data-testid^="pen-preview"]').count()).toBe(0);

    await waitForSameStrokes([priya, sam]);
    const onPriya = (await getStrokes(priya))[0]!;
    const onSam = (await getStrokes(sam))[0]!;
    expect(onSam.id).toBe(onPriya.id);
    expect(onSam.points.length).toBe(onPriya.points.length);
    expect(onSam.color).toBe(onPriya.color);
    expect(onSam.thickness).toBe(onPriya.thickness);
    expect(onSam.id).toBe(stroke.id);

    // Sam's own screen drew it: a stroke object, with a path and the pen's width.
    const drawn = await drawnStroke(sam, onSam.id);
    expect(drawn.d.startsWith('M')).toBe(true);
    expect(drawn.strokeWidth).toBe(PEN_THICKNESS_WORLD[onSam.thickness]);
    expect(await sam.locator('[data-testid^="stroke-object-"]').count()).toBe(1);

    await priya.close();
    await sam.close();
  });

  test('TC-19: with the pen in hand the wheel still pans and zooms, and a stroke that starts on a sticky leaves the sticky where it was', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openBoard(page);
    await setFlatCamera(page);
    await pressPenTool(page);

    // A plain wheel pans, exactly as it does with Select in hand.
    const beforePan = await getCamera(page);
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(140);
    const afterPan = await getCamera(page);
    expect(near(afterPan.y - beforePan.y, 200 / beforePan.zoom, 0.01)).toBe(true);
    expect(afterPan.x).toBe(beforePan.x);
    expect(afterPan.zoom).toBe(beforePan.zoom);

    // The wheel's other job, zoom, is untouched by the pen too.
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');
    await page.waitForTimeout(140);
    const afterZoom = await getCamera(page);
    expect(afterZoom.zoom).not.toBe(afterPan.zoom);

    // Neither gesture drew anything.
    expect((await getStrokes(page)).length).toBe(0);

    // A stroke whose press lands on a sticky note: the note is left completely
    // alone - not moved, not raised, not selected - and the board does not pan
    // instead of drawing.
    const stickyId = await createNoteAt(page, { x: 640, y: 400 }, 'yellow');
    const stickyBefore = (await getNotes(page)).find((note) => note.id === stickyId);
    if (!stickyBefore) {
      throw new Error('the sticky note was not created');
    }
    const onSticky = await noteCentre(page, stickyId);

    await penDragThrough(page, [
      { x: onSticky.x - 150, y: onSticky.y - 90 },
      onSticky,
      { x: onSticky.x + 60, y: onSticky.y + 40 },
      { x: onSticky.x + 150, y: onSticky.y + 110 },
    ]);

    const strokes = await waitForStrokeCount(page, 1);
    expect(strokes.length).toBe(1);

    const stickyAfter = (await getNotes(page)).find((note) => note.id === stickyId);
    if (!stickyAfter) {
      throw new Error('the pen took the sticky note off the board');
    }
    expect(stickyAfter.x).toBe(stickyBefore.x);
    expect(stickyAfter.y).toBe(stickyBefore.y);
    expect(stickyAfter.z).toBe(stickyBefore.z);
    expect(await noteAttribute(page, stickyId, 'data-selected')).not.toBe('true');

    // And the drag panned nothing: the same camera as before the press.
    const afterDrag = await getCamera(page);
    expect(afterDrag.zoom).toBe(afterZoom.zoom);
    expect(near(afterDrag.x, afterZoom.x, 0.01)).toBe(true);
    expect(near(afterDrag.y, afterZoom.y, 0.01)).toBe(true);
  });

  test('TC-20: Select picks the sketch up by its line, Transform scales it without squashing it or fattening it, and Delete takes it off both boards', async ({
    context,
  }) => {
    test.setTimeout(180_000);
    const boardId = newLiveBoardId();
    const priya = await joinBoard(context, boardId);
    const sam = await joinBoard(context, boardId);
    await setFlatCamera(priya);
    await setFlatCamera(sam);

    await pressPenTool(priya);
    await penDragThrough(priya, SHORT_LOOP);
    const drawn = await waitForStrokeCount(priya, 1);
    const stroke = drawn[0]!;
    await waitForSameStrokes([priya, sam]);

    // The pen is put away, and Select picks the drawing up by clicking its line.
    await priya.keyboard.press('Escape');
    await expect(priya.locator('[data-testid="board"]')).toHaveAttribute('data-tool', 'select');
    const onLine = await strokeLinePoint(priya, stroke.id);
    await priya.mouse.click(onLine.x, onLine.y);
    await waitForStrokeSelected(priya, stroke.id);
    await expect(priya.getByTestId('resize-handle-se')).toBeVisible();

    const before = await strokeOf(priya, stroke.id);
    const ratio = before.width / before.height;

    // No Shift held: a stroke's aspect is locked, so a corner handle can only scale
    // it (`pen.resize`).
    await dragHandle(priya, 'se', 120, 80);
    const resized = await strokeOf(priya, stroke.id);
    expect(resized.id).toBe(stroke.id);
    expect(resized.width).toBeGreaterThan(before.width);
    expect(near(resized.width / resized.height, ratio, ratio * 0.01)).toBe(true);
    expect(resized.thickness).toBe(before.thickness); // scaled in length, never fatter
    expect(resized.points.length).toBe(before.points.length); // the same drawing

    const afterResize = await drawnStroke(priya, stroke.id);
    expect(afterResize.strokeWidth).toBe(PEN_THICKNESS_WORLD[before.thickness]);
    expect(
      near(afterResize.box.width / afterResize.box.height, ratio, ratio * 0.01),
    ).toBe(true);

    // Dragging the line itself moves the drawing.
    await dragStrokeBy(priya, stroke.id, 140, -90);
    const moved = await strokeOf(priya, stroke.id);
    expect(moved.x).toBeGreaterThan(before.x);
    expect(moved.y).toBeLessThan(before.y);
    expect(moved.width).toBe(resized.width);
    expect(moved.height).toBe(resized.height);

    // Sam's board holds the same drawing, drawn the same way.
    await waitForSameStrokes([priya, sam]);
    const samDrawing = await drawnStroke(sam, stroke.id);
    expect(samDrawing.strokeWidth).toBe(PEN_THICKNESS_WORLD[before.thickness]);
    expect(samDrawing.d.startsWith('M')).toBe(true);

    // Delete takes it off both screens.
    await priya.keyboard.press('Delete');
    await waitForStroke(priya, stroke.id, false);
    await waitForStroke(sam, stroke.id, false);
    expect(await priya.locator(`[data-testid="stroke-object-${stroke.id}"]`).count()).toBe(0);
    expect(await sam.locator(`[data-testid="stroke-object-${stroke.id}"]`).count()).toBe(0);

    await priya.close();
    await sam.close();
  });
});
