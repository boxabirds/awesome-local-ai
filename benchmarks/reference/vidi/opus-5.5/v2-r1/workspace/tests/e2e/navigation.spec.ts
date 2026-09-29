import { expect, test } from '@playwright/test';
import { NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import { UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX } from '../../src/shared/config';
import {
  drag,
  expectedSpacing,
  getCamera,
  gridState,
  openBoard,
  originPosition,
  pageZoom,
  setCamera,
  viewport,
  waitForFrame,
  zoomLabel,
} from './helpers/board';

const TOLERANCE_PX = 1;
const VIEW = { width: 1280, height: 800 };

function expectNear(actual: number, expected: number, tol = TOLERANCE_PX) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

function mod(a: number, n: number) {
  return ((a % n) + n) % n;
}

test.describe('Workflow 1: first visit navigation', () => {
  test('TC-28 → TC-23 → TC-24: hint, exact drag, zoom around the pointer', async ({ page }) => {
    await openBoard(page);

    // TC-28: hint visible on load.
    const hint = page.getByText(NAVIGATION_HINT_TEXT);
    await expect(hint).toBeVisible();
    await expect(zoomLabel(page)).toHaveText('100%');

    // Origin starts at the centre of the board area.
    const start = await originPosition(page);
    expectNear(start.x, VIEW.width / 2);
    expectNear(start.y, VIEW.height / 2);
    const gridBefore = await gridState(page);

    // TC-23: drag 200 right and 100 down on empty space.
    await drag(page, { x: 300, y: 300 }, 200, 100);
    const after = await originPosition(page);
    expectNear(after.x - start.x, 200);
    expectNear(after.y - start.y, 100);
    const gridAfter = await gridState(page);
    expect(gridAfter.spacing).toBe(gridBefore.spacing);
    expectNear(
      mod(gridAfter.dot.x - gridBefore.dot.x, gridBefore.spacing),
      mod(200, gridBefore.spacing),
    );
    expectNear(
      mod(gridAfter.dot.y - gridBefore.dot.y, gridBefore.spacing),
      mod(100, gridBefore.spacing),
    );

    // TC-28: hint removed after the first pan.
    await expect(hint).toHaveCount(0);

    // TC-24: Ctrl + wheel over the origin marker keeps it under the pointer.
    const before = await pageZoom(page);
    await page.mouse.move(after.x, after.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await expect(zoomLabel(page)).not.toHaveText('100%');
    await waitForFrame(page);
    const zoomed = await originPosition(page);
    expectNear(zoomed.x, after.x);
    expectNear(zoomed.y, after.y);
    expect((await getCamera(page)).zoom).toBeGreaterThan(1);
    expect(await pageZoom(page)).toEqual(before);

    // Hint stays gone.
    await expect(hint).toHaveCount(0);
  });

  test('plain scroll pans the board', async ({ page }) => {
    await openBoard(page);
    const start = await originPosition(page);
    await page.mouse.move(400, 400);
    await page.mouse.wheel(0, 120);
    await expect.poll(async () => (await originPosition(page)).y).toBeLessThan(start.y);
    await page.mouse.wheel(80, 0);
    await expect.poll(async () => (await originPosition(page)).x).toBeLessThan(start.x);
  });
});

test.describe('Workflow 2: limits and recovery', () => {
  test('TC-25 → TC-26: zoom to max, button disables, reset from far away', async ({ page }) => {
    await openBoard(page);
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    const zoomOut = page.getByRole('button', { name: 'Zoom out' });

    await zoomIn.click();
    await expect(zoomLabel(page)).toHaveText('125%');
    await zoomOut.click();
    await expect(zoomLabel(page)).toHaveText('100%');

    // TC-25: click + until disabled.
    const labels: string[] = [];
    for (let i = 0; i < 20 && (await zoomIn.isEnabled()); i++) {
      const prev = await zoomLabel(page).textContent();
      await zoomIn.click();
      await expect(zoomLabel(page)).not.toHaveText(prev!);
      labels.push((await zoomLabel(page).textContent())!);
    }
    expect(labels.at(-1)).toBe('400%');
    await expect(zoomLabel(page)).toHaveText('400%');
    await expect(zoomIn).toBeDisabled();
    await zoomOut.click();
    await expect(zoomIn).toBeEnabled();

    // Repeatedly zoom out to the minimum.
    for (let i = 0; i < 40 && (await zoomOut.isEnabled()); i++) {
      const prev = await zoomLabel(page).textContent();
      await zoomOut.click();
      await expect(zoomLabel(page)).not.toHaveText(prev!);
    }
    await expect(zoomLabel(page)).toHaveText('10%');
    await expect(zoomOut).toBeDisabled();

    // TC-26: jump far away at max zoom, then Reset view.
    await setCamera(page, {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: -UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    });
    await expect(zoomLabel(page)).toHaveText('400%');
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect(zoomLabel(page)).toHaveText('100%');
    await waitForFrame(page);
    const origin = await originPosition(page);
    expectNear(origin.x, VIEW.width / 2);
    expectNear(origin.y, VIEW.height / 2);
  });

  test('keyboard shortcuts zoom and reset', async ({ page }) => {
    await openBoard(page);
    await viewport(page).click({ position: { x: 50, y: 50 } });
    await page.keyboard.press('Control+Equal');
    await expect(zoomLabel(page)).toHaveText('125%');
    await page.keyboard.press('Control+Minus');
    await expect(zoomLabel(page)).toHaveText('100%');
    await page.keyboard.press('Control+Minus');
    await expect(zoomLabel(page)).toHaveText('80%');
    await page.keyboard.press('Control+Digit0');
    await expect(zoomLabel(page)).toHaveText('100%');
  });
});

test.describe('Workflow 3: far travel', () => {
  test('TC-27 at 1,000,000 units panning is still exact and the grid even', async ({ page }) => {
    await openBoard(page);
    const zoom = 1.5;
    const far = { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom };
    await setCamera(page, far);
    const gridBefore = await gridState(page);
    expectNear(gridBefore.spacing, expectedSpacing(zoom), 1e-3);

    await drag(page, { x: 400, y: 300 }, 200, 100);
    const cam = await getCamera(page);
    expectNear((far.x - cam.x) * zoom, 200);
    expectNear((far.y - cam.y) * zoom, 100);

    const gridAfter = await gridState(page);
    expectNear(gridAfter.spacing, expectedSpacing(zoom), 1e-3);
    const s = gridBefore.spacing;
    expectNear(mod(gridAfter.dot.x - gridBefore.dot.x, s), mod(200, s));
    expectNear(mod(gridAfter.dot.y - gridBefore.dot.y, s), mod(100, s));

    // Also far away in the negative direction.
    await setCamera(page, { x: -UNBOUNDED_PAN_TESTED_EXTENT, y: -UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 });
    await drag(page, { x: 400, y: 300 }, -200, -100);
    const cam2 = await getCamera(page);
    expectNear(cam2.x - -UNBOUNDED_PAN_TESTED_EXTENT, 200);
    expectNear(cam2.y - -UNBOUNDED_PAN_TESTED_EXTENT, 100);
  });
});

test('TC-31 zoom gestures and shortcuts over the board never change page zoom', async ({ page }) => {
  await openBoard(page);
  const before = await pageZoom(page);
  await page.mouse.move(640, 400);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.mouse.wheel(0, 300);
  await page.keyboard.up('Control');
  await page.keyboard.press('Control+Equal');
  await page.keyboard.press('Control+Minus');
  await page.keyboard.press('Control+Digit0');
  await waitForFrame(page);
  expect(await pageZoom(page)).toEqual(before);
  const fontSize = await page
    .locator('.zoom-controls')
    .evaluate((el) => getComputedStyle(el).fontSize);
  expect(fontSize).toBe('14px');
});
