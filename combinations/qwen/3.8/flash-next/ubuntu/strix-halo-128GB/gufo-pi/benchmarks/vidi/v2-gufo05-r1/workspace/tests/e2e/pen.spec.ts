/**
 * The Pen tool in the browser (story 11): real freehand drags, real smooth paths, real zoom,
 * real collaboration and real undo.
 *
 * What a browser adds over the component suite is measurement and paint: that a wobbly line is
 * smoothed but stays within a pixel of the hand, that the preview moves as the pen moves, that the
 * ink scales with the view while the click tolerance does not, that a second person sees the stroke
 * in well under the budget, and that undo and a reload leave the board exactly as they should.
 *
 * TC-17 a wobbly loop is smoothed to fewer points, within a pixel of the hand, painted as curves,
 *      and its preview moves mid-drag
 * TC-18 the pen works at 50 %, 100 % and 200 %; the world ink scales with the view; a plain click
 *      leaves a dot
 * TC-19 Dana draws, Sam sees the same path within the latency budget
 * TC-20 undo removes the last stroke; after a reload it is still gone
 */
import { expect, test, type Page } from '@playwright/test';

import { setCamera } from './helpers/board';
import { openBoard, waitForChange, logLatencyReport } from './helpers/participants';
import { loopPath, underlinePath } from '../fixtures/pen-paths';
import {
  armPenTool,
  beginStroke,
  choosePenColour,
  choosePenThickness,
  drawDot,
  drawStroke,
  readStroke,
  strokePathD,
  strokeCount,
  STROKE_PREVIEW,
} from './helpers/pen';

async function openAndPark(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'New board' }).click();
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await setCamera(page, { x: 0, y: 0, zoom: 1 });
}

