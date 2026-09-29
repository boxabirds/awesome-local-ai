import { test, expect } from '@playwright/test';
import { createAndGotoBoard } from './helpers/create-board';
import {
  getPenToolButton,
  getPenToolOverlay,
  getPenToolbar,
  getPenPreview,
  getStrokes,
  getStrokeIds,
  drawWithPen,
  drawWithPenOptions,
  getStrokeDocState,
} from './helpers/pen';
import { getWorldLayerData } from './helpers/board';
import { openParticipants, closeParticipants, newE2eBoardId } from './helpers/participants';
import { seedSticky, getNoteWorldPos } from './helpers/sticky';

const within = (ms = 6000) => ({ timeout: ms });

test.describe('Pen tool: annotate, share, tidy up', () => {
  test('TC-17: draw a stroke; preview path present during drag; stroke persists after release', async ({ page }) => {
    await createAndGotoBoard(page);

    // Activate pen
    await getPenToolButton(page).click();
    await expect(getPenToolOverlay(page)).toBeVisible();
    await expect(getPenToolbar(page)).toBeVisible();

    // Start drawing
    await page.mouse.move(400, 300);
    await page.mouse.down();

    // Move slowly — check preview appears
    await page.mouse.move(450, 320, { steps: 5 });
    await page.mouse.move(500, 340, { steps: 5 });

    // Preview path should be visible during drag
    const preview = getPenPreview(page);
    await expect(preview).toBeVisible(within());

    // Check the d attribute changes on consecutive frames
    const d1 = await preview.locator('path').getAttribute('d');
    await page.mouse.move(550, 360, { steps: 3 });
    await page.waitForTimeout(50); // let rAF fire
    const d2 = await preview.locator('path').getAttribute('d');
    expect(d1).not.toBeNull();
    expect(d2).not.toBeNull();
    expect(d2).not.toBe(d1); // path grew

    // Release
    await page.mouse.up();

    // Stroke object should exist in DOM
    await expect(getStrokes(page)).toHaveCount(1, within());
    // Preview should be gone
    await expect(preview).not.toBeVisible();
  });

  test('TC-18: other participant sees nothing during drag, sees stroke after release', async ({ browser }) => {
    const participants = await openParticipants(browser, newE2eBoardId(), 2);
    const priya = participants[0];
    const sam = participants[1];

    // Sam should see 0 strokes
    await expect(getStrokes(sam.page)).toHaveCount(0);

    // Priya activates pen and starts drawing
    await getPenToolButton(priya.page).click();
    await priya.page.mouse.move(400, 300);
    await priya.page.mouse.down();
    await priya.page.mouse.move(450, 350, { steps: 5 });
    await priya.page.mouse.move(500, 300, { steps: 5 });

    // During drag, Sam should see nothing
    await expect(getStrokes(sam.page)).toHaveCount(0);

    // Release
    await priya.page.mouse.up();

    // Sam should see the stroke within 1 second (LIVE_UPDATE_LATENCY_BUDGET_MS)
    await expect(getStrokes(sam.page)).toHaveCount(1, { timeout: 1000 });

    // Both should see it
    await expect(getStrokes(priya.page)).toHaveCount(1);

    await closeParticipants(participants);
  });

  test('TC-19: wheel while Pen active pans the board; drag on a sticky creates stroke, not a move', async ({ page }) => {
    await createAndGotoBoard(page);

    // Seed a sticky note on the board
    const stickyId = await seedSticky(page, 640, 400);

    // Activate pen
    await getPenToolButton(page).click();
    await expect(getPenToolOverlay(page)).toBeVisible();

    // Move mouse to center of board (away from toolbar) so wheel events hit the pen overlay
    await page.mouse.move(640, 400);

    // Get camera before wheel
    const camBefore = await getWorldLayerData(page);

    // Wheel (scroll down) should pan the board
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(100);

    const camAfter = await getWorldLayerData(page);
    // Camera should have panned (y changed)
    expect(camAfter.y).not.toBe(camBefore.y);

    // Now drag starting on the sticky: should create a stroke, NOT move the sticky
    const stickyBefore = await page.evaluate((id) => {
      const doc = (window as any).__vidi6?.doc;
      if (!doc) return null;
      const m = doc.getMap('objects').get(id);
      if (!m) return null;
      return { x: m.get('x'), y: m.get('y') };
    }, stickyId);

    if (!stickyBefore) throw new Error('Sticky not found in doc before drag');

    // Get stroke count before
    const strokesBefore = await getStrokeIds(page);

    // Drag from the sticky position
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(700, 450, { steps: 5 });
    await page.mouse.up();

    // A new stroke should be created
    await expect(getStrokes(page)).toHaveCount(strokesBefore.length + 1, within());

    // The sticky should NOT have moved
    const stickyAfter = await page.evaluate((id) => {
      const doc = (window as any).__vidi6?.doc;
      if (!doc) return null;
      const m = doc.getMap('objects').get(id);
      if (!m) return null;
      return { x: m.get('x'), y: m.get('y') };
    }, stickyId);
    expect(stickyAfter!.x).toBe(stickyBefore!.x);
    expect(stickyAfter!.y).toBe(stickyBefore!.y);
  });

  test('TC-20: select by line, resize proportionally, move, delete', async ({ page }) => {
    await createAndGotoBoard(page);

    // Draw a diagonal stroke
    const strokeId = await drawWithPen(page, [
      { x: 300, y: 300 },
      { x: 350, y: 350 },
      { x: 400, y: 400 },
      { x: 450, y: 350 },
      { x: 500, y: 300 },
    ]);

    // Switch to select tool
    await page.keyboard.press('v');

    // Click on the stroke line (close to the path)
    // The path goes through ~(400, 400) world, so screen should be close to that
    await page.mouse.click(400, 400);

    // Stroke should be selected
    const strokeEl = page.locator(`[data-testid="stroke-object"][data-stroke-id="${strokeId}"]`);
    await expect(strokeEl).toHaveAttribute('data-selected', 'true', within());

    // Get initial dimensions
    const stateBefore = await getStrokeDocState(page, strokeId);
    expect(stateBefore).not.toBeNull();
    const ratioBefore = stateBefore!.width / stateBefore!.height;

    // Drag corner handle to resize (bottom-right handle)
    // SelectionOverlay renders handles; we need to drag the SE handle
    const wrapper = page.locator(`[data-testid="stroke-wrapper"][data-stroke-id="${strokeId}"]`);
    const box = await wrapper.boundingBox();
    expect(box).not.toBeNull();

    // Drag from SE corner (approximately at right edge, bottom edge of bounding box)
    // Handles are placed at corners of the selection overlay
    const handleX = box!.x + box!.width;
    const handleY = box!.y + box!.height;

    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(handleX + 40, handleY + 40, { steps: 5 });
    await page.mouse.up();

    // Check aspect ratio is preserved within 1%
    const stateAfterResize = await getStrokeDocState(page, strokeId);
    expect(stateAfterResize).not.toBeNull();
    const ratioAfter = stateAfterResize!.width / stateAfterResize!.height;
    expect(Math.abs(ratioAfter - ratioBefore) / ratioBefore).toBeLessThan(0.01);

    // Thickness unchanged
    expect(stateAfterResize!.thickness).toBe(stateBefore!.thickness);

    // Move the stroke: drag the body
    const centerBefore = { x: stateBefore!.x + stateBefore!.width / 2, y: stateBefore!.y + stateBefore!.height / 2 };
    await page.mouse.move(400, 350);
    await page.mouse.down();
    await page.mouse.move(450, 380, { steps: 5 });
    await page.mouse.up();

    const stateAfterMove = await getStrokeDocState(page, strokeId);
    expect(stateAfterMove!.x).not.toBe(stateAfterResize!.x);

    // Delete the stroke
    await page.keyboard.press('Delete');
    await expect(getStrokes(page)).toHaveCount(0, within());
  });
});
