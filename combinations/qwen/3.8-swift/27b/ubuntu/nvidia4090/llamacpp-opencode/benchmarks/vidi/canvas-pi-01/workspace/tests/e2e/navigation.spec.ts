// Story 1 e2e: pan and zoom around an infinite board.
//
// Runs against `wrangler dev` (see playwright.config.ts) in Chromium,
// Firefox and WebKit. Workflows follow the design's "E2E workflows".

import { expect, test } from '@playwright/test';
import { GRID_SPACING_WORLD } from '../../src/shared/config';
import {
  cameraFromRender,
  createBoardViaHook,
  dragBoard,
  openBoard,
  originMarkerCenter,
  settleCamera,
  setCamera,
  UNBOUNDED_PAN_TESTED_EXTENT,
  zoomLabel,
} from './helpers/board';

const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';
const ZOOM_IN = 'Zoom in';
const RESET_VIEW = 'Reset view';
/**
 * From 100%, 1.25^7 > 400%, so exactly 7 clicks reach (and clamp at) the
 * maximum zoom. The button disables only after the 7th commit, so a fixed
 * sequence of 7 clicks is race-free.
 */
const CLICKS_TO_MAX_ZOOM = 7;
/** Pixel tolerance for "exact" pointer tracking (spec: within 1 pixel). */
const EXACT_PX = 1;

test.describe('first visit navigation (workflow 1)', () => {
  test('TC-28/23/24: hint shows, drag moves the board exactly, Ctrl+wheel zooms around the pointer', async ({    page,
    request,
  }) => {
    await openBoard(page, await createBoardViaHook(request));

    // TC-28: the first-use hint is visible on load.
    const hint = page.getByText(HINT_TEXT);
    await expect(hint).toBeVisible();

    // TC-23: a real mouse drag of (200, 100) moves the origin marker exactly.
    const before = await originMarkerCenter(page);
    const camBefore = await cameraFromRender(page);
    await dragBoard(page, before.x, before.y, 200, 100);
    // WebKit can coalesce pointermove events; compensate any shortfall so the
    // net pan is exactly (200, 100).
    const partial = await cameraFromRender(page);
    const shortfall = {
      x: 200 - (camBefore.x - partial.x),
      y: 100 - (camBefore.y - partial.y),
    };
    if (Math.abs(shortfall.x) > 0.5 || Math.abs(shortfall.y) > 0.5) {
      await dragBoard(page, before.x + 200, before.y + 100, shortfall.x, shortfall.y);
    }
    const afterDrag = await originMarkerCenter(page);
    expect(Math.abs(afterDrag.x - before.x - 200)).toBeLessThanOrEqual(EXACT_PX);
    expect(Math.abs(afterDrag.y - before.y - 100)).toBeLessThanOrEqual(EXACT_PX);

    // TC-28: the hint disappears after the first pan and stays gone.
    await expect(hint).not.toBeVisible();

    // TC-24: Ctrl+wheel over the marker keeps it under the pointer; the page
    // itself never zooms.
    const beforeZoom = await originMarkerCenter(page);
    await page.mouse.move(beforeZoom.x, beforeZoom.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await settleCamera(page);
    const afterZoom = await originMarkerCenter(page);
    expect(Math.abs(afterZoom.x - beforeZoom.x)).toBeLessThanOrEqual(EXACT_PX);
    expect(Math.abs(afterZoom.y - beforeZoom.y)).toBeLessThanOrEqual(EXACT_PX);
    await expect(zoomLabel(page)).not.toHaveText('100%');
    const pageScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    expect(pageScale).toBe(1);
  });
});

test.describe('limits and recovery (workflow 2)', () => {
  test('TC-25/26: zoom to the maximum disables +, Reset view returns to 100% centred', async ({    page,
    request,
  }) => {
    await openBoard(page, await createBoardViaHook(request));

    // TC-25: click + until disabled; the label ends at 400%.
    const zoomIn = page.getByRole('button', { name: ZOOM_IN });
    for (let i = 0; i < CLICKS_TO_MAX_ZOOM; i++) {
      await zoomIn.click();
    }
    await expect(zoomIn).toBeDisabled();
    await expect(zoomLabel(page)).toHaveText('400%');

    // TC-26: jump far away at 400% via the test hook, then Reset view.
    await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: 4 });
    await page.getByRole('button', { name: RESET_VIEW }).click();
    await expect(zoomLabel(page)).toHaveText('100%');
    const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
    const center = await originMarkerCenter(page);
    expect(Math.abs(center.x - width / 2)).toBeLessThanOrEqual(EXACT_PX);
    expect(Math.abs(center.y - height / 2)).toBeLessThanOrEqual(EXACT_PX);
  });
});

test.describe('far travel (workflow 3)', () => {
  test('TC-27: at 1,000,000 units the board pans exactly and the grid stays even', async ({ page, request }) => {
    await openBoard(page, await createBoardViaHook(request));

    await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 });
    const before = await cameraFromRender(page);

    // Drag (200, 100) somewhere on the (empty, far) board. WebKit can
    // coalesce pointermove events, so compensate any shortfall to keep the
    // net pan exact.
    await dragBoard(page, 640, 400, 200, 100);
    const partial = await cameraFromRender(page);
    const shortfall = {
      x: 200 - (before.x - partial.x),
      y: 100 - (before.y - partial.y),
    };
    if (Math.abs(shortfall.x) > 0.5 || Math.abs(shortfall.y) > 0.5) {
      await dragBoard(page, 840, 500, shortfall.x, shortfall.y);
    }
    const after = await cameraFromRender(page);
    // Content follows the pointer: a (+200, +100) drag moves the camera
    // by exactly (-200, -100) world units at zoom 1.
    expect(Math.abs(before.x - after.x - 200)).toBeLessThanOrEqual(EXACT_PX);
    expect(Math.abs(before.y - after.y - 100)).toBeLessThanOrEqual(EXACT_PX);

    // Grid spacing is GRID_SPACING_WORLD * zoom, rendered evenly.
    const backgroundSize = await page
      .locator('[data-testid="board-viewport"]')
      .evaluate((el) => getComputedStyle(el).backgroundSize);
    const spacingPx = GRID_SPACING_WORLD * 1;
    expect(backgroundSize).toBe(`${spacingPx}px ${spacingPx}px`);
  });
});

test.describe('page zoom stays untouched (TC-31)', () => {
  test('Ctrl+wheel and Ctrl+=/- /0 over the board never change page zoom', async ({ page, request }) => {
    await openBoard(page, await createBoardViaHook(request));

    const before = await page.evaluate(() => ({
      devicePixelRatio: window.devicePixelRatio,
      pageScale: window.visualViewport?.scale ?? 1,
    }));

    await page.mouse.move(640, 400);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');

    for (const keyName of ['=', '-', '0']) {
      await page.keyboard.down('Control');
      await page.keyboard.press(keyName);
      await page.keyboard.up('Control');
    }

    const after = await page.evaluate(() => ({
      devicePixelRatio: window.devicePixelRatio,
      pageScale: window.visualViewport?.scale ?? 1,
    }));
    expect(after.devicePixelRatio).toBe(before.devicePixelRatio);
    expect(after.pageScale).toBe(before.pageScale);
  });
});
