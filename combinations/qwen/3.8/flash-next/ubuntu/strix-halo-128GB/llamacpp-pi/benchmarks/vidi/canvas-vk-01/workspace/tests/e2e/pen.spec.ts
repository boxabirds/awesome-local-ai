import { expect, test, type Page } from '@playwright/test';

import { PEN_THICKNESS_WORLD } from '../../src/shared/config';
import { handwrittenLoop, underline } from '../fixtures/pen-paths';
import {
  joinBoard,
  setCamera,
  startBoard,
  LATENCY_BUDGET_MS,
} from './helpers/live';

/**
 * Story 11 e2e: pen tool and stroke object (TC-17 to TC-20).
 *
 * Workflows:
 * - TC-17: Annotate a cluster – real drag with preview, stroke persists after release
 * - TC-18: Shared sketch – drawer sees preview, watcher sees stroke after release only
 * - TC-19: Navigation while Pen active – wheel pans, drag on sticky draws over it
 * - TC-20: Tidy up – select by line, proportional resize, move, delete across two clients
 */

const PIN = { x: 0, y: 0, zoom: 1 };

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function strokeIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="stroke-object-"]')].map((element) =>
      String(element.getAttribute('data-testid')).slice('stroke-object-'.length),
    ),
  );
}

async function strokeBox(page: Page, id: string): Promise<Box> {
  const box = await page.locator(`[data-testid="stroke-object-${id}"]`).boundingBox();
  if (box === null) throw new Error(`stroke ${id} not visible`);
  return box;
}

/**
 * Draw a stroke with real mouse events. Points are screen coordinates (camera at {0,0,1}).
 */
async function drawStroke(page: Page, points: { x: number; y: number }[]): Promise<string> {
  const before = new Set(await strokeIds(page));
  // Switch to pen tool
  await page.keyboard.press('p');
  await expect(page.getByTestId('pen-tool-layer')).toBeVisible();

  // Draw: pointer down, moves, pointer up
  await page.mouse.move(points[0]!.x, points[0]!.y);
  await page.mouse.down();
  for (let i = 1; i < points.length; i += 1) {
    await page.mouse.move(points[i]!.x, points[i]!.y);
  }
  await page.mouse.up();

  // Wait for stroke to appear
  let id = '';
  await expect
    .poll(
      async () => {
        id = (await strokeIds(page)).find((candidate) => !before.has(candidate)) ?? '';
        return id;
      },
      { timeout: 5000 },
    )
    .not.toBe('');
  return id;
}

test.describe('TC-17: real drag draws a stroke with preview', () => {
  test('preview path updates during drag; stroke persists after release', async ({ page }) => {
    await startBoard(page);
    await setCamera(page, PIN);

    // Use a subset of handwrittenLoop (first ~50 points) scaled to viewport
    const raw = handwrittenLoop().slice(0, 50);
    const points = raw.map((p) => ({ x: 200 + p.x * 0.5, y: 150 + p.y * 0.5 }));

    // Switch to pen
    await page.keyboard.press('p');
    await expect(page.getByTestId('pen-tool-layer')).toBeVisible();

    // Start drag
    await page.mouse.move(points[0]!.x, points[0]!.y);
    await page.mouse.down();

    // Move partway
    const mid = Math.floor(points.length / 2);
    for (let i = 1; i <= mid; i += 1) {
      await page.mouse.move(points[i]!.x, points[i]!.y);
    }

    // Check preview path exists and has content during drag
    const preview = page.getByTestId('pen-preview');
    await expect(preview).toBeVisible();
    const dMid = await preview.locator('path').getAttribute('d');
    expect(dMid).toBeTruthy();
    expect(dMid!.length).toBeGreaterThan(10);

    // Continue moving
    for (let i = mid + 1; i < points.length; i += 1) {
      await page.mouse.move(points[i]!.x, points[i]!.y);
    }

    // d attribute should have changed
    const dEnd = await preview.locator('path').getAttribute('d');
    expect(dEnd).not.toBe(dMid);

    // Release
    await page.mouse.up();

    // Stroke should persist in the DOM
    const ids = await strokeIds(page);
    expect(ids.length).toBeGreaterThanOrEqual(1);

    // The stroke object element should be visible
    const strokeEl = page.locator(`[data-testid="stroke-object-${ids[0]}"]`);
    await expect(strokeEl).toBeVisible();

    // Preview should be cleared
    const dAfter = await preview.locator('path').getAttribute('d');
    expect(dAfter === '' || dAfter === null).toBeTruthy();
  });
});

