import { expect, test } from '@playwright/test';
import { screenToWorld } from '../../src/client/canvas/camera';
import {
  GRID_SPACING_WORLD,
  PERCENT_PER_UNIT,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
import {
  cameraFromDom,
  clickAndWaitForZoomChange,
  expectGridSpacingMatchesCamera,
  gridOffsetPx,
  gridSpacingPx,
  hint,
  openBoard,
  originCentre,
  pageZoomState,
  resetButton,
  setCamera,
  waitForRender,
  viewport,
  zoomInButton,
  zoomLabel,
  zoomOutButton,
  zoomPercentLabel,
} from './helpers/board';

const HINT_TEXT = 'Drag to move around \u00b7 Ctrl/Cmd + scroll or pinch to zoom';

function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

test.describe('workflow 1: first visit navigation', () => {
  // TC-28
  test('TC-28 the hint is shown until the first navigation and never returns', async ({
    page,
  }) => {
    await openBoard(page);
    await expect(hint(page)).toBeVisible();
    await expect(hint(page)).toHaveText(HINT_TEXT);

    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(740, 460, { steps: 6 });
    await page.mouse.up();
    await expect(hint(page)).toHaveCount(0);

    // Further navigation does not bring it back during this visit.
    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(200, 250, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.press('Control+=');
    await expect(hint(page)).toHaveCount(0);
  });

  // TC-23
  test('TC-23 a 200x100 drag moves the board exactly 200x100 pixels', async ({ page }) => {
    await openBoard(page);
    const before = await originCentre(page);
    const spacing = await gridSpacingPx(page);
    const gridBefore = await gridOffsetPx(page);

    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(840, 500, { steps: 10 });
    await page.mouse.up();
    await waitForRender(page);

    const after = await originCentre(page);
    expect(Math.abs(after.x - (before.x + 200))).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - (before.y + 100))).toBeLessThanOrEqual(1);

    // The dot grid moved with the board.
    const gridAfter = await gridOffsetPx(page);
    expect(Math.abs(gridAfter.x - mod(gridBefore.x + 200, spacing))).toBeLessThanOrEqual(1);
    expect(Math.abs(gridAfter.y - mod(gridBefore.y + 100, spacing))).toBeLessThanOrEqual(1);
    await expectGridSpacingMatchesCamera(page);
  });

  // TC-24
  test('TC-24 Ctrl+wheel zooms around the pointer, which does not move', async ({
    page,
  }) => {
    await openBoard(page);
    const marker = await originCentre(page);
    const before = await cameraFromDom(page);
    await page.mouse.move(marker.x, marker.y);

    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await waitForRender(page);

    const zoomAfter = await zoomPercentLabel(page);
    expect(zoomAfter).toBeGreaterThan(PERCENT_PER_UNIT);
    const moved = await originCentre(page);
    expect(Math.abs(moved.x - marker.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(moved.y - marker.y)).toBeLessThanOrEqual(1);

    // Zooming back out around the same pointer restores the original camera.
    // (Control must be held for this wheel too: a plain wheel pans the board.)
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 100);
    await page.keyboard.up('Control');
    await waitForRender(page);
    const restored = await originCentre(page);
    expect(Math.abs(restored.x - marker.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(restored.y - marker.y)).toBeLessThanOrEqual(1);
    expect(await zoomPercentLabel(page)).toBe(PERCENT_PER_UNIT);
    // `before.zoom` is a factor, the label is a percentage: compare like with like.
    expect(before.zoom * PERCENT_PER_UNIT).toBe(PERCENT_PER_UNIT);
    await expectGridSpacingMatchesCamera(page);
  });

  // TC-31
  test('TC-31 board gestures never zoom the browser page', async ({ page }) => {
    await openBoard(page);
    const before = await pageZoomState(page);
    const labelBefore = await zoomLabel(page).innerText();

    await page.mouse.move(640, 400);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.mouse.wheel(0, 200);
    await page.keyboard.up('Control');

    // Plain wheel scrolls the board, not the page.
    await page.mouse.wheel(0, 400);
    // Trackpad-style horizontal scroll.
    await page.mouse.wheel(200, 0);

    // Keyboard zoom and reset.
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+-');
    await page.keyboard.press('Control+0');

    await zoomInButton(page).click();
    await resetButton(page).click();

    const after = await pageZoomState(page);
    expect(after.scale).toBeCloseTo(before.scale, 6);
    expect(after.dpr).toBe(before.dpr);
    // The control is still the same size and shows the board zoom again.
    await expect(zoomLabel(page)).toHaveText(labelBefore);
    const box = await page.getByTestId('zoom-controls').boundingBox();
    const labelBox = await zoomLabel(page).boundingBox();
    expect(box && box.height > 0).toBe(true);
    expect(labelBox && labelBox.height > 0).toBe(true);
  });
});

test.describe('workflow 2: limits and recovery', () => {
  // TC-25
  test('TC-25 zooming in stops at the maximum and disables the + button', async ({
    page,
  }) => {
    await openBoard(page);
    await expect(zoomLabel(page)).toHaveText('100%');

    const seen: number[] = [];
    for (let i = 0; i < 15; i += 1) {
      if (await zoomInButton(page).isDisabled()) break;
      seen.push(await clickAndWaitForZoomChange(page, zoomInButton(page)));
      await expectGridSpacingMatchesCamera(page);
    }

    expect(seen[0]).toBe(Math.round(ZOOM_STEP_FACTOR * PERCENT_PER_UNIT));
    expect(seen[seen.length - 1]).toBe(Math.round(ZOOM_MAX * PERCENT_PER_UNIT));
    await expect(zoomInButton(page)).toBeDisabled();
    await expect(zoomOutButton(page)).toBeEnabled();
    // Every step is a whole-number percentage and monotonic.
    for (const value of seen) {
      expect(Number.isInteger(value)).toBe(true);
    }
    expect(seen).toEqual([...seen].sort((a, b) => a - b));

    // Zooming back the other way re-enables +.
    await zoomOutButton(page).click();
    await expect(zoomInButton(page)).toBeEnabled();
  });

  test('zooming out stops at the minimum and disables the - button', async ({ page }) => {
    await openBoard(page);
    const seen: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      if (await zoomOutButton(page).isDisabled()) break;
      seen.push(await clickAndWaitForZoomChange(page, zoomOutButton(page)));
      await expectGridSpacingMatchesCamera(page);
    }
    expect(seen[seen.length - 1]).toBe(Math.round(ZOOM_MIN * PERCENT_PER_UNIT));
    await expect(zoomOutButton(page)).toBeDisabled();
    await expect(zoomInButton(page)).toBeEnabled();
  });

  test('zoom buttons keep the centre of the board area fixed', async ({ page }) => {
    await openBoard(page);
    const centre = {
      x: (page.viewportSize()?.width ?? 1280) / 2,
      y: (page.viewportSize()?.height ?? 800) / 2,
    };
    const before = await cameraFromDom(page);
    const worldCentreBefore = screenToWorld(before, centre);

    await zoomInButton(page).click();
    await waitForRender(page);

    const after = await cameraFromDom(page);
    expect(after.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 9);
    const worldCentreAfter = screenToWorld(after, centre);
    expect(Math.abs(worldCentreAfter.x - worldCentreBefore.x)).toBeLessThan(1e-6);
    expect(Math.abs(worldCentreAfter.y - worldCentreBefore.y)).toBeLessThan(1e-6);
  });

  // TC-26
  test('TC-26 Reset view returns to 100 % with the starting point centred', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    await expect(zoomLabel(page)).toHaveText('400%');

    await resetButton(page).click();

    await expect(zoomLabel(page)).toHaveText('100%');
    const size = page.viewportSize() ?? { width: 1280, height: 800 };
    const marker = await originCentre(page);
    expect(Math.abs(marker.x - size.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(marker.y - size.height / 2)).toBeLessThanOrEqual(1);
    expect(await cameraFromDom(page)).toEqual({
      x: -size.width / 2,
      y: -size.height / 2,
      zoom: 1,
    });
  });
});

