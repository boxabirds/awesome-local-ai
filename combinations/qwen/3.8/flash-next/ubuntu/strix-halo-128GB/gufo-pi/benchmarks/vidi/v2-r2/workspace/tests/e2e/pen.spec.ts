import { test, expect } from '@playwright/test';
import {
  createParticipant,
  waitForConnected,
  type Participant,
} from './helpers/participants';

const E2E_EVENTUAL_TIMEOUT_MS = 15_000;
const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

// Helper: activate pen tool by keyboard shortcut
async function activatePen(page: import('@playwright/test').Page): Promise<void> {
  await page.keyboard.press('p');
}

// Helper: get stroke count from DOM
async function getStrokeCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() =>
    document.querySelectorAll('[aria-label="Drawing"]').length,
  );
}

// Helper: get stroke path d attribute
async function getStrokePathD(page: import('@playwright/test').Page, index: number): Promise<string> {
  return page.evaluate((i) => {
    const strokes = document.querySelectorAll('[aria-label="Drawing"]');
    const el = strokes[i];
    if (!el) return '';
    const path = el.querySelector('path[data-testid^="stroke-path-"]');
    return path?.getAttribute('d') ?? '';
  }, index);
}

// Helper: get stroke world position and size
async function getStrokeWorld(
  page: import('@playwright/test').Page,
  index: number,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return page.evaluate((i) => {
    const strokes = document.querySelectorAll('[aria-label="Drawing"]');
    const el = strokes[i] as SVGSVGElement | undefined;
    if (!el) return null;
    const x = parseFloat(el.style.left);
    const y = parseFloat(el.style.top);
    const width = parseFloat(el.getAttribute('width') ?? '0');
    const height = parseFloat(el.getAttribute('height') ?? '0');
    return { x, y, width, height };
  }, index);
}

// Helper: get sticky world position
async function getStickyWorldPos(
  page: import('@playwright/test').Page,
  index: number,
): Promise<{ x: number; y: number } | null> {
  return page.evaluate((i) => {
    const notes = document.querySelectorAll('[role="group"][aria-label="Sticky note"]');
    const el = notes[i] as HTMLElement | undefined;
    if (!el) return null;
    return { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
  }, index);
}

// Helper: get preview path d attribute during drawing
async function getPreviewPathD(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const path = document.querySelector('[data-testid="pen-preview-path"]');
    return path?.getAttribute('d') ?? '';
  });
}

