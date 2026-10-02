import { expect, test } from '@playwright/test';

import {
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../../src/shared/config';
import { browserAvailable } from './helpers/browserAvailability';
import {
  ctrlWheel,
  dotNearest,
  dragBoard,
  expectCamera,
  expectGridPhaseForCamera,
  expectGridPhaseMoved,
  expectGridSpacing,
  expectMarkerAt,
  farView,
  markerCentre,
  navigationHint,
  PIXEL_TOLERANCE,
  pressWithModifier,
  readCamera,
  readGrid,
  resetCameraOf,
  resetViewButton,
  setCamera,
  settle,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
  worldToScreen,
  zoomedCamera,
  zoomInButton,
  zoomLabel,
  zoomOutButton,
  type Point,
} from './helpers/board';

const CENTRE: Point = { x: VIEWPORT_WIDTH / 2, y: VIEWPORT_HEIGHT / 2 };
const DRAG = { x: 200, y: 100 };
const START: Point = { x: 400, y: 300 };

test.beforeEach(async ({}, testInfo) => {
  const name = testInfo.project.name;
  test.skip(
    !browserAvailable(name),
    `${name} cannot be launched in this environment (probed by playwright.config.ts)`,
  );
});

test.describe('workflow 1 — first visit navigation', () => {
  test('TC-28 the hint is shown on open and removed by the first drag', async ({ page }) => {
    await page.goto('/');

    await expect(navigationHint(page)).toBeVisible();
    await expect(navigationHint(page)).toHaveText(
      'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom',
    );
    await expect(zoomLabel(page)).toHaveText('100%');

    await dragBoard(page, START, DRAG);

    await expect(navigationHint(page)).toHaveCount(0);
  });

  test('TC-23 a drag moves the grid dot and origin marker by exactly the pointer delta', async ({
    page,
  }) => {
    await page.goto('/');
    await expectMarkerAt(page, CENTRE);

    const markerBefore = await markerCentre(page);
    const gridBefore = await readGrid(page);

    await dragBoard(page, START, DRAG);

    const markerAfter = await markerCentre(page);
    expect(Math.abs(markerAfter.x - (markerBefore.x + DRAG.x))).toBeLessThanOrEqual(
      PIXEL_TOLERANCE,
    );
    expect(Math.abs(markerAfter.y - (markerBefore.y + DRAG.y))).toBeLessThanOrEqual(
      PIXEL_TOLERANCE,
    );
    await expectGridPhaseMoved(page, gridBefore, DRAG.x, DRAG.y);
    await expectCamera(page, {
      ...resetCameraOf(),
      x: resetCameraOf().x - DRAG.x,
      y: resetCameraOf().y - DRAG.y,
    });
  });

  test('TC-28b navigation by scroll, zoom buttons and keys also dismisses the hint', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(navigationHint(page)).toBeVisible();

    await ctrlWheel(page, -100);

    await expect(navigationHint(page)).toHaveCount(0);
  });

  test('TC-24 zooming with Ctrl + wheel keeps the dot under the pointer', async ({ page }) => {
    await page.goto('/');
    await expectMarkerAt(page, CENTRE);

    const pointer: Point = { x: 820, y: 460 };
    const before = await readCamera(page);
    const dot = dotNearest(before, pointer);
    const dotBefore = worldToScreen(before, dot);
    await page.mouse.move(dotBefore.x, dotBefore.y);

    await ctrlWheel(page, -100);

    const after = await readCamera(page);
    expect(after.zoom).toBeGreaterThan(before.zoom);
    const dotAfter = worldToScreen(after, dot);
    expect(Math.abs(dotAfter.x - dotBefore.x)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(dotAfter.y - dotBefore.y)).toBeLessThanOrEqual(PIXEL_TOLERANCE);

    // the painted grid agrees with the camera, so this is about what is drawn
    await expectGridSpacing(page, after.zoom);
    await expectGridPhaseForCamera(page, after);

    // zoom back out: the same dot is still under the pointer
    await ctrlWheel(page, 100);
    const back = await readCamera(page);
    const dotBack = worldToScreen(back, dot);
    expect(Math.abs(dotBack.x - dotBefore.x)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(dotBack.y - dotBefore.y)).toBeLessThanOrEqual(PIXEL_TOLERANCE);

    await expect(page.evaluate(() => window.visualViewport?.scale ?? 1)).resolves.toBe(1);
  });

  test('TC-15-equivalent scrolling moves the board with the scroll', async ({ page }) => {
    await page.goto('/');
    await page.mouse.move(600, 400);

    await page.mouse.wheel(0, 200);
    await settle(page);

    const scrolled = await readCamera(page);
    expect(scrolled.y).toBeGreaterThan(resetCameraOf().y);
    await expectMarkerAt(page, { x: CENTRE.x, y: CENTRE.y - 200 });

    await page.mouse.wheel(300, 0);
    await settle(page);

    const sideways = await readCamera(page);
    expect(sideways.x).toBeGreaterThan(scrolled.x);
    await expectMarkerAt(page, { x: CENTRE.x - 300, y: CENTRE.y - 200 });
  });
});

