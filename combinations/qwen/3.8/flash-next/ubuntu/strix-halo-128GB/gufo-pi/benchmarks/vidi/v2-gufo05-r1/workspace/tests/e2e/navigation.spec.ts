import { expect, test, type Page } from '@playwright/test';

import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../../src/shared/config';
import { resetCamera, zoomPercent, zoomStep } from '../../src/client/canvas/camera';
import {
  BOARD_VIEWPORT,
  NAVIGATION_HINT,
  ZOOM_LABEL,
  dragBoard,
  gridSpacingPixels,
  originMarkerPosition,
  openFreshBoard,
  pinchAt,
  readCamera,
  readZoomLabel,
  scrollBoard,
  setCamera,
  waitForSettledCamera,
  withinTolerance,
} from './helpers/board';

/** A point on empty board space, away from the hint and the controls. */
const BOARD_POINT = { x: 420, y: 260 };

async function expectZoomLabel(page: Page, percent: string): Promise<void> {
  await expect(page.locator(ZOOM_LABEL)).toHaveText(`${percent}%`, { timeout: 10_000 });
}

/**
 * Click the zoom button all the way to a limit, predicting every label with the
 * same camera maths the app runs, and return the labels that were shown. The
 * label is awaited after every click so the button's disabled state is read
 * only once the app has rendered the result.
 */
async function stepZoomInBrowser(page: Page, direction: 'in' | 'out'): Promise<string[]> {
  const size = page.viewportSize() ?? { width: 1280, height: 800 };
  const button = page.getByRole('button', { name: direction === 'in' ? 'Zoom in' : 'Zoom out' });
  const labels: string[] = [];
  let camera = resetCamera(size);
  for (let step = 0; step < 40; step += 1) {
    const next = zoomStep(camera, size, direction);
    if (next === camera) return labels; // the camera refuses: the button must be disabled
    await expect(button).toBeEnabled();
    await button.click();
    camera = next;
    const expected = `${zoomPercent(camera)}%`;
    await expect(page.locator(ZOOM_LABEL)).toHaveText(expected);
    labels.push(expected);
  }
  throw new Error('zoom never reached its limit');
}

test.describe('workflow 1: first visit navigation', () => {
  // TC-28
  test('TC-28 shows the navigation hint and removes it after the first drag', async ({ page }) => {
    await openFreshBoard(page);
    const hint = page.locator(NAVIGATION_HINT);
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(
      'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom',
    );

    await dragBoard(page, BOARD_POINT, { x: 60, y: 30 });
    await expect(hint).toHaveCount(0);

    // Further navigation does not bring it back during this visit.
    await scrollBoard(page, { x: 0, y: 120 });
    await pinchAt(page, BOARD_POINT, -120);
    await expect(hint).toHaveCount(0);
  });

  // TC-23
  test('TC-23 a 200 x 100 drag moves the board exactly 200 x 100 pixels', async ({ page }) => {
    await openFreshBoard(page);
    await page.waitForSelector(BOARD_VIEWPORT);
    const before = await originMarkerPosition(page);

    await dragBoard(page, BOARD_POINT, { x: 200, y: 100 });

    const after = await originMarkerPosition(page);
    expect(withinTolerance(after.x - before.x, 200)).toBe(true);
    expect(withinTolerance(after.y - before.y, 100)).toBe(true);
  });

  // TC-24
  test('TC-24 Ctrl + scroll keeps the point under the pointer and never zooms the page', async ({
    page,
  }) => {
    await openFreshBoard(page);
    await page.waitForSelector(BOARD_VIEWPORT);
    const scaleBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);

    // Zoom in on the origin marker: it must stay under the pointer.
    const marker = await originMarkerPosition(page);
    await pinchAt(page, marker, -240);
    const zoomedIn = await readCamera(page);
    expect(zoomedIn.zoom).toBeGreaterThan(1);
    let position = await originMarkerPosition(page);
    expect(withinTolerance(position.x, marker.x)).toBe(true);
    expect(withinTolerance(position.y, marker.y)).toBe(true);

    // And back out again.
    await pinchAt(page, marker, 240);
    position = await originMarkerPosition(page);
    expect(withinTolerance(position.x, marker.x)).toBe(true);
    expect(withinTolerance(position.y, marker.y)).toBe(true);

    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(scaleBefore);
  });

  // pan.scroll
  test('scrolling moves the board in the scroll direction', async ({ page }) => {
    await openFreshBoard(page);
    await page.waitForSelector(BOARD_VIEWPORT);
    const before = await originMarkerPosition(page);

    // Scroll down: the content moves up.
    await scrollBoard(page, { x: 0, y: 120 });
    let after = await originMarkerPosition(page);
    expect(after.y).toBeLessThan(before.y);

    // Scroll right: the content moves left.
    await scrollBoard(page, { x: 120, y: 0 });
    after = await originMarkerPosition(page);
    expect(after.x).toBeLessThan(before.x);
  });
});