test.describe('TC-18: shared sketch – watcher sees stroke only after release', () => {
  test('drawer sees preview during drag, watcher sees nothing until release', async ({
    browser,
  }) => {
    const pageA = await browser.newPage();
    const pageB = await browser.newPage();

    // A creates a board
    const boardId = await startBoard(pageA);
    await setCamera(pageA, PIN);
    // B joins the same board
    await joinBoard(pageB, boardId);
    await setCamera(pageB, PIN);

    // Use underline fixture for a simple horizontal draw
    const raw = underline().slice(0, 30);
    const points = raw.map((p) => ({ x: 100 + p.x * 0.5, y: 200 + p.y * 0.5 }));

    // A switches to pen
    await pageA.keyboard.press('p');
    await expect(pageA.getByTestId('pen-tool-layer')).toBeVisible();

    // A starts drawing
    await pageA.mouse.move(points[0]!.x, points[0]!.y);
    await pageA.mouse.down();
    for (let i = 1; i <= 15; i += 1) {
      await pageA.mouse.move(points[i]!.x, points[i]!.y);
    }
    // Force a microtask so B updates
    await pageB.waitForTimeout(200);

    // B should see NO stroke yet (preview is local only)
    const strokesOnB = await strokeIds(pageB);
    expect(strokesOnB.length).toBe(0);

    // A finishes drawing
    for (let i = 16; i < points.length; i += 1) {
      await pageA.mouse.move(points[i]!.x, points[i]!.y);
    }
    await pageA.mouse.up();

    // B sees the stroke within the latency budget
    await pageB.waitForTimeout(LATENCY_BUDGET_MS);
    const strokesAfterB = await strokeIds(pageB);
    expect(strokesAfterB.length).toBeGreaterThanOrEqual(1);

    await pageA.close();
    await pageB.close();
  });
});

