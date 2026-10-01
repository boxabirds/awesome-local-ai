import { expect, test } from '@playwright/test';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
import {
  HINT_TEXT,
  backgroundSize,
  dragBoard,
  expectCenterAt,
  expectMoved,
  farCenter,
  hint,
  originCenter,
  pageZoomState,
  setCamera,
  gotoBoard,
  zoomLabel,
} from './helpers/board';

const VIEWPORT = { width: 1280, height: 800 }; // set in playwright.config.ts

test.describe('workflow 1: first visit navigation', () => {
  test('hint shows, drag moves the board exactly, zoom keeps its point (TC-28, TC-23, TC-24, TC-31)', async ({
    page,
  }) => {
    await gotoBoard(page);

    // TC-28: the first-use hint is visible on load.
    await expect(hint(page)).toHaveText(HINT_TEXT);
    const zoom0 = await pageZoomState(page);

    // TC-23: a 200 px right / 100 px down drag moves the board content by
    // exactly that (the board's starting point marker follows the pointer).
    const before = await originCenter(page);
    await dragBoard(page, { x: 300, y: 300 }, 200, 100);
    await expectMoved(page, before, 200, 100, originCenter);

    // The hint disappeared with the first pan and does not come back.
    await expect(hint(page)).toHaveCount(0);
    await dragBoard(page, { x: 400, y: 500 }, -120, 60);
    await expect(hint(page)).toHaveCount(0);

    // TC-24: Ctrl + wheel over the marker zooms the board with the marker
    // staying under the pointer (within 1 px), in and back out.
    const hover = await originCenter(page);
    await page.keyboard.down('Control');
    await page.mouse.move(hover.x, hover.y);
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    const zoomPercentAfter = Math.round(100 * Math.exp(120 * WHEEL_ZOOM_SENSITIVITY));
    await expect(zoomLabel(page)).toHaveText(`${zoomPercentAfter}%`);
    await expect
      .poll(
        async () => {
          const c = await originCenter(page);
          return Math.max(Math.abs(c.x - hover.x), Math.abs(c.y - hover.y));
        },
        { timeout: 3000 },
      )
      .toBeLessThanOrEqual(1);

    // TC-31: the browser's page zoom was not touched by any of the above.
    const zoom1 = await pageZoomState(page);
    expect(zoom1.dpr).toBe(zoom0.dpr);
    expect(zoom1.scale).toBe(zoom0.scale);

    // Keyboard zoom shortcuts also leave the page zoom alone (TC-31 cont'd).
    await page.keyboard.press('Control+=');
    await expect(zoomLabel(page)).not.toHaveText(`${zoomPercentAfter}%`);
    await page.keyboard.press('Control+-');
    await page.keyboard.press('Control+0');
    await expect(zoomLabel(page)).toHaveText('100%');
    const zoom2 = await pageZoomState(page);
    expect(zoom2.dpr).toBe(zoom0.dpr);
    expect(zoom2.scale).toBe(zoom0.scale);
  });
});

test.describe('workflow 2: limits and recovery', () => {
  test('zoom to maximum disables +; Reset view returns to 100% centred (TC-25, TC-26)', async ({
    page,
  }) => {
    await gotoBoard(page);
    const plus = page.getByRole('button', { name: 'Zoom in' });
    const minus = page.getByRole('button', { name: 'Zoom out' });
    await expect(zoomLabel(page)).toHaveText('100%');
    await expect(minus).toBeEnabled();

    // TC-25: click + until it disables; the label sequence ends at 400%.
    const expectedPercents = [125, 156, 195, 244, 305, 381, 400].map(String);
    for (const percent of expectedPercents) {
      await plus.click();
      await expect(zoomLabel(page)).toHaveText(`${percent}%`);
    }
    await expect(plus).toBeDisabled();
    // At the maximum, − still works (zoom back the other way).
    await expect(minus).toBeEnabled();

    // TC-26: far away at ZOOM_MAX (via the test hook), Reset view recentres.
    await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: ZOOM_MAX });
    await expect(zoomLabel(page)).toHaveText('400%');
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect(zoomLabel(page)).toHaveText('100%');
    await expectCenterAt(page, { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }, originCenter);
  });

  test('zoom out to minimum disables −, zoom back in re-enables it', async ({ page }) => {
    await gotoBoard(page);
    const minus = page.getByRole('button', { name: 'Zoom out' });
    const plus = page.getByRole('button', { name: 'Zoom in' });
    for (let i = 0; i < 20; i++) {
      try {
        await minus.click({ timeout: 1500 });
      } catch {
        break; // − became disabled: the minimum is reached
      }
    }
    await expect(zoomLabel(page)).toHaveText('10%');
    await expect(minus).toBeDisabled();
    await plus.click();
    await expect(minus).toBeEnabled();
    // One step in from the minimum: 10% * ZOOM_STEP_FACTOR = 12.5% → 13%.
    await expect(zoomLabel(page)).toHaveText(`${Math.round(ZOOM_MIN * ZOOM_STEP_FACTOR * 100)}%`);
  });
});

test.describe('workflow 3: far travel', () => {
  test('panning follows the pointer exactly at 1,000,000 units (TC-27)', async ({ page }) => {
    await gotoBoard(page);
    // Jump 1,000,000 board units away at 200% zoom, far marker centred.
    const zoom = 2;
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT - VIEWPORT.width / 2 / zoom,
      y: UNBOUNDED_PAN_TESTED_EXTENT - VIEWPORT.height / 2 / zoom,
      zoom,
    });
    await expect(zoomLabel(page)).toHaveText(`${zoom * 100}%`);
    await expectCenterAt(page, { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }, farCenter);
    const before = await farCenter(page);

    await dragBoard(page, { x: 300, y: 300 }, 200, 100);
    await expectMoved(page, before, 200, 100, farCenter);

    // The dot grid renders evenly spaced at GRID_SPACING_WORLD * zoom.
    await expect
      .poll(() => backgroundSize(page))
      .toBe(`${GRID_SPACING_WORLD * zoom}px ${GRID_SPACING_WORLD * zoom}px`);
  });
});