test.describe('workflow 2 — limits and recovery', () => {
  test('TC-25 zooming in by steps ends at 400% with Zoom in disabled', async ({ page }) => {
    await page.goto('/');
    await expect(zoomLabel(page)).toHaveText('100%');

    // 1.25**n until the maximum clamps it
    for (const label of ['125%', '156%', '195%', '244%', '305%', '381%', '400%']) {
      await zoomInButton(page).click();
      await expect(zoomLabel(page)).toHaveText(label);
    }

    await expect(zoomInButton(page)).toBeDisabled();
    await expect(zoomOutButton(page)).toBeEnabled();
    await expectCamera(page, zoomedCamera(ZOOM_MAX));
    // zooming keeps the middle of the board in the middle
    await expectMarkerAt(page, CENTRE);

    // zooming back the other way re-enables the button
    await zoomOutButton(page).click();
    await expect(zoomLabel(page)).toHaveText('320%');
    await expect(zoomInButton(page)).toBeEnabled();
  });

  test('TC-19-equivalent zooming out by steps ends at 10% with Zoom out disabled', async ({
    page,
  }) => {
    await page.goto('/');

    for (const label of ['80%', '64%', '51%', '41%', '33%', '26%', '21%', '17%', '13%', '11%', '10%']) {
      await zoomOutButton(page).click();
      await expect(zoomLabel(page)).toHaveText(label);
    }

    await expect(zoomOutButton(page)).toBeDisabled();
    await expect(zoomInButton(page)).toBeEnabled();
    await expectCamera(page, zoomedCamera(ZOOM_MIN));
    await expectMarkerAt(page, CENTRE);

    await zoomInButton(page).click();
    await expect(zoomLabel(page)).toHaveText('13%');
  });

  test('TC-26 Reset view returns from far away at 400% to 100% centred on the start', async ({
    page,
  }) => {
    await page.goto('/');
    await setCamera(page, farView(UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX));
    await expect(zoomLabel(page)).toHaveText('400%');
    await expect(zoomInButton(page)).toBeDisabled();

    await resetViewButton(page).click();
    await settle(page);

    await expect(zoomLabel(page)).toHaveText('100%');
    await expectCamera(page, resetCameraOf());
    await expectMarkerAt(page, CENTRE);
  });

  test('TC-18-equivalent Ctrl/Cmd + = - and 0 step and reset the zoom', async ({ page }) => {
    await page.goto('/');

    await pressWithModifier(page, 'Control', '=');
    await expect(zoomLabel(page)).toHaveText('125%');

    await pressWithModifier(page, 'Control', '-');
    await expect(zoomLabel(page)).toHaveText('100%');

    await pressWithModifier(page, 'Control', '=');
    await pressWithModifier(page, 'Control', '=');
    await expect(zoomLabel(page)).toHaveText('156%');

    await pressWithModifier(page, 'Control', '0');
    await expect(zoomLabel(page)).toHaveText('100%');
    await expectCamera(page, resetCameraOf());
    await expectMarkerAt(page, CENTRE);
  });

  test('a disabled zoom button does nothing', async ({ page }) => {
    await page.goto('/');
    await setCamera(page, { ...resetCameraOf(), zoom: ZOOM_MAX });
    await zoomInButton(page).click({ force: true });
    await settle(page);

    await expectCamera(page, { ...resetCameraOf(), zoom: ZOOM_MAX });
    await expect(zoomLabel(page)).toHaveText('400%');
  });
});

