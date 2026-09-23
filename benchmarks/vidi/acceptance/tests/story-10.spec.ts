// Story 10 — Draw shapes and connect them with arrows that follow when moved.
import { test, expect, requires, openBoard, clickEmpty, box, drag, shot, mod } from './fixtures';
import type { Page } from '@playwright/test';

const PIXEL_TOLERANCE = 2;
const SHAPE_DEFAULT_SIZE_WORLD = 160;
const DRAG_W = 200;
const DRAG_H = 120;

const handles = (p: Page) => p.locator('[aria-label^="Resize "]');

// Bounding box of the current selection, from its resize handles (declared by story 7).
async function selectionBox(p: Page) {
  const n = await handles(p).count();
  expect(n).toBeGreaterThan(0);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const b = await box(handles(p).nth(i));
    x0 = Math.min(x0, b.x + b.width / 2); y0 = Math.min(y0, b.y + b.height / 2);
    x1 = Math.max(x1, b.x + b.width / 2); y1 = Math.max(y1, b.y + b.height / 2);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// Board-level SVG lines/paths that are not strokes (story 11) — i.e. connectors.
const connectorCount = (p: Page) => p.evaluate(() =>
  document.querySelectorAll('svg line, svg path[marker-end], svg [marker-end]').length);

test.describe('story 10 @s10', () => {
  test.beforeEach(() => requires(10));

  test('drag creates a shape exactly covering the dragged area, then Select is active @ref prd:shape.drag', async ({ page }) => {
    await openBoard(page);
    await page.keyboard.press('s');
    await drag(page, { x: 300, y: 250 }, { x: 300 + DRAG_W, y: 250 + DRAG_H });
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
    const b = await selectionBox(page);
    expect(Math.abs(b.width - DRAG_W)).toBeLessThan(PIXEL_TOLERANCE * 2);
    expect(Math.abs(b.height - DRAG_H)).toBeLessThan(PIXEL_TOLERANCE * 2);
    expect(Math.abs(b.x - 300)).toBeLessThan(PIXEL_TOLERANCE * 2);
  });

  test('click drops a standard 160×160 shape centred on the point @ref prd:shape.click', async ({ page }) => {
    await openBoard(page);
    await page.keyboard.press('s');
    await page.mouse.click(600, 400);
    const b = await selectionBox(page);
    expect(Math.abs(b.width - SHAPE_DEFAULT_SIZE_WORLD)).toBeLessThan(PIXEL_TOLERANCE * 2);
    expect(Math.abs(b.x + b.width / 2 - 600)).toBeLessThan(PIXEL_TOLERANCE * 2);
  });

  test('shift constrains new shape to a square @ref prd:shape.shift', async ({ page }) => {
    await openBoard(page);
    await page.keyboard.press('s');
    await drag(page, { x: 300, y: 250 }, { x: 300 + DRAG_W, y: 250 + DRAG_H }, { shift: true });
    const b = await selectionBox(page);
    expect(Math.abs(b.width - b.height)).toBeLessThan(PIXEL_TOLERANCE * 2);
    expect(Math.abs(b.width - DRAG_W)).toBeLessThan(PIXEL_TOLERANCE * 2);
  });

  test('double-click labels a shape @ref prd:shape.label', async ({ page }) => {
    await openBoard(page);
    await page.keyboard.press('s');
    await page.mouse.click(600, 400);
    await page.keyboard.press('Escape');
    await clickEmpty(page);
    await page.mouse.dblclick(600, 400);
    await page.keyboard.type('Checkout');
    await page.keyboard.press('Escape');
    await expect(page.getByText('Checkout', { exact: true })).toBeVisible();
    const t = await box(page.getByText('Checkout', { exact: true }));
    expect(Math.abs(t.x + t.width / 2 - 600)).toBeLessThan(PIXEL_TOLERANCE * 4);
  });

  test('fill and outline swatches exist for a selected shape @ref prd:shape.colour', async ({ page }) => {
    await openBoard(page);
    await page.keyboard.press('s');
    await page.mouse.click(600, 400);
    await expect(page.locator('button[aria-label$=" fill" i]')).toHaveCount(7);
    await expect(page.locator('button[aria-label$=" outline" i]')).toHaveCount(6);
  });

  test('golden path: connector joins two shapes and follows when moved @ref prd:connector.follow', async ({ page }) => {
    await openBoard(page);
    await page.keyboard.press('s');
    await page.mouse.click(350, 400);
    await page.keyboard.press('s');
    await page.mouse.click(850, 400);
    await clickEmpty(page);
    const before = await connectorCount(page);
    await page.keyboard.press('l');
    await drag(page, { x: 350, y: 400 }, { x: 850, y: 400 }, { steps: 20 });
    await expect.poll(() => connectorCount(page)).toBeGreaterThan(before);
    await shot(page, 's10-connected');
    await page.keyboard.press('v');
    await clickEmpty(page);
    // Move the right shape down; the arrow's geometry must change with it.
    const lineBefore = await page.evaluate(() => {
      const el = document.querySelector('svg line, svg [marker-end]');
      return el ? el.getBoundingClientRect().toJSON() : null;
    });
    await drag(page, { x: 870, y: 420 }, { x: 870, y: 620 });
    const lineAfter = await page.evaluate(() => {
      const el = document.querySelector('svg line, svg [marker-end]');
      return el ? el.getBoundingClientRect().toJSON() : null;
    });
    expect(lineBefore).not.toBeNull();
    expect(lineAfter!.height).toBeGreaterThan(lineBefore!.height + 50);
  });

  test('connector drag of a few pixels creates nothing @ref prd:connector.no_accidental', async ({ page }) => {
    await openBoard(page);
    const before = await connectorCount(page);
    await page.keyboard.press('l');
    await drag(page, { x: 500, y: 400 }, { x: 503, y: 401 }, { steps: 2 });
    await page.waitForTimeout(300);
    expect(await connectorCount(page)).toBe(before);
  });

  test('Escape with Shape tool returns to Select without creating @ref prd:tool.return', async ({ page }) => {
    await openBoard(page);
    await page.keyboard.press('s');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press(`${mod}+KeyA`);
    await expect(handles(page)).toHaveCount(0);
  });
});