test.describe('workflow 3: far travel', () => {
  // TC-27
  test('TC-27 a million units from the start the board still pans exactly', async ({
    page,
  }) => {
    await openBoard(page);
    const cam = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: -UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 };
    await setCamera(page, cam);

    const spacing = await gridSpacingPx(page);
    expect(Math.abs(spacing - GRID_SPACING_WORLD * cam.zoom)).toBeLessThan(0.5);
    const gridBefore = await gridOffsetPx(page);
    const before = await cameraFromDom(page);

    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(840, 500, { steps: 10 });
    await page.mouse.up();
    await waitForRender(page);

    const after = await cameraFromDom(page);
    // The camera moved by exactly the pointer movement in world units.
    expect(Math.abs(after.x - (before.x - 200 / before.zoom))).toBeLessThan(1e-6);
    expect(Math.abs(after.y - (before.y - 100 / before.zoom))).toBeLessThan(1e-6);
    // The grid is still evenly spaced and moved with the board.
    const gridAfter = await gridOffsetPx(page);
    expect(Math.abs(gridAfter.x - mod(gridBefore.x + 200, spacing))).toBeLessThanOrEqual(1);
    expect(Math.abs(gridAfter.y - mod(gridBefore.y + 100, spacing))).toBeLessThanOrEqual(1);
    await expectGridSpacingMatchesCamera(page);

    // Zooming out to the minimum keeps the grid sane and the camera finite.
    await setCamera(page, { ...after, zoom: ZOOM_MIN });
    const minSpacing = await gridSpacingPx(page);
    expect(Math.abs(minSpacing - GRID_SPACING_WORLD * ZOOM_MIN)).toBeLessThan(0.5);
    const far = await cameraFromDom(page);
    expect(Number.isFinite(far.x)).toBe(true);
    expect(Number.isFinite(far.y)).toBe(true);
  });
});

test.describe('board chrome', () => {
  test('the board fills the window and the controls are in the corner', async ({
    page,
  }) => {
    await openBoard(page);
    const size = page.viewportSize() ?? { width: 1280, height: 800 };
    const box = await viewport(page).boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.width - size.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.height - size.height)).toBeLessThanOrEqual(1);

    const controls = await page.getByTestId('zoom-controls').boundingBox();
    expect(controls).not.toBeNull();
    expect(controls!.x + controls!.width).toBeLessThanOrEqual(size.width);
    expect(controls!.y + controls!.height).toBeLessThanOrEqual(size.height);
    // Bottom-right corner.
    expect(controls!.x + controls!.width).toBeGreaterThan(size.width - 100);
    expect(controls!.y + controls!.height).toBeGreaterThan(size.height - 100);
  });

  test('zoom label is announced and the buttons have accessible names', async ({
    page,
  }) => {
    await openBoard(page);
    await expect(page.getByRole('button', { name: 'Zoom out' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
    await expect(zoomLabel(page)).toHaveAccessibleName('Zoom level');
    expect(await zoomLabel(page).getAttribute('aria-live')).toBe('polite');
  });

  test('the dot grid is visible on an empty board', async ({ page }) => {
    await openBoard(page);
    const background = await viewport(page).evaluate((el) =>
      getComputedStyle(el as HTMLElement).backgroundImage,
    );
    expect(background).toContain('radial-gradient');
    expect(await gridSpacingPx(page)).toBeCloseTo(GRID_SPACING_WORLD, 3);
  });
});
