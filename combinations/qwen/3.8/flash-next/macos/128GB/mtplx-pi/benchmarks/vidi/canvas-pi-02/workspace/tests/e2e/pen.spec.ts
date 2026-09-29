/**
 * Story 11 e2e: the pen, in a real browser (TC-17 to TC-20).
 *
 * The component suite drives the pen through synthetic MouseEvents in jsdom,
 * where `getBoundingClientRect` is all zeros and there is no compositor. What is
 * only provable here is the thing the story is actually about: a held button
 * whose travel becomes ink, in a browser that has to decide between drawing,
 * panning and dragging the note underneath.
 *
 * Two checks are made against the document as well as the pixels. A preview that
 * never reaches the Y.Doc is the requirement (D2: an unfinished stroke is not
 * shared), and a stroke that survives a reload is the proof that the release
 * committed an object rather than a decoration.
 */
import { expect, test } from './helpers/boardTest';
import { type Page } from '@playwright/test';
import {
  board,
  readCamera,
  readNotes,
  readStrokes,
  screenPointOf,
  seedNotes,
  seedStroke,
  settle,
  type StrokeState,
} from './helpers/board';
import { openFreshPair, slotOf } from './helpers/boards';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, STICKY_SIZE_WORLD } from '../../src/shared/config';

type ScreenPoint = { x: number; y: number };

/** A loop: `count` points around a circle, the last one back where it started. */
function circle(centre: ScreenPoint, radius: number, count: number): ScreenPoint[] {
  const points: ScreenPoint[] = [];
  for (let index = 0; index <= count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    points.push({
      x: centre.x + Math.cos(angle) * radius,
      y: centre.y + Math.sin(angle) * radius,
    });
  }
  return points;
}

/** One press, from the first point to the last, without lifting the pen. */
async function draw(page: Page, points: ScreenPoint[]): Promise<void> {
  await page.mouse.move(points[0]!.x, points[0]!.y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    await page.mouse.move(point.x, point.y);
  }
  await page.mouse.up();
  await settle(page);
}

/** Everything the board draws with the pen, preview or not. */
const ink = (page: Page) => page.locator('[data-testid^="stroke-"]');

/**
 * A corner of a stroke's own ink, in screen coordinates: taken from the points
 * the document holds rather than from the middle of its bounding box, because for
 * a drawing the middle is usually empty (§4.2).
 */
function inkCorner(page: Page, stroke: StrokeState): Promise<ScreenPoint> {
  return screenPointOf(page, {
    x: stroke.x + stroke.points[6]!,
    y: stroke.y + stroke.points[7]!,
  });
}

async function strokes(page: Page): Promise<StrokeState[]> {
  return readStrokes(page);
}

test.describe('the pen, drawn', () => {
  test('TC-17 a loop shows a live preview and commits one stroke', async ({ page }) => {
    await settle(page);
    await page.getByTestId('tool-pen').click();
    await settle(page);
    // The pen arrives with its own options: six colours, three thicknesses.
    await expect(page.getByTestId('pen-options')).toBeVisible();
    await expect(page.getByTestId('pen-colours').locator('button')).toHaveCount(6);
    await expect(page.getByTestId('pen-thicknesses').locator('button')).toHaveCount(3);

    const box = await board(page).boundingBox();
    if (!box) throw new Error('the board viewport has no bounding box');
    const loop = circle(
      { x: box.x + box.width / 2, y: box.y + box.height / 2 + 40 },
      90,
      48,
    );

    const preview = page.getByTestId('stroke-preview');
    await page.mouse.move(loop[0]!.x, loop[0]!.y);
    await page.mouse.down();
    await page.mouse.move(loop[1]!.x, loop[1]!.y);
    await settle(page);
    await expect(preview).toHaveCount(1);
    const early = await preview.locator('path').getAttribute('d');
    if (!early) throw new Error('the preview has no path to draw with');

    // Every point is its own move: a loop drawn as one long straight sweep would
    // not be a loop, and what is under test here is a closed drawing.
    for (const point of loop.slice(2)) {
      await page.mouse.move(point.x, point.y);
    }
    await settle(page);
    const later = await preview.locator('path').getAttribute('d');
    // One element, and more of the drawing inside it: the preview is the stroke
    // being drawn, not a snapshot taken when the button went down.
    expect(later!.length).toBeGreaterThan(early.length);
    // And nothing has been committed, or sent, while the button is held (D2).
    expect(await strokes(page)).toHaveLength(0);

    await page.mouse.up();
    await settle(page);
    await expect(preview).toHaveCount(0);
    await expect.poll(() => strokes(page).then((list) => list.length)).toBe(1);
    // The preview layer is gone and the ink is still there, now as an object.
    await expect(ink(page)).toHaveCount(1);

    const drawn = (await strokes(page))[0]!;
    // A circle drawn in one press is a ring: its middle is board, not ink.
    expect(drawn.closed).toBe(true);
    expect(drawn.points.length).toBeLessThan(48 * 2);
    expect(drawn.points.length).toBeGreaterThan(4);

    // Reload: the stroke was a commit, so it comes back, path for path.
    await page.reload();
    await expect
      .poll(() => strokes(page).then((list) => list.map((item) => item.path).join('|')), {
        timeout: 10_000,
      })
      .toBe(drawn.path);
  });
});

