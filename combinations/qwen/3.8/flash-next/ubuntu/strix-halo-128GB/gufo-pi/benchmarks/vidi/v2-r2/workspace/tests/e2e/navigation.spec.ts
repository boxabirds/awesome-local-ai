import { test, expect } from '@playwright/test';
import {
  gotoBoard,
  originScreenPos,
  zoomScale,
  gridBackgroundSize,
  setCamera,
} from './helpers/board';
import { ZOOM_STEP_FACTOR, GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT } from '../../src/shared/config';

const HINT = 'Drag to move around \u00b7 Ctrl/Cmd + scroll or pinch to zoom';
const CENTER = { x: 640, y: 400 }; // centre of the 1280x800 viewport

async function dragBy(page: import('@playwright/test').Page, start: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 });
  await page.mouse.up();
}

test.describe('Workflow 1: first-visit navigation', () => {
  // TC-28 -> TC-23 -> TC-24
  test('TC-28 hint shows on load and is removed after the first drag', async ({ page }) => {
    await gotoBoard(page);
    await expect(page.getByTestId('navigation-hint')).toBeVisible();
    await expect(page.getByTestId('navigation-hint')).toContainText(HINT);
    await dragBy(page, { x: 500, y: 300 }, 60, 40);
    await expect(page.getByTestId('navigation-hint')).toHaveCount(0);
    // further navigation does not bring it back
    await dragBy(page, { x: 500, y: 300 }, 20, 10);
    await expect(page.getByTestId('navigation-hint')).toHaveCount(0);
  });

  test('TC-23 dragging the mouse by (200,100) moves the board by exactly that', async ({ page }) => {
    await gotoBoard(page);
    const before = await originScreenPos(page);
    await dragBy(page, { x: 500, y: 250 }, 200, 100);
    const after = await originScreenPos(page);
    expect(after.x - before.x).toBeCloseTo(200, 0);
    expect(after.y - before.y).toBeCloseTo(100, 0);
  });

  test('TC-24 Ctrl+wheel over a dot keeps it under the pointer and never zooms the page', async ({ page }) => {
    await gotoBoard(page);
    await page.mouse.move(CENTER.x, CENTER.y); // pointer over the origin dot
    const before = await originScreenPos(page);
    const zoomBefore = await zoomScale(page);
    const vpScaleBefore = await page.evaluate(() => window.visualViewport?.scale ?? -1);

    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');

    const after = await originScreenPos(page);
    const zoomAfter = await zoomScale(page);
    const vpScaleAfter = await page.evaluate(() => window.visualViewport?.scale ?? -1);

    expect(zoomAfter).toBeGreaterThan(zoomBefore); // board zoomed
    expect(after.x).toBeCloseTo(before.x, 0); // within 1px
    expect(after.y).toBeCloseTo(before.y, 0);
    expect(vpScaleAfter).toBe(1); // page never zoomed
    expect(vpScaleBefore).toBe(1);
  });
});

test.describe('Workflow 2: limits and recovery', () => {
  // TC-25
  test('TC-25 clicking + repeatedly stops at 400% and disables the button', async ({ page }) => {
    await gotoBoard(page);
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    let zoomOut0 = page.getByRole('button', { name: 'Zoom out' });
    // sanity: at 100% both are enabled and a single step is +25%
    expect(zoomOut0).toBeEnabled();
    await zoomIn.click();
    await expect(page.getByTestId('zoom-label')).toHaveText(
      `${Math.round(ZOOM_STEP_FACTOR * 100)}%`,
    );

    for (let i = 0; i < 40; i++) {
      if (await zoomIn.isDisabled()) break;
      await zoomIn.click();
    }
    await expect(zoomIn).toBeDisabled();
    await expect(page.getByTestId('zoom-label')).toHaveText('400%');
    zoomOut0 = page.getByRole('button', { name: 'Zoom out' });
    await expect(zoomOut0).toBeEnabled();
  });

  // TC-26
  test('TC-26 Reset view from far away at max zoom returns to 100% centred', async ({ page }) => {
    await gotoBoard(page);
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 4,
    });
    await page.waitForFunction(() => /scale\(4\)/.test((document.querySelector('[data-testid="board-world"]') as HTMLElement).style.transform));
    await expect(page.getByTestId('zoom-label')).toHaveText('400%');
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect(page.getByTestId('zoom-label')).toHaveText('100%');
    const origin = await originScreenPos(page);
    expect(origin.x).toBeCloseTo(CENTER.x, 0);
    expect(origin.y).toBeCloseTo(CENTER.y, 0);
  });
});

test.describe('Workflow 3: far travel', () => {
  // TC-27
  test('TC-27 at 1,000,000 units the board still pans exactly and the grid is evenly spaced', async ({ page }) => {
    await gotoBoard(page);
    const zoom = 2;
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom,
    });
    await page.waitForFunction(
      (z) => new RegExp(`scale\\(${z}\\)`).test((document.querySelector('[data-testid="board-world"]') as HTMLElement).style.transform),
      zoom,
    );
    // grid spacing must equal GRID_SPACING_WORLD * zoom, in px
    const size = await gridBackgroundSize(page);
    expect(size).toBe(`${GRID_SPACING_WORLD * zoom}px ${GRID_SPACING_WORLD * zoom}px`);

    const before = await originScreenPos(page);
    await dragBy(page, { x: 400, y: 250 }, 200, 100);
    const after = await originScreenPos(page);
    expect(after.x - before.x).toBeCloseTo(200, 0);
    expect(after.y - before.y).toBeCloseTo(100, 0);
  });
});

test.describe('Negative: page zoom never changes', () => {
  // TC-31
  test('TC-31 Ctrl+wheel and Ctrl+=/-/0 leave page scale and devicePixelRatio unchanged', async ({ page }) => {
    await gotoBoard(page);
    const dprBefore = await page.evaluate(() => window.devicePixelRatio);
    const scaleBefore = await page.evaluate(() => window.visualViewport?.scale ?? -1);

    await page.mouse.move(CENTER.x, CENTER.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.mouse.wheel(0, 200);
    await page.keyboard.up('Control');

    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+-');
    await page.keyboard.press('Control+0');

    const dprAfter = await page.evaluate(() => window.devicePixelRatio);
    const scaleAfter = await page.evaluate(() => window.visualViewport?.scale ?? -1);
    expect(scaleAfter).toBe(scaleBefore);
    expect(scaleAfter).toBe(1);
    expect(dprAfter).toBe(dprBefore);
    // and the board is back to 100% after Ctrl+0
    await expect(page.getByTestId('zoom-label')).toHaveText('100%');
  });
});
