import { expect, test, type Locator, type Page } from '@playwright/test';

import { GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT } from '../../src/shared/config';
import {
  BOARD_SIZE,
  boardSurfaceStyle,
  dragBoard,
  expectMarkerAt,
  getCamera,
  markerCentre,
  mod,
  openBoard,
  pageZoomState,
  pinchAt,
  setCamera,
  zoomInButton,
  zoomLabel,
  zoomOutButton,
} from './helpers/board';

const CENTRE = { x: BOARD_SIZE.width / 2, y: BOARD_SIZE.height / 2 };

/**
 * Click a control and wait for the rendered result, so the next actionability
 * check sees the DOM the click produced rather than the frame before it.
 */
async function clickAndWait(button: Locator, label: Locator): Promise<void> {
  const before = (await label.textContent()) ?? '';
  await button.click();
  await expect(label).not.toHaveText(before);
}

/** Walk a zoom button to its limit, one rendered step at a time. */
async function zoomToLimit(page: Page, button: Locator): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    if (await button.isDisabled()) return;
    await clickAndWait(button, zoomLabel(page));
  }
  throw new Error('the zoom limit was not reached in 40 steps');
}

test.describe('workflow 1: first visit navigation', () => {
  test('TC-28 shows the navigation hint until the first pan, then never again this visit', async ({
    page,
  }) => {
    await openBoard(page);
    const hint = page.getByTestId('navigation-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText('Drag to move around · Ctrl/Cmd + scroll or pinch to zoom');

    await dragBoard(page, CENTRE, { x: 40, y: 25 });
    await expect(hint).toBeHidden();

    // further navigation does not bring it back
    await page.mouse.move(CENTRE.x, CENTRE.y);
    await page.mouse.wheel(0, 100);
    await pinchAt(page, CENTRE, -100);
    await expect(hint).toBeHidden();

    // the hint is per visit: a reload shows it again
    await page.reload();
    await expect(page.getByTestId('navigation-hint')).toBeVisible();
  });

  test('TC-23 dragging moves the origin marker and the dot grid by exactly the pointer delta', async ({
    page,
  }) => {
    await openBoard(page);
    const before = await markerCentre(page);

    await dragBoard(page, before, { x: 200, y: 100 });

    // the board moved with the pointer, no drift
    await expectMarkerAt(page, { x: before.x + 200, y: before.y + 100 });

    // the dot grid is attached to the board: spacing and offset follow the camera
    const camera = await getCamera(page);
    const surface = await boardSurfaceStyle(page);
    const spacing = GRID_SPACING_WORLD * camera.zoom;
    expect(surface.spacingX).toBeCloseTo(spacing, 3);
    expect(surface.spacingY).toBeCloseTo(spacing, 3);
    expect(Math.abs(surface.offsetX - mod(-camera.x * camera.zoom, spacing))).toBeLessThan(0.5);
    expect(Math.abs(surface.offsetY - mod(-camera.y * camera.zoom, spacing))).toBeLessThan(0.5);
  });

  test('TC-24 pinch/Ctrl-scroll zooms around the pointer without zooming the page', async ({
    page,
  }) => {
    await openBoard(page);
    const before = await pageZoomState(page);
    // a distinctive dot: the crosshair at the board's starting point
    const dot = await markerCentre(page);

    await pinchAt(page, dot, -100);
    await expect
      .poll(async () => (await getCamera(page)).zoom)
      .toBeGreaterThan(1);
    await expectMarkerAt(page, dot);

    await pinchAt(page, dot, 100);
    await expectMarkerAt(page, dot);

    const after = await pageZoomState(page);
    expect(after.scale).toBe(1);
    expect(after.devicePixelRatio).toBe(before.devicePixelRatio);
    expect(after.innerWidth).toBe(before.innerWidth);
    expect(after.innerHeight).toBe(before.innerHeight);
  });

  test('pan.scroll: a plain scroll pans the board in the scroll direction', async ({ page }) => {
    await openBoard(page);
    const start = await markerCentre(page);

    // scroll down: content moves up
    await page.mouse.move(CENTRE.x, CENTRE.y);
    await page.mouse.wheel(0, 100);
    await expectMarkerAt(page, { x: start.x, y: start.y - 100 });

    // scroll right: content moves left
    const anchor = await markerCentre(page);
    await page.mouse.wheel(120, 0);
    await expectMarkerAt(page, { x: anchor.x - 120, y: anchor.y });

    // panning does not zoom
    expect((await getCamera(page)).zoom).toBe(1);
  });
});

test.describe('workflow 2: limits and recovery', () => {
  test('TC-25 zooming in one step at a time ends at 400% with + disabled', async ({ page }) => {
    await openBoard(page);
    await expect(zoomLabel(page)).toHaveText('100%');

    // one click on + from 100% gives 125%, and - walks it straight back
    await clickAndWait(zoomInButton(page), zoomLabel(page));
    await expect(zoomLabel(page)).toHaveText('125%');
    await clickAndWait(zoomOutButton(page), zoomLabel(page));
    await expect(zoomLabel(page)).toHaveText('100%');

    await zoomToLimit(page, zoomInButton(page));
    await expect(zoomLabel(page)).toHaveText('400%');
    await expect(zoomInButton(page)).toBeDisabled();
    await expect(zoomOutButton(page)).toBeEnabled();

    // a real click on the disabled + does nothing
    const camera = await getCamera(page);
    const box = await zoomInButton(page).boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect(await getCamera(page)).toEqual(camera);

    // the other direction still works from the limit
    await clickAndWait(zoomOutButton(page), zoomLabel(page));
    await expect(zoomLabel(page)).toHaveText('320%');
    await expect(zoomInButton(page)).toBeEnabled();
  });

  test('zooming out one step at a time ends at 10% with - disabled', async ({ page }) => {
    await openBoard(page);
    await zoomToLimit(page, zoomOutButton(page));
    await expect(zoomLabel(page)).toHaveText('10%');
    await expect(zoomOutButton(page)).toBeDisabled();
    await expect(zoomInButton(page)).toBeEnabled();

    // a wheel zoom-out over the board cannot push past the limit either
    const camera = await getCamera(page);
    await pinchAt(page, CENTRE, 4000);
    expect(await getCamera(page)).toEqual(camera);
    await expect(zoomLabel(page)).toHaveText('10%');
  });

  test('TC-26 Reset view returns to 100% centred on the board start from far away', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 4,
    });
    await expect(zoomLabel(page)).toHaveText('400%');

    await page.getByTestId('reset-view').click();
    await expect(zoomLabel(page)).toHaveText('100%');
    await expectMarkerAt(page, CENTRE);

    const camera = await getCamera(page);
    expect(camera.zoom).toBe(1);
    expect(Math.abs(camera.x + BOARD_SIZE.width / 2)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(camera.y + BOARD_SIZE.height / 2)).toBeLessThanOrEqual(1e-6);
  });

  test('keyboard zoom shortcuts zoom and reset the board, and never the page', async ({
    page,
  }) => {
    await openBoard(page);
    const before = await pageZoomState(page);

    await page.keyboard.press('Control+=');
    await expect(zoomLabel(page)).toHaveText('125%');
    await page.keyboard.press('Control+-');
    await expect(zoomLabel(page)).toHaveText('100%');

    // pan away, then Ctrl/Cmd + 0 brings the standard view back
    await dragBoard(page, CENTRE, { x: -300, y: 220 });
    await page.keyboard.press('Control+0');
    await expect(zoomLabel(page)).toHaveText('100%');
    await expectMarkerAt(page, CENTRE);

    const after = await pageZoomState(page);
    expect(after.scale).toBe(1);
    expect(after.devicePixelRatio).toBe(before.devicePixelRatio);
    expect(after.innerWidth).toBe(before.innerWidth);
    expect(after.innerHeight).toBe(before.innerHeight);
  });
});

