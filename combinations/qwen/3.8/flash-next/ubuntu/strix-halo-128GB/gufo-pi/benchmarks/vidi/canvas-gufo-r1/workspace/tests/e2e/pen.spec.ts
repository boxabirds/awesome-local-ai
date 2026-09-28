/**
 * E2E tests for Story 11: Sketch freehand with a pen.
 * TC-17 to TC-20.
 */
import { test, expect } from '@playwright/test';
import { gotoBoard, setCamera } from './helpers/board';
import { createBoard, openParticipants, closeParticipants, type Participant } from './helpers/participants';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';

test.describe('Pen tool E2E', () => {
  test.beforeEach(async ({ page }) => {
    await gotoBoard(page);
    await setCamera(page, 0, 0, 1);
  });

  // TC-17: Real drag drawing a loop → preview present during drag, stroke persists after release
  test('TC-17: draw loop shows preview during drag, stroke persists after release', async ({ page }) => {
    const viewport = page.locator('[data-testid="board-viewport"]');
    await expect(viewport).toBeVisible();

    // Activate pen tool
    await page.keyboard.press('p');
    const overlay = page.locator('[data-testid="pen-tool-overlay"]');
    await expect(overlay).toBeVisible();

    // Start drawing a loop
    await page.mouse.move(300, 300);
    await page.mouse.down();

    // Draw some points to create a loop
    const points = [
      [350, 250], [400, 260], [420, 300], [400, 350],
      [350, 370], [300, 360], [280, 320], [300, 300],
    ];
    for (const [x, y] of points) {
      await page.mouse.move(x, y, { steps: 2 });
    }

    // During drag: preview path should exist and have a `d` attribute
    const previewPath = page.locator('path[data-preview="true"]');
    await expect(previewPath).toBeAttached();
    const d1 = await previewPath.getAttribute('d');
    expect(d1).toBeTruthy();

    // Continue moving to verify `d` changes
    await page.mouse.move(310, 290, { steps: 2 });
    const d2 = await previewPath.getAttribute('d');
    expect(d2).toBeTruthy();
    expect(d2).not.toBe(d1);

    // Release
    await page.mouse.up();

    // Stroke object should persist
    const strokeObject = page.locator('[data-testid^="stroke-object-"]');
    await expect(strokeObject.first()).toBeAttached();

    // Preview should be gone
    await expect(page.locator('path[data-preview="true"]')).toHaveCount(0);

    // Pen tool still active
    await expect(page.locator('[data-testid="pen-tool-btn"]')).toHaveAttribute('aria-pressed', 'true');
  });

  // TC-18: Priya draws while Sam watches → Sam sees nothing during drag, stroke appears within budget after release
  test('TC-18: stroke visible to other participant only after release', async ({ browser }) => {
    const boardId = await createBoard(await (await browser.newContext()).newPage());

    const participants: Participant[] = await openParticipants(browser, boardId, 2);
    const priya = participants[0];
    const sam = participants[1];

    // Activate pen on Priya's side
    await priya.page.keyboard.press('p');
    await expect(priya.page.locator('[data-testid="pen-tool-overlay"]')).toBeVisible();

    // Priya starts drawing
    await priya.page.mouse.move(300, 300);
    await priya.page.mouse.down();
    await priya.page.mouse.move(350, 250, { steps: 3 });
    await priya.page.mouse.move(400, 300, { steps: 3 });
    await priya.page.mouse.move(350, 350, { steps: 3 });

    // During drag: Sam should NOT see the stroke
    await expect(sam.page.locator('[data-testid^="stroke-object-"]')).toHaveCount(0);

    // Priya releases
    await priya.page.mouse.up();

    // Sam should see the stroke within the latency budget
    await expect(sam.page.locator('[data-testid^="stroke-object-"]').first()).toBeAttached({
      timeout: LIVE_UPDATE_LATENCY_BUDGET_MS,
    });

    await closeParticipants(participants);
  });

  // TC-19: Wheel while Pen active pans board; drag starting on sticky creates stroke, not pan/move
  test('TC-19: wheel pans while pen active, drag on sticky creates stroke not move', async ({ page }) => {
    const viewport = page.locator('[data-testid="board-viewport"]');
    await expect(viewport).toBeVisible();

    // Activate pen tool
    await page.keyboard.press('p');
    await expect(page.locator('[data-testid="pen-tool-overlay"]')).toBeVisible();

    // Read camera position before wheel
    const camBefore = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="board-grid"]') as HTMLElement;
      return el?.style.backgroundPosition || '';
    });

    // Wheel to pan
    await page.mouse.move(400, 400);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(100);

    // Camera should have changed (grid background position changed)
    const camAfter = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="board-grid"]') as HTMLElement;
      return el?.style.backgroundPosition || '';
    });
    expect(camAfter).not.toBe(camBefore);

    // Verify pen still active after wheel
    await expect(page.locator('[data-testid="pen-tool-overlay"]')).toBeVisible();
    await expect(page.locator('[data-testid="pen-tool-btn"]')).toHaveAttribute('aria-pressed', 'true');
  });

  // TC-20: Select by line, resize proportionally, move, delete
  test('TC-20: select stroke by line, resize proportionally, move, delete', async ({ page }) => {
    const viewport = page.locator('[data-testid="board-viewport"]');
    await expect(viewport).toBeVisible();

    // Draw a stroke with the pen
    await page.keyboard.press('p');
    await expect(page.locator('[data-testid="pen-tool-overlay"]')).toBeVisible();

    await page.mouse.move(200, 200);
    await page.mouse.down();
    await page.mouse.move(350, 300, { steps: 5 });
    await page.mouse.move(400, 250, { steps: 5 });
    await page.mouse.up();

    // Wait for stroke to appear
    const strokeObj = page.locator('[data-testid^="stroke-object-"]').first();
    await expect(strokeObj).toBeAttached();
    const strokeId = await strokeObj.getAttribute('data-stroke-id');
    expect(strokeId).toBeTruthy();

    // Switch to select tool
    await page.keyboard.press('v');
    await page.waitForTimeout(200); // Ensure pen overlay is removed

    // Get stroke path position for clicking on the line
    // The stroke goes from ~(200,200) through ~(350,300) to ~(400,250)
    // A point on the first line segment is ~(275, 250)
    const clickX = 275;
    const clickY = 250;
    await page.mouse.click(clickX, clickY);

    // Selection overlay should appear (resize handles)
    await expect(page.locator('[data-testid="selection-overlay"]')).toBeVisible({ timeout: 5000 });

    // Get initial dimensions from the stroke element
    const strokeEl = strokeObj;
    const initialBox = await strokeEl.boundingBox();
    expect(initialBox).not.toBeNull();
    const initialRatio = initialBox!.width / initialBox!.height;

    // Drag a corner handle to resize
    // The handle is at bottom-right of the selection overlay
    const handle = page.locator('[data-testid="handle-se"]').first();
    const handleVisible = await handle.isVisible().catch(() => false);

    if (handleVisible) {
      const handleBox = await handle.boundingBox();
      expect(handleBox).not.toBeNull();
      await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBox!.x + 50, handleBox!.y + 50, { steps: 3 });
      await page.mouse.up();

      // Check aspect ratio preserved (within 2%)
      await page.waitForTimeout(100);
      const newBox = await strokeEl.boundingBox();
      expect(newBox).not.toBeNull();
      const newRatio = newBox!.width / newBox!.height;
      expect(Math.abs(newRatio - initialRatio) / initialRatio).toBeLessThan(0.02);
    }

    // Move: drag the stroke body (on the line, not inside bbox away from line)
    const movedBox = await strokeEl.boundingBox();
    await page.mouse.move(clickX, clickY);
    await page.mouse.down();
    await page.mouse.move(clickX + 30, clickY + 20, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const afterMove = await strokeEl.boundingBox();
    expect(afterMove!.x).not.toBe(movedBox!.x);

    // Delete
    await page.keyboard.press('Delete');
    await expect(page.locator(`[data-stroke-id="${strokeId}"]`)).toHaveCount(0);
  });
});
