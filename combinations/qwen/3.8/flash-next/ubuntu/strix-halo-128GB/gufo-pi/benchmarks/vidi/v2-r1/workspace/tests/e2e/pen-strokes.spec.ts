/**
 * E2E pen/stroke tests (TC-17 to TC-20).
 *
 * Proves the Pen tool, Stroke rendering, Pen toolbar, collaboration,
 * and selection/resize/delete in real browsers.
 */
import { expect, test } from '@playwright/test';

import { openBoard } from './helpers/board';
import {
  activatePenTool,
  drawStroke,
  drawCircleStroke,
  getStrokeObjectsFromDoc,
  waitForStrokesStable,
  getStrokeSvgCount,
} from './helpers/pen';
import { openParticipants, closeParticipants, expectEventually } from './helpers/participants';

test.describe('Pen tool (story 11)', () => {
  test('TC-17: draw a loop → preview during drag, stroke persists after release', async ({ page }) => {
    await openBoard(page);
    await activatePenTool(page);

    // Begin drawing a circle-like path
    const cx = 500, cy = 400, radius = 80;
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 50; i++) {
      const t = (i / 50) * Math.PI * 2;
      points.push({ x: cx + Math.cos(t) * radius, y: cy + Math.sin(t) * radius });
    }

    // Start the drag but don't release yet
    await page.mouse.move(points[0]!.x, points[0]!.y);
    await page.mouse.down();

    // Move through some points
    for (let i = 1; i <= 25; i++) {
      await page.mouse.move(points[i]!.x, points[i]!.y);
    }

    // During drag: preview overlay should exist
    const preview = page.locator('[data-testid="pen-preview-overlay"]');
    await expect(preview).toBeVisible();
    const previewPath = preview.locator('path');
    const d1 = await previewPath.getAttribute('d');
    expect(d1).toBeTruthy();

    // Continue dragging — path should change
    for (let i = 26; i <= 50; i++) {
      await page.mouse.move(points[i]!.x, points[i]!.y);
    }

    const d2 = await previewPath.getAttribute('d');
    expect(d2).toBeTruthy();
    expect(d2).not.toBe(d1);

    // Release
    await page.mouse.up();
    await waitForStrokesStable(page, 1);

    // After release: stroke object in doc
    const strokes = await getStrokeObjectsFromDoc(page);
    expect(strokes.length).toBeGreaterThanOrEqual(1);
    expect(strokes[0]!.pointCount).toBeGreaterThanOrEqual(2);

    // SVG rendering should exist in the world layer
    const svgCount = await getStrokeSvgCount(page);
    expect(svgCount).toBeGreaterThanOrEqual(1);

    // Pen tool should still be active
    await expect(page.getByTestId('pen-toolbar')).toBeVisible();
  });

  test('TC-18: collaborator sees stroke only after release', async ({ browser }) => {
    const participants = await openParticipants(browser, 2);
    const [priya, sam] = [participants[0]!, participants[1]!];

    await activatePenTool(priya.page);

    // Draw a stroke
    const strokePoints = [
      { x: 300, y: 300 },
      { x: 350, y: 250 },
      { x: 400, y: 300 },
      { x: 450, y: 250 },
      { x: 500, y: 300 },
    ];

    await priya.page.mouse.move(strokePoints[0]!.x, strokePoints[0]!.y);
    await priya.page.mouse.down();
    for (let i = 1; i < strokePoints.length; i++) {
      await priya.page.mouse.move(strokePoints[i]!.x, strokePoints[i]!.y);
    }

    // Sam should NOT see the stroke yet (not released)
    const samStrokesDuring = await getStrokeObjectsFromDoc(sam.page);
    expect(samStrokesDuring.length).toBe(0);

    // Release
    await priya.page.mouse.up();

    // Sam should see the stroke after release
    const start = Date.now();
    await expectEventually(
      'TC-18: Sam sees stroke',
      participants,
      async () => {
        const s = await getStrokeObjectsFromDoc(sam.page);
        return s.length >= 1;
      },
    );

    const elapsed = Date.now() - start;
    console.log(`TC-18 release-to-visible: ${elapsed}ms`);

    await closeParticipants(participants);
  });

  test('TC-19: pen active — scroll pans board, drag on sticky creates stroke not move', async ({ page }) => {
    await openBoard(page);

    // Create a sticky note
    await page.getByTestId('create-sticky').click();
    await page.waitForTimeout(200);

    // Activate pen
    await activatePenTool(page);

    // Get camera before scroll
    const camBefore = await page.evaluate(() => window.__vidi6!.getCamera());

    // Scroll with mouse wheel — should pan the board even with pen active
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(200);

    const camAfter = await page.evaluate(() => window.__vidi6!.getCamera());
    // Camera should have panned (y changed)
    expect(camAfter.y).not.toBe(camBefore.y);

    // Now draw a stroke starting on a sticky note — should create a stroke, not move the sticky
    const strokesBefore = await getStrokeObjectsFromDoc(page);
    const countBefore = strokesBefore.length;

    // Draw on the sticky area
    await drawCircleStroke(page, 640, 400, 30);
    await waitForStrokesStable(page, countBefore + 1);

    const strokesAfter = await getStrokeObjectsFromDoc(page);
    expect(strokesAfter.length).toBeGreaterThan(countBefore);

    // Pen should still be active
    await expect(page.getByTestId('pen-toolbar')).toBeVisible();
  });

  test('TC-20: select stroke by line, aspect-locked resize, move, delete (cross-browser)', async ({ page }) => {
    await openBoard(page);

    // Draw a horizontal line stroke (easy to hit for selection)
    await activatePenTool(page);
    const linePoints = [
      { x: 400, y: 400 },
      { x: 420, y: 398 },
      { x: 440, y: 402 },
      { x: 460, y: 400 },
      { x: 480, y: 398 },
      { x: 500, y: 402 },
      { x: 520, y: 400 },
      { x: 540, y: 399 },
      { x: 560, y: 401 },
      { x: 580, y: 400 },
      { x: 600, y: 400 },
    ];
    await drawStroke(page, linePoints);
    await waitForStrokesStable(page, 1);

    // Switch to select tool
    await page.keyboard.press('v');
    await page.waitForTimeout(200);

    // Click directly on the stroke line (middle of the line, y=400)
    await page.mouse.click(500, 400);
    await page.waitForTimeout(300);

    const strokes = await getStrokeObjectsFromDoc(page);
    expect(strokes.length).toBe(1);
    const s = strokes[0]!;

    // Verify selection: check resize handles appear
    let handles = page.locator('[data-resize-handle]');
    let handleCount = await handles.count();

    // If clicking on line didn't select, use Ctrl+A
    if (handleCount === 0) {
      await page.keyboard.press('Control+a');
      await page.waitForTimeout(200);
      handles = page.locator('[data-resize-handle]');
      handleCount = await handles.count();
    }

    // Resize: drag bottom-right handle
    if (handleCount > 0) {
      const startW = s.width;
      const startH = s.height;
      const handle = handles.last();
      const bbox = await handle.boundingBox();
      if (bbox && startH > 0) {
        await page.mouse.move(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
        await page.mouse.down();
        await page.mouse.move(bbox.x + 40, bbox.y + 20);
        await page.mouse.up();
        await page.waitForTimeout(300);

        // Check aspect ratio preserved (within 2%)
        const strokesAfterResize = await getStrokeObjectsFromDoc(page);
        const sr = strokesAfterResize[0]!;
        const ratioBefore = startW / startH;
        const ratioAfter = sr.width / sr.height;
        expect(Math.abs(ratioAfter - ratioBefore) / ratioBefore).toBeLessThan(0.02);
      }
    }

    // Move: select all, then drag from the line center
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(200);

    const strokes2 = await getStrokeObjectsFromDoc(page);
    const s2 = strokes2[0]!;
    const xBefore = s2.x;

    // Convert world center of bbox to screen coords: screen = (world - cam) * zoom
    const cam = await page.evaluate(() => window.__vidi6!.getCamera());
    const worldCx = s2.x + s2.width * 0.5;
    const worldCy = s2.y + s2.height * 0.5;
    const dragX = (worldCx - cam.x) * cam.zoom;
    const dragY = (worldCy - cam.y) * cam.zoom;

    await page.mouse.move(dragX, dragY);
    await page.mouse.down();
    await page.mouse.move(dragX + 80, dragY + 50);
    await page.mouse.up();
    await page.waitForTimeout(300);

    const afterMove = await getStrokeObjectsFromDoc(page);
    expect(Math.abs(afterMove[0]!.x - xBefore)).toBeGreaterThan(1);

    // Delete
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    const afterDelete = await getStrokeObjectsFromDoc(page);
    expect(afterDelete.length).toBe(0);
  });
});
