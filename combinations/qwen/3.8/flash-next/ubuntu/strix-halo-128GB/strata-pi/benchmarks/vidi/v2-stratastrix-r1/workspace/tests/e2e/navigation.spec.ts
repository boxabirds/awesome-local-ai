import { expect, test, type Page } from '@playwright/test';

import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../../src/shared/config';
import {
  CENTRE,
  clickZoomInUntilDisabled,
  ctrlWheel,
  dragBoard,
  expectClose,
  getCamera,
  gridOffsets,
  gridSpacingPx,
  hintLocator,
  originMarker,
  resetViewButton,
  scrollBoard,
  setCamera,
  startingPoint,
  waitForRender,
  zoomInButton,
  zoomLabel,
  zoomOutButton,
} from './helpers/board';

const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';
/** A screen point over the board: where Reset view puts the starting point. */
const DOT = { x: CENTRE.x, y: CENTRE.y };

/** Height of a rendered text line in CSS pixels: a page-zoom canary. */
async function textHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    const element = document.createElement('div');
    element.style.cssText = 'position:fixed;top:0;left:0;font-size:100px;line-height:1;';
    element.textContent = 'x';
    document.body.append(element);
    const height = element.getBoundingClientRect().height;
    element.remove();
    return height;
  });
}

async function pageZoomState(page: Page) {
  return {
    scale: await page.evaluate(() => window.visualViewport?.scale ?? 1),
    dpr: await page.evaluate(() => window.devicePixelRatio),
    textHeight: await textHeight(page),
    layoutWidth: await page.evaluate(() => window.innerWidth),
  };
}

test.describe('workflow 1: first visit navigation', () => {
  test('TC-28 / TC-23 / TC-24: hint, exact drag, zoom that keeps the pointer still', async ({
    page,
  }) => {
    await page.goto('/');

    // TC-28: the first-use hint is shown near the bottom centre.
    const hint = hintLocator(page);
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(HINT_TEXT);

    const before = await startingPoint(page);
    expectClose(before.x, CENTRE.x);
    expectClose(before.y, CENTRE.y);

    // TC-23: a 200 x 100 drag moves the board - and the grid dot at the starting
    // point - by exactly that distance and direction.
    await dragBoard(page, DOT, 200, 100);
    const afterDrag = await startingPoint(page);
    expectClose(afterDrag.x - before.x, 200);
    expectClose(afterDrag.y - before.y, 100);

    // The hint disappeared with the first pan and does not come back.
    await expect(hint).toHaveCount(0);

    // Scrolling down moves the board content up.
    const beforeScroll = await startingPoint(page);
    await scrollBoard(page, DOT, 0, 100);
    const afterScroll = await startingPoint(page);
    expectClose(afterScroll.y - beforeScroll.y, -100);

    // TC-24: hovering a distinctive grid dot (the one on the starting point, now
    // on whole pixels) and zooming in and out keeps that exact dot under the
    // pointer.
    const dot = await startingPoint(page);
    const pointer = { x: Math.round(dot.x), y: Math.round(dot.y) };
    expect(Math.abs(dot.x - pointer.x)).toBeLessThan(0.01);
    expect(Math.abs(dot.y - pointer.y)).toBeLessThan(0.01);

    await ctrlWheel(page, pointer, -240);
    const zoomedIn = await getCamera(page);
    expect(zoomedIn.zoom).toBeGreaterThan(1);
    const stillThereIn = await startingPoint(page);
    expectClose(stillThereIn.x, pointer.x, 0.05);
    expectClose(stillThereIn.y, pointer.y, 0.05);

    await ctrlWheel(page, pointer, 240);
    const stillThereOut = await startingPoint(page);
    expectClose(stillThereOut.x, pointer.x, 0.05);
    expectClose(stillThereOut.y, pointer.y, 0.05);

    // The dot grid scales with the board and is still drawn: one dot every
    // GRID_SPACING_WORLD board units, at the current zoom.
    expect(zoomedIn.zoom).toBeGreaterThan(1);
    expect(await gridSpacingPx(page)).toBeCloseTo(
      GRID_SPACING_WORLD * (await getCamera(page)).zoom,
      4,
    );

    // The sub-pixel case: a 1.5 x 0.5 pixel drag still moves the board by 1.5 x
    // 0.5 pixels - nothing gets rounded to whole device pixels.
    const beforeSub = await startingPoint(page);
    await dragBoard(page, { x: 700, y: 300 }, 1.5, 0.5);
    const afterSub = await startingPoint(page);
    expect(afterSub.x - beforeSub.x).toBeCloseTo(1.5, 1);
    expect(afterSub.y - beforeSub.y).toBeCloseTo(0.5, 1);

    // The hint never came back during the visit.
    await expect(hint).toHaveCount(0);
  });
});