test.describe('workflow 2: limits and recovery', () => {
  // TC-25
  test('TC-25 zooming in with the button stops at 400% and disables +', async ({ page }) => {
    await openFreshBoard(page);
    await expectZoomLabel(page, '100');
    const labels = await stepZoomInBrowser(page, 'in');

    expect(await readZoomLabel(page)).toBe('400%');
    expect(await page.getByRole('button', { name: 'Zoom in' }).isDisabled()).toBe(true);
    expect(labels.at(-1)).toBe('400%');

    // Zooming back the other way re-enables the button.
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect(page.locator(ZOOM_LABEL)).not.toHaveText('400%');
    expect(await page.getByRole('button', { name: 'Zoom in' }).isDisabled()).toBe(false);
  });

  // TC-19 / TC-20 in a real browser
  test('the zoom label tracks the limits at both ends', async ({ page }) => {
    await openFreshBoard(page);
    const labels = await stepZoomInBrowser(page, 'out');
    expect(await readZoomLabel(page)).toBe(`${Math.round(ZOOM_MIN * 100)}%`);
    expect(await page.getByRole('button', { name: 'Zoom out' }).isDisabled()).toBe(true);
    expect(await page.getByRole('button', { name: 'Zoom in' }).isDisabled()).toBe(false);
    expect(labels.at(-1)).toBe(`${Math.round(ZOOM_MIN * 100)}%`);
  });

  // TC-26
  test('TC-26 Reset view returns to 100% with the starting point centred', async ({ page }) => {
    await openFreshBoard(page);
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    await expectZoomLabel(page, '400');

    await page.getByRole('button', { name: 'Reset view' }).click();

    await expectZoomLabel(page, '100');
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const marker = await originMarkerPosition(page);
    expect(withinTolerance(marker.x, (viewport?.width ?? 1280) / 2)).toBe(true);
    expect(withinTolerance(marker.y, (viewport?.height ?? 800) / 2)).toBe(true);
  });

  test('Ctrl/Cmd + 0 resets the view too', async ({ page }) => {
    await openFreshBoard(page);
    await dragBoard(page, BOARD_POINT, { x: 300, y: 200 });
    await pinchAt(page, BOARD_POINT, -240);
    const zoomed = await readCamera(page);
    expect(zoomed.zoom).not.toBe(1);

    await page.keyboard.press('Control+Digit0');
    await waitForSettledCamera(page);
    await expectZoomLabel(page, '100');
    const viewport = page.viewportSize();
    const marker = await originMarkerPosition(page);
    expect(withinTolerance(marker.x, (viewport?.width ?? 1280) / 2)).toBe(true);
    expect(withinTolerance(marker.y, (viewport?.height ?? 800) / 2)).toBe(true);
  });
});

