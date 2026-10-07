import { test, expect } from '@playwright/test';
import { GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT } from '../../src/shared/config';
import {
  gotoBoard,
  markerCenter,
  zoomLabel,
  gridSpacingPx,
  setCamera,
  dragBoard,
  ctrlWheel,
  pageZoomSignals,
} from './helpers/board';

const VIEWPORT = { width: 1280, height: 800 };
const CENTER = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

test.beforeEach(async ({ page }) => {
  await gotoBoard(page);
  await expect(zoomLabel(page)).toHaveText('100%');
});

test.describe('Workflow 1 - first use, drag, and wheel', () => {
  // TC-28: the hint is visible on first load and disappears after the first pan.
  test('TC-28 the first-use hint disappears after the first pan', async ({ page }) => {
    await expect(page.getByTestId('navigation-hint')).toBeVisible();
    await dragBoard(page, { x: 300, y: 250 }, { x: 420, y: 310 });
    await expect(page.getByTestId('navigation-hint')).toBeHidden();
  });

  // TC-23: a 200x100 mouse drag moves the world origin by exactly (200, 100).
  test('TC-23 dragging the board moves content exactly by the pointer delta', async ({ page }) => {
    const before = await markerCenter(page);
    expect(Math.round(before.x)).toBe(CENTER.x);
    expect(Math.round(before.y)).toBe(CENTER.y);

    await dragBoard(page, { x: 200, y: 200 }, { x: 400, y: 300 }); // delta (200, 100)

    await expect
      .poll(() => markerCenter(page).then((c) => Math.round(c.x - before.x)), { timeout: 3000 })
      .toBe(200);
    await expect
      .poll(() => markerCenter(page).then((c) => Math.round(c.y - before.y)), { timeout: 3000 })
      .toBe(100);
  });

  // TC-24: ctrl + wheel keeps the dot under the pointer and never zooms the page.
  test('TC-24 ctrl + wheel zooms around the pointer without zooming the page', async ({ page }) => {
    const before = await markerCenter(page); // the "dot" sits here
    const scaleBefore = await pageZoomSignals(page);
    expect(scaleBefore.scale).toBe(1);

    await ctrlWheel(page, before, -120); // zoom in over the dot

    // the same dot stays under the pointer (within 1 CSS pixel)
    const after = await markerCenter(page);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);

    // the board actually zoomed
    await expect(zoomLabel(page)).not.toHaveText('100%');

    // the page itself was not zoomed
    const scaleAfter = await pageZoomSignals(page);
    expect(scaleAfter.scale).toBe(1);
  });
});

test.describe('Workflow 2 - zoom controls and reset', () => {
  // TC-25: clicking + repeatedly reaches and clamps at 400% then disables +.
  test('TC-25 zooming in reaches 400% and disables the + button', async ({ page }) => {
    // Drive the + button in-page: click, flush two animation frames so the
    // rAF-batched camera commit updates the disabled state, then read it. This
    // avoids Playwright's auto-waiting click() blocking on the enabled state at
    // the exact moment the button becomes disabled at 400%.
    const clicks = await page.evaluate(async () => {
      const btn = document.querySelector('[data-testid="zoom-in"]') as HTMLButtonElement;
      const twoFrames = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      let n = 0;
      while (!btn.disabled && n < 40) {
        btn.click();
        n++;
        await twoFrames();
      }
      return n;
    });

    expect(clicks).toBeGreaterThan(4); // more than one step is required
    await expect(zoomLabel(page)).toHaveText('400%');
    await expect(page.getByTestId('zoom-in')).toBeDisabled();
  });

  // TC-26: Reset view from far away returns to 100% with world (0,0) centred.
  test('TC-26 reset view returns to a centred origin at 100%', async ({ page }) => {
    await setCamera(page, { x: 400000, y: 300000, zoom: 4 });
    await expect(zoomLabel(page)).toHaveText('400%');

    await page.getByTestId('reset-view').click();

    await expect(zoomLabel(page)).toHaveText('100%');
    const c = await markerCenter(page);
    expect(Math.abs(c.x - CENTER.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(c.y - CENTER.y)).toBeLessThanOrEqual(1);
  });
});

test.describe('Workflow 3 - pan to the tested extent', () => {
  // TC-27: at UNBOUNDED_PAN_TESTED_EXTENT a drag still moves exactly and the
  // dot grid spacing matches GRID_SPACING_WORLD * zoom.
  test('TC-27 panning at the tested extent stays exact and grid spacing matches zoom', async ({
    page,
  }) => {
    const zoom = 2;
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom,
    });

    // grid spacing in pixels == world spacing * zoom
    const spacing = await gridSpacingPx(page);
    expect(spacing).toBeCloseTo(GRID_SPACING_WORLD * zoom, 0);

    const before = await markerCenter(page); // off-screen but measurable
    await dragBoard(page, { x: 200, y: 200 }, { x: 400, y: 300 }); // delta (200, 100)

    await expect
      .poll(() => markerCenter(page).then((c) => Math.round(c.x - before.x)), { timeout: 3000 })
      .toBe(200);
    await expect
      .poll(() => markerCenter(page).then((c) => Math.round(c.y - before.y)), { timeout: 3000 })
      .toBe(100);
  });
});

test.describe('Negative assertions', () => {
  // TC-31: after ctrl + wheel and Ctrl +/-/0, the page is not zoomed.
  test('TC-31 page zoom and devicePixelRatio are unchanged after gestures', async ({ page }) => {
    const before = await pageZoomSignals(page);

    await ctrlWheel(page, CENTER, -200); // zoom in via wheel
    await ctrlWheel(page, CENTER, 200); // zoom out via wheel
    await page.keyboard.down('Control');
    await page.keyboard.press('=');
    await page.keyboard.press('-');
    await page.keyboard.press('0');
    await page.keyboard.up('Control');

    const after = await pageZoomSignals(page);
    expect(after.scale).toBe(before.scale);
    expect(after.dpr).toBe(before.dpr);
  });
});
