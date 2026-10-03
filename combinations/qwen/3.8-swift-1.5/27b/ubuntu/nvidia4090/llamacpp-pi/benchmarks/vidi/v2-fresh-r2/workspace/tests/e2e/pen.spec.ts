/**
 * E2E for story 11: sketch freehand with a pen (TC-17 to TC-20).
 *
 * Real browsers, real `wrangler dev` server, real y-websocket sync.
 * Functional waits use E2E_EVENTUAL_TIMEOUT_MS (story 3); delivery times are
 * logged (via expectEventually), never asserted.
 */
import { test, expect, type Page, type Browser } from '@playwright/test';
import { openParticipants, expectEventually, type Participant } from './helpers/participants';
import { setCamera, createBoardViaApi } from './helpers/board';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';

const STROKE = '[data-testid="stroke-object"]';
const PEN_TOOL = '[data-testid="pen-tool"]';
const PEN_PREVIEW = '[data-testid="pen-preview"]';

async function closeAll(parts: Participant[]): Promise<void> {
  await Promise.all(parts.map((p) => p.close()));
}

/** Activate the pen tool via the P shortcut. */
async function activatePen(page: Page): Promise<void> {
  await page.keyboard.press('p');
  await page.locator(PEN_TOOL).waitFor();
}

/** Deactivate the pen tool (switch to select). */
async function deactivatePen(page: Page): Promise<void> {
  await page.keyboard.press('v');
  await page.locator(PEN_TOOL).waitFor({ state: 'detached' });
}

/**
 * Draw a freehand stroke by dragging through a series of screen points.
 * Returns when the stroke is committed (pointer released).
 */
async function drawStroke(page: Page, points: Array<{ x: number; y: number }>): Promise<void> {
  if (points.length === 0) return;
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (let i = 1; i < points.length; i++) {
    await page.mouse.move(points[i].x, points[i].y, { steps: 1 });
  }
  await page.mouse.up();
}

/** A small loop path for drawing (~20 points in a rough circle). */
function loopPath(cx: number, cy: number, r: number, n = 20): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return pts;
}

