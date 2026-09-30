/**
 * Story 11: pen.e2e (TC-17 to TC-20).
 *
 * Playwright (chromium) against the real dev server:
 * - TC-17: the in-progress preview updates while the pointer moves; the
 *   finished stroke persists across a reload.
 * - TC-18: nothing is shared until the pointer is released; the stroke
 *   appears on the other screen (delivery latency is reported, not
 *   asserted).
 * - TC-19: the board pans with the wheel while Pen is active; a drag
 *   starting over a sticky note creates a stroke and does not move the
 *   sticky.
 * - TC-20: a stroke is selected by its line, resized with its aspect and
 *   thickness preserved, moved, and deleted — both screens stay in sync.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { openNewBoard } from './helpers/board';
import { handwrittenLoop } from '../fixtures/pen-paths';

// Story 11 (design.md test strategy): eventual assertions get 5 s; the
// live-delivery latency budget is 2.5 s and is reported, not asserted.
const E2E_EVENTUAL_TIMEOUT_MS = 5000;
const LIVE_UPDATE_LATENCY_BUDGET_MS = 2500;

const BASE = 'http://localhost:8787';

/** Story 5: boards are created server-side via POST /api/boards. */
async function createBoard(): Promise<string> {
  const resp = await fetch(`${BASE}/api/boards`, { method: 'POST' });
  if (resp.status !== 201) throw new Error(`board creation failed: ${resp.status}`);
  return ((await resp.json()) as { id: string }).id;
}

