import { expect, test, type Page } from '@playwright/test';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
} from '../../src/shared/config';
import {
  HINT_TEXT,
  dragBy,
  gridBackgroundPosition,
  gridBackgroundSize,
  nextFrame,
  originMarker,
  pageZoom,
  setCamera,
  zoomLabel,
} from './helpers/board';

/** Viewport is 1280x800 (see playwright.config.ts). */
const CENTRE = { x: 640, y: 400 };

/**
 * Story 5 turned `/` into the landing page, so the navigation tests must
 * open a real board: create one via the API, navigate to it, wait for the
 * socket, and (unless `parkCamera` is false) park the camera at home so
 * every test starts from the same frame the old `/` board gave them.
 */
async function openBoard(page: Page, parkCamera = true): Promise<void> {
  const res = await page.request.post('/api/boards');
  if (res.status() !== 201) {
    throw new Error(`board creation failed: HTTP ${res.status()}`);
  }
  const { id } = await res.json();
  await page.goto(`/b/${id}`);
  await page.waitForFunction(
    () => (window as unknown as { __vidi6?: { connectionState: string | null } }).__vidi6?.connectionState === 'connected',
    null,
    { timeout: 15_000 },
  );
  if (parkCamera) {
    await setCamera(page, { x: -640, y: -400, zoom: 1 });
  }
}

test.describe('story 1: pan and zoom around an infinite board', () => {
  test('TC-28 first-visit hint is shown and dismissed after the first navigation', async ({
    page,
  }) => {
    // No camera parking: the first-visit hint must still be up when we
    // arrive (parking it would count as a camera interaction).
    await openBoard(page, false);
    const hint = page.getByText(HINT_TEXT);
    await expect(hint).toBeVisible();

    await dragBy(page, 120, 60);
    await expect(hint).toBeHidden();
  });

  test('TC-23 a drag moves the board by exactly the pointer distance', async ({ page }) => {
    await openBoard(page);
    const marker = originMarker(page);
    const before = (await marker.boundingBox())!;
    const startX = before.x + before.width / 2;
    const startY = before.y + before.height / 2;

    const gridBefore = await gridBackgroundPosition(page);

    await dragBy(page, 200, 100, { x: startX, y: startY });

    await nextFrame(page);
    const after = (await marker.boundingBox())!;
    expect(after.x - before.x).toBeCloseTo(200, 1);
    expect(after.y - before.y).toBeCloseTo(100, 1);

    // The dot grid moves with the board.
    const gridAfter = await gridBackgroundPosition(page);
    expect(gridAfter.x - gridBefore.x).toBeCloseTo(200, 1);
    expect(gridAfter.y - gridBefore.y).toBeCloseTo(100, 1);
  });

  test('TC-24 Ctrl+wheel zooms around the pointer without zooming the page', async ({ page }) => {
    await openBoard(page);
    const marker = originMarker(page);
    const box = (await marker.boundingBox())!;
    const px = box.x + box.width / 2;
    const py = box.y + box.height / 2;

    const zoomBefore = await pageZoom(page);

    await page.mouse.move(px, py);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');

    // The dot under the pointer stays under the pointer.
    await nextFrame(page);
    const after = (await marker.boundingBox())!;
    expect(Math.abs(after.x + after.width / 2 - px)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y + after.height / 2 - py)).toBeLessThanOrEqual(1);

    // The board actually zoomed (240 delta at sensitivity 0.01 clamps to max).
    await expect(zoomLabel(page)).toHaveText('400%');

    // The page did not zoom.
    expect(await pageZoom(page)).toEqual(zoomBefore);
  });

  test('TC-25 clicking + until disabled ends at 400% with a disabled button', async ({ page }) => {
    await openBoard(page);
    const plus = page.getByRole('button', { name: 'Zoom in' });
    const minus = page.getByRole('button', { name: 'Zoom out' });
    const label = zoomLabel(page);

    for (let i = 0; i < 50; i++) {
      if (await plus.isDisabled()) break;
      const before = (await label.textContent()) ?? '';
      let clicked = true;
      try {
        await plus.click({ timeout: 3000 });
      } catch {
        // The button became disabled between the check and the action;
        // that is the terminal state.
        clicked = false;
      }
      if (!clicked) break;
      // Settle: wait for the render that applied this zoom step to land
      // (the label changes on every step until the max), so the next
      // isDisabled() check sees fresh DOM.
      await page.waitForFunction(
        (prev) => {
          const el = document.querySelector('output[aria-live="polite"]');
          return !!el && el.textContent !== prev;
        },
        before,
        { timeout: 5000 },
      );
    }

    await expect(label).toHaveText('400%');
    await expect(plus).toBeDisabled();
    await expect(minus).toBeEnabled();
  });

  test('TC-26 Reset view from far away returns to 100% centred on the start point', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    await expect(zoomLabel(page)).toHaveText('400%');

    await page.getByRole('button', { name: 'Reset view' }).click();

    await expect(zoomLabel(page)).toHaveText('100%');
    await nextFrame(page);
    const box = (await originMarker(page).boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - CENTRE.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height / 2 - CENTRE.y)).toBeLessThanOrEqual(1);
  });

  test('TC-27 far travel (1,000,000 units): drags stay exact and the grid spacing is preserved', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    });
    await nextFrame(page);

    const gridBefore = await gridBackgroundPosition(page);
    await dragBy(page, 200, 100);
    await nextFrame(page);
    const gridAfter = await gridBackgroundPosition(page);

    expect(gridAfter.x - gridBefore.x).toBeCloseTo(200, 1);
    expect(gridAfter.y - gridBefore.y).toBeCloseTo(100, 1);

    // Grid spacing is GRID_SPACING_WORLD * zoom pixels.
    const size = await gridBackgroundSize(page);
    expect(size.w).toBeCloseTo(GRID_SPACING_WORLD * 1, 3);
    expect(size.h).toBeCloseTo(GRID_SPACING_WORLD * 1, 3);
  });

  test('TC-31 board zoom gestures never change the page zoom', async ({ page }) => {
    await openBoard(page);
    const before = await pageZoom(page);

    // Ctrl+wheel over the board.
    await page.mouse.move(CENTRE.x, CENTRE.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');
    await expect(zoomLabel(page)).toHaveText(`${Math.round(ZOOM_MAX * 100)}%`);

    // Ctrl/Cmd + = at the max limit is ignored (zoom-in past the limit does nothing).
    await page.keyboard.down('Control');
    await page.keyboard.press('Equal');
    await page.keyboard.up('Control');
    await expect(zoomLabel(page)).toHaveText(`${Math.round(ZOOM_MAX * 100)}%`);

    // Ctrl/Cmd + - at the max limit is a normal one-step zoom-out.
    await page.keyboard.down('Control');
    await page.keyboard.press('Minus');
    await page.keyboard.up('Control');
    await expect(zoomLabel(page)).toHaveText('320%');

    // Ctrl/Cmd + 0 resets.
    await page.keyboard.down('Control');
    await page.keyboard.press('Digit0');
    await page.keyboard.up('Control');
    await expect(zoomLabel(page)).toHaveText('100%');

    expect(await pageZoom(page)).toEqual(before);
  });
});
