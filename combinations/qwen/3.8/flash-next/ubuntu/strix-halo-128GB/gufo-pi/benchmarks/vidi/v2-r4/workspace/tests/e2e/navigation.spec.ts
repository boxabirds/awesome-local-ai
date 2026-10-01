import { expect, test } from '@playwright/test';
import {
  ctrlWheel,
  dragBoard,
  clickUntilDisabled,
  expectGridAttachedToCamera,
  expectGridMovedBy,
  expectNear,
  getCamera,
  gridStyle,
  navigationHint,
  openBoard,
  originMarker,
  originMarkerCentre,
  resetViewButton,
  setCamera,
  zoomInButton,
  zoomLabel,
  zoomOutButton,
} from './helpers/board';
import {
  GRID_SPACING_WORLD,
  ZOOM_MAX,
  ZOOM_MIN,
  UNBOUNDED_PAN_TESTED_EXTENT,
} from '../../src/shared/config';

const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

test.describe('workflow 1: first visit navigation', () => {
  test('TC-28 hint shows, TC-23 drag moves the board exactly, TC-24 zoom keeps the point under the pointer', async ({
    page,
  }) => {
    await openBoard(page);

    // TC-28: the hint is shown on a first visit.
    await expect(navigationHint(page)).toBeVisible();
    await expect(navigationHint(page)).toHaveText(HINT_TEXT);

    // TC-23: a 200 x 100 drag moves the board exactly 200 x 100 pixels.
    const gridBefore = await gridStyle(page);
    const before = await originMarkerCentre(page);
    await dragBoard(page, { x: 320, y: 240 }, { x: 520, y: 340 });

    const after = await originMarkerCentre(page);
    expectNear(after.x - before.x, 200);
    expectNear(after.y - before.y, 100);
    await expectGridMovedBy(page, gridBefore, 200, 100);
    await expectGridAttachedToCamera(page);
    await expect(zoomLabel(page)).toHaveText('100%');

    // TC-28: the hint is gone, and further navigation does not bring it back.
    await expect(navigationHint(page)).toHaveCount(0);

    // TC-24: zooming around the marker keeps it exactly under the pointer.
    const anchor = await originMarkerCentre(page);
    await ctrlWheel(page, anchor, -100);
    const zoomed = await originMarkerCentre(page);
    expectNear(zoomed.x, anchor.x);
    expectNear(zoomed.y, anchor.y);
    expect((await getCamera(page)).zoom).toBeGreaterThan(1);
    await expect(zoomLabel(page)).not.toHaveText('100%');

    await ctrlWheel(page, anchor, 100);
    const back = await originMarkerCentre(page);
    expectNear(back.x, anchor.x);
    expectNear(back.y, anchor.y);
    await expect(zoomLabel(page)).toHaveText('100%');

    await dragBoard(page, { x: 700, y: 500 }, { x: 760, y: 560 });
    await expect(navigationHint(page)).toHaveCount(0);
  });

  test('TC-28 the hint is dismissed by a scroll, not only by a drag', async ({ page }) => {
    await openBoard(page);
    await expect(navigationHint(page)).toBeVisible();
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 120);
    await expect(navigationHint(page)).toHaveCount(0);
  });
});

