import { expect, test } from '@playwright/test';
import {
  GRID_SPACING_WORLD,
  PERCENT,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../../src/shared/config';
import { canZoomIn, canZoomOut, resetCamera, zoomPercent, zoomStep } from '../../src/client/canvas/camera';
import {
  dragBoard,
  hint,
  isMultipleOf,
  marker,
  markerCentre,
  openBoard,
  readCamera,
  readGrid,
  resetButton,
  scrollBoard,
  setCamera,
  settle,
  VIEWPORT,
  worldLayer,
  zoomInButton,
  zoomLabel,
  zoomNumber,
  zoomOutButton,
  zoomText,
} from './helpers/board';

/** Pixel tolerance from the PRD ("within 1 pixel"). */
const PX = 1;
const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

test.describe('workflow 1: first visit navigation', () => {
  test('TC-28: the navigation hint shows on load and is gone after the first drag', async ({
    page,
  }) => {
    await openBoard(page);
    await expect(hint(page)).toBeVisible();
    await expect(hint(page)).toHaveText(HINT_TEXT);

    await dragBoard(page, { x: 400, y: 250 }, { x: 600, y: 400 });
    await expect(hint(page)).toHaveCount(0);

    // Further navigation does not bring it back during this visit.
    await dragBoard(page, { x: 600, y: 400 }, { x: 300, y: 500 });
    await scrollBoard(page, { x: 640, y: 400 }, { y: 120 });
    await scrollBoard(page, { x: 640, y: 400 }, { y: -120 }, 'Control');
    await expect(hint(page)).toHaveCount(0);
  });

  test('TC-23: a 200 x 100 drag moves the board exactly 200 x 100 pixels', async ({ page }) => {
    await openBoard(page);
    const before = await markerCentre(page);
    const gridBefore = await readGrid(page);

    await dragBoard(page, { x: 300, y: 200 }, { x: 500, y: 300 });

    const after = await markerCentre(page);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(PX);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(PX);

    // The dot grid moved with the board: dots repeat every spacing, so the offset the
    // grid moved is congruent with the pointer delta modulo the spacing.
    const gridAfter = await readGrid(page);
    expect(gridAfter.spacing).toBeCloseTo(gridBefore.spacing, 1);
    expect(isMultipleOf(gridAfter.x - gridBefore.x - 200, gridAfter.spacing, 0.5)).toBe(true);
    expect(isMultipleOf(gridAfter.y - gridBefore.y - 100, gridAfter.spacing, 0.5)).toBe(true);
  });

  test('TC-24: zooming with Ctrl + wheel keeps the point under the pointer fixed', async ({
    page,
  }) => {
    await openBoard(page);
    const pointer = await markerCentre(page);
    const scaleBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);

    await scrollBoard(page, pointer, { y: -100 }, 'Control');
    expect(await zoomNumber(page)).toBeGreaterThan(100);
    const zoomed = await markerCentre(page);
    expect(Math.abs(zoomed.x - pointer.x)).toBeLessThanOrEqual(PX);
    expect(Math.abs(zoomed.y - pointer.y)).toBeLessThanOrEqual(PX);

    // Zooming back out again keeps it there too.
    await scrollBoard(page, pointer, { y: 100 }, 'Control');
    const back = await markerCentre(page);
    expect(Math.abs(back.x - pointer.x)).toBeLessThanOrEqual(PX);
    expect(Math.abs(back.y - pointer.y)).toBeLessThanOrEqual(PX);

    // The browser page zoom was not affected.
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(scaleBefore);
  });

  test('TC-15 (browser): plain scrolling moves the board in the scroll direction', async ({
    page,
  }) => {
    await openBoard(page);
    const before = await markerCentre(page);

    await scrollBoard(page, { x: 400, y: 400 }, { y: 100 });
    const after = await markerCentre(page);
    // Scrolling down moves content up.
    expect(after.y).toBeLessThan(before.y - 50);

    await scrollBoard(page, { x: 400, y: 400 }, { x: 100 });
    const afterRight = await markerCentre(page);
    // Scrolling right moves content left.
    expect(afterRight.x).toBeLessThan(after.x - 50);
  });

  test('the dot grid spacing on screen is GRID_SPACING_WORLD * zoom', async ({ page }) => {
    await openBoard(page);
    expect((await readGrid(page)).spacing).toBeCloseTo(GRID_SPACING_WORLD, 1);

    await zoomInButton(page).click();
    await settle(page);
    const zoom = (await zoomNumber(page)) / PERCENT;
    expect((await readGrid(page)).spacing).toBeCloseTo(GRID_SPACING_WORLD * zoom, 1);
  });
});