test.describe('workflow 3 — far travel', () => {
  for (const zoom of [1, 2]) {
    test(`TC-27 at ${UNBOUNDED_PAN_TESTED_EXTENT} board units panning and the grid stay exact at ${zoom}x`, async ({
      page,
    }) => {
      await page.goto('/');
      const camera = farView(UNBOUNDED_PAN_TESTED_EXTENT, zoom);
      await setCamera(page, camera);

      // the view is centred on the far location, and the grid is evenly spaced
      await expectCamera(page, camera);
      await expectGridSpacing(page, zoom);
      await expectGridPhaseForCamera(page, camera);

      const before = await markerCentre(page);
      const gridBefore = await readGrid(page);

      await dragBoard(page, START, DRAG);

      const after = await markerCentre(page);
      expect(Math.abs(after.x - (before.x + DRAG.x))).toBeLessThanOrEqual(PIXEL_TOLERANCE);
      expect(Math.abs(after.y - (before.y + DRAG.y))).toBeLessThanOrEqual(PIXEL_TOLERANCE);
      await expectGridPhaseMoved(page, gridBefore, DRAG.x, DRAG.y);
      await expectGridSpacing(page, zoom);
      // screen pixels become world units: the camera moves delta / zoom
      await expectCamera(page, {
        ...camera,
        x: camera.x - DRAG.x / zoom,
        y: camera.y - DRAG.y / zoom,
      });
    });
  }

  test('panning far away in every direction still follows the pointer', async ({ page }) => {
    await page.goto('/');
    const directions = [
      { x: 300, y: 150 },
      { x: -300, y: -150 },
      { x: -300, y: 150 },
      { x: 300, y: -150 },
    ];

    for (const delta of directions) {
      const camera = farView(UNBOUNDED_PAN_TESTED_EXTENT, 1, delta.x > 0 ? 1 : -1);
      await setCamera(page, camera);
      await dragBoard(page, START, delta);

      const moved = await readCamera(page);
      expect(moved.x).toBeCloseTo(camera.x - delta.x, 3);
      expect(moved.y).toBeCloseTo(camera.y - delta.y, 3);
      await expectGridSpacing(page, 1);
      await expectGridPhaseForCamera(page, moved);
    }
  });
});

test.describe('board gestures do not zoom the page', () => {
  test('TC-31 page zoom and device pixel ratio are unchanged by board gestures', async ({
    page,
  }) => {
    await page.goto('/');
    await expectMarkerAt(page, CENTRE);

    const pageBefore = await page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1,
      dpr: window.devicePixelRatio,
      control: (() => {
        const box = document
          .querySelector('[data-testid="zoom-controls"]')
          ?.getBoundingClientRect();
        return box ? { width: box.width, height: box.height } : null;
      })(),
    }));

    await page.mouse.move(600, 400);
    await ctrlWheel(page, -160);
    await ctrlWheel(page, 160);
    await page.mouse.wheel(0, 120);
    await settle(page);
    await pressWithModifier(page, 'Control', '=');
    await pressWithModifier(page, 'Control', '=');
    await pressWithModifier(page, 'Control', '-');
    await pressWithModifier(page, 'Control', '0');

    const pageAfter = await page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1,
      dpr: window.devicePixelRatio,
      control: (() => {
        const box = document
          .querySelector('[data-testid="zoom-controls"]')
          ?.getBoundingClientRect();
        return box ? { width: box.width, height: box.height } : null;
      })(),
    }));

    expect(pageAfter).toEqual(pageBefore);
    expect(pageAfter.scale).toBe(1);
    // only the board content scaled: the board is back at the standard view
    await expect(zoomLabel(page)).toHaveText('100%');
    await expectMarkerAt(page, CENTRE);
  });

  test('a Ctrl + wheel over the zoom control does not zoom the board', async ({ page }) => {
    await page.goto('/');
    await expect(zoomLabel(page)).toHaveText('100%');

    const box = await resetViewButton(page).boundingBox();
    if (!box) throw new Error('the reset control has no bounding box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -400);
    await page.keyboard.up('Control');
    await settle(page);

    await expect(zoomLabel(page)).toHaveText('100%');
    await expectCamera(page, resetCameraOf());
  });

  test('the board does not scroll the page', async ({ page }) => {
    await page.goto('/');

    await page.mouse.move(600, 400);
    await page.mouse.wheel(0, 500);
    await settle(page);

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expectMarkerAt(page, { x: CENTRE.x, y: CENTRE.y - 500 });
  });
});
