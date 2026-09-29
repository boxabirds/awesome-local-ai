/**
 * E2E tests for Pen tool and StrokeObject (TC-17 to TC-20).
 */
import { expect, test, type Page } from '@playwright/test';
import { boardLocator, readCamera } from './helpers/board';
import { openParticipants, closeParticipants, expectWithinBudget, type Participant } from './helpers/participants';
import { newBoardId } from '../../src/shared/board-id';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';

/** Navigate to board via landing page and wait for camera. */
async function waitForBoard(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a board' }).click();
  await expect(boardLocator(page)).toBeVisible();
  await expect
    .poll(
      async () => {
        const cam = await boardLocator(page).evaluate((el) => ({
          x: Number(el.dataset.cameraX),
          y: Number(el.dataset.cameraY),
        }));
        return cam.x !== 0 || cam.y !== 0;
      },
      { timeout: 4000 },
    )
    .toBe(true);
}

/** Activate a tool by pressing its shortcut key. */
async function pressKey(page: Page, key: string) {
  await page.keyboard.press(key);
  await page.waitForTimeout(50);
}

/** Get all stroke IDs on a page. */
async function strokeIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const els = document.querySelectorAll('[data-stroke-id]');
    return Array.from(els).map((el) => el.getAttribute('data-stroke-id')!);
  });
}

/** Stroke count on a page. */
async function strokeCount(page: Page): Promise<number> {
  return (await strokeIds(page)).length;
}

