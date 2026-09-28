// E2E navigation tests (TC-23 to TC-28, TC-31) against wrangler dev.

import { expect, test, type Page } from '@playwright/test';
import {
  GRID_SPACING_WORLD,
  gridSpacingPx,
  openBoard,
  originMarkerCenter,
  setCamera,
  zoomLabel,
} from './helpers/board';

const TOLERANCE_PX = 1;

/** Poll until the origin marker sits at (x, y) within tolerance. */
async function expectMarkerNear(page: Page, x: number, y: number): Promise<void> {
  await expect
    .poll(async () => {
      const c = await originMarkerCenter(page);
      return Math.abs(c.x - x) <= TOLERANCE_PX && Math.abs(c.y - y) <= TOLERANCE_PX;
    })
    .toBe(true);
}

test.describe('first visit navigation', () => {
  test('TC-28/TC-23/TC-24: hint shows, drag moves exactly, pointer zoom stays put', async ({
    page,
  }) => {
    await openBoard(page);

    // TC-28: the hint is visible on first load.
    const hint = page.getByTestId('nav-hint');
    await expect(hint).toBeVisible();

    // The initial view centres the origin (viewport 1280x800 -> 640,400);
    // wait for that render before measuring.
    await expectMarkerNear(page, 640, 400);

    // TC-23: a real mouse drag moves the origin marker (a grid dot) exactly.
    const before = await originMarkerCenter(page);
    await page.mouse.move(before.x, before.y);
    await page.mouse.down();
    await page.mouse.move(before.x + 200, before.y + 100, { steps: 10 });
    await page.mouse.up();
    await expectMarkerNear(page, before.x + 200, before.y + 100);
    const after = await originMarkerCenter(page);

    // The first pan dismissed the hint for this visit.
    await expect(hint).toHaveCount(0);

    // TC-24: Ctrl + wheel over the marker keeps it under the pointer and
    // zooms the board (label 272% = exp(100 * 0.01) rounded).
    await page.mouse.move(after.x, after.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await expect(zoomLabel(page)).toHaveText('272%');
    await expectMarkerNear(page, after.x, after.y);

    // The page itself did not zoom.
    const pageScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    expect(pageScale).toBe(1);
  });
});

test.describe('limits and recovery', () => {
  test('TC-25/TC-26: zoom to max disables +, reset returns to 100% centred', async ({ page }) => {
    await openBoard(page);
    // Settle the initial centred view before jumping the camera (the
    // one-shot initial centering must not race the test hook).
    await expectMarkerNear(page, 640, 400);
    const plus = page.getByRole('button', { name: 'Zoom in' });

    // Click until the button disables. force:true avoids a race where the
    // button disables (rAF commit) between the isDisabled check and the
    // click's actionability check; a force click on a disabled button is a
    // harmless no-op.
    for (let i = 0; i < 20; i += 1) {
      if (await plus.isDisabled()) break;
      await plus.click({ force: true });
    }
    await expect(plus).toBeDisabled();
    await expect(zoomLabel(page)).toHaveText('400%');

    // Jump far away at 400% via the test hook, then reset.
    await setCamera(page, 1_000_000, -1_000_000, 4);
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect(zoomLabel(page)).toHaveText('100%');
    await expectMarkerNear(page, 640, 400);
  });
});

test.describe('far travel', () => {
  test('TC-27: at 1,000,000 units the board pans exactly and the grid is intact', async ({
    page,
  }) => {
    await openBoard(page);
    // Settle the initial centred view before jumping the camera (the
    // one-shot initial centering must not race the test hook).
    await expectMarkerNear(page, 640, 400);
    await setCamera(page, 1_000_000, 1_000_000, 1);
    const before = await originMarkerCenter(page);

    // Drag on empty space away from the marker.
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(840, 500, { steps: 10 });
    await page.mouse.up();
    await expectMarkerNear(page, before.x + 200, before.y + 100);

    // Grid spacing equals GRID_SPACING_WORLD * zoom in CSS pixels.
    expect(await gridSpacingPx(page)).toBe(`${GRID_SPACING_WORLD}px ${GRID_SPACING_WORLD}px`);
  });
});

test.describe('no page zoom', () => {
  test('TC-31: board gestures never change the page zoom', async ({ page }) => {
    await openBoard(page);
    const before = await page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1,
      dpr: window.devicePixelRatio,
    }));

    await page.mouse.move(640, 400);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+-');
    await page.keyboard.press('Control+0');

    const after = await page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1,
      dpr: window.devicePixelRatio,
    }));
    expect(after).toEqual(before);
  });
});