test.describe('workflow 2: limits and recovery', () => {
  test('TC-25: zooming in stops at 400% and disables the Zoom in button', async ({ page }) => {
    await page.goto('/');
    await expect(zoomLabel(page)).toHaveText('100%');
    await expect(zoomInButton(page)).toBeEnabled();
    await expect(zoomOutButton(page)).toBeEnabled();

    await clickZoomInUntilDisabled(page);

    await expect(zoomLabel(page)).toHaveText('400%');
    await expect(zoomInButton(page)).toBeDisabled();
    await expect(zoomOutButton(page)).toBeEnabled();
    expect((await getCamera(page)).zoom).toBe(ZOOM_MAX);

    // Zooming back the other way re-enables Zoom in.
    await zoomOutButton(page).click();
    await waitForRender(page);
    await expect(zoomLabel(page)).toHaveText('320%');
    await expect(zoomInButton(page)).toBeEnabled();
  });

  test('zooming out stops at 10% and disables the Zoom out button', async ({ page }) => {
    await page.goto('/');
    await setCamera(page, { x: -CENTRE.x, y: -CENTRE.y, zoom: ZOOM_MIN });
    await expect(zoomLabel(page)).toHaveText('10%');
    await expect(zoomOutButton(page)).toBeDisabled();
    await expect(zoomInButton(page)).toBeEnabled();
  });

  test('TC-26: Reset view returns to a centred 100% from far away at 400%', async ({ page }) => {
    await page.goto('/');

    // A place no user could drag to in a session: a million board units away at
    // the maximum zoom.
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    await expect(zoomLabel(page)).toHaveText('400%');
    const far = await startingPoint(page);
    expect(far.x).toBeLessThan(-UNBOUNDED_PAN_TESTED_EXTENT);

    await resetViewButton(page).click();
    await waitForRender(page);

    await expect(zoomLabel(page)).toHaveText('100%');
    const home = await startingPoint(page);
    expectClose(home.x, CENTRE.x);
    expectClose(home.y, CENTRE.y);
    expect(await zoomInButton(page).isEnabled()).toBe(true);
    expect(await zoomOutButton(page).isEnabled()).toBe(true);
  });
});

test.describe('workflow 3: far travel', () => {
  test('TC-27: a million board units out the grid is even and drags stay exact', async ({
    page,
  }) => {
    for (const zoom of [1, ZOOM_MAX]) {
      await page.goto('/');
      await setCamera(page, {
        x: UNBOUNDED_PAN_TESTED_EXTENT,
        y: UNBOUNDED_PAN_TESTED_EXTENT,
        zoom,
      });

      // The grid still draws: one dot every GRID_SPACING_WORLD board units, with
      // offsets kept inside a single cell so the spacing stays even.
      expect(await gridSpacingPx(page)).toBeCloseTo(GRID_SPACING_WORLD * zoom, 6);
      for (const offset of await gridOffsets(page)) {
        expect(offset).toBeGreaterThanOrEqual(-(GRID_SPACING_WORLD * zoom));
        expect(offset).toBeLessThan(GRID_SPACING_WORLD * zoom);
      }

      const before = await startingPoint(page);
      await dragBoard(page, DOT, 200, 100);
      const after = await startingPoint(page);

      // A 200 x 100 drag still moves the board by exactly 200 x 100 pixels.
      expectClose(after.x - before.x, 200);
      expectClose(after.y - before.y, 100);

      const camera = await getCamera(page);
      expect(camera.x).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 200 / zoom, 6);
      expect(camera.y).toBeCloseTo(UNBOUNDED_PAN_TESTED_EXTENT - 100 / zoom, 6);
    }
  });
});

test.describe('board gestures never zoom the page', () => {
  test('TC-31: Ctrl/Cmd gestures and shortcuts leave the page zoom untouched', async ({
    page,
  }) => {
    await page.goto('/');
    const before = await pageZoomState(page);
    expect(before.scale).toBe(1);
    expect(await hintLocator(page).count()).toBe(1);

    await ctrlWheel(page, DOT, -240);
    await ctrlWheel(page, DOT, 240);
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+-');
    await page.keyboard.press('Control+0');
    await waitForRender(page);

    // The gestures reached the board instead of the page: the hint is gone.
    expect(await hintLocator(page).count()).toBe(0);

    // ... and the page itself did not zoom one bit.
    const after = await pageZoomState(page);
    expect(after).toEqual(before);
  });

  test('keyboard zoom and reset shortcuts drive the board', async ({ page }) => {
    await page.goto('/');

    await page.keyboard.press('Control+=');
    await waitForRender(page);
    await expect(zoomLabel(page)).toHaveText('125%');

    await page.keyboard.press('Control+-');
    await waitForRender(page);
    await expect(zoomLabel(page)).toHaveText('100%');

    // Pan away, then Control+0 puts the starting point back in the centre.
    await dragBoard(page, DOT, 300, -120);
    const panned = await startingPoint(page);
    expectClose(panned.x, CENTRE.x + 300);

    await page.keyboard.press('Control+0');
    await waitForRender(page);
    const home = await startingPoint(page);
    expectClose(home.x, CENTRE.x);
    expectClose(home.y, CENTRE.y);
    await expect(zoomLabel(page)).toHaveText('100%');
  });
});

test.describe('empty board', () => {
  test('the board is empty apart from the grid and its starting point', async ({ page }) => {
    await page.goto('/');
    await expect(originMarker(page)).toHaveCount(1);
    await expect(hintLocator(page)).toBeVisible();
    await expect(zoomLabel(page)).toHaveText('100%');
    expect(await page.evaluate(() => document.body.innerText)).not.toMatch(
      /item|element|shape|note|card/i,
    );
  });
});