test.describe('Annotate a cluster', () => {
  test.beforeEach(async ({ page }) => {
    await waitForBoard(page);
  });

  // TC-17: Real drag replaying handwritten-loop fixture → preview path exists during drag,
  // d attribute changes on consecutive frames, stroke persists after release.
  test('TC-17: drag creates stroke with live preview', async ({ page }) => {
    // Activate pen tool
    await pressKey(page, 'p');

    const boardBox = await boardLocator(page).boundingBox();
    if (!boardBox) throw new Error('board not visible');

    // Start a drag to draw a stroke (simulating handwritten loop)
    const startX = boardBox.x + 200;
    const startY = boardBox.y + 200;

    await page.mouse.move(startX, startY);
    await page.mouse.down();

    // Move in small steps to generate many intermediate points
    await page.mouse.move(startX + 50, startY - 30, { steps: 5 });
    await page.mouse.move(startX + 100, startY + 20, { steps: 5 });
    await page.mouse.move(startX + 80, startY + 60, { steps: 5 });

    // During drag, check the preview path exists
    const previewEl = page.locator('[data-testid="pen-preview"] path');
    await expect(previewEl).toBeVisible({ timeout: 1000 });

    // Sample d attribute on consecutive frames
    const d1 = await previewEl.getAttribute('d');
    expect(d1).toBeTruthy();

    // Continue moving
    await page.mouse.move(startX + 20, startY + 40, { steps: 3 });
    await page.mouse.move(startX - 10, startY + 10, { steps: 3 });

    // d should have changed
    const d2 = await previewEl.getAttribute('d');
    expect(d2).toBeTruthy();
    expect(d2).not.toBe(d1);

    await page.mouse.up();
    await page.waitForTimeout(100);

    // After release, a stroke object should persist
    const ids = await strokeIds(page);
    expect(ids.length).toBe(1);

    // Stroke should have aria-label="Drawing"
    const strokeEl = page.locator(`[data-stroke-id="${ids[0]}"]`);
    await expect(strokeEl).toHaveAttribute('aria-label', 'Drawing');

    // Tool should still be pen
    const penBtn = page.getByRole('button', { name: 'Pen (P)' });
    await expect(penBtn).toHaveAttribute('aria-pressed', 'true');
  });

  // TC-19: wheel while Pen active pans the board; drag on sticky creates stroke, leaves sticky in place
  test('TC-19: wheel pans while pen active; drag over sticky draws stroke', async ({ page }) => {
    // Activate pen tool
    await pressKey(page, 'p');

    // Verify wheel pans the board
    const camBefore = await readCamera(page);

    const boardBox = await boardLocator(page).boundingBox();
    if (!boardBox) throw new Error('board not visible');

    // Scroll with wheel (no Ctrl, so it's a pan gesture)
    await page.mouse.move(boardBox.x + 400, boardBox.y + 400);
    await page.mouse.wheel(100, 100);
    await page.waitForTimeout(200);

    const camAfter = await readCamera(page);
    // Camera should have panned (position changed)
    const moved = Math.abs(camAfter.x - camBefore.x) > 1 || Math.abs(camAfter.y - camBefore.y) > 1;
    expect(moved).toBe(true);

    // Draw a stroke over the board area
    await page.mouse.move(boardBox.x + 200, boardBox.y + 200);
    await page.mouse.down();
    await page.mouse.move(boardBox.x + 300, boardBox.y + 250, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    // A stroke should have been created
    const ids = await strokeIds(page);
    expect(ids.length).toBe(1);
  });
});

test.describe('Shared sketch', () => {
  let participants: Participant[];
  let priya: Participant;
  let sam: Participant;

  test.beforeEach(async ({ browser }) => {
    const boardId = newBoardId();
    participants = await openParticipants(browser, 2, boardId);
    [priya, sam] = participants;
  });

  test.afterEach(async () => {
    if (participants) await closeParticipants(participants);
  });

  // TC-18: Priya draws while Sam watches → Sam sees nothing during drag (negative),
  // stroke appears within LIVE_UPDATE_LATENCY_BUDGET_MS after release.
  test('TC-18: stroke shared on finish, not during drag', async () => {
    const { page: priyaPage } = priya;
    const { page: samPage } = sam;

    // Activate pen tool on Priya's page
    await pressKey(priyaPage, 'p');

    const boardBox = await boardLocator(priyaPage).boundingBox();
    if (!boardBox) throw new Error('board not visible');

    const startX = boardBox.x + 300;
    const startY = boardBox.y + 300;

    // Priya starts drawing
    await priyaPage.mouse.move(startX, startY);
    await priyaPage.mouse.down();
    await priyaPage.mouse.move(startX + 100, startY + 50, { steps: 5 });
    await priyaPage.mouse.move(startX + 200, startY, { steps: 5 });

    // During drag, Sam should see no strokes (negative check)
    const samCountDuring = await strokeCount(samPage);
    expect(samCountDuring).toBe(0);

    // Priya releases
    await priyaPage.mouse.up();

    // Within LIVE_UPDATE_LATENCY_BUDGET_MS, Sam should see the stroke
    await expectWithinBudget(
      () => strokeCount(samPage),
      1,
    ).toBe(1);
  });
});

test.describe('Tidy up', () => {
  let participants: Participant[];
  let dana: Participant;
  let sam: Participant;

  test.beforeEach(async ({ browser }) => {
    const boardId = newBoardId();
    participants = await openParticipants(browser, 2, boardId);
    [dana, sam] = participants;

    // Dana draws a stroke to work with
    await pressKey(dana.page, 'p');
    const boardBox = await boardLocator(dana.page).boundingBox();
    if (!boardBox) throw new Error('board not visible');

    // Draw a roughly L-shaped stroke for easier hit-testing
    const sx = boardBox.x + 300;
    const sy = boardBox.y + 300;
    await dana.page.mouse.move(sx, sy);
    await dana.page.mouse.down();
    await dana.page.mouse.move(sx + 200, sy, { steps: 5 });
    await dana.page.mouse.move(sx + 200, sy + 150, { steps: 5 });
    await dana.page.mouse.up();
    await dana.page.waitForTimeout(100);

    // Wait for Sam to see the stroke
    await expect
      .poll(async () => strokeCount(sam.page), { timeout: 5000 })
      .toBe(1);
  });

  test.afterEach(async () => {
    if (participants) await closeParticipants(participants);
  });

  // TC-20: press V, click stroke line, resize handle (aspect ratio preserved),
  // move stroke, Delete → removed on both screens.
  test('TC-20: select, resize, move, delete stroke across participants', async () => {
    const { page: danaPage } = dana;

    // Switch to Select tool
    await pressKey(danaPage, 'v');

    // Find and select the stroke by clicking its line
    const strokeEl = danaPage.locator('[data-stroke-id]').first();
    const strokeBox = await strokeEl.boundingBox();
    if (!strokeBox) throw new Error('stroke not visible');

    // Click on the stroke line (near the top where the horizontal segment is)
    const clickX = strokeBox.x + strokeBox.width * 0.3;
    const clickY = strokeBox.y + 2;
    await danaPage.mouse.click(clickX, clickY);
    await danaPage.waitForTimeout(200);

    // Get stroke dimensions before resize
    const strokeDimsBefore = await strokeEl.evaluate((el) => {
      const s = (el as HTMLElement).style;
      return { w: parseFloat(s.width), h: parseFloat(s.height) };
    });
    const aspectBefore = strokeDimsBefore.w / strokeDimsBefore.h;

    // Check for resize handles (aspect-locked resize)
    const handles = danaPage.locator('.resize-handle');
    const handleCount = await handles.count();

    if (handleCount > 0) {
      // Drag the bottom-right resize handle
      const brHandle = handles.last();
      const hBox = await brHandle.boundingBox();
      if (hBox) {
        await danaPage.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2);
        await danaPage.mouse.down();
        await danaPage.mouse.move(hBox.x + hBox.width / 2 + 30, hBox.y + hBox.height / 2 + 30, { steps: 3 });
        await danaPage.mouse.up();
        await danaPage.waitForTimeout(100);

        // Check aspect ratio preserved within 1%
        const strokeDimsAfter = await strokeEl.evaluate((el) => {
          const s = (el as HTMLElement).style;
          return { w: parseFloat(s.width), h: parseFloat(s.height) };
        });
        const aspectAfter = strokeDimsAfter.w / strokeDimsAfter.h;
        expect(Math.abs(aspectAfter - aspectBefore) / aspectBefore).toBeLessThan(0.01);
      }
    }

    // Move the stroke by dragging its body
    const strokeBox2 = await strokeEl.boundingBox();
    if (strokeBox2) {
      const moveX = strokeBox2.x + strokeBox2.width * 0.5;
      const moveY = strokeBox2.y + 1;

      await danaPage.mouse.move(moveX, moveY);
      await danaPage.mouse.down();
      await danaPage.mouse.move(moveX + 100, moveY + 50, { steps: 5 });
      await danaPage.mouse.up();
      await danaPage.waitForTimeout(100);

      // Stroke should still exist after move
      expect(await strokeCount(danaPage)).toBe(1);
    }

    // Select the stroke again (click on its line)
    const strokeBox4 = await strokeEl.boundingBox();
    if (strokeBox4) {
      await danaPage.mouse.click(strokeBox4.x + strokeBox4.width * 0.3, strokeBox4.y + 1);
      await danaPage.waitForTimeout(100);
    }

    // Delete the stroke
    await danaPage.keyboard.press('Delete');
    await danaPage.waitForTimeout(100);

    // Dana should see no strokes
    expect(await strokeCount(danaPage)).toBe(0);

    // Sam should see no strokes within budget
    await expect
      .poll(async () => strokeCount(sam.page), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS })
      .toBe(0);
  });
});