test.describe('workflow 3: far travel', () => {
  // TC-27
  test('TC-27 a million units out, panning is still exact and the grid still even', async ({
    page,
  }) => {
    await openFreshBoard(page);
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    });

    const spacing = await gridSpacingPixels(page);
    expect(withinTolerance(spacing, GRID_SPACING_WORLD * 1, 0.01)).toBe(true);

    const before = await originMarkerPosition(page);
    await dragBoard(page, BOARD_POINT, { x: 200, y: 100 });
    const after = await originMarkerPosition(page);
    expect(withinTolerance(after.x - before.x, 200)).toBe(true);
    expect(withinTolerance(after.y - before.y, 100)).toBe(true);

    // Zooming out far away keeps the grid evenly spaced too.
    await pinchAt(page, BOARD_POINT, -240);
    const camera = await readCamera(page);
    expect(
      withinTolerance(await gridSpacingPixels(page), GRID_SPACING_WORLD * camera.zoom, 0.01),
    ).toBe(true);
  });

  test('reset still works from the far edge of the tested extent', async ({ page }) => {
    await openFreshBoard(page);
    await setCamera(page, {
      x: -UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MIN,
    });
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expectZoomLabel(page, '100');
    const viewport = page.viewportSize();
    const marker = await originMarkerPosition(page);
    expect(withinTolerance(marker.x, (viewport?.width ?? 1280) / 2)).toBe(true);
  });
});

test.describe('window resize (navigation.resize)', () => {
  test('resizing leaves content anchored to the top-left of the board', async ({ page }) => {
    await openFreshBoard(page);
    await dragBoard(page, BOARD_POINT, { x: 120, y: 60 });
    const before = await originMarkerPosition(page);

    await page.setViewportSize({ width: 900, height: 600 });
    await waitForSettledCamera(page);
    const after = await originMarkerPosition(page);
    expect(withinTolerance(after.x, before.x)).toBe(true);
    expect(withinTolerance(after.y, before.y)).toBe(true);

    // Navigation still measures the same after the resize.
    await dragBoard(page, { x: 250, y: 200 }, { x: 40, y: -30 });
    const moved = await originMarkerPosition(page);
    expect(withinTolerance(moved.x - after.x, 40)).toBe(true);
    expect(withinTolerance(moved.y - after.y, -30)).toBe(true);
  });
});

test.describe('board gestures do not zoom the page (zoom.no_page_zoom)', () => {
  // TC-31
  test('TC-31 page zoom is untouched by every board zoom gesture', async ({ page }) => {
    await openFreshBoard(page);
    await page.waitForSelector(BOARD_VIEWPORT);
    const dprBefore = await page.evaluate(() => window.devicePixelRatio);
    const scaleBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    const controlBoxBefore = await page
      .getByRole('button', { name: 'Reset view' })
      .boundingBox();
    expect(controlBoxBefore).not.toBeNull();

    await pinchAt(page, BOARD_POINT, -240);
    await pinchAt(page, BOARD_POINT, 120);
    await page.keyboard.press('Control+Equal');
    await page.keyboard.press('Control+Minus');
    await page.keyboard.press('Control+Digit0');
    await waitForSettledCamera(page);

    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(scaleBefore);
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(dprBefore);
    const controlBoxAfter = await page.getByRole('button', { name: 'Reset view' }).boundingBox();
    expect(controlBoxAfter?.height).toBe(controlBoxBefore?.height);
    expect(controlBoxAfter?.width).toBe(controlBoxBefore?.width);
  });

  test('the board owns the wheel: the page never scrolls', async ({ page }) => {
    await openFreshBoard(page);
    await scrollBoard(page, { x: 0, y: 400 });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const camera = await readCamera(page);
    expect(camera.y).toBeGreaterThan(0);
  });
});

test.describe('zoom label (zoom.indicator)', () => {
  test('the label matches the camera zoom after every action', async ({ page }) => {
    await openFreshBoard(page);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expectZoomLabel(page, '125');
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expectZoomLabel(page, '100');

    await pinchAt(page, BOARD_POINT, -60);
    const camera = await readCamera(page);
    await expectZoomLabel(page, String(Math.round(camera.zoom * 100)));
    expect(camera.zoom).toBeGreaterThan(1);
    expect(camera.zoom).toBeLessThan(ZOOM_MAX);
  });
});
