/**
 * E2E tests for story 11: Pen tool.
 * TC-17: Draw a loop, preview present during drag, stroke persists after release
 * TC-18: Shared sketch - others see finished strokes only
 * TC-19: Navigation while Pen is active (wheel pans, drag creates stroke not pan)
 * TC-20: Select by line, proportional resize, move, delete
 */
import { expect, test, type Page, type Browser, type APIRequestContext } from '@playwright/test';
import {
  openBoard,
  board,
  setCamera,
  getCamera,
} from './helpers/board';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
} from '../../src/shared/config';

/** Create a board via API and return its id. */
async function createBoardApi(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/boards');
  expect(res.ok()).toBeTruthy();
  const data = await res.json() as { id: string };
  return data.id;
}

async function openTwoPages(browser: Browser, request: APIRequestContext) {
  const boardId = await createBoardApi(request);
  const url = `/b/${boardId}`;

  const ctx1 = await browser.newContext();
  const page1 = await ctx1.newPage();
  await page1.goto(url);
  await expect(board(page1)).toBeVisible();
  await page1.waitForFunction(() => {
    const api = (window as any).__vidi6;
    return api && api.connectionState === 'connected';
  }, undefined, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.goto(url);
  await expect(board(page2)).toBeVisible();
  await page2.waitForFunction(() => {
    const api = (window as any).__vidi6;
    return api && api.connectionState === 'connected';
  }, undefined, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

  return { ctx1, page1, ctx2, page2, boardId };
}

/** Draw a stroke on the pen tool overlay using mouse events */
async function drawStroke(page: Page, points: { x: number; y: number }[]): Promise<void> {
  await page.mouse.move(points[0]!.x, points[0]!.y);
  await page.mouse.down();
  for (let i = 1; i < points.length; i++) {
    await page.mouse.move(points[i]!.x, points[i]!.y);
  }
  await page.mouse.up();
}

/** Get stroke elements */
function strokes(page: Page) {
  return page.locator('[data-testid^="stroke-"]');
}

/** Activate pen tool */
async function activatePen(page: Page): Promise<void> {
  await page.keyboard.press('p');
  await page.waitForTimeout(50);
}

/** Activate select tool */
async function activateSelect(page: Page): Promise<void> {
  await page.keyboard.press('v');
  await page.waitForTimeout(50);
}

/** Double-click to create a sticky note at the given screen coordinates */
async function createStickyAt(page: Page, x: number, y: number): Promise<void> {
  await activateSelect(page);
  await page.mouse.dblclick(x, y);
  await page.waitForTimeout(100);
  // Click away to deselect/stop editing
  await page.keyboard.press('Escape');
  await page.waitForTimeout(50);
}

test.describe('Pen tool E2E', () => {
  test('TC-17: Draw a loop; preview present during drag; stroke persists after release', async ({ page, request }) => {
    await openBoard(page, request);
    await setCamera(page, { x: -400, y: -300, zoom: 1 });

    await activatePen(page);

    // Draw a circle-like path (screen coords)
    const cx = 400, cy = 400, r = 80;
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i <= 40; i++) {
      const angle = (i / 40) * Math.PI * 2;
      points.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
    }

    // Start drag but don't release yet
    await page.mouse.move(points[0]!.x, points[0]!.y);
    await page.mouse.down();
    for (let i = 1; i < points.length; i++) {
      await page.mouse.move(points[i]!.x, points[i]!.y);
      // Wait a frame between some points
      if (i % 10 === 0) await page.waitForTimeout(16);
    }

    // Preview should exist during drag
    const preview = page.locator('[data-testid="pen-preview"]');
    await expect(preview).toBeVisible();

    // Release
    await page.mouse.up();
    await page.waitForTimeout(100);

    // Stroke should exist after release
    await expect(strokes(page)).toHaveCount(1);
  });

  test('TC-18: Shared sketch - Sam sees finished stroke after Priya releases', async ({ browser, request }) => {
    const { ctx1, page1, ctx2, page2 } = await openTwoPages(browser, request);

    // Priya activates pen and draws
    await activatePen(page1);

    // Sam should see no strokes initially
    await expect(strokes(page2)).toHaveCount(0);

    // Priya draws a stroke
    await page1.mouse.move(300, 400);
    await page1.mouse.down();
    await page1.mouse.move(350, 350);
    await page1.mouse.move(400, 400);
    await page1.mouse.move(450, 350);
    await page1.mouse.move(500, 400);

    // During drag, Sam should still see nothing
    await expect(strokes(page2)).toHaveCount(0);

    // Record time before release for delivery logging
    const releaseStart = Date.now();

    // Priya releases
    await page1.mouse.up();

    // Wait for Sam to see the stroke
    await expect(strokes(page2)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    const deliveryTime = Date.now() - releaseStart;
    console.log(`TC-18: Stroke delivery time: ${deliveryTime}ms (budget: ${E2E_EVENTUAL_TIMEOUT_MS}ms, informational)`);

    await ctx1.close();
    await ctx2.close();
  });

  test('TC-19: Wheel while Pen active pans; drag starting on sticky creates stroke not pan/move', async ({ page, request }) => {
    await openBoard(page, request);
    await setCamera(page, { x: -400, y: -300, zoom: 1 });

    // First, create a sticky note
    await createStickyAt(page, 400, 300);

    // Get sticky position
    const camBefore = await getCamera(page);

    // Activate pen tool
    await activatePen(page);

    // Wheel scroll should pan (not draw)
    await page.mouse.move(400, 400);
    await page.mouse.wheel(50, 100);
    await page.waitForTimeout(50);

    const camAfter = await getCamera(page);
    // Camera should have moved (panned)
    expect(camAfter.x).not.toBe(camBefore.x);
    expect(camAfter.y).not.toBe(camBefore.y);

    // No stroke from wheel
    await expect(strokes(page)).toHaveCount(0);

    // Drag starting on a sticky with Pen tool creates a stroke, does not move sticky
    // Note: pen overlay is on top, so drag always goes to pen, not to sticky
    const stickyBefore = await page.evaluate(() => {
      const el = document.querySelector('[data-testid^="sticky-"]');
      if (!el) return null;
      const x = el.getAttribute('data-world-x');
      const y = el.getAttribute('data-world-y');
      return { x: x ? parseFloat(x) : null, y: y ? parseFloat(y) : null };
    });

    // Draw a stroke (even on top of a sticky - pen overlay captures all)
    await drawStroke(page, [
      { x: 300, y: 250 },
      { x: 350, y: 300 },
      { x: 400, y: 350 },
    ]);

    await page.waitForTimeout(100);

    // Stroke created
    await expect(strokes(page)).toHaveCount(1);

    // Sticky was not moved (it was protected by pen overlay)
    const stickyAfter = await page.evaluate(() => {
      const el = document.querySelector('[data-testid^="sticky-"]');
      if (!el) return null;
      const x = el.getAttribute('data-world-x');
      const y = el.getAttribute('data-world-y');
      return { x: x ? parseFloat(x) : null, y: y ? parseFloat(y) : null };
    });
    if (stickyBefore && stickyAfter) {
      expect(stickyAfter.x).toBe(stickyBefore.x);
      expect(stickyAfter.y).toBe(stickyBefore.y);
    }
  });

  test('TC-20: Select by line, proportional resize, move, delete', async ({ page, request }) => {
    await openBoard(page, request);
    await setCamera(page, { x: -400, y: -300, zoom: 1 });

    // Draw a horizontal stroke
    await activatePen(page);
    await drawStroke(page, [
      { x: 200, y: 400 },
      { x: 300, y: 400 },
      { x: 400, y: 400 },
      { x: 500, y: 400 },
    ]);
    await page.waitForTimeout(100);
    await expect(strokes(page)).toHaveCount(1);

    // Switch to select
    await activateSelect(page);

    // Click on the stroke line (near its path)
    await page.mouse.click(350, 400);
    await page.waitForTimeout(100);

    // Check stroke is selected by looking at data-selected
    const strokeEl = strokes(page).first();
    await expect(strokeEl).toHaveAttribute('data-selected', 'true');

    // Resize: drag a corner handle
    // Get the selection overlay handles position
    const bbox = await page.evaluate(() => {
      const sel = document.querySelector('[data-testid="selection-overlay"]');
      if (!sel) return null;
      const handles = sel.querySelectorAll('[data-handle]');
      const se = Array.from(handles).find((h) => h.getAttribute('data-handle') === 'se');
      if (!se) return null;
      const rect = se.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });

    if (bbox) {
      // Drag SE handle to resize
      const origBBox = await strokeEl.boundingBox();
      await page.mouse.move(bbox.x, bbox.y);
      await page.mouse.down();
      await page.mouse.move(bbox.x + 50, bbox.y + 50, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(100);

      // Aspect ratio should be preserved
      const newBBox = await strokeEl.boundingBox();
      if (origBBox && newBBox && origBBox.width > 0 && origBBox.height > 0) {
        const origRatio = origBBox.width / origBBox.height;
        const newRatio = newBBox.width / newBBox.height;
        // Should be within 5% (handles are small, so some tolerance)
        expect(Math.abs(origRatio - newRatio) / origRatio).toBeLessThan(0.05);
      }
    }

    // Move: drag the stroke body (click near the line and drag)
    const beforePos = await page.evaluate(() => {
      const el = document.querySelector('[data-testid^="stroke-"]');
      if (!el) return null;
      const path = el.querySelector('path:last-child');
      const d = path?.getAttribute('d') ?? '';
      return d;
    });

    await page.mouse.move(300, 400);
    await page.mouse.down();
    await page.mouse.move(300, 450, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    const afterPos = await page.evaluate(() => {
      const el = document.querySelector('[data-testid^="stroke-"]');
      if (!el) return null;
      const path = el.querySelector('path:last-child');
      const d = path?.getAttribute('d') ?? '';
      return d;
    });

    // Path should have changed (moved)
    expect(afterPos).not.toBe(beforePos);

    // Delete: press Delete key
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);
    await expect(strokes(page)).toHaveCount(0);
  });
});
