/**
 * Story 11, end to end: a pen that draws on the board and leaves objects behind.
 *
 * These are the three workflows the design names, against `wrangler dev` with real WebSockets:
 *
 *  * "Annotate a cluster" (TC-17, TC-19) - a real mouse replaying the recorded handwritten loop, with
 *    the line being repainted on consecutive animation frames while it is drawn and an object on the
 *    board once the button comes up; and the board still being a board while the pen is up, so the
 *    wheel still pans and a drag that starts on a note sketches over it instead of moving it.
 *  * "Shared sketch" (TC-18) - Priya draws while Sam watches: nothing arrives during the drag, which
 *    is the negative half of the promise, and the finished stroke arrives when the button is released.
 *    How long that trip takes is logged, never asserted: a shared runner decides how fast a room is.
 *  * "Tidy up" (TC-20) - the stroke is an object now: selected by its line, resized in proportion
 *    with its nib unchanged, moved by its body, deleted for everybody.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import type { Point } from '../../src/shared/geometry';
import { PEN_THICKNESS_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import type { StrokeSnapshot } from '../../src/shared/board-model';
import { getCamera, setCamera } from './helpers/board';
import {
  closeParticipants,
  LatencyLog,
  openParticipants,
  personAt,
  waitForBoard,
  type Participant,
} from './helpers/participants';
import { centredCamera, toScreen, waitForGone, type World } from './helpers/shapes';
import { screenOf, worldOfScreen } from './helpers/notes';
import {
  drawnStrokeBox,
  previewPathAcrossFrames,
  strokeById,
  strokeDrawnWidth,
  strokePathData,
  strokesOn,
  waitForStrokeCount,
} from './helpers/strokes';
import { HANDWRITTEN_LOOP } from '../fixtures/pen-paths';

test.use({ actionTimeout: 10_000 });

/**
 * The recorded loop, thinned to every other sample.
 *
 * A browser hands a drag's samples to the page in bursts of its own, and the tool takes
 * `getCoalescedEvents()` when it can; replaying all 400 fixture samples through CDP would send twice
 * the messages for a line the same shape. Every other sample keeps the shape - the turns, the wobble
 * and the drift are all still there - and the assertions are about the shape.
 */
const REPLAY: readonly Point[] = HANDWRITTEN_LOOP.filter((_, index) => index % 2 === 0);

/** The box the fixture occupies, so a stored stroke can be compared with what it was drawn from. */
function fixtureBox(points: readonly Point[]): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

/** The world point a stored stroke's point sits at. */
function worldPointOf(stroke: StrokeSnapshot, index: number): World {
  return {
    x: stroke.x + stroke.points[index * 2]!,
    y: stroke.y + stroke.points[index * 2 + 1]!,
  };
}