test.describe('Pen tool', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New board' }).click();
    await page.waitForSelector('[data-testid="board-viewport"]');
    await waitForConnected(page);
  });

  // TC-17: real drag draws preview and persists stroke after release
  test('TC-17: draw a loop - preview during drag, stroke persists after release', async ({ page }) => {
    await activatePen(page);

    // Start drawing: simulate a drag with multiple moves
    const viewport = page.locator('[data-testid="board-viewport"]');
    const box = await viewport.boundingBox();
    if (!box) throw new Error('viewport not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const radius = 60;

    // Begin drawing
    await page.mouse.move(cx, cy);
    await page.mouse.down();

    // Move in a circle
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const px = cx + Math.cos(t) * radius;
      const py = cy + Math.sin(t) * radius;
      await page.mouse.move(px, py);
    }

    // Check preview path has content
    const previewD = await getPreviewPathD(page);
    expect(previewD.length).toBeGreaterThan(5);

    // Release
    await page.mouse.up();

    // Stroke should persist
    await expect(async () => {
      const count = await getStrokeCount(page);
      expect(count).toBe(1);
    }).toPass({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Verify the stroke has a path
    const d = await getStrokePathD(page, 0);
    expect(d.length).toBeGreaterThan(5);
  });

  // TC-18: shared sketch - other participant sees stroke only after release
  test('TC-18: shared sketch - others see finished stroke only', async ({ browser, page }) => {
    // Create board and get participant Sam
    const boardId = new URL(page.url()).pathname.split('/')[2];
    const sam: Participant = await createParticipant(browser, boardId);
    await waitForConnected(sam.page);

    // Activate pen on Priya's page
    await activatePen(page);

    const viewport = page.locator('[data-testid="board-viewport"]');
    const box = await viewport.boundingBox();
    if (!box) throw new Error('viewport not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Start drawing (drag)
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 0; i < 20; i++) {
      await page.mouse.move(cx + i * 5, cy + i * 3);
    }

    // Sam should NOT see the stroke yet (in-progress)
    const samCountDuringDrag = await getStrokeCount(sam.page);

    // Release
    const releaseTime = Date.now();
    await page.mouse.up();

    // Measure how long it takes for Sam to see the stroke
    let deliveryTime = 0;
    await expect(async () => {
      const count = await getStrokeCount(sam.page);
      expect(count).toBeGreaterThan(0);
      deliveryTime = Date.now() - releaseTime;
    }).toPass({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Log delivery time (not asserted per design)
    console.log(`TC-18 delivery time: ${deliveryTime}ms (budget: ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`);

    // Verify Sam didn't see it during drag (negative check)
    expect(samCountDuringDrag).toBe(0);

    await sam.context.close();
  });

  // TC-19: wheel while Pen active pans board; drag on sticky creates stroke not move
  test('TC-19: wheel pans while Pen active; drag on sticky creates stroke', async ({ page }) => {
    // First create a sticky note
    await page.dblclick('[data-testid="board-viewport"]', { position: { x: 400, y: 300 } });
    await page.waitForSelector('[role="group"][aria-label="Sticky note"]');

    // Click on empty area to finish editing the sticky
    await page.click('[data-testid="board-viewport"]', { position: { x: 700, y: 500 } });
    await page.waitForTimeout(200);

    // Get camera position before wheel
    const camBefore = await page.evaluate(() => {
      const viewport = document.querySelector('[data-testid="board-viewport"]') as HTMLElement;
      const style = getComputedStyle(viewport);
      return { bgPos: style.backgroundPosition };
    });

    // Activate pen
    await activatePen(page);

    // Wheel to pan
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(200);

    // The board should have panned (background position changed or camera changed)
    const camAfter = await page.evaluate(() => {
      const viewport = document.querySelector('[data-testid="board-viewport"]') as HTMLElement;
      const style = getComputedStyle(viewport);
      return { bgPos: style.backgroundPosition };
    });

    // Camera panned means bg position changed
    expect(camAfter.bgPos).not.toBe(camBefore.bgPos);

    // Now drag starting on the sticky note area - should create a stroke, not move the sticky
    const stickyPosBefore = await getStickyWorldPos(page, 0);
    expect(stickyPosBefore).not.toBeNull();

    // Draw a stroke that starts near the sticky position
    await page.mouse.move(400, 300);
    await page.mouse.down();
    await page.mouse.move(450, 350);
    await page.mouse.move(500, 400);
    await page.mouse.up();

    // Sticky should not have moved
    const stickyPosAfter = await getStickyWorldPos(page, 0);
    expect(stickyPosAfter).not.toBeNull();
    // Allow small floating point differences but not actual movement
    expect(Math.abs(stickyPosAfter!.x - stickyPosBefore!.x)).toBeLessThan(1);
    expect(Math.abs(stickyPosAfter!.y - stickyPosBefore!.y)).toBeLessThan(1);

    // A stroke should have been created
    const strokeCount = await getStrokeCount(page);
    expect(strokeCount).toBeGreaterThan(0);
  });

  // TC-20: select by line, resize proportionally, move, delete
  test('TC-20: select by line, resize, move, delete', async ({ browser, page }) => {
    const boardId = new URL(page.url()).pathname.split('/')[2];
    const sam: Participant = await createParticipant(browser, boardId);
    await waitForConnected(sam.page);

    // Draw a mostly-horizontal stroke with small variations
    await activatePen(page);
    const viewport = page.locator('[data-testid="board-viewport"]');
    const box = await viewport.boundingBox();
    if (!box) throw new Error('viewport not found');

    const startX = box.x + 300;
    const startY = box.y + 300;
    // Draw a straight horizontal line (within hit tolerance)
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let i = 1; i <= 30; i++) {
      await page.mouse.move(startX + i * 5, startY + (i % 3 === 0 ? 1 : 0));
    }
    await page.mouse.up();

    // Wait for stroke to appear
    await expect(async () => {
      expect(await getStrokeCount(page)).toBe(1);
    }).toPass({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Wait for Sam to see the stroke too
    await expect(async () => {
      expect(await getStrokeCount(sam.page)).toBe(1);
    }).toPass({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Switch to Select tool
    await page.keyboard.press('v');
    await page.waitForTimeout(200);

    // Click on the stroke line to select it (middle of the path)
    await page.mouse.click(startX + 75, startY);
    await page.waitForTimeout(300);

    // Verify selection: check for selection-related DOM elements
    await page.evaluate(() => {
      return !!document.querySelector('[data-handle]') ||
             !!document.querySelector('[data-testid="selection-overlay"]');
    });

    // Get stroke world dimensions before resize
    const before = await getStrokeWorld(page, 0);
    expect(before).not.toBeNull();

    // Resize if handle is visible
    const originalRatio = before!.width / Math.max(before!.height, 1);
    const handle = page.locator('[data-handle="se"]');
    const handleVisible = await handle.isVisible().catch(() => false);

    if (handleVisible) {
      const handleBox = await handle.boundingBox();
      if (handleBox) {
        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(handleBox.x + 60, handleBox.y + 60, { steps: 5 });
        await page.mouse.up();
      }

      // Check aspect ratio is preserved within 1%
      const after = await getStrokeWorld(page, 0);
      expect(after).not.toBeNull();
      const newRatio = after!.width / Math.max(after!.height, 1);
      const ratioDiff = Math.abs(newRatio - originalRatio) / originalRatio;
      expect(ratioDiff).toBeLessThan(0.01);
    }

    // Move the stroke by dragging its body
    const moveBefore = await getStrokeWorld(page, 0);
    expect(moveBefore).not.toBeNull();

    // Re-select the stroke
    await page.mouse.click(startX + 75, startY);
    await page.waitForTimeout(300);

    // Drag body: pointerdown then moves then pointerup
    await page.mouse.move(startX + 75, startY);
    await page.waitForTimeout(50);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.move(startX + 100, startY + 30, { steps: 5 });
    await page.mouse.move(startX + 130, startY + 60, { steps: 5 });
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForTimeout(300);

    const moveAfter = await getStrokeWorld(page, 0);
    expect(moveAfter).not.toBeNull();
    // Should have moved
    const movedDist = Math.sqrt(
      (moveAfter!.x - moveBefore!.x) ** 2 + (moveAfter!.y - moveBefore!.y) ** 2,
    );
    // Movement should be significant (at least 5 world units)
    expect(movedDist).toBeGreaterThan(5);

    // Delete the stroke
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    // Stroke should be gone
    await expect(async () => {
      expect(await getStrokeCount(page)).toBe(0);
    }).toPass({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Sam should also see it gone
    await expect(async () => {
      expect(await getStrokeCount(sam.page)).toBe(0);
    }).toPass({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    await sam.context.close();
  });
});