test.describe('workflow 2: limits and recovery', () => {
  test('TC-25: zooming in with the button ends at 400% with the button disabled', async ({
    page,
  }) => {
    await openBoard(page);

    // Expected label sequence, derived from the camera maths (one ZOOM_STEP_FACTOR per click).
    const expected: number[] = [zoomPercent(resetCamera(VIEWPORT))];
    let camera = resetCamera(VIEWPORT);
    while (canZoomIn(camera)) {
      camera = zoomStep(camera, VIEWPORT, 'in');
      expected.push(zoomPercent(camera));
    }

    const observed: number[] = [await zoomNumber(page)];
    for (let clicks = 0; clicks < expected.length + 5; clicks += 1) {
      if (await zoomInButton(page).isDisabled()) {
        break;
      }
      await zoomInButton(page).click();
      await settle(page);
      observed.push(await zoomNumber(page));
    }

    expect(observed).toEqual(expected);
    expect(observed.at(-1)).toBe(ZOOM_MAX * PERCENT);
    await expect(zoomInButton(page)).toBeDisabled();
    await expect(zoomLabel(page)).toHaveText(`${ZOOM_MAX * PERCENT}%`);

    // Zooming back the other way re-enables zoom in.
    await zoomOutButton(page).click();
    await settle(page);
    await expect(zoomInButton(page)).toBeEnabled();
    expect(await zoomNumber(page)).toBeLessThan(ZOOM_MAX * PERCENT);

    // And zooming back out all the way disables zoom out at ZOOM_MIN.
    camera = resetCamera(VIEWPORT);
    const expectedOut: number[] = [zoomPercent(camera)];
    while (canZoomOut(camera)) {
      camera = zoomStep(camera, VIEWPORT, 'out');
      expectedOut.push(zoomPercent(camera));
    }
    const observedOut: number[] = [await zoomNumber(page)];
    for (let clicks = 0; clicks < expectedOut.length + 5; clicks += 1) {
      if (await zoomOutButton(page).isDisabled()) {
        break;
      }
      await zoomOutButton(page).click();
      await settle(page);
      observedOut.push(await zoomNumber(page));
    }
    expect(observedOut.at(-1)).toBe(ZOOM_MIN * PERCENT);
    await expect(zoomOutButton(page)).toBeDisabled();
  });

  test('TC-26: Reset view returns to 100% centred on the starting point from far away', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    await expect(zoomLabel(page)).toHaveText(`${ZOOM_MAX * PERCENT}%`);
    const farAway = await markerCentre(page);
    expect(Math.abs(farAway.x - VIEWPORT.width / 2)).toBeGreaterThan(100);

    await resetButton(page).click();
    await settle(page);

    await expect(zoomLabel(page)).toHaveText('100%');
    const centre = await markerCentre(page);
    expect(Math.abs(centre.x - VIEWPORT.width / 2)).toBeLessThanOrEqual(PX);
    expect(Math.abs(centre.y - VIEWPORT.height / 2)).toBeLessThanOrEqual(PX);
  });

  test('keyboard shortcuts zoom the board and never the page', async ({ page }) => {
    await openBoard(page);
    const controlBox = await page.getByTestId('zoom-controls').boundingBox();

    await page.keyboard.press('Control+=');
    await settle(page);
    expect(await zoomNumber(page)).toBe(zoomPercent(zoomStep(resetCamera(VIEWPORT), VIEWPORT, 'in')));

    await page.keyboard.press('Control+-');
    await settle(page);
    expect(await zoomNumber(page)).toBe(1 * PERCENT);

    await page.keyboard.press('Control+=');
    await settle(page);
    await page.keyboard.press('Control+0');
    await settle(page);
    expect(await zoomNumber(page)).toBe(1 * PERCENT);
    const centre = await markerCentre(page);
    expect(Math.abs(centre.x - VIEWPORT.width / 2)).toBeLessThanOrEqual(PX);

    // The page itself never scaled: the control is the same size as before.
    const afterBox = await page.getByTestId('zoom-controls').boundingBox();
    expect(afterBox?.height).toBeCloseTo(controlBox?.height ?? -1, 1);
  });

  test('TC-31: board zoom gestures leave the page zoom untouched', async ({ page }) => {
    await openBoard(page);
    const before = await page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1,
      dpr: window.devicePixelRatio,
      textHeight: (document.querySelector('.zoom-controls__reset') as HTMLElement).getBoundingClientRect()
        .height,
    }));

    await scrollBoard(page, { x: 640, y: 400 }, { y: -240 }, 'Control');
    await scrollBoard(page, { x: 640, y: 400 }, { y: 240 }, 'Control');
    await page.keyboard.press('Control+=');
    await settle(page);
    await page.keyboard.press('Control+-');
    await settle(page);
    await page.keyboard.press('Control+0');
    await settle(page);

    expect(await zoomNumber(page)).toBe(1 * PERCENT);
    const after = await page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1,
      dpr: window.devicePixelRatio,
      textHeight: (document.querySelector('.zoom-controls__reset') as HTMLElement).getBoundingClientRect()
        .height,
    }));
    expect(after.scale).toBe(before.scale);
    expect(after.dpr).toBe(before.dpr);
    expect(after.textHeight).toBeCloseTo(before.textHeight, 1);
  });
});