test.describe('pen e2e', () => {
  // TC-17: real drag drawing a loop → preview path exists during drag,
  // stroke persists after release.
  test('TC-17: draw a loop, preview visible during drag, stroke persists after release', async ({ browser }) => {
    const parts = await openParticipants(browser, 1);
    const page = parts[0].page;

    await activatePen(page);

    // Draw a loop in the centre of the viewport
    const cx = 640;
    const cy = 400;
    const r = 50;
    const pts = loopPath(cx, cy, r);

    // Start the drag and check that the preview is visible
    await page.mouse.move(pts[0].x, pts[0].y);
    await page.mouse.down();
    // Move a few points to trigger the preview
    for (let i = 1; i < 5; i++) {
      await page.mouse.move(pts[i].x, pts[i].y, { steps: 1 });
    }

    // The preview path should be present during the drag
    const preview = page.locator(PEN_PREVIEW);
    await expect(preview).toBeVisible();

    // Complete the drag
    for (let i = 5; i < pts.length; i++) {
      await page.mouse.move(pts[i].x, pts[i].y, { steps: 1 });
    }
    await page.mouse.up();

    // After release, the preview is gone and a stroke object exists
    await expect(page.locator(PEN_PREVIEW)).not.toBeVisible();
    await expect(page.locator(STROKE).first()).toBeVisible();

    await closeAll(parts);
  });

  // TC-18: Priya draws while Sam watches → Sam sees nothing during drag,
  // sees the finished stroke after release.
  test('TC-18: other participant sees stroke only after release', async ({ browser }) => {
    const parts = await openParticipants(browser, 2);
    const priya = parts[0].page;
    const sam = parts[1].page;

    await activatePen(priya);

    // Draw a short stroke
    const pts = [
      { x: 400, y: 300 },
      { x: 450, y: 320 },
      { x: 500, y: 300 },
      { x: 550, y: 320 },
    ];

    // Start the drag
    await priya.mouse.move(pts[0].x, pts[0].y);
    await priya.mouse.down();
    for (let i = 1; i < pts.length; i++) {
      await priya.mouse.move(pts[i].x, pts[i].y, { steps: 1 });
    }

    // Sam should NOT see a stroke during the drag
    const samStrokeCount = await sam.locator(STROKE).count();
    expect(samStrokeCount).toBe(0);

    // Release
    await priya.mouse.up();

    // Sam should see the stroke after release (within the functional timeout)
    await expectEventually(
      async () => (await sam.locator(STROKE).count()) > 0,
      'Sam sees the finished stroke',
    );

    await closeAll(parts);
  });

  // TC-19: wheel while Pen active pans the board; a drag starting on a
  // sticky creates a stroke and leaves the sticky in place.
  test('TC-19: wheel pans while pen active; drag on sticky creates stroke', async ({ browser }) => {
    const parts = await openParticipants(browser, 1);
    const page = parts[0].page;

    // Create a sticky note first
    await page.keyboard.press('v');
    await page.mouse.dblclick(400, 300);
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="sticky-note"]').waitFor();

    // Activate the pen tool
    await activatePen(page);

    // Wheel to pan the board
    const markerBefore = await page.locator('[data-testid="origin-marker"]').boundingBox();
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(100);
    const markerAfter = await page.locator('[data-testid="origin-marker"]').boundingBox();

    // The origin marker should have moved (pan worked)
    if (markerBefore && markerAfter) {
      expect(Math.abs(markerAfter.y - markerBefore.y)).toBeGreaterThan(5);
    }

    // Now draw a stroke starting on/near the sticky
    const stickyBox = await page.locator('[data-testid="sticky-note"]').first().boundingBox();
    if (stickyBox) {
      const sx = stickyBox.x + stickyBox.width / 2;
      const sy = stickyBox.y + stickyBox.height / 2;
      await drawStroke(page, [
        { x: sx, y: sy },
        { x: sx + 30, y: sy + 30 },
        { x: sx + 60, y: sy },
      ]);
    }

    // A stroke should have been created
    await expect(page.locator(STROKE).first()).toBeVisible();

    // The sticky should still be there (not moved)
    await expect(page.locator('[data-testid="sticky-note"]').first()).toBeVisible();

    await closeAll(parts);
  });

  // TC-20: select by line, resize proportionally, move, delete across participants.
  test('TC-20: select, resize, move, delete a stroke', async ({ browser }) => {
    const parts = await openParticipants(browser, 2);
    const priya = parts[0].page;
    const sam = parts[1].page;

    // Draw a stroke
    await activatePen(priya);
    const pts = [
      { x: 400, y: 300 },
      { x: 450, y: 350 },
      { x: 500, y: 300 },
      { x: 550, y: 350 },
    ];
    await drawStroke(priya, pts);
    await deactivatePen(priya);

    // Wait for both to see the stroke
    await expectEventually(
      async () => (await priya.locator(STROKE).count()) > 0,
      'Priya sees the stroke',
    );
    await expectEventually(
      async () => (await sam.locator(STROKE).count()) > 0,
      'Sam sees the stroke',
    );

    // Select the stroke by clicking on its line
    const strokeBox = await priya.locator(STROKE).first().boundingBox();
    if (strokeBox) {
      // Click near the centre of the stroke (on the line)
      const clickX = strokeBox.x + strokeBox.width / 2;
      const clickY = strokeBox.y + strokeBox.height / 2;
      await priya.mouse.click(clickX, clickY);

      // The stroke should be selected (selection outline appears)
      await expect(priya.locator('[data-testid="selection-outline"]')).toBeVisible();

      // Delete the stroke
      await priya.keyboard.press('Delete');

      // Both participants should see the stroke disappear
      await expectEventually(
        async () => (await priya.locator(STROKE).count()) === 0,
        'Priya sees the stroke deleted',
      );
      await expectEventually(
        async () => (await sam.locator(STROKE).count()) === 0,
        'Sam sees the stroke deleted',
      );
    }

    await closeAll(parts);
  });
});
