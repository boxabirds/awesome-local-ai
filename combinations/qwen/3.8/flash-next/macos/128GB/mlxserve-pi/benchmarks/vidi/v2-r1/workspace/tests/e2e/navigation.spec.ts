import { expect, test } from '@playwright/test';
import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../../src/shared/config';
import { worldToScreen, type Camera } from '../../src/client/canvas/camera';
import {
  boardViewport,
  gridStyle,
  hint,
  LIMITS,
  markerCentre,
  openBoard,
  pageZoom,
  readCamera,
  readZoomPercent,
  resetButton,
  setCamera,
  settle,
  STANDARD_VIEW,
  VIEWPORT,
  zoomInButton,
  zoomLabel,
  zoomOutButton,
} from './helpers/board';

const mod = (value: number, period: number): number =>
  ((value % period) + period) % period;

/** Drag the mouse by (dx, dy) over empty board space. */
async function dragBy(page: import('@playwright/test').Page, dx: number, dy: number): Promise<void> {
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(400 + dx / 2, 300 + dy / 2, { steps: 5 });
  await page.mouse.move(400 + dx, 300 + dy, { steps: 5 });
  await page.mouse.up();
  await settle(page);
}

test.describe('workflow 1: first visit navigation', () => {
  // TC-28: the hint is shown on open and dismissed by the first drag.
  test('TC-28 shows the navigation hint until the first drag', async ({ page }) => {
    await openBoard(page);
    await expect(hint(page)).toBeVisible();
    await expect(hint(page)).toHaveText(
      'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom',
    );
    await expect(zoomLabel(page)).toHaveText('100%');

    await dragBy(page, 120, 60);

    await expect(hint(page)).toHaveCount(0);
    // Further navigation does not bring it back during this visit.
    await page.mouse.wheel(0, -100);
    await settle(page);
    await expect(hint(page)).toHaveCount(0);
  });

  // TC-23: a real mouse drag moves the board by exactly the pointer delta.
  test('TC-23 moves the board exactly with the mouse drag', async ({ page }) => {
    await openBoard(page);
    const before = await markerCentre(page);
    const gridBefore = await gridStyle(page);
    expect(gridBefore.size.width).toBeCloseTo(GRID_SPACING_WORLD, 3);

    await page.mouse.move(400, 300);
    await page.mouse.down();
    await page.mouse.move(550, 350, { steps: 5 });
    // The pointer shows a grabbing hand while dragging.
    await expect(boardViewport(page)).toHaveCSS('cursor', 'grabbing');
    await expect(boardViewport(page)).toHaveAttribute('data-state', 'panning');
    await page.mouse.move(600, 400, { steps: 5 });
    await page.mouse.up();
    await settle(page);

    const after = await markerCentre(page);
    // The dot (and the board's starting point) is 200px right and 100px down
    // from where it started, within 1px.
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);

    // The dot grid moved with the board: the same repeating dot is 200px right
    // and 100px down.
    const gridAfter = await gridStyle(page);
    const spacing = gridAfter.size.width;
    expect(spacing).toBeCloseTo(GRID_SPACING_WORLD, 3);
    expect(
      mod(gridAfter.position.x - gridBefore.position.x, spacing),
    ).toBeCloseTo(mod(200, spacing), 1);
    expect(
      mod(gridAfter.position.y - gridBefore.position.y, spacing),
    ).toBeCloseTo(mod(100, spacing), 1);

    await expect(boardViewport(page)).toHaveAttribute('data-state', 'idle');
    await expect(boardViewport(page)).toHaveCSS('cursor', 'grab');
  });

  // TC-24: Ctrl + wheel zooms the board around the pointer without moving the
  // point under it, and does not zoom the page.
  test('TC-24 keeps the point under the pointer while zooming with Ctrl + wheel', async ({ page }) => {
    await openBoard(page);
    const dot = await markerCentre(page);
    await page.mouse.move(dot.x, dot.y);

    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await settle(page);

    expect(await readZoomPercent(page)).toBeGreaterThan(100);
    const zoomed = await markerCentre(page);
    expect(Math.abs(zoomed.x - dot.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(zoomed.y - dot.y)).toBeLessThanOrEqual(1);

    // Zoom back out around the same pointer: the dot is still under it.
    await page.mouse.move(dot.x, dot.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 100);
    await page.keyboard.up('Control');
    await settle(page);
    expect(await readZoomPercent(page)).toBe(100);
    const out = await markerCentre(page);
    expect(Math.abs(out.x - dot.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(out.y - dot.y)).toBeLessThanOrEqual(1);

    // The web page itself never zoomed.
    expect((await pageZoom(page)).scale).toBe(1);
  });

  // TC-15/pan.scroll in a real browser: plain scroll moves the board, and the
  // page does not scroll.
  test('plain wheel scrolls move the board, not the page', async ({ page }) => {
    await openBoard(page);
    const before = await markerCentre(page);
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 100);
    await settle(page);
    const after = await markerCentre(page);
    expect(after.y - before.y).toBeCloseTo(-100, 0);
    expect(await readZoomPercent(page)).toBe(100);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});

test.describe('workflow 2: limits and recovery', () => {
  // TC-25: repeated zoom in stops at 400% and disables the + button.
  test('TC-25 zooming in stops at the maximum and disables Zoom in', async ({ page }) => {
    await openBoard(page);
    await expect(zoomLabel(page)).toHaveText('100%');
    let clicks = 0;
    for (let i = 0; i < 40; i += 1) {
      if (await zoomInButton(page).isDisabled()) break;
      await zoomInButton(page).click();
      await settle(page);
      clicks += 1;
    }
    expect(await readZoomPercent(page)).toBe(Math.round(ZOOM_MAX * 100));
    await expect(zoomInButton(page)).toBeDisabled();
    expect(await zoomInButton(page).getAttribute('disabled')).not.toBeNull();
    expect(await zoomOutButton(page).isDisabled()).toBe(false);
    // One step in from 100% is exactly 125%.
    expect(clicks).toBeGreaterThan(3);

    // Zooming back the other way re-enables the button.
    await zoomOutButton(page).click();
    await settle(page);
    await expect(zoomInButton(page)).toBeEnabled();
    expect(await readZoomPercent(page)).toBe(320);

    // Back to the limit, where a real click on the disabled button does nothing.
    for (let i = 0; i < 10; i += 1) {
      if (await zoomInButton(page).isDisabled()) break;
      await zoomInButton(page).click();
      await settle(page);
    }
    await expect(zoomInButton(page)).toBeDisabled();
    const box = await zoomInButton(page).boundingBox();
    if (!box) throw new Error('zoom control is not laid out');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await settle(page);
    expect(await readZoomPercent(page)).toBe(Math.round(ZOOM_MAX * 100));
  });

  // TC-25 (mirror): repeated zoom out stops at 10% and disables the - button.
  test('TC-25 zooming out stops at the minimum and disables Zoom out', async ({ page }) => {
    await openBoard(page);
    for (let i = 0; i < 40; i += 1) {
      if (await zoomOutButton(page).isDisabled()) break;
      await zoomOutButton(page).click();
      await settle(page);
    }
    expect(await readZoomPercent(page)).toBe(Math.round(ZOOM_MIN * 100));
    await expect(zoomOutButton(page)).toBeDisabled();
    expect(await zoomInButton(page).isDisabled()).toBe(false);
    // The grid shrinks with the zoom and stays evenly spaced.
    const grid = await gridStyle(page);
    expect(grid.size.width).toBeCloseTo(GRID_SPACING_WORLD * LIMITS.min, 2);
  });

  // TC-20 in a real browser: one + from 100% gives 125%, one - returns to 100%.
  test('zoom buttons step one level and come back exactly', async ({ page }) => {
    await openBoard(page);
    await zoomInButton(page).click();
    await settle(page);
    await expect(zoomLabel(page)).toHaveText('125%');
    await zoomOutButton(page).click();
    await settle(page);
    await expect(zoomLabel(page)).toHaveText('100%');
  });

  // TC-26: Reset view returns to 100% with the starting point centred.
  test('TC-26 Reset view returns to a standard view from far away at 400%', async ({ page }) => {
    await openBoard(page);
    const far: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT - VIEWPORT.width / 2,
      y: -UNBOUNDED_PAN_TESTED_EXTENT - VIEWPORT.height / 2,
      zoom: ZOOM_MAX,
    };
    await setCamera(page, far);
    await expect(zoomLabel(page)).toHaveText('400%');

    await resetButton(page).click();
    await settle(page);

    await expect(zoomLabel(page)).toHaveText('100%');
    const centre = await markerCentre(page);
    expect(Math.abs(centre.x - VIEWPORT.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre.y - VIEWPORT.height / 2)).toBeLessThanOrEqual(1);
    expect(await readCamera(page)).toEqual(STANDARD_VIEW);
  });

  // TC-18 in a real browser: Ctrl/Cmd + = / - / 0 step and reset the zoom.
  test('keyboard shortcuts zoom and reset without page zoom', async ({ page }) => {
    await openBoard(page);
    const zoomBefore = await pageZoom(page);

    await page.keyboard.press('Control+=');
    await settle(page);
    await expect(zoomLabel(page)).toHaveText('125%');

    await page.keyboard.press('Control+-');
    await settle(page);
    await expect(zoomLabel(page)).toHaveText('100%');

    // Move away, then reset with the keyboard.
    await dragBy(page, 300, 200);
    await page.keyboard.press('Control+0');
    await settle(page);
    await expect(zoomLabel(page)).toHaveText('100%');
    expect(await readCamera(page)).toEqual(STANDARD_VIEW);

    const zoomAfter = await pageZoom(page);
    expect(zoomAfter.scale).toBe(zoomBefore.scale);
    expect(zoomAfter.dpr).toBe(zoomBefore.dpr);
  });

  // TC-31: board gestures never change the browser's page zoom.
  test('TC-31 board gestures leave the page zoom unchanged', async ({ page }) => {
    await openBoard(page);
    const before = await pageZoom(page);

    await page.mouse.move(640, 400);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.mouse.wheel(0, 300);
    await page.keyboard.up('Control');
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+-');
    await page.keyboard.press('Control+-');
    await page.keyboard.press('Control+0');
    await settle(page);

    const after = await pageZoom(page);
    expect(after.scale).toBe(before.scale);
    expect(after.dpr).toBe(before.dpr);
    // The board itself did change and come back.
    await expect(zoomLabel(page)).toHaveText('100%');
  });

  // TC-30 in a real browser: a pinch over the zoom control does not zoom the board.
  test('a pinch over the zoom control does not zoom the board', async ({ page }) => {
    await openBoard(page);
    const box = await zoomInButton(page).boundingBox();
    if (!box) throw new Error('zoom control is not laid out');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');
    await settle(page);
    await expect(zoomLabel(page)).toHaveText('100%');
  });
});

test.describe('workflow 3: far travel', () => {
  // TC-27: at UNBOUNDED_PAN_TESTED_EXTENT the grid is intact and panning is exact.
  test('TC-27 pans exactly one million world units from the start', async ({ page }) => {
    await openBoard(page);
    const far: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    };
    await setCamera(page, far);

    // The grid renders evenly spaced at the expected screen spacing.
    const gridBefore = await gridStyle(page);
    expect(gridBefore.size.width).toBeCloseTo(GRID_SPACING_WORLD * far.zoom, 3);
    expect(gridBefore.size.height).toBeCloseTo(GRID_SPACING_WORLD * far.zoom, 3);

    // The world point just inside the top-left of the board area is where the
    // camera says it is (no distortion this far out).
    const worldPoint = { x: far.x + 10, y: far.y + 10 };
    const projected = worldToScreen(far, worldPoint);
    expect(projected.x).toBeGreaterThan(0);
    expect(projected.x).toBeLessThan(VIEWPORT.width);
    expect(projected.y).toBeGreaterThan(0);
    expect(projected.y).toBeLessThan(VIEWPORT.height);

    await dragBy(page, 200, 100);

    const camera = await readCamera(page);
    expect(camera.x).toBeCloseTo(far.x - 200, 3);
    expect(camera.y).toBeCloseTo(far.y - 100, 3);

    // The grid moved with the board and is still evenly spaced.
    const gridAfter = await gridStyle(page);
    const spacing = gridAfter.size.width;
    expect(spacing).toBeCloseTo(GRID_SPACING_WORLD, 3);
    expect(mod(gridAfter.position.x - gridBefore.position.x, spacing)).toBeCloseTo(
      mod(200, spacing),
      1,
    );
    expect(mod(gridAfter.position.y - gridBefore.position.y, spacing)).toBeCloseTo(
      mod(100, spacing),
      1,
    );

    // Reset view still returns to the standard view from here.
    await resetButton(page).click();
    await settle(page);
    await expect(zoomLabel(page)).toHaveText('100%');
    expect(await readCamera(page)).toEqual(STANDARD_VIEW);
  });

  // Zooming at the far end keeps the point under the pointer.
  test('zooming at the far end keeps the point under the pointer', async ({ page }) => {
    await openBoard(page);
    const far: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    };
    await setCamera(page, far);
    const pointer = { x: 640, y: 400 };
    const worldUnderPointer = worldToScreen(far, { x: far.x + 640, y: far.y + 400 });
    expect(worldUnderPointer.x).toBeCloseTo(640, 3);

    await page.mouse.move(pointer.x, pointer.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await settle(page);

    const camera = await readCamera(page);
    expect(camera.zoom).toBeGreaterThan(1);
    const screen = worldToScreen(camera, { x: far.x + 640, y: far.y + 400 });
    expect(Math.abs(screen.x - pointer.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(screen.y - pointer.y)).toBeLessThanOrEqual(1);
  });
});