test.describe('workflow 3: far travel', () => {
  test('TC-27: at 1,000,000 units the grid is evenly spaced and dragging is exact', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    });

    const cameraBefore = await readCamera(page);
    const gridBefore = await readGrid(page);
    expect(gridBefore.spacing).toBeCloseTo(GRID_SPACING_WORLD, 1);

    await dragBoard(page, { x: 400, y: 300 }, { x: 600, y: 400 });

    const cameraAfter = await readCamera(page);
    expect(Math.abs(cameraAfter.x - (cameraBefore.x - 200))).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(cameraAfter.y - (cameraBefore.y - 100))).toBeLessThanOrEqual(1e-6);

    const gridAfter = await readGrid(page);
    expect(gridAfter.spacing).toBeCloseTo(GRID_SPACING_WORLD, 1);
    expect(isMultipleOf(gridAfter.x - gridBefore.x - 200, gridAfter.spacing, 0.5)).toBe(true);
    expect(isMultipleOf(gridAfter.y - gridBefore.y - 100, gridAfter.spacing, 0.5)).toBe(true);

    // The browser still resolves the far-away board to sub-pixel accuracy.
    const matrix = await worldLayer(page).evaluate((element) => getComputedStyle(element).transform);
    const [a, e, f] = parseMatrix(matrix);
    expect(a).toBeCloseTo(cameraAfter.zoom, 3);
    expect(e).toBeCloseTo(-cameraAfter.x * cameraAfter.zoom, 0);
    expect(f).toBeCloseTo(-cameraAfter.y * cameraAfter.zoom, 0);
  });

  test('TC-27b: panning far away at maximum zoom still follows the pointer exactly', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    const cameraBefore = await readCamera(page);
    const gridBefore = await readGrid(page);
    expect(gridBefore.spacing).toBeCloseTo(GRID_SPACING_WORLD * ZOOM_MAX, 1);

    await dragBoard(page, { x: 300, y: 600 }, { x: 500, y: 400 });

    const cameraAfter = await readCamera(page);
    expect(Math.abs(cameraAfter.x - (cameraBefore.x - 200 / ZOOM_MAX))).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(cameraAfter.y - (cameraBefore.y + 200 / ZOOM_MAX))).toBeLessThanOrEqual(1e-6);
    expect((await readGrid(page)).spacing).toBeCloseTo(GRID_SPACING_WORLD * ZOOM_MAX, 1);
  });

  test('TC-26b: reset works after a long trip and zoom, and the marker is centred', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 });
    await dragBoard(page, { x: 200, y: 200 }, { x: 900, y: 700 });
    await page.keyboard.press('Control+=');
    await settle(page);

    await resetButton(page).click();
    await settle(page);
    expect(await zoomText(page)).toBe(`${1 * PERCENT}%`);
    const centre = await markerCentre(page);
    expect(Math.abs(centre.x - VIEWPORT.width / 2)).toBeLessThanOrEqual(PX);
    expect(Math.abs(centre.y - VIEWPORT.height / 2)).toBeLessThanOrEqual(PX);
    await expect(marker(page)).toBeVisible();
  });
});

/** Parse a computed `matrix(a, b, c, d, e, f)` into scale-x and the translation. */
function parseMatrix(value: string): [number, number, number] {
  const numbers = value
    .replace(/^matrix(3d)?\(/, '')
    .replace(/\)$/, '')
    .split(',')
    .map((part) => Number.parseFloat(part.trim()));
  if (numbers.length === 6) {
    const [a, , , , e, f] = numbers as [number, number, number, number, number, number];
    return [a, e, f];
  }
  if (numbers.length === 16) {
    return [numbers[0] as number, numbers[12] as number, numbers[13] as number];
  }
  throw new Error(`unrecognised transform: ${value}`);
}