test.describe('TC-19: navigation while Pen active; pen over sticky draws not moves', () => {
  test('wheel pans board, drag on sticky creates stroke (no move)', async ({ page }) => {
    await startBoard(page);
    await setCamera(page, PIN);

    // Create a sticky note at a known location (double-click at 400, 300)
    await page.mouse.dblclick(400, 300);
    await expect(page.getByTestId('sticky-textarea')).toBeVisible();
    // Type something so we can identify it later
    await page.keyboard.type('Sticky');
    await page.keyboard.press('Escape');

    // Switch to pen
    await page.keyboard.press('p');
    await expect(page.getByTestId('pen-tool-layer')).toBeVisible();

    // Wheel: should pan the board, not draw
    await page.mouse.move(400, 400);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(100);
    // No strokes created by wheel
    const idsAfterWheel = await strokeIds(page);
    expect(idsAfterWheel.length).toBe(0);

    // Draw over the sticky note: creates a stroke, does NOT move the sticky
    const noteBefore = await page
      .locator('[data-note-id]')
      .boundingBox();

    const drawPts = [
      { x: 350, y: 270 },
      { x: 360, y: 265 },
      { x: 375, y: 260 },
      { x: 390, y: 268 },
      { x: 410, y: 275 },
      { x: 430, y: 272 },
      { x: 445, y: 268 },
    ];

    await page.mouse.move(drawPts[0]!.x, drawPts[0]!.y);
    await page.mouse.down();
    for (let i = 1; i < drawPts.length; i += 1) {
      await page.mouse.move(drawPts[i]!.x, drawPts[i]!.y);
    }
    await page.mouse.up();

    // Stroke created
    const idsAfterDraw = await strokeIds(page);
    expect(idsAfterDraw.length).toBeGreaterThanOrEqual(1);

    // Sticky did NOT move
    const noteAfter = await page.locator('[data-note-id]').boundingBox();
    if (noteBefore && noteAfter) {
      expect(Math.abs(noteAfter.x - noteBefore.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(noteAfter.y - noteBefore.y)).toBeLessThanOrEqual(2);
    }
  });
});

test.describe('TC-20: tidy up – select, resize (aspect-locked), move, delete', () => {
  test('resize preserves aspect, move repositions, delete removes on both clients', async ({
    browser,
  }) => {
    const pageA = await browser.newPage();
    const pageB = await browser.newPage();

    const boardId = await startBoard(pageA);
    await setCamera(pageA, PIN);
    await joinBoard(pageB, boardId);
    await setCamera(pageB, PIN);

    // A draws a simple diagonal stroke with known screen coordinates
    const points = [
      { x: 300, y: 200 },
      { x: 310, y: 210 },
      { x: 325, y: 225 },
      { x: 340, y: 240 },
      { x: 360, y: 260 },
      { x: 380, y: 280 },
      { x: 400, y: 300 },
      { x: 420, y: 320 },
      { x: 440, y: 340 },
      { x: 460, y: 360 },
    ];

    const id = await drawStroke(pageA, points);
    await pageB.waitForTimeout(LATENCY_BUDGET_MS);

    // B sees the stroke
    await expect(pageB.locator(`[data-testid="stroke-object-${id}"]`)).toBeVisible();

    // A: switch to select tool (V)
    await pageA.keyboard.press('v');
    await pageA.waitForTimeout(100);

    // Click directly on the stroke line (midpoint of our diagonal)
    // After simplification, the diagonal line at (380, 280) should still be on the path
    await pageA.mouse.click(380, 280);
    await pageA.waitForTimeout(200);

    // Stroke should be selected (has resize handles)
    const handles = pageA.locator('[data-testid^="resize-handle-"]');
    await expect(handles.first()).toBeVisible({ timeout: 3000 });
    const handleCount = await handles.count();
    expect(handleCount).toBeGreaterThan(0);

    // Get current box for aspect ratio check
    const boxBefore = await strokeBox(pageA, id);
    const aspectBefore = boxBefore.width / boxBefore.height;

    // Drag a corner handle to resize (e.g. corner "se" = bottom-right)
    const corner = pageA.getByTestId('resize-handle-se');
    const cornerBox = await corner.boundingBox();
    if (cornerBox) {
      const fromX = cornerBox.x + cornerBox.width / 2;
      const fromY = cornerBox.y + cornerBox.height / 2;
      await pageA.mouse.move(fromX, fromY);
      await pageA.mouse.down();
      await pageA.mouse.move(fromX + 30, fromY + 25, { steps: 5 });
      await pageA.mouse.up();
      await pageA.waitForTimeout(200);
    }

    // Aspect ratio preserved within 1%
    const boxAfter = await strokeBox(pageA, id);
    const aspectAfter = boxAfter.width / boxAfter.height;
    expect(Math.abs(aspectAfter - aspectBefore) / aspectBefore).toBeLessThan(0.01);

    // Thickness unchanged (check stroke-width attribute on the SVG path)
    const strokeWidth = await pageA
      .locator(`[data-testid="stroke-object-${id}"] svg path`)
      .first()
      .getAttribute('stroke-width');
    // Thickness should still be 2 (medium, default)
    expect(Number(strokeWidth)).toBe(PEN_THICKNESS_WORLD.medium);

    // Move: drag the body of the stroke (the stroke is selected, click on its line to start drag)
    // For a diagonal line, the center of the bbox is approximately on the line
    const midX = boxAfter.x + boxAfter.width / 2;
    const midY = boxAfter.y + boxAfter.height / 2;
    await pageA.mouse.move(midX, midY);
    await pageA.mouse.down();
    await pageA.mouse.move(midX + 60, midY + 40, { steps: 5 });
    await pageA.mouse.up();
    await pageA.waitForTimeout(200);

    // Stroke moved
    const boxMoved = await strokeBox(pageA, id);
    expect(boxMoved.x).toBeGreaterThan(boxAfter.x + 20);

    // Delete: make sure stroke is still selected, press Delete
    await pageA.keyboard.press('Delete');
    await pageA.waitForTimeout(200);

    // Stroke removed on A
    const idsAfterDelete = await strokeIds(pageA);
    expect(idsAfterDelete).not.toContain(id);

    // B also sees deletion within latency
    await pageB.waitForTimeout(LATENCY_BUDGET_MS);
    const idsOnB = await strokeIds(pageB);
    expect(idsOnB).not.toContain(id);

    await pageA.close();
    await pageB.close();
  });
});