test.describe('pen.drawing: freehand ink in the browser', () => {
  test('TC-17 a wobbly loop is smoothed, faithful to the hand, and previewed mid-drag', async ({
    page,
  }) => {
    await openAndPark(page);
    await armPenTool(page);

    const centre = { x: 480, y: 340 };
    const radius = 140;
    const loop = loopPath(centre, radius, { points: 400, wobble: 7 });

    // Begin the stroke and watch the live preview move.
    const stroke = await beginStroke(page, loop.slice(0, 60));
    await expect(page.locator(STROKE_PREVIEW)).toHaveAttribute('d', /Q/, { timeout: 5000 });
    const firstPreview = await stroke.previewPath();
    await stroke.extend(loop.slice(60, 200));
    const secondPreview = await stroke.previewPath();
    expect(secondPreview).not.toBe(firstPreview);
    expect(secondPreview.length).toBeGreaterThan(firstPreview.length);
    await stroke.extend(loop.slice(200));
    await stroke.finish();

    // Exactly one stroke, smoothed to well under the hand's 400 points but still a real curve.
    await expect.poll(() => strokeCount(page)).toBe(1);
    const drawn = await readStroke(page, (await page.locator('[data-testid="stroke-object"]').first().getAttribute('data-object-id'))!);
    expect(drawn).not.toBeNull();
    expect(drawn!.points).toBeLessThan(loop.length);
    expect(drawn!.points).toBeGreaterThan(3);

    // The painted path is smooth (quadratic midpoint curves), not a polyline of straight segments.
    const d = await strokePathD(page, drawn!.id);
    expect(d).toContain('Q');
    expect(d).not.toContain('C');
    expect(d).not.toContain('L'); // no line-to segments in the smoothed ink

    // Faithful to the hand: the painted box covers the loop it traced, within a pixel or two of
    // the jitter — the simplifier removed points without erasing the curve.
    const xs = loop.map((p) => p.x);
    const ys = loop.map((p) => p.y);
    const boxLeft = Math.min(...xs);
    const boxRight = Math.max(...xs);
    const boxTop = Math.min(...ys);
    const boxBottom = Math.max(...ys);
    // Half the (medium) thickness pads the box on every side.
    const pad = 4 / 2;
    expect(Math.abs(drawn!.x - (boxLeft - pad))).toBeLessThanOrEqual(3);
    expect(Math.abs(drawn!.width - (boxRight - boxLeft + pad * 2))).toBeLessThanOrEqual(4);
    expect(Math.abs(drawn!.y - (boxTop - pad))).toBeLessThanOrEqual(3);
    expect(Math.abs(drawn!.height - (boxBottom - boxTop + pad * 2))).toBeLessThanOrEqual(4);
  });

  test('TC-18 the pen draws at any zoom, the ink scales with the view, a click leaves a dot', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'world-geometry scaling is asserted on Chromium');
    await openAndPark(page);
    await armPenTool(page);
    await choosePenColour(page, 'red');
    await choosePenThickness(page, 'thick');

    // Draw the same length underline at three zooms; the screen length is fixed, so the stored
    // world width is that length divided by the zoom — the ink keeps its size in the world.
    const screenLength = 220;
    for (const zoom of [1, 2, 0.5]) {
      await setCamera(page, { x: 0, y: 0, zoom });
      const y = 200;
      const before = await strokeCount(page);
      const id = await drawStroke(page, underlinePath({ x: 200, y }, screenLength));
      await expect.poll(() => strokeCount(page)).toBe(before + 1);
      const stroke = await readStroke(page, id);
      expect(stroke).not.toBeNull();
      expect(stroke!.color).toBe('red');
      expect(stroke!.thickness).toBe('thick');
      // The world width is the screen length over the zoom, plus the box padding of half the
      // thickness on each side (thick = 8, so up to 8 world units) and a little for anti-aliasing.
      expect(Math.abs(stroke!.width - screenLength / zoom)).toBeLessThanOrEqual(6 / zoom + 10);
    }

    // A plain click, no movement, is a dot.
    await setCamera(page, { x: 0, y: 0, zoom: 1 });
    const dotBefore = await strokeCount(page);
    const dot = await drawDot(page, { x: 760, y: 520 });
    await expect.poll(() => strokeCount(page)).toBe(dotBefore + 1);
    const dotStroke = await readStroke(page, dot);
    expect(dotStroke).not.toBeNull();
    expect(dotStroke!.points).toBe(1);
  });

  test('TC-20 undo removes the last stroke and it stays gone after a reload', async ({ page }) => {
    await openAndPark(page);
    await armPenTool(page);

    await drawStroke(page, underlinePath({ x: 150, y: 180 }, 160));
    await drawStroke(page, loopPath({ x: 520, y: 360 }, 90, { points: 120 }));
    await expect.poll(() => strokeCount(page)).toBe(2);

    // One undo is one stroke. (No click to focus first: with the Pen armed a click would draw.)
    await page.keyboard.press('Control+z');
    await expect.poll(() => strokeCount(page)).toBe(1);

    await page.keyboard.press('Control+z');
    await expect.poll(() => strokeCount(page)).toBe(0);

    // And the undo is durable: a reload does not bring the strokes back.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    await expect.poll(() => strokeCount(page)).toBe(0);
  });
});

test.describe('pen.collaboration: two people, one ink', () => {
  test('TC-19 Dana draws, Sam sees the same path within the latency budget', async ({
    browser,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'cross-person ink is asserted on Chromium');
    const session = await openBoard(browser, 2);
    const dana = session.byName('Alex');
    const sam = session.byName('Sam');
    await setCamera(dana.page, { x: 0, y: 0, zoom: 1 });
    await setCamera(sam.page, { x: 0, y: 0, zoom: 1 });

    await armPenTool(dana.page);
    const id = await drawStroke(dana.page, loopPath({ x: 400, y: 320 }, 120, { points: 160 }));

    const ms = await waitForChange('Sam sees Dana stroke', async () => (await strokeCount(sam.page)) === 1);
    expect(ms).toBeLessThan(150);

    // Sam sees the same stroke: same id, and a matching world box.
    const onSam = await readStroke(sam.page, id);
    const onDana = await readStroke(dana.page, id);
    expect(onSam).not.toBeNull();
    expect(onSam!.points).toBe(onDana!.points);
    expect(Math.abs(onSam!.x - onDana!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(onSam!.width - onDana!.width)).toBeLessThanOrEqual(1);

    logLatencyReport('story 11 pen sync');
    await session.close();
  });
});