test.describe('two people, one drawing', () => {
  test(
    'TC-18 a stroke in progress stays on the drawer\'s screen until it is released',
    async ({ browser }, testInfo) => {
      const [drawer, watcher] = await openFreshPair(browser, 'TC-18', slotOf(testInfo));
      await settle(drawer);
      await settle(watcher);

      await drawer.getByTestId('tool-pen').click();
      await settle(drawer);

      const box = await board(drawer).boundingBox();
      if (!box) throw new Error('the board viewport has no bounding box');
      const loop = circle({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, 80, 40);

      await drawer.mouse.move(loop[0]!.x, loop[0]!.y);
      await drawer.mouse.down();
      for (const point of loop.slice(1, 14)) {
        await drawer.mouse.move(point.x, point.y);
      }
      await settle(watcher);
      // Halfway through the loop, the watcher's board is unchanged: no element and
      // no object, so the preview cannot have been broadcast by accident.
      expect(await ink(watcher).count()).toBe(0);
      expect(await strokes(watcher)).toHaveLength(0);

      for (const point of loop.slice(14)) {
        await drawer.mouse.move(point.x, point.y);
      }
      const released = Date.now();
      await drawer.mouse.up();

      // The finished stroke is a document change, and a document change is live:
      // the story asks for it within the sharing budget.
      await expect
        .poll(() => strokes(watcher).then((list) => list.length), {
          timeout: LIVE_UPDATE_LATENCY_BUDGET_MS,
        })
        .toBe(1);
      const elapsed = Date.now() - released;
      expect(elapsed).toBeLessThanOrEqual(LIVE_UPDATE_LATENCY_BUDGET_MS);

      // And what arrived is the same drawing, not a redraw of it: same points,
      // same box, so both screens compose the same pixels.
      await expect
        .poll(
          async () => {
            const left = (await strokes(drawer))[0];
            const right = (await strokes(watcher))[0];
            return left !== undefined && right !== undefined && left.path === right.path;
          },
          { timeout: 2_000 },
        )
        .toBe(true);
      expect(await ink(watcher).count()).toBe(1);

      await drawer.close();
      await watcher.close();
    },
  );
});

test.describe('the pen, over the rest of the board', () => {
  test('TC-19 the wheel still pans, and a stroke over a note leaves the note alone', async ({
    page,
  }) => {
    await settle(page);
    await seedNotes(page, [{ x: 0, y: 0, text: 'Under the pen' }]);
    await page.getByTestId('tool-pen').click();
    await settle(page);

    const noteBefore = (await readNotes(page))[0]!;
    const centre = {
      x: noteBefore.x + STICKY_SIZE_WORLD / 2,
      y: noteBefore.y + STICKY_SIZE_WORLD / 2,
    };

    // Wheel with the pen active: navigation, not drawing.
    const cameraBefore = await readCamera(page);
    const middleOfTheNote = await screenPointOf(page, centre);
    await page.mouse.move(middleOfTheNote.x, middleOfTheNote.y);
    await page.mouse.wheel(0, -240);
    await settle(page);
    await page.waitForTimeout(200);
    await settle(page);
    const cameraAfter = await readCamera(page);
    expect(cameraAfter).not.toEqual(cameraBefore);
    expect(await strokes(page)).toHaveLength(0);

    // A drag that starts on the note. The pen holds the pointer, so the note is
    // not dragged and the ink is drawn on top of it (D3). The start point is taken
    // after the wheel, because the wheel moved the board under the cursor.
    const overNote = await screenPointOf(page, centre);
    const path: ScreenPoint[] = [];
    for (let index = 0; index <= 20; index += 1) {
      path.push({ x: overNote.x - 30 + index * 8, y: overNote.y - 10 + index * 2 });
    }
    await draw(page, path);
    await settle(page);

    const noteAfter = (await readNotes(page))[0]!;
    expect([noteAfter.x, noteAfter.y]).toEqual([noteBefore.x, noteBefore.y]);
    const drawn = await strokes(page);
    expect(drawn).toHaveLength(1);
    // The stroke is a new object above the note, and it is the ink that was drawn:
    // about 160 x 40 screen pixels at zoom 1, wherever the camera had drifted to.
    const stroke = drawn[0]!;
    expect(Math.abs(stroke.width - 160)).toBeLessThanOrEqual(6);
    expect(Math.abs(stroke.height - 40)).toBeLessThanOrEqual(6);
  });

  test(
    'TC-20 select by the line, resize proportionally, drag by the ink, delete',
    async ({ browser }, testInfo) => {
      const [page, other] = await openFreshPair(browser, 'TC-20', slotOf(testInfo));
      await settle(page);
      await settle(other);

      // A zig-zag 200 x 100, so "proportional" has a number attached to it: any
      // free resize would change this ratio, a locked one cannot.
      await seedStroke(page, {
        points: [100, 100, 150, 200, 200, 100, 250, 200, 300, 100],
      });
      await expect.poll(() => strokes(other).then((list) => list.length)).toBe(1);
      const seeded = (await strokes(page))[0]!;
      expect(Math.abs(seeded.width - 200)).toBeLessThanOrEqual(1);
      expect(Math.abs(seeded.height - 100)).toBeLessThanOrEqual(1);

      // Click on the middle peak. The empty half of the box is not the drawing, so
      // a click there has to stay a click on the board.
      const peak = await screenPointOf(page, { x: 200, y: 100 });
      const hollow = await screenPointOf(page, { x: 200, y: 160 });
      await page.mouse.click(hollow.x, hollow.y);
      await settle(page);
      await expect(page.getByTestId('local-selection-outline')).toHaveCount(0);
      await page.mouse.click(peak.x, peak.y);
      await settle(page);
      await expect(page.getByTestId('local-selection-outline')).toHaveCount(1);
      await expect(page.getByTestId('handle-se')).toBeVisible();

      // Resize from the bottom-right corner: 80 px wider, 20 px taller. An unlocked
      // box would come out at 280 x 120.
      const handle = page.getByTestId('handle-se');
      const handleBox = await handle.boundingBox();
      if (!handleBox) throw new Error('the bottom-right handle has no bounding box');
      const start = {
        x: handleBox.x + handleBox.width / 2,
        y: handleBox.y + handleBox.height / 2,
      };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 80, start.y + 20, { steps: 12 });
      await page.mouse.up();
      await settle(page);
      await page.waitForTimeout(200);
      await settle(page);

      const resized = (await strokes(page))[0]!;
      expect(resized.width).toBeGreaterThan(seeded.width + 40);
      const ratio = resized.width / resized.height;
      // ±1% of the drawing's own ratio, which is what the story asks a pen line to
      // keep when it is stretched.
      expect(Math.abs(ratio / 2 - 1)).toBeLessThanOrEqual(0.01);

      // Drag it by the ink. The press lands on the line, and the line is what is
      // selected, so this is a move: the board does not slide out from under it.
      const before = (await strokes(page))[0]!;
      const onInk = await inkCorner(page, before);
      const path: ScreenPoint[] = [];
      for (let index = 1; index <= 12; index += 1) {
        path.push({ x: onInk.x + index * 6, y: onInk.y - index * 4 });
      }
      await page.mouse.move(onInk.x, onInk.y);
      await page.mouse.down();
      for (const point of path) await page.mouse.move(point.x, point.y);
      await page.mouse.up();
      await settle(page);
      await page.waitForTimeout(200);
      await settle(page);

      const moved = (await strokes(page))[0]!;
      expect(Math.abs(moved.x - (before.x + 72))).toBeLessThanOrEqual(2);
      expect(Math.abs(moved.y - (before.y - 48))).toBeLessThanOrEqual(2);
      // The same drawing, elsewhere: the ink travelled with its box instead of
      // stretching inside it.
      expect(moved.path).toBe(before.path);

      // Delete: one press, and the object is gone from both boards.
      await page.keyboard.press('Delete');
      await settle(page);
      await expect.poll(() => strokes(page).then((list) => list.length)).toBe(0);
      await expect
        .poll(() => strokes(other).then((list) => list.length), { timeout: 5_000 })
        .toBe(0);
      await expect(ink(page)).toHaveCount(0);
      await expect(ink(other)).toHaveCount(0);

      await page.close();
      await other.close();
    },
  );
});
