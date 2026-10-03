import { expect, test } from '@playwright/test';
import { GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX } from '../../src/shared/config';
import { createBoardAndOpen, dragBoard, originMarkerCenter, setCamera } from './helpers/board';

const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

/** The (non-null in these tests) viewport size. */
function viewportSize(page: import('@playwright/test').Page): { width: number; height: number } {
  const size = page.viewportSize();
  if (!size) throw new Error('viewport size unavailable');
  return size;
}

/** The zoom percentage label (auto-retrying where used in expect()). */
function zoomLabel(page: import('@playwright/test').Page) {
  return page.locator('[data-testid="zoom-label"]');
}

/**
 * Assert the origin marker centre, polling because camera renders are
 * rAF-coalesced and one-shot reads can race the render.
 */
async function expectMarkerCenter(
  page: import('@playwright/test').Page,
  x: number,
  y: number,
): Promise<void> {
  await expect
    .poll(async () => {
      const c = await originMarkerCenter(page);
      return { x: Math.round(c.x), y: Math.round(c.y) };
    })
    .toEqual({ x: Math.round(x), y: Math.round(y) });
}

test.describe('First visit navigation', () => {
  test('TC-28 the hint shows on load and is removed after the first drag', async ({ page }) => {
    await createBoardAndOpen(page);
    const hint = page.getByText(HINT_TEXT);
    await expect(hint).toBeVisible();
    await dragBoard(page, 120, 60);
    await expect(hint).not.toBeVisible();
  });

  test('TC-23 a 200x100 drag moves the board exactly 200x100 px', async ({ page }) => {
    await createBoardAndOpen(page);
    const before = await originMarkerCenter(page);
    await dragBoard(page, 200, 100);
    await expectMarkerCenter(page, before.x + 200, before.y + 100);
  });

  test('TC-24 a Ctrl-wheel over a dot keeps it under the pointer and never zooms the page', async ({
    page,
  }) => {
    await createBoardAndOpen(page);
    // Centre the origin so the pointer rests on a distinctive grid point,
    // and wait for the reset render to land before reading the position.
    const { width, height } = viewportSize(page);
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expectMarkerCenter(page, width / 2, height / 2);
    const pointer = await originMarkerCenter(page);
    await page.mouse.move(pointer.x, pointer.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');
    // The board zoomed around the pointer: the dot stays put...
    await expectMarkerCenter(page, pointer.x, pointer.y);
    // ...and it really did zoom...
    await expect(zoomLabel(page)).not.toHaveText('100%');
    // ...while the page did not.
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  });
});

test.describe('Limits and recovery', () => {
  test('TC-25 zooming in stops at 400% with the + button disabled', async ({ page }) => {
    await createBoardAndOpen(page);
    const plus = page.getByRole('button', { name: 'Zoom in' });
    // The click that reaches the limit can lose the race with the re-render
    // that disables the button; a timeout there means the limit is reached.
    for (let i = 0; i < 20; i += 1) {
      if (await plus.isDisabled()) break;
      await plus.click({ timeout: 1500 }).catch(() => {});
    }
    await expect(plus).toBeDisabled();
    await expect(zoomLabel(page)).toHaveText('400%');
  });

  test('TC-26 reset view from far away returns to 100% centred on the start', async ({ page }) => {
    await createBoardAndOpen(page);
    const extent = UNBOUNDED_PAN_TESTED_EXTENT;
    await setCamera(page, { x: extent, y: extent, zoom: ZOOM_MAX });
    await expect(zoomLabel(page)).toHaveText('400%');
    const { width, height } = viewportSize(page);
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect(zoomLabel(page)).toHaveText('100%');
    await expectMarkerCenter(page, width / 2, height / 2);
  });
});

test.describe('Far travel', () => {
  test('TC-27 panning is exact at 1,000,000 units and the grid stays even', async ({ page }) => {
    await createBoardAndOpen(page);
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    });
    const before = await originMarkerCenter(page);
    await dragBoard(page, 200, 100);
    await expectMarkerCenter(page, before.x + 200, before.y + 100);
    const spacing = await page
      .locator('[data-testid="board-viewport"]')
      .evaluate((el) => getComputedStyle(el).backgroundSize);
    expect(spacing).toBe(`${GRID_SPACING_WORLD}px ${GRID_SPACING_WORLD}px`);
  });
});

test.describe('No page zoom', () => {
  test('TC-31 board zoom gestures leave the page zoom untouched', async ({ page }) => {
    await createBoardAndOpen(page);
    const before = await page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1,
      devicePixelRatio: window.devicePixelRatio,
    }));
    const { width, height } = viewportSize(page);
    await page.mouse.move(width / 2, height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.press('Equal');
    await page.keyboard.press('Minus');
    await page.keyboard.press('Digit0');
    await page.keyboard.up('Control');
    const after = await page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1,
      devicePixelRatio: window.devicePixelRatio,
    }));
    expect(after.scale).toBe(before.scale);
    expect(after.devicePixelRatio).toBe(before.devicePixelRatio);
  });
});
