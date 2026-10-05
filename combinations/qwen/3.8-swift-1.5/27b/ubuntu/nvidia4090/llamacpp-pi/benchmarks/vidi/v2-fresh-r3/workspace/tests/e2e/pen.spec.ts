import { test, expect, type Page } from '@playwright/test';
import { openBoardPath, setCamera, waitForZoom } from './helpers/board';

/**
 * Story 11 E2E: the Pen tool (TC-17 to TC-20).
 *
 * The Pen is armed from the toolbar button (or P). A pointer drag on the
 * board draws a stroke; on release the stroke becomes a board object that
 * renders for everyone, survives reload, and can be selected/moved/deleted
 * like the other objects.
 */

/** Arms the Pen tool and resets the camera so world == screen. */
async function armPen(page: Page) {
  await setCamera(page, 0, 0, 1);
  await waitForZoom(page, 1);
  await page.getByTestId('pen-tool-button').click();
  await expect(page.getByTestId('pen-tool-button')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('pen-toolbar')).toBeVisible();
}

/** Creates one board and opens the same URL in both pages. */
async function openBoardInTwo(request: import('@playwright/test').APIRequestContext, pageA: Page, pageB: Page) {
  const res = await request.post('/api/boards');
  const { id } = (await res.json()) as { id: string };
  await pageA.goto(`/b/${id}`);
  await pageB.goto(`/b/${id}`);
  await expect(pageA.getByTestId('board-viewport')).toBeVisible({ timeout: 15000 });
  await expect(pageB.getByTestId('board-viewport')).toBeVisible({ timeout: 15000 });
}

test.describe('story 11: sketch freehand with a pen (e2e)', () => {
  test('TC-17: a finished stroke remains after page reload', async ({ browser, request }) => {
    const page = await browser.newPage();
    await openBoardPath(request, page);

    // Draw two strokes.
    await armPen(page);
    await page.mouse.move(400, 300);
    await page.mouse.down();
    await page.mouse.move(500, 320, { steps: 10 });
    await page.mouse.up();
    // The pen stays active after a finished stroke.
    await expect(page.getByTestId('pen-tool-button')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-stroke-id]')).toHaveCount(1);

    // Delete the first stroke (select tool, click the line, Delete).
    await page.keyboard.press('v');
    await page.mouse.click(450, 310);
    await expect(page.locator('[data-stroke-id][data-selected="true"]')).toHaveCount(1);
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-stroke-id]')).toHaveCount(0);

    // Draw a second stroke that must survive the reload.
    await armPen(page);
    await page.mouse.move(600, 400);
    await page.mouse.down();
    await page.mouse.move(700, 430, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator('[data-stroke-id]')).toHaveCount(1);

    await page.reload();
    await expect(page.locator('[data-stroke-id]')).toHaveCount(1);
  });

  test('TC-18: a stroke can be selected by clicking it and deleted', async ({ browser, request }) => {
    const page = await browser.newPage();
    await openBoardPath(request, page);

    await armPen(page);
    await page.mouse.move(400, 300);
    await page.mouse.down();
    await page.mouse.move(520, 340, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator('[data-stroke-id]')).toHaveCount(1);

    // Back to the select tool: clicking the line selects the stroke.
    await page.keyboard.press('v');
    await page.mouse.click(460, 320);
    await expect(page.locator('[data-stroke-id][data-selected="true"]')).toHaveCount(1);

    await page.keyboard.press('Delete');
    await expect(page.locator('[data-stroke-id]')).toHaveCount(0);
  });

  test('TC-19: a stroke drawn by one client renders in the other', async ({ browser, request }) => {
    const pageA = await browser.newPage();
    const pageB = await browser.newPage();
    await openBoardInTwo(request, pageA, pageB);

    await armPen(pageA);
    await pageA.mouse.move(400, 300);
    await pageA.mouse.down();
    await pageA.mouse.move(520, 330, { steps: 10 });
    await pageA.mouse.up();
    await expect(pageA.locator('[data-stroke-id]')).toHaveCount(1);

    // The other client sees the finished stroke appear.
    await expect(pageB.locator('[data-stroke-id]'), 'stroke renders for the other client').toHaveCount(1);
  });

  test('TC-20: 5000+ points → two stroke objects; the other client sees both', async ({ browser, request }) => {
    const pageA = await browser.newPage();
    const pageB = await browser.newPage();
    await openBoardInTwo(request, pageA, pageB);

    await armPen(pageA);
    // A single continuous drag of 5,010 points: the part is committed at
    // STROKE_MAX_POINTS and the rest continues from the shared join point.
    await pageA.mouse.move(100, 300);
    await pageA.mouse.down();
    await pageA.evaluate(async () => {
      const overlay = document.querySelector('[data-testid="pen-tool-overlay"]') as HTMLElement;
      const ev = (type: string, x: number, y: number) =>
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: 1,
        });
      // Yield so the real pointerdown is fully processed first.
      await new Promise((r) => setTimeout(r, 50));
      for (let i = 1; i <= 5010; i++) {
        overlay.dispatchEvent(ev('pointermove', 100 + i * 0.4, 300));
      }
      await new Promise((r) => setTimeout(r, 20));
    });
    await pageA.mouse.up();

    await expect(pageA.locator('[data-stroke-id]'), 'two strokes locally').toHaveCount(2);

    // The other client receives both parts.
    await expect(pageB.locator('[data-stroke-id]'), 'two strokes on the other client').toHaveCount(2);
  });
});