async function openBoardContext(browser: Browser, boardId: string): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/b/${boardId}`);
  await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 15000 });
  return page;
}

const VIEWPORT = { width: 1280, height: 800 };
// Default camera: world origin at screen center.
const ORIGIN = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

function toScreen(world: { x: number; y: number }) {
  return { x: ORIGIN.x + world.x, y: ORIGIN.y + world.y };
}

test.describe('pen.e2e', () => {
  test('TC-17: preview updates while dragging; the stroke persists after a reload', async ({ page }) => {
    await openNewBoard(page);
    await page.getByLabel('Pen (P)').click();
    await expect(page.getByTestId('pen-tool-overlay')).toBeVisible();

    const pts = handwrittenLoop.map(toScreen);

    // Sample the preview path's `d` attribute on every animation frame.
    await page.evaluate(() => {
      (window as any).__dSamples = [] as (string | null)[];
      (window as any).__sampling = true;
      const tick = () => {
        if (!(window as any).__sampling) return;
        const el = document.querySelector('[data-testid="pen-preview"]');
        (window as any).__dSamples.push(el ? el.getAttribute('d') : null);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await page.mouse.move(pts[0].x, pts[0].y);
    await page.mouse.down();
    for (const pt of pts.slice(1)) {
      await page.mouse.move(pt.x, pt.y);
    }
    await page.evaluate(() => { (window as any).__sampling = false; });
    const samples = await page.evaluate(
      () => (window as any).__dSamples as (string | null)[],
    );
    const nonNull = samples.filter((d): d is string => d !== null);

    // The preview appeared and visibly updated during the drag.
    expect(nonNull.length).toBeGreaterThan(0);
    expect(new Set(nonNull).size).toBeGreaterThan(1);

    await page.mouse.up();
    // The preview is gone; one stroke object exists.
    await expect(page.getByTestId('pen-preview')).toHaveCount(0);
    await expect(page.getByTestId('stroke-object')).toHaveCount(1);

    // Reload: the stroke persists (PRD pen.share: strokes are shared when
    // they finish and survive reloads).
    await page.reload();
    await expect(page.getByTestId('stroke-object')).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  });

  test('TC-18: nothing is shared until release; the stroke reaches the other screen', async ({ browser }: { browser: Browser }) => {
    const boardId = await createBoard();
    const pageA = await openBoardContext(browser, boardId);
    const pageB = await openBoardContext(browser, boardId);

    await pageA.getByLabel('Pen (P)').click();

    const pts = handwrittenLoop.slice(0, 60).map(toScreen);
    await pageA.mouse.move(pts[0].x, pts[0].y);
    await pageA.mouse.down();
    for (const pt of pts.slice(1, 30)) {
      await pageA.mouse.move(pt.x, pt.y);
    }

    // Sam sees nothing while the stroke is being drawn (PRD pen.share).
    await expect(pageB.getByTestId('stroke-object')).toHaveCount(0);

    const t0 = Date.now();
    await pageA.mouse.up();
    await expect(pageB.getByTestId('stroke-object')).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    const deliveryMs = Date.now() - t0;
    // Report the delivery latency (design.md: reported in the run log,
    // not asserted).
    console.log(
      `[pen.share] stroke delivered to the second screen in ${deliveryMs}ms ` +
      `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms, reported not asserted)`,
    );
  });

  test('TC-19: the board pans with the wheel while Pen is active; a drag over a sticky draws a stroke', async ({ page }) => {
    await openNewBoard(page);

    // A sticky note on the board.
    await page.mouse.dblclick(500, 300);
    await page.getByTestId('sticky-note').waitFor();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    await page.getByLabel('Pen (P)').click();
    await expect(page.getByTestId('pen-tool-overlay')).toBeVisible();

    // Wheel pans the board even with the Pen active (PRD pen.navigation).
    const markerBefore = (await page.getByTestId('origin-marker').boundingBox())!;
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    await page.mouse.wheel(0, 150);
    await page.waitForTimeout(100);
    const markerAfter = (await page.getByTestId('origin-marker').boundingBox())!;
    expect(Math.abs(markerAfter.y - markerBefore.y)).toBeGreaterThan(10);

    // A drag starting over the sticky note creates a stroke and does NOT
    // move the sticky (PRD pen.navigation: strokes are drawn over objects).
    const stickyBefore = (await page.getByTestId('sticky-note').boundingBox())!;
    const sx = stickyBefore.x + stickyBefore.width / 2;
    const sy = stickyBefore.y + stickyBefore.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 120, sy + 60, { steps: 8 });
    await page.mouse.up();

    await expect(page.getByTestId('stroke-object')).toHaveCount(1);
    const stickyAfter = (await page.getByTestId('sticky-note').boundingBox())!;
    expect(stickyAfter.x).toBeCloseTo(stickyBefore.x, 0);
    expect(stickyAfter.y).toBeCloseTo(stickyBefore.y, 0);
  });

  test('TC-20: select by line, resize keeps aspect and thickness, move, delete — both screens in sync', async ({ browser }: { browser: Browser }) => {
    const boardId = await createBoard();
    const pageA = await openBoardContext(browser, boardId);
    const pageB = await openBoardContext(browser, boardId);

    // Draw a diagonal stroke on A.
    await pageA.getByLabel('Pen (P)').click();
    await pageA.mouse.move(500, 300);
    await pageA.mouse.down();
    await pageA.mouse.move(700, 450, { steps: 12 });
    await pageA.mouse.up();
    const strokeA = pageA.getByTestId('stroke-object');
    const strokeB = pageB.getByTestId('stroke-object');
    await expect(strokeA).toHaveCount(1);
    await expect(strokeB).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Switch to Select and click the line (its midpoint).
    await pageA.keyboard.press('v');
    await pageA.mouse.click(600, 375);
    await expect(pageA.getByTestId('selection-overlay')).toBeVisible();

    const boxBefore = (await strokeA.boundingBox())!;
    const widthBefore = await strokeA.locator('path').first().getAttribute('stroke-width');

    // Resize from the SE corner: aspect ratio preserved...
    const handle = pageA.getByTestId('resize-handle-se');
    const hb = (await handle.boundingBox())!;
    await pageA.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await pageA.mouse.down();
    await pageA.mouse.move(hb.x + hb.width / 2 + 80, hb.y + hb.height / 2 + 80, { steps: 8 });
    await pageA.mouse.up();
    await pageA.waitForTimeout(200);

    const boxAfter = (await strokeA.boundingBox())!;
    const ratioBefore = boxBefore.width / boxBefore.height;
    const ratioAfter = boxAfter.width / boxAfter.height;
    expect(Math.abs(ratioAfter / ratioBefore - 1)).toBeLessThan(0.01);
    // ...and the line thickness unchanged (PRD pen.resize).
    const widthAfter = await strokeA.locator('path').first().getAttribute('stroke-width');
    expect(widthAfter).toBe(widthBefore);

    // Move the stroke by its line (a point near the line inside the bbox).
    const mx = boxAfter.x + boxAfter.width * 0.25;
    const my = boxAfter.y + boxAfter.height * 0.25;
    await pageA.mouse.move(mx, my);
    await pageA.mouse.down();
    await pageA.mouse.move(mx + 60, my + 40, { steps: 6 });
    await pageA.mouse.up();
    await pageA.waitForTimeout(200);
    const boxMoved = (await strokeA.boundingBox())!;
    expect(boxMoved.x).not.toBeCloseTo(boxAfter.x, 0);
    expect(boxMoved.y).not.toBeCloseTo(boxAfter.y, 0);

    // Delete on A; B sees it disappear (PRD pen.delete).
    await pageA.keyboard.press('Delete');
    await expect(strokeA).toHaveCount(0);
    await expect(strokeB).toHaveCount(0, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  });
});
