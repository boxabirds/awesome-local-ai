import { expect, test } from '@playwright/test';

import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../src/shared/config';
import {
  HINT_TEXT,
  centreOf,
  clickResetView,
  clickZoomUntilDisabled,
  ctrlWheel,
  dragBoard,
  expectGrid,
  expectMarkerAt,
  hint,
  markerCentre,
  metrics,
  mod,
  openBoard,
  readGrid,
  resetViewButton,
  setCamera,
  originMarker,
  viewport,
  zoomInButton,
  zoomOutButton,
  zoomPercentLabel,
} from './helpers/board';

test.describe('workflow 1: first visit navigation', () => {
  // TC-28
  test('TC-28 shows the navigation hint until the first pan, then never again this visit', async ({
    page,
  }) => {
    await openBoard(page);

    await expect(hint(page)).toBeVisible();
    await expect(hint(page)).toHaveText(HINT_TEXT);

    await dragBoard(page, { x: 400, y: 400 }, { x: 500, y: 460 });
    await expect(hint(page)).toHaveCount(0);

    // Further navigation never brings it back during this visit.
    await ctrlWheel(page, { x: 640, y: 400 }, -120);
    await dragBoard(page, { x: 700, y: 500 }, { x: 720, y: 520 });
    await expect(hint(page)).toHaveCount(0);

    // A reload starts a new visit, so the hint returns.
    await page.reload();
    await expect(hint(page)).toBeVisible();
    await expect(hint(page)).toHaveText(HINT_TEXT);
  });

  // TC-23
  test('TC-23 dragging moves the board by exactly the pointer movement', async ({ page }) => {
    await openBoard(page);
    await clickResetView(page);

    const before = await markerCentre(page);
    await dragBoard(page, { x: 400, y: 300 }, { x: 600, y: 400 });

    await expectMarkerAt(page, { x: before.x + 200, y: before.y + 100 });
    await expect(zoomPercentLabel(page)).toHaveText('100%');
  });

  // TC-24
  test('TC-24 ctrl + wheel zooms around the pointer without zooming the page', async ({ page }) => {
    await openBoard(page);
    await clickResetView(page);

    const point = await markerCentre(page);
    const before = await metrics(page);
    expect(before.visualViewportScale).toBe(1);

    await ctrlWheel(page, point, -120);
    await expect(zoomPercentLabel(page)).not.toHaveText('100%');

    // The zoomed board location is still under the pointer ...
    await expectMarkerAt(page, point);
    // ... and the page itself did not zoom.
    const after = await metrics(page);
    expect(after.visualViewportScale).toBe(1);
    expect(after.devicePixelRatio).toBe(before.devicePixelRatio);
  });

  test('TC-24 wheel without a modifier pans instead of zooming', async ({ page }) => {
    await openBoard(page);
    await clickResetView(page);

    const before = await markerCentre(page);
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 100);

    await expectMarkerAt(page, { x: before.x, y: before.y - 100 });
    await expect(zoomPercentLabel(page)).toHaveText('100%');
  });
});

test.describe('workflow 2: limits and recovery', () => {
  // TC-25
  test('TC-25 zooming in with the buttons stops at 400% and disables +', async ({ page }) => {
    await openBoard(page);
    await clickResetView(page);
    await expect(zoomInButton(page)).toBeEnabled();

    // One click is one step: 100% -> 125% and back.
    await zoomInButton(page).click();
    await expect(zoomPercentLabel(page)).toHaveText('125%');
    await zoomOutButton(page).click();
    await expect(zoomPercentLabel(page)).toHaveText('100%');

    const clicks = await clickZoomUntilDisabled(zoomInButton(page));
    expect(clicks).toBeGreaterThan(1);
    await expect(zoomPercentLabel(page)).toHaveText('400%');
    await expect(zoomInButton(page)).toBeDisabled();
    await expect(zoomOutButton(page)).toBeEnabled();

    // Zooming back the other way re-enables +.
    await zoomOutButton(page).click();
    await expect(zoomPercentLabel(page)).toHaveText(
      `${Math.round((ZOOM_MAX / ZOOM_STEP_FACTOR) * 100)}%`,
    );
    await expect(zoomInButton(page)).toBeEnabled();
  });

  // TC-25 / zoom.limits
  test('TC-25 zooming out with the buttons stops at 10% and disables -', async ({ page }) => {
    await openBoard(page);
    await clickResetView(page);

    const clicks = await clickZoomUntilDisabled(zoomOutButton(page));
    expect(clicks).toBeGreaterThan(1);
    await expect(zoomPercentLabel(page)).toHaveText('10%');
    await expect(zoomOutButton(page)).toBeDisabled();
    await expect(zoomInButton(page)).toBeEnabled();

    // The board content really is smaller: one grid tile is 24 * 0.1 px.
    await expectGrid(page, { tile: GRID_SPACING_WORLD * ZOOM_MIN });
  });

  // TC-26
  test('TC-26 Reset view returns to 100% with the board start centred', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    await expect(zoomPercentLabel(page)).toHaveText('400%');

    await resetViewButton(page).click();
    await expect(zoomPercentLabel(page)).toHaveText('100%');

    const centre = centreOf(page);
    await expectMarkerAt(page, centre);
  });
});

test.describe('workflow 3: far travel', () => {
  // TC-27
  test('TC-27 panning 1,000,000 units from the start stays exact with an even grid', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    });

    const before = await readGrid(page);
    await expectGrid(page, { tile: GRID_SPACING_WORLD });

    await dragBoard(page, { x: 300, y: 300 }, { x: 500, y: 400 });

    await expectGrid(page, {
      tile: GRID_SPACING_WORLD,
      offsetX: mod(before.offsetX + 200, before.tile),
      offsetY: mod(before.offsetY + 100, before.tile),
    });
    await expect(zoomPercentLabel(page)).toHaveText('100%');

    // Reset still finds the board start from this far away.
    await resetViewButton(page).click();
    await expectMarkerAt(page, centreOf(page));
  });

  test('TC-27 zooming far from the start, the grid spacing is GRID_SPACING_WORLD * zoom', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, {
      x: -UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    });

    await zoomInButton(page).click();
    await expectGrid(page, { tile: GRID_SPACING_WORLD * ZOOM_STEP_FACTOR });
    await expect(zoomPercentLabel(page)).toHaveText('125%');
  });
});

test.describe('board gestures do not zoom the page', () => {
  // TC-31
  test('TC-31 ctrl + wheel and the keyboard shortcuts leave the page zoom alone', async ({
    page,
  }) => {
    await openBoard(page);
    const baseline = await metrics(page);

    await ctrlWheel(page, { x: 640, y: 400 }, -240);
    await expect(zoomPercentLabel(page)).not.toHaveText('100%');
    await ctrlWheel(page, { x: 640, y: 400 }, 120);
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+-');
    await page.keyboard.press('Control+0');

    await expect(zoomPercentLabel(page)).toHaveText('100%');

    const after = await metrics(page);
    expect(after.visualViewportScale).toBe(baseline.visualViewportScale);
    expect(after.devicePixelRatio).toBe(baseline.devicePixelRatio);
    expect(after.innerWidth).toBe(baseline.innerWidth);
    expect(after.innerHeight).toBe(baseline.innerHeight);

    // The control's own text stayed a normal size; only the board content scaled.
    const box = await zoomPercentLabel(page).boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.height).toBeGreaterThan(8);
      expect(box.height).toBeLessThan(40);
    }
    await expect(viewport(page)).toBeVisible();
    await expect(originMarker(page)).toBeVisible();
  });
});