/** A board of its own, opened with the world origin in the middle of the screen at 100%. */
async function openBoard(page: Page): Promise<string> {
  const created = await page.request.post('/api/boards');
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await page.goto(`/b/${id}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await setCamera(page, centredCamera());
  return id;
}

/** Presses P, waits for the pen's own surface, and hands the page back mid-sketch. */
async function armPen(page: Page): Promise<void> {
  await page.keyboard.press('p');
  await expect(page.getByTestId('pen-tool-surface')).toBeVisible();
}

/** The pen's bar: the colour and thickness of the *next* stroke. */
function penBar(page: Page) {
  return page.getByTestId('pen-toolbar');
}

/**
 * Priya and Sam on a board of their own, both looking at the world origin at 100%.
 *
 * `openParticipants` names people from the suite's own list; the design calls these two Priya and Sam,
 * and a failure that says "Alex drew the loop" in a test about Priya is a waste of an afternoon.
 */
async function pair(
  browser: Browser,
): Promise<{ priya: Participant; sam: Participant; all: Participant[] }> {
  const all = await openParticipants(browser, newBoardId(), 2);
  const priya = personAt(all, 0);
  const sam = personAt(all, 1);
  priya.name = 'Priya';
  sam.name = 'Sam';
  await setCamera(priya.page, centredCamera());
  await setCamera(sam.page, centredCamera());
  return { priya, sam, all };
}

/** A screen path: the fixture, converted through the camera every test sets up. */
function screenPath(): { x: number; y: number }[] {
  return REPLAY.map((point) => toScreen(point));
}

/**
 * Drags the loop, and hands back whatever was sampled along the way.
 *
 * The button is still down when `whileDown` is awaited, so a test can look at the board in the middle
 * of a stroke - which is the only moment any of the interesting promises is about.
 */
async function dragLoop<T>(
  page: Page,
  whileDown: () => Promise<T>,
): Promise<{ result: T; stroke: StrokeSnapshot }> {
  const path = screenPath();
  const first = path[0]!;
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  const running = whileDown();
  for (const point of path.slice(1)) await page.mouse.move(point.x, point.y);
  const result = await running;
  await page.mouse.up();
  await waitForStrokeCount(page, 1);
  const [stroke] = await strokesOn(page);
  if (!stroke) throw new Error('the loop was drawn and never stored');
  return { result, stroke };
}

test.describe('annotating a cluster with the pen', () => {
  test('TC-17 a real drag shows a line that is repainted every frame, and leaves one stroke behind', async ({
    page,
    browserName,
  }) => {
    await openBoard(page);

    await armPen(page);
    // the bar says what the next stroke will be drawn with, and the pen button says it is armed
    await expect(penBar(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const path = screenPath();
    const first = path[0]!;
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();

    // The line is being drawn *now*: sample it on consecutive animation frames while the mouse is
    // still moving. `d` is written once per frame, so a repaint-once-at-the-end or a paint that only
    // follows React would show up here as identical strings.
    const frames = previewPathAcrossFrames(page, 6);
    for (const point of path.slice(1)) await page.mouse.move(point.x, point.y);
    const samples = await frames;

    const painted = samples.filter((d): d is string => typeof d === 'string' && d.length > 0);
    expect(painted.length, `no preview was painted during the drag (${browserName})`).toBeGreaterThanOrEqual(
      2,
    );
    expect(new Set(painted).size, 'the preview did not change between animation frames').toBeGreaterThan(
      1,
    );
    // and what it grew into is a line with more of it at the end than at the start
    const curves = (d: string): number => d.split(' Q ').length - 1;
    expect(curves(painted[painted.length - 1]!)).toBeGreaterThan(curves(painted[0]!));

    // while the stroke is in the air it is on nobody's board but this screen's, and only as a preview
    expect((await strokesOn(page)).length).toBe(0);

    await page.mouse.up();
    await waitForStrokeCount(page, 1);
    const [stroke] = await strokesOn(page);
    if (!stroke) throw new Error('the loop was released and never stored');

    // the preview is gone: what is on the screen now is an object, drawn from the document
    await expect(page.getByTestId('pen-preview')).toHaveCount(0);
    const drawn = await strokePathData(page, stroke.id);
    expect(drawn.startsWith('M ')).toBe(true);
    expect(curves(drawn)).toBeGreaterThan(1);

    // it is the loop that was drawn: the box holds the fixture, padded by the nib
    const box = fixtureBox(REPLAY);
    const half = PEN_THICKNESS_WORLD.medium / 2;
    const tolerance = 2; // a replayed mouse is not a survey instrument, and smoothing may shave a tolerance
    expect(stroke.x).toBeLessThanOrEqual(box.left - half + tolerance);
    expect(stroke.y).toBeLessThanOrEqual(box.top - half + tolerance);
    expect(stroke.x + stroke.width).toBeGreaterThanOrEqual(box.right + half - tolerance);
    expect(stroke.y + stroke.height).toBeLessThanOrEqual(box.bottom + half + tolerance);

    // the picture agrees with the document, at 100% where world units and CSS pixels are one thing
    const onScreen = await drawnStrokeBox(page, stroke.id);
    expect(Math.abs(onScreen.width - stroke.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(onScreen.height - stroke.height)).toBeLessThanOrEqual(1);

    // and the Pen is still armed, because a pen is not put down after one line
    await expect(page.getByTestId('pen-tool-surface')).toBeVisible();

    // a second stroke starts straight away, and lands beside the first
    await page.mouse.move(200, 700);
    await page.mouse.down();
    await page.mouse.move(420, 760, { steps: 8 });
    await page.mouse.up();
    await waitForStrokeCount(page, 2);
  });

  test('TC-19 the board still navigates under the Pen, and a drag that starts on a note sketches over it', async ({
    page,
  }) => {
    await openBoard(page);

    // a note to annotate, made through the model exactly as the sticky tool would - which centres the
    // note on the point asked for, so the box is read back rather than assumed
    const note = await page.evaluate(() => window.__vidi6!.createNote(-40, -20));
    expect(note).not.toBe('');
    await expect(page.locator(`[data-note-id="${note}"]`)).toHaveCount(1);
    const noteAt = async (): Promise<{ x: number; y: number }> =>
      page.evaluate((id) => {
        const found = window.__vidi6!.getObjects().find((obj) => obj.id === id);
        if (!found) throw new Error('the note this test created is not on the board');
        return { x: found.x, y: found.y };
      }, note);
    const placed = await noteAt();

    await armPen(page);

    // the wheel still pans the board with the pen up: the tool hands it down rather than eating it
    const before = await getCamera(page);
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 60);
    await expect
      .poll(() => getCamera(page).then((camera) => camera.y))
      .not.toBe(before.y);
    const panned = await getCamera(page);
    expect(panned.zoom).toBe(before.zoom);

    // Ctrl+wheel still zooms. A small delta on purpose: a wheel notch is a notch, and a delta big
    // enough to slam into the zoom ceiling would put the rest of the test's targets off the screen.
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -40);
    await page.keyboard.up('Control');
    await expect.poll(() => getCamera(page).then((camera) => camera.zoom)).not.toBe(before.zoom);
    const zoomed = await getCamera(page);
    expect(zoomed.zoom).toBeGreaterThan(1);
    expect(zoomed.zoom).toBeLessThan(4);

    // a drag that starts on the note draws over it: the note does not move, is not selected, and the
    // camera does not budge out from under the stroke. The camera has been panned and zoomed by now, so
    // the drag is aimed in screen pixels read from the live camera and converted back to the world
    // units the board stores.
    const centre = await screenOf(page, {
      x: placed.x + STICKY_SIZE_WORLD / 2,
      y: placed.y + STICKY_SIZE_WORLD / 2,
    }); // the middle of the note, which is the least arguable point inside it
    const over = { x: centre.x + 150, y: centre.y + 120 };
    // A pointer aimed outside the window is a pointer that does nothing, and a test that then waits
    // for a stroke waits fifteen minutes for the wrong reason. Both ends of the drag are on screen.
    expect(centre.x).toBeGreaterThanOrEqual(0);
    expect(centre.x).toBeLessThan(1280);
    expect(centre.y).toBeGreaterThanOrEqual(0);
    expect(centre.y).toBeLessThan(800);
    expect(over.x).toBeGreaterThanOrEqual(0);
    expect(over.x).toBeLessThan(1280);
    expect(over.y).toBeGreaterThanOrEqual(0);
    expect(over.y).toBeLessThan(800);
    const overWorld = await worldOfScreen(page, over);
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(over.x, over.y, { steps: 10 });
    await page.mouse.up();
    await waitForStrokeCount(page, 1);

    const [stroke] = await strokesOn(page);
    if (!stroke) throw new Error('a drag that started on a note drew nothing');
    expect(await getCamera(page)).toEqual(zoomed);

    // the note is exactly where it was left: a drag that starts on a note is not a way of moving it
    expect(await noteAt()).toEqual(placed);
    await expect(page.locator(`[data-note-id="${note}"]`)).not.toHaveAttribute(
      'data-selected',
      'true',
    );
    // the stroke covers the line that was dragged, in world units: the note underneath is untouched
    expect(stroke.x).toBeLessThanOrEqual(placed.x + STICKY_SIZE_WORLD / 2);
    expect(stroke.x + stroke.width).toBeGreaterThanOrEqual(overWorld.x - 1);
    expect(stroke.y + stroke.height).toBeGreaterThanOrEqual(overWorld.y - 1);
  });
});

test.describe('a sketch that two people watch', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'chromium is what the design asks for here');

  test('TC-18 nobody sees the stroke until the line is finished, then everybody does', async ({
    browser,
  }) => {
    const { priya, sam, all } = await pair(browser);
    const latency = new LatencyLog();
    try {
      await armPen(priya.page);

      const { result: nothingYet, stroke } = await dragLoop(priya.page, async () => {
        // midway through the drag: Sam's board has nothing on it, because there is nothing to send yet
        await priya.page.waitForTimeout(200);
        return {
          strokes: (await strokesOn(sam.page)).length,
          drawn: await sam.page.locator('[data-stroke-id]').count(),
          previewOnSam: await sam.page.locator('[data-testid="pen-preview"]').count(),
        };
      });

      expect(nothingYet.strokes).toBe(0);
      expect(nothingYet.drawn).toBe(0);
      expect(nothingYet.previewOnSam).toBe(0);

      // the release: how long the finished stroke takes to reach Sam is reported, not asserted
      await latency.measure(
        `${priya.name}'s stroke reached ${sam.name}`,
        async () => Date.now(),
        async () => (await strokesOn(sam.page)).some((item) => item.id === stroke.id),
      );

      // both boards now say the same thing about the same stroke, and Sam's screen draws it too
      const onSam = await strokeById(sam.page, stroke.id);
      expect(onSam).toEqual(stroke);
      await expect(sam.page.locator(`[data-stroke-id="${stroke.id}"]`)).toHaveCount(1);
      expect(await strokePathData(sam.page, stroke.id)).toBe(await strokePathData(priya.page, stroke.id));
      expect(await strokeDrawnWidth(sam.page, stroke.id)).toBe(PEN_THICKNESS_WORLD.medium);

      // Sam's board is a late-joiner's board as well: reloading it brings the same sketch back
      await sam.page.reload();
      // reload is the late-joiner case: the board has to come back before its document can be read
      await waitForBoard(sam);
      await waitForStrokeCount(sam.page, 1);
      expect(await strokeById(sam.page, stroke.id)).toEqual(stroke);

      for (const who of all) expect(who.consoleErrors).toEqual([]);
      latency.report('pen release latency');
    } finally {
      await closeParticipants(all);
    }
  });

  test('TC-20 the finished stroke is selected by its line, resized in proportion, moved and deleted for both', async ({
    browser,
  }) => {
    const { priya, sam, all } = await pair(browser);
    try {
      await armPen(priya.page);
      const { stroke } = await dragLoop(priya.page, async () => undefined);
      await waitForStrokeCount(sam.page, 1);

      // put the pen down and click the line itself: the middle of the first segment is on it by
      // construction, because the stored point is where the pen went down
      await priya.page.keyboard.press('v');
      await expect(priya.page.getByTestId('pen-tool-surface')).toHaveCount(0);
      const onLine = worldPointOf(stroke, 1);
      const aim = toScreen(onLine);
      await priya.page.mouse.click(aim.x, aim.y);
      await expect(priya.page.locator(`[data-stroke-id="${stroke.id}"]`)).toHaveAttribute(
        'data-selected',
        'true',
      );
      await expect(priya.page.getByTestId('selection-overlay')).toBeVisible();

      // the click that looked like the best candidate for a false hit - inside the box, far from the
      // line - is not a hit at all: 40 px away at 100% is 40 px, and the tolerance is 6
      const box = await drawnStrokeBox(priya.page, stroke.id);
      const inside = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await priya.page.mouse.click(inside.x, inside.y);
      await expect(priya.page.locator(`[data-stroke-id="${stroke.id}"]`)).not.toHaveAttribute(
        'data-selected',
        'true',
      );

      // select it again and drag a corner: the drawing grows in proportion and the nib does not
      await priya.page.mouse.click(aim.x, aim.y);
      await expect(priya.page.locator(`[data-stroke-id="${stroke.id}"]`)).toHaveAttribute(
        'data-selected',
        'true',
      );
      const nib = await strokeDrawnWidth(priya.page, stroke.id);
      const ratioBefore = stroke.width / stroke.height;
      const handle = priya.page.locator('[data-handle="se"]');
      const handleBox = await handle.boundingBox();
      if (!handleBox) throw new Error('the selection offers no corner handle for a stroke');
      await priya.page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await priya.page.mouse.down();
      await priya.page.mouse.move(handleBox.x + 120, handleBox.y + 120, { steps: 10 });
      await priya.page.mouse.up();

      const grown = await strokeById(priya.page, stroke.id);
      expect(grown.width).toBeGreaterThan(stroke.width);
      expect(grown.height).toBeGreaterThan(stroke.height);
      // aspect ratio preserved within 1%
      expect(Math.abs(grown.width / grown.height - ratioBefore) / ratioBefore).toBeLessThan(0.01);
      // the ink kept the thickness it was drawn with
      expect(grown.thickness).toBe(stroke.thickness);
      expect(await strokeDrawnWidth(priya.page, stroke.id)).toBe(nib);
      await expect
        .poll(() => strokeById(sam.page, grown.id).then((item) => item.width))
        .toBeCloseTo(grown.width, 6);

      // drag the body (on the line, because that is the part a person can catch): it moves, and it is
      // still one stroke rather than a new one
      const movedFrom = worldPointOf(grown, 2);
      const from = toScreen(movedFrom);
      const to = { x: from.x + 60, y: from.y + 40 };
      await priya.page.mouse.move(from.x, from.y);
      await priya.page.mouse.down();
      await priya.page.mouse.move(to.x, to.y, { steps: 8 });
      await priya.page.mouse.up();

      const placed = await strokeById(priya.page, grown.id);
      expect(Math.abs(placed.x - (grown.x + 60))).toBeLessThanOrEqual(1);
      expect(Math.abs(placed.y - (grown.y + 40))).toBeLessThanOrEqual(1);
      expect((await strokesOn(priya.page)).length).toBe(1);
      await expect
        .poll(() => strokeById(sam.page, placed.id).then((item) => item.x))
        .toBeCloseTo(placed.x, 6);

      // delete: it leaves both boards, and nothing is left selected on either
      await priya.page.keyboard.press('Delete');
      await waitForGone(priya.page, placed.id);
      await waitForGone(sam.page, placed.id);
      await expect(priya.page.getByTestId('selection-overlay')).toHaveCount(0);
      await expect(sam.page.locator(`[data-stroke-id="${placed.id}"]`)).toHaveCount(0);

      for (const who of all) expect(who.consoleErrors).toEqual([]);
    } finally {
      await closeParticipants(all);
    }
  });
});
