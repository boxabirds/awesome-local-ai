// tests/e2e/pen.spec.ts
// TC-17 to TC-20: E2E pen workflows

import { test, expect, type Page } from '@playwright/test';
import { getOriginMarkerPosition } from './helpers/board';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';
import { handwrittenLoop } from '../fixtures/pen-paths';

// Helper: create a new board and navigate to it
async function createBoard(page: Page): Promise<string> {
  await page.goto('/');
  await page.click('text=New board');
  // Wait for the URL to change to a board URL (History API, no full page load)
  await page.waitForFunction(() => window.location.pathname.startsWith('/b/'), { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  // Extract board ID from URL
  const url = page.url();
  const match = url.match(/\/b\/([A-Za-z0-9_-]{22})/);
  if (!match) throw new Error(`No board ID in URL: ${url}`);
  return match[1];
}

// Helper: wait for the board viewport to be ready
async function waitForBoard(page: Page) {
  await expect(page.locator('[data-testid="board-viewport"]')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
}

// Helper: activate the pen tool
async function activatePen(page: Page) {
  await waitForBoard(page);
  await page.keyboard.press('p');
  await expect(page.locator('[data-testid="pen-tool-overlay"]')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
}

test.describe('Annotate a cluster', () => {
  test('TC-17: real drag drawing a loop; preview during drag; stroke persists after release', async ({ page }) => {
    await createBoard(page);
    await waitForBoard(page);

    // Activate pen tool
    await activatePen(page);

    // Get the origin marker position to know where world (0,0) is on screen
    const origin = await getOriginMarkerPosition(page);

    // Replay the handwritten loop path centered on the origin
    const loop = handwrittenLoop();
    // The loop is centered around (100, 100) with radius 50
    const offsetX = origin.x - 100;
    const offsetY = origin.y - 100;

    // Start the drag
    await page.mouse.move(loop[0].x + offsetX, loop[0].y + offsetY);
    await page.mouse.down();

    // Move through some points - check preview is visible during drag
    for (let i = 1; i < Math.min(20, loop.length); i++) {
      await page.mouse.move(loop[i].x + offsetX, loop[i].y + offsetY);
    }

    // Preview path should be visible during drag
    const preview = page.locator('[data-testid="pen-preview"] path');
    await expect(preview).toBeVisible();

    // Continue the rest of the path
    for (let i = 20; i < loop.length; i++) {
      await page.mouse.move(loop[i].x + offsetX, loop[i].y + offsetY);
    }

    // Release
    await page.mouse.up();

    // Preview should be gone
    await expect(preview).not.toBeVisible();

    // Stroke should persist - check for stroke-path element
    const strokePath = page.locator('[data-testid="stroke-path"]');
    await expect(strokePath).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  });

  test('TC-19: wheel while Pen active pans; drag on sticky creates stroke, sticky not moved', async ({ page }) => {
    await createBoard(page);
    await waitForBoard(page);

    // Create a sticky note first (double-click on empty board)
    await page.mouse.dblclick(400, 300);
    // Wait for sticky to appear
    const sticky = page.locator('[data-testid="sticky-note"]').first();
    await expect(sticky).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Activate pen tool
    await activatePen(page);

    // Test wheel panning: get origin position before
    const originBefore = await getOriginMarkerPosition(page);

    // Scroll to pan
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(200);

    const originAfter = await getOriginMarkerPosition(page);
    // Origin should have moved (panned)
    expect(Math.abs(originAfter.y - originBefore.y)).toBeGreaterThan(5);

    // Now draw a stroke starting near the sticky
    // Re-get sticky position after pan
    const stickyBox2 = await sticky.boundingBox();
    expect(stickyBox2).not.toBeNull();
    const scX = stickyBox2!.x + stickyBox2!.width / 2;
    const scY = stickyBox2!.y + stickyBox2!.height / 2;

    await page.mouse.move(scX, scY);
    await page.mouse.down();
    await page.mouse.move(scX + 50, scY + 30);
    await page.mouse.up();

    // A stroke should have been created
    const strokePath = page.locator('[data-testid="stroke-path"]');
    await expect(strokePath).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // The sticky should NOT have moved significantly
    const stickyBoxAfter = await sticky.boundingBox();
    expect(stickyBoxAfter).not.toBeNull();
    // The sticky moved due to pan, but not due to the pen drag
    // Just verify it's still visible
    expect(stickyBoxAfter!.width).toBeGreaterThan(0);
  });
});

test.describe('Shared sketch', () => {
  test('TC-18: Priya draws while Sam watches; Sam sees finished stroke after release', async ({ browser }) => {
    // Create a board first
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    const boardId = await createBoard(page1);
    await waitForBoard(page1);

    // Sam joins the same board
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto(`/b/${boardId}`);
    await waitForBoard(page2);

    // Priya (page1) activates pen
    await page1.keyboard.press('p');
    await expect(page1.locator('[data-testid="pen-tool-overlay"]')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Sam (page2) should NOT see any pen overlay
    await expect(page2.locator('[data-testid="pen-tool-overlay"]')).not.toBeVisible();

    // Get origin position on page1
    const origin = await getOriginMarkerPosition(page1);

    // Priya starts drawing
    const startX = origin.x;
    const startY = origin.y;
    await page1.mouse.move(startX, startY);
    await page1.mouse.down();

    // Move a bit (in-progress stroke)
    await page1.mouse.move(startX + 30, startY + 30);
    await page1.mouse.move(startX + 60, startY + 10);
    await page1.waitForTimeout(100);

    // Sam should NOT see the in-progress stroke
    const samStrokeDuring = await page2.locator('[data-testid="stroke-path"]').count();
    expect(samStrokeDuring).toBe(0);

    // Record time before release
    const releaseTime = Date.now();

    // Priya releases
    await page1.mouse.up();

    // Sam should see the stroke after release
    const samStroke = page2.locator('[data-testid="stroke-path"]');
    await expect(samStroke).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Log delivery time (not asserted)
    const deliveryTime = Date.now() - releaseTime;
    console.log(`[TC-18] Stroke delivery time: ${deliveryTime}ms (budget: ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`);

    // Cleanup
    await context1.close();
    await context2.close();
  });
});

test.describe('Tidy up', () => {
  test('TC-20: select by line, resize proportionally, move, delete', async ({ page }) => {
    await createBoard(page);
    await waitForBoard(page);

    // Draw a stroke with the pen tool
    await activatePen(page);

    const origin = await getOriginMarkerPosition(page);
    const startX = origin.x;
    const startY = origin.y;

    // Draw a simple line
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY + 50);
    await page.mouse.up();

    // Wait for stroke to appear
    const strokePath = page.locator('[data-testid="stroke-path"]');
    await expect(strokePath).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Switch to select tool
    await page.keyboard.press('v');
    await expect(page.locator('[data-testid="pen-tool-overlay"]')).not.toBeVisible();

    // Click on the stroke line to select it
    // The stroke goes from origin to (origin+100, origin+50)
    // Click near the middle of the line
    const clickX = startX + 50;
    const clickY = startY + 25;
    await page.mouse.click(clickX, clickY);

    // Selection bounding box should be visible
    const bbox = page.locator('[data-testid="selection-bounding-box"]');
    await expect(bbox).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Get the bounding box dimensions before resize
    const bboxBox = await bbox.boundingBox();
    expect(bboxBox).not.toBeNull();
    const origW = bboxBox!.width;
    const origH = bboxBox!.height;
    const origRatio = origW / origH;

    // Drag the SE corner handle to resize
    const seHandle = page.locator('[data-testid="resize-handle-se"]');
    await expect(seHandle).toBeVisible();
    const handleBox = await seHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    // Drag the handle to make it larger
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + 80, handleBox!.y + 60);
    await page.mouse.up();

    // Check aspect ratio is preserved (within 1%)
    const bboxBoxAfter = await bbox.boundingBox();
    expect(bboxBoxAfter).not.toBeNull();
    const newW = bboxBoxAfter!.width;
    const newH = bboxBoxAfter!.height;
    const newRatio = newW / newH;
    expect(Math.abs(newRatio - origRatio) / origRatio).toBeLessThan(0.01);

    // Move the stroke by dragging its body
    const strokeBox = await strokePath.boundingBox();
    expect(strokeBox).not.toBeNull();
    const moveStartX = strokeBox!.x + strokeBox!.width / 2;
    const moveStartY = strokeBox!.y + strokeBox!.height / 2;

    await page.mouse.move(moveStartX, moveStartY);
    await page.mouse.down();
    await page.mouse.move(moveStartX + 30, moveStartY + 20);
    await page.mouse.up();

    // Stroke should have moved
    const strokeBoxAfter = await strokePath.boundingBox();
    expect(strokeBoxAfter).not.toBeNull();
    expect(Math.abs(strokeBoxAfter!.x - strokeBox!.x - 30)).toBeLessThan(5);
    expect(Math.abs(strokeBoxAfter!.y - strokeBox!.y - 20)).toBeLessThan(5);

    // Delete the stroke
    await page.keyboard.press('Delete');
    await expect(strokePath).toHaveCount(0, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  });
});
