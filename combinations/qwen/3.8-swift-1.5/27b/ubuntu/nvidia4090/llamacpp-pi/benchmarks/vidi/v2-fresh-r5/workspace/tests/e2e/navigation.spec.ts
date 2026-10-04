import { test, expect } from '@playwright/test';
import { gotoBoard, originCenter, readZoomLabel, setCamera } from './helpers/board';
import { GRID_SPACING_WORLD, UNBOUNDED_PAN_TESTED_EXTENT } from '../../src/shared/config';

const CENTER = { x: 640, y: 400 };
const HINT = /Drag to move around/;

async function dragBy(page: any, dx: number, dy: number) {
  await page.mouse.move(CENTER.x, CENTER.y);
  await page.mouse.down();
  await page.mouse.move(CENTER.x + dx, CENTER.y + dy, { steps: 10 });
  await page.mouse.up();
}

async function pageZoom(page: any) {
  return page.evaluate(() => ({
    scale: (window.visualViewport && window.visualViewport.scale) || 1,
    dpr: window.devicePixelRatio,
  }));
}

async function worldEF(page: any) {
  return page.locator('[data-testid="world"]').evaluate((el: HTMLElement) => {
    const m = getComputedStyle(el).transform;
    if (m === 'none') return { e: 0, f: 0 };
    const parts = m.slice(m.indexOf('(') + 1, -1).split(',').map(Number);
    return { e: parts[4], f: parts[5] };
  });
}

test.describe('Workflow 1: first visit navigation', () => {
  test('TC-28 hint is visible on load and removed after the first drag', async ({ page }) => {
    await gotoBoard(page);
    const hint = page.getByText(HINT);
    await expect(hint).toBeVisible();
    await dragBy(page, 120, 60);
    await expect(hint).not.toBeVisible();
  });

  test('TC-23 a real drag moves the origin by exactly (200,100)', async ({ page }) => {
    await gotoBoard(page);
    const before = await originCenter(page);
    await dragBy(page, 200, 100);
    const after = await originCenter(page);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);
  });

  test('TC-24 Ctrl+wheel zooms around the pointer and does not zoom the page', async ({ page }) => {
    await gotoBoard(page);
    const o = await originCenter(page);
    await page.mouse.move(o.x, o.y); // pointer over the origin
    const before = await originCenter(page);
    const scaleBefore = (await pageZoom(page)).scale;
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    const after = await originCenter(page);
    const scaleAfter = (await pageZoom(page)).scale;
    // The board point under the pointer (the origin) stays under the pointer.
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    // The board actually zoomed (label is no longer 100%).
    expect(await readZoomLabel(page)).not.toBe('100%');
    // Page zoom is unchanged.
    expect(scaleBefore).toBe(1);
    expect(scaleAfter).toBe(1);
  });
});

test.describe('Workflow 2: limits and recovery', () => {
  test('TC-25 clicking + reaches 400% and disables the button', async ({ page }) => {
    await gotoBoard(page);
    const plus = page.getByRole('button', { name: 'Zoom in' });
    for (let i = 0; i < 30 && !(await plus.isDisabled()); i++) {
      await plus.click();
    }
    await expect(plus).toBeDisabled();
    expect(await readZoomLabel(page)).toBe('400%');
  });

  test('TC-26 Reset view from far away returns to 100% centred on the origin', async ({ page }) => {
    await gotoBoard(page);
    await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: UNBOUNDED_PAN_TESTED_EXTENT, zoom: 4 });
    await page.getByRole('button', { name: 'Reset view' }).click();
    expect(await readZoomLabel(page)).toBe('100%');
    const o = await originCenter(page);
    expect(Math.abs(o.x - CENTER.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(o.y - CENTER.y)).toBeLessThanOrEqual(1);
  });
});

test.describe('Workflow 3: far travel', () => {
  test('TC-27 at 1,000,000 units panning is exact and the grid spacing is correct', async ({ page }) => {
    await gotoBoard(page);
    await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: 0, zoom: 1 });
    const bg = await page
      .locator('[role="application"]')
      .evaluate((el: HTMLElement) => getComputedStyle(el).backgroundSize);
    expect(bg).toBe(`${GRID_SPACING_WORLD}px ${GRID_SPACING_WORLD}px`);

    const before = await worldEF(page);
    await dragBy(page, 200, 100);
    const after = await worldEF(page);
    expect(Math.abs(after.e - before.e - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.f - before.f - 100)).toBeLessThanOrEqual(1);
  });
});

test('TC-31 board gestures never change the page zoom', async ({ page }) => {
  await gotoBoard(page);
  const before = await pageZoom(page);
  // Ctrl/Cmd + wheel.
  await page.mouse.move(CENTER.x, CENTER.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  // Ctrl/Cmd + = / - / 0.
  await page.keyboard.down('Control');
  await page.keyboard.press('=');
  await page.keyboard.press('-');
  await page.keyboard.press('0');
  await page.keyboard.up('Control');
  const after = await pageZoom(page);
  expect(after.scale).toBe(before.scale);
  expect(after.scale).toBe(1);
  expect(after.dpr).toBe(before.dpr);
});
