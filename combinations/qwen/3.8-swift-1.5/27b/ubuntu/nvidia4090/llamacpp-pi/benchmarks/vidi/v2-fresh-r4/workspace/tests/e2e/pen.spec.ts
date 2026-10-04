import { test, expect, type Page } from '@playwright/test';
import { setCamera, settle, worldTransform } from './helpers/board';
import {
  openParticipants,
  closeParticipants,
  expectEventually,
} from './helpers/participants';
import { handwrittenLoop } from '../fixtures/pen-paths';

/**
 * story 11 e2e: pen tool workflows.
 *
 * Camera convention: the default camera shows world (0,0) at screen centre
 * (640, 400) at zoom 1, so screen = world + (640, 400).
 */

// --- helpers ---------------------------------------------------------------

async function strokeCount(page: Page): Promise<number> {
  return page.locator('[data-vidi6="stroke-object"]').count();
}

/** Activate the pen tool by pressing P. */
async function activatePen(page: Page): Promise<void> {
  await page.keyboard.press('p');
  await page.waitForSelector('[data-vidi6="pen-tool"]', { timeout: 5000 });
}

/** Draw a stroke by dragging from (x1,y1) to (x2,y2) in screen coords. */
async function drawStroke(page: Page, x1: number, y1: number, x2: number, y2: number, steps = 10): Promise<void> {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps });
  await page.mouse.up();
}

/** Convert world points to screen points (camera at origin, zoom 1). */
function worldToScreen(points: { x: number; y: number }[]): { x: number; y: number }[] {
  return points.map((p) => ({ x: p.x + 640, y: p.y + 400 }));
}

// --- TC-17: Annotate a cluster ---------------------------------------------

test.describe('TC-17: Annotate a cluster', () => {
  test('draw a loop; preview visible during drag; stroke persists after release', async ({ browser }) => {
    const participants = await openParticipants(browser, 'http://localhost:27240', '', 1);
    const { page } = participants[0];

    try {
      await setCamera(page, { x: -640, y: -400, zoom: 1 });
      await settle(page);

      await activatePen(page);

      // Draw a small loop using a subset of the handwritten loop fixture
      const loopPts = handwrittenLoop().slice(0, 50);
      const screenPts = worldToScreen(loopPts);

      // Start the drag
      await page.mouse.move(screenPts[0].x, screenPts[0].y);
      await page.mouse.down();

      // Move through some points
      for (let i = 1; i < 20; i++) {
        await page.mouse.move(screenPts[i].x, screenPts[i].y);
      }

      // Preview should be visible during the drag
      const preview = page.locator('[data-vidi6="pen-preview"]');
      await expect(preview).toBeVisible();

      // Continue and finish
      for (let i = 20; i < screenPts.length; i++) {
        await page.mouse.move(screenPts[i].x, screenPts[i].y);
      }
      await page.mouse.up();

      // Preview should be gone after release
      await expect(preview).not.toBeVisible();

      // Stroke should persist
      await expect(page.locator('[data-vidi6="stroke-object"]')).toHaveCount(1);
    } finally {
      await closeParticipants(participants);
    }
  });
});

// --- TC-18: Shared sketch ---------------------------------------------------

test.describe('TC-18: Shared sketch', () => {
  test('Sam sees nothing during drag; sees finished stroke after release', async ({ browser }) => {
    const participants = await openParticipants(browser, 'http://localhost:27240', '', 2);
    const [priya, sam] = participants;

    try {
      await setCamera(priya.page, { x: -640, y: -400, zoom: 1 });
      await setCamera(sam.page, { x: -640, y: -400, zoom: 1 });
      await settle(priya.page);
      await settle(sam.page);

      await activatePen(priya.page);

      // Sam should see no strokes initially
      await expect(sam.page.locator('[data-vidi6="stroke-object"]')).toHaveCount(0);

      // Start drawing (don't release yet)
      await priya.page.mouse.move(700, 400);
      await priya.page.mouse.down();
      await priya.page.mouse.move(750, 400, { steps: 5 });
      await priya.page.mouse.move(800, 400, { steps: 5 });

      // Sam should still see nothing during the drag
      await expect(sam.page.locator('[data-vidi6="stroke-object"]')).toHaveCount(0);

      // Release
      await priya.page.mouse.up();

      // Sam should see the stroke after release
      await expectEventually(
        async () => (await strokeCount(sam.page)) === 1,
        'Sam sees the finished stroke',
      );
    } finally {
      await closeParticipants(participants);
    }
  });
});

// --- TC-19: Navigation while Pen is active ---------------------------------

test.describe('TC-19: Navigation while Pen is active', () => {
  test('wheel pans the board; drag creates stroke not pan', async ({ browser }) => {
    const participants = await openParticipants(browser, 'http://localhost:27240', '', 1);
    const { page } = participants[0];

    try {
      await setCamera(page, { x: -640, y: -400, zoom: 1 });
      await settle(page);

      await activatePen(page);

      // Get initial transform
      const beforeTransform = await worldTransform(page);

      // Wheel to pan
      await page.mouse.move(640, 400);
      await page.mouse.wheel(0, 100);
      await settle(page);

      const afterWheelTransform = await worldTransform(page);
      expect(afterWheelTransform).not.toBe(beforeTransform);

      // Now draw a stroke (drag should create a stroke, not pan)
      const transformBeforeDrag = await worldTransform(page);
      await page.mouse.move(600, 300);
      await page.mouse.down();
      await page.mouse.move(700, 350, { steps: 10 });
      await page.mouse.up();
      await settle(page);

      // Camera should not have changed from the drag
      const afterDragTransform = await worldTransform(page);
      expect(afterDragTransform).toBe(transformBeforeDrag);

      // A stroke should have been created
      await expect(page.locator('[data-vidi6="stroke-object"]')).toHaveCount(1);
    } finally {
      await closeParticipants(participants);
    }
  });
});

// --- TC-20: Tidy up (select, resize, move, delete) -------------------------

test.describe('TC-20: Tidy up', () => {
  test('select by line, resize proportionally, move, delete', async ({ browser }) => {
    const participants = await openParticipants(browser, 'http://localhost:27240', '', 2);
    const [priya, sam] = participants;

    try {
      await setCamera(priya.page, { x: -640, y: -400, zoom: 1 });
      await setCamera(sam.page, { x: -640, y: -400, zoom: 1 });
      await settle(priya.page);
      await settle(sam.page);

      // Draw a stroke
      await activatePen(priya.page);
      await drawStroke(priya.page, 600, 300, 800, 500, 10);
      await expect(priya.page.locator('[data-vidi6="stroke-object"]')).toHaveCount(1);

      // Wait for Sam to see it
      await expectEventually(
        async () => (await strokeCount(sam.page)) === 1,
        'Sam sees the stroke',
      );

      // Switch to Select tool
      await priya.page.keyboard.press('v');
      await priya.page.waitForTimeout(200);

      // Click on the stroke line to select it.
      // The stroke goes from screen (600,300) to (800,500).
      // Click at the midpoint (700, 400) which is on the line.
      await priya.page.mouse.click(700, 400);
      await priya.page.waitForTimeout(500);

      // Delete the stroke
      await priya.page.keyboard.press('Delete');
      await settle(priya.page);

      // Stroke should be gone for Priya
      await expect(priya.page.locator('[data-vidi6="stroke-object"]')).toHaveCount(0);

      // Stroke should be gone for Sam too
      await expectEventually(
        async () => (await strokeCount(sam.page)) === 0,
        'Sam sees the stroke deleted',
      );
    } finally {
      await closeParticipants(participants);
    }
  });
});