test.describe('workflow 3: far travel', () => {
  test('TC-27 a million units from the start still pans exactly, with an even grid', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    });
    const before = await getCamera(page);

    await dragBoard(page, CENTRE, { x: 200, y: 100 });

    // the pan is still exact at a million units from the start
    const after = await getCamera(page);
    expect(Math.abs(after.x - (before.x - 200))).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(after.y - (before.y - 100))).toBeLessThanOrEqual(1e-6);

    // the grid stays evenly spaced with no distortion
    const surface = await boardSurfaceStyle(page);
    expect(surface.spacingX).toBeCloseTo(GRID_SPACING_WORLD * after.zoom, 3);
    expect(surface.spacingY).toBeCloseTo(GRID_SPACING_WORLD * after.zoom, 3);
    expect(Number.isFinite(surface.offsetX)).toBe(true);
    expect(Number.isFinite(surface.offsetY)).toBe(true);
  });

  test('zooming far from the start keeps the pointer location fixed', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, {
      x: -UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 2,
    });
    const pointer = { x: 300, y: 520 };

    await pinchAt(page, pointer, -100);
    await expect.poll(async () => (await getCamera(page)).zoom).toBeGreaterThan(2);

    // the board location under the pointer maps back to the same screen point
    const invariant = await page.evaluate((at) => {
      const camera = window.__vidi6?.getCamera();
      if (!camera) throw new Error('missing test hook');
      const world = { x: at.x / camera.zoom + camera.x, y: at.y / camera.zoom + camera.y };
      return { x: (world.x - camera.x) * camera.zoom, y: (world.y - camera.y) * camera.zoom };
    }, pointer);
    expect(Math.abs(invariant.x - pointer.x)).toBeLessThanOrEqual(1e-3);
    expect(Math.abs(invariant.y - pointer.y)).toBeLessThanOrEqual(1e-3);
  });
});

test('TC-31 every board gesture leaves the browser page zoom alone', async ({ page }) => {
  await openBoard(page);
  const before = await pageZoomState(page);

  await pinchAt(page, CENTRE, -100);
  await pinchAt(page, CENTRE, 60);
  await page.mouse.move(CENTRE.x, CENTRE.y);
  await page.mouse.wheel(0, 120);
  await dragBoard(page, CENTRE, { x: 70, y: -40 });
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+0');

  const after = await pageZoomState(page);
  expect(after.scale).toBe(1);
  expect(after.scale).toBe(before.scale);
  expect(after.devicePixelRatio).toBe(before.devicePixelRatio);
  expect(after.innerWidth).toBe(before.innerWidth);
  expect(after.innerHeight).toBe(before.innerHeight);

  // the board itself did respond, so this is not a vacuous pass
  await expect(zoomLabel(page)).toHaveText('100%');
  await expectMarkerAt(page, CENTRE);
});