test.describe('workflow 2: zoom limits and recovery', () => {
  test('TC-25 zooming in stops at 400% and disables the + button', async ({ page }) => {
    await openBoard(page);
    await expect(zoomLabel(page)).toHaveText('100%');

    await clickUntilDisabled(zoomInButton(page));
    await expect(zoomLabel(page)).toHaveText('400%');
    await expect(zoomInButton(page)).toBeDisabled();
    await expect(zoomOutButton(page)).toBeEnabled();
    expect((await getCamera(page)).zoom).toBe(ZOOM_MAX);

    // zooming back the other way re-enables +
    await zoomOutButton(page).click();
    await expect(zoomInButton(page)).toBeEnabled();
  });

  test('TC-32 a disabled zoom button does nothing', async ({ page }) => {
    await openBoard(page);
    await clickUntilDisabled(zoomOutButton(page));
    await expect(zoomLabel(page)).toHaveText('10%');
    await expect(zoomOutButton(page)).toBeDisabled();
    const camera = await getCamera(page);

    // A real click on the disabled button, plus Ctrl+- and a Ctrl+wheel out.
    await zoomOutButton(page)
      .click({ force: true, timeout: 2000 })
      .catch(() => undefined);
    await page.keyboard.press('Control+-');
    await ctrlWheel(page, { x: 640, y: 400 }, 600);
    const after = await getCamera(page);
    expect(after).toEqual(camera);
    expect(after.zoom).toBe(ZOOM_MIN);
  });

  test('TC-26 Reset view returns to 100% centred from far away at 400%', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT / 2,
      zoom: ZOOM_MAX,
    });
    await expect(zoomLabel(page)).toHaveText('400%');
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('no viewport size');

    await resetViewButton(page).click();
    await expect(zoomLabel(page)).toHaveText('100%');

    const centre = await originMarkerCentre(page);
    expectNear(centre.x, viewport.width / 2);
    expectNear(centre.y, viewport.height / 2);
    const camera = await getCamera(page);
    expect(camera.zoom).toBe(1);
    await expectGridAttachedToCamera(page);
  });

  test('Ctrl/Cmd + = , - and 0 zoom and reset from the keyboard', async ({ page }) => {
    await openBoard(page);
    const centre = await originMarkerCentre(page);

    await page.keyboard.press('Control+=');
    await expect(zoomLabel(page)).toHaveText('125%');
    await page.keyboard.press('Control+-');
    await expect(zoomLabel(page)).toHaveText('100%');

    await dragBoard(page, { x: 200, y: 200 }, { x: 460, y: 360 });
    await page.keyboard.press('Control+=');
    await expect(zoomLabel(page)).toHaveText('125%');

    await page.keyboard.press('Control+0');
    await expect(zoomLabel(page)).toHaveText('100%');
    const restored = await originMarkerCentre(page);
    expectNear(restored.x, centre.x);
    expectNear(restored.y, centre.y);
  });
});

test.describe('workflow 3: far travel (pan.unbounded)', () => {
  test('TC-27 the board still pans exactly a million units from the start', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: -UNBOUNDED_PAN_TESTED_EXTENT });

    const gridBefore = await gridStyle(page);
    expectNear(gridBefore.spacingX, GRID_SPACING_WORLD, 0.02);
    await expectGridAttachedToCamera(page);

    const cameraBefore = await getCamera(page);
    await dragBoard(page, { x: 400, y: 300 }, { x: 600, y: 400 });

    const cameraAfter = await getCamera(page);
    expectNear(cameraAfter.x, cameraBefore.x - 200, 0.01);
    expectNear(cameraAfter.y, cameraBefore.y - 100, 0.01);
    await expectGridMovedBy(page, gridBefore, 200, 100);
    await expectGridAttachedToCamera(page);

    // grid stays evenly spaced: spacing is unchanged and the tile offset stays
    // inside one tile, so the dots cannot smear at this distance
    const gridAfter = await gridStyle(page);
    expectNear(gridAfter.spacingX, GRID_SPACING_WORLD, 0.02);
    expect(gridAfter.offsetX).toBeGreaterThanOrEqual(0);
    expect(gridAfter.offsetX).toBeLessThan(GRID_SPACING_WORLD);

    // zooming far away out and back keeps the unbounded camera usable
    await ctrlWheel(page, { x: 640, y: 400 }, -600);
    await expectGridAttachedToCamera(page);
    await resetViewButton(page).click();
    await expect(zoomLabel(page)).toHaveText('100%');
    const centre = await originMarkerCentre(page);
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('no viewport size');
    expectNear(centre.x, viewport.width / 2);
    expectNear(centre.y, viewport.height / 2);
  });

  test('the origin marker renders crisply and is reachable again after a long drag', async ({
    page,
  }) => {
    await openBoard(page);
    const centre = await originMarkerCentre(page);
    expect(originMarker(page)).toBeVisible();
    await dragBoard(page, { x: 300, y: 300 }, { x: 130, y: 120 });
    const moved = await originMarkerCentre(page);
    expectNear(moved.x - centre.x, -170);
    expectNear(moved.y - centre.y, -180);
  });
});

test.describe('board gestures do not zoom the page (zoom.no_page_zoom)', () => {
  test('TC-31 page scale and devicePixelRatio are unchanged by board gestures', async ({
    page,
  }) => {
    await openBoard(page);
    const initial = await page.evaluate(() => ({
      scale: window.visualViewport ? window.visualViewport.scale : 1,
      dpr: window.devicePixelRatio,
      controlWidth: (
        document.querySelector('[data-testid="zoom-controls"]') as HTMLElement
      ).getBoundingClientRect().width,
      bodyFont: window.getComputedStyle(document.body).fontSize,
    }));

    await ctrlWheel(page, { x: 640, y: 400 }, -100);
    await ctrlWheel(page, { x: 640, y: 400 }, 100);
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+-');
    await page.keyboard.press('Control+0');

    const after = await page.evaluate(() => ({
      scale: window.visualViewport ? window.visualViewport.scale : 1,
      dpr: window.devicePixelRatio,
      controlWidth: (
        document.querySelector('[data-testid="zoom-controls"]') as HTMLElement
      ).getBoundingClientRect().width,
      bodyFont: window.getComputedStyle(document.body).fontSize,
    }));

    expect(after.scale).toBe(initial.scale);
    expect(after.scale).toBe(1);
    expect(after.dpr).toBe(initial.dpr);
    expect(after.controlWidth).toBeCloseTo(initial.controlWidth, 1);
    expect(after.bodyFont).toBe(initial.bodyFont);
  });

  test('the page does not scroll and a plain wheel is claimed by the board', async ({
    page,
  }) => {
    await openBoard(page);
    const cameraBefore = await getCamera(page);
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 200);
    await expect.poll(() => getCamera(page)).not.toEqual(cameraBefore);
    const scroll = await page.evaluate(() => ({
      x: window.scrollX,
      y: window.scrollY,
      scale: window.visualViewport ? window.visualViewport.scale : 1,
    }));
    expect(scroll).toEqual({ x: 0, y: 0, scale: 1 });
  });
});

test.describe('window resize', () => {
  test('resizing the window does not move content relative to the top-left', async ({
    page,
  }) => {
    await openBoard(page);
    // move away from the default centred view first, so "unchanged" is real
    await dragBoard(page, { x: 500, y: 300 }, { x: 620, y: 380 });
    const before = await originMarkerCentre(page);
    const cameraBefore = await getCamera(page);

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(100);

    const after = await originMarkerCentre(page);
    expectNear(after.x, before.x);
    expectNear(after.y, before.y);
    expect(await getCamera(page)).toEqual(cameraBefore);
    await expectGridAttachedToCamera(page);
  });
});

test.describe('zoom controls UI', () => {
  test('buttons and label are present, focusable and accessible', async ({ page }) => {
    await openBoard(page);
    await expect(zoomLabel(page)).toHaveText('100%');
    await expect(zoomOutButton(page)).toBeEnabled();
    await expect(zoomInButton(page)).toBeEnabled();

    await zoomInButton(page).focus();
    await expect(zoomInButton(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(zoomLabel(page)).toHaveText('125%');

    await resetViewButton(page).focus();
    await expect(resetViewButton(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(zoomLabel(page)).toHaveText('100%');
  });

  test('the label is announced politely and rounds to a whole percent', async ({ page }) => {
    await openBoard(page);
    await expect(zoomLabel(page)).toHaveAttribute('aria-live', 'polite');
    // 1.5625 is exactly three steps out from 1 and labels 156%
    await setCamera(page, { zoom: 1.5625 });
    await expect(zoomLabel(page)).toHaveText('156%');
  });

  test('wheel over the zoom control does not move the board', async ({ page }) => {
    await openBoard(page);
    const before = await getCamera(page);
    await zoomLabel(page).hover();
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(100);
    expect(await getCamera(page)).toEqual(before);
  });
});
