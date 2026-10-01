import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { SHAPE_DEFAULT_SIZE_WORLD } from '../../src/shared/config';
import { setCamera } from './helpers/board';
import { closeAll, openParticipants } from './helpers/participants';

const shapes = (page: Page) => page.locator('[data-shape-object]');

async function shapeBox(page: Page, index = 0) {
  return shapes(page).nth(index).evaluate((el) => {
    const e = el as HTMLElement;
    return { left: parseFloat(e.style.left), top: parseFloat(e.style.top), width: parseFloat(e.style.width), height: parseFloat(e.style.height) };
  });
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(to[0], to[1], { steps: 4 });
  await page.mouse.up();
}

test.describe('shapes', () => {
  test('TC-23 dragging with the Shape tool creates a shape exactly covering the dragged area', async ({ browser }) => {
    const [a] = await openParticipants(browser, 1);
    try {
      const page = a.page;
      await setCamera(page, { x: 0, y: 0, zoom: 1 });
      await page.keyboard.press('s');
      await expect(page.getByRole('button', { name: 'Shape (S)' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: 'Rectangle' })).toHaveAttribute('aria-pressed', 'true');
      await drag(page, [100, 100], [300, 220]);
      await expect(shapes(page)).toHaveCount(1);
      const b = await shapeBox(page);
      expect(Math.abs(b.left - 100)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.top - 100)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.width - 200)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.height - 120)).toBeLessThanOrEqual(1);
      await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
      await expect(shapes(page).first()).toHaveAttribute('data-selected', 'true');
    } finally {
      await closeAll([a]);
    }
  });

  test('TC-24 a diamond dropped by clicking at 200% is 160x160, and its label wraps and stays centred when resized', async ({ browser }) => {
    const [a] = await openParticipants(browser, 1);
    try {
      const page = a.page;
      await setCamera(page, { x: 0, y: 0, zoom: 2 });
      await page.keyboard.press('s');
      await page.getByRole('button', { name: 'Diamond' }).click();
      await page.mouse.click(600, 400);
      await expect(shapes(page)).toHaveCount(1);
      const b = await shapeBox(page);
      expect(b.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(b.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
      expect(Math.abs(b.left + b.width / 2 - 300)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.top + b.height / 2 - 200)).toBeLessThanOrEqual(1);

      await shapes(page).first().dblclick();
      await expect(page.getByRole('textbox')).toBeFocused();
      await page.keyboard.insertText('A label that is much longer than the shape is wide');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('textbox')).toHaveCount(0);

      const label = shapes(page).first().locator('.shape-label-text');
      const metrics = async () => {
        const [text, shape] = await Promise.all([label.boundingBox(), shapes(page).first().boundingBox()]);
        if (!text || !shape) throw new Error('not visible');
        const lineHeight = await label.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
        return {
          lines: Math.round(text.height / (lineHeight * 2)),
          dx: text.x + text.width / 2 - (shape.x + shape.width / 2),
          dy: text.y + text.height / 2 - (shape.y + shape.height / 2),
          width: text.width,
          shapeWidth: shape.width,
        };
      };
      const before = await metrics();
      expect(before.lines).toBeGreaterThanOrEqual(2);
      expect(before.width).toBeLessThanOrEqual(before.shapeWidth);
      expect(Math.abs(before.dx)).toBeLessThanOrEqual(3);
      expect(Math.abs(before.dy)).toBeLessThanOrEqual(6);

      // Resize with the east handle: wider shape, fewer lines, still centred.
      const handle = await page.locator('[data-handle="e"]').boundingBox();
      if (!handle) throw new Error('no handle');
      await drag(page, [handle.x + handle.width / 2, handle.y + handle.height / 2], [handle.x + handle.width / 2 + 300, handle.y + handle.height / 2]);
      await expect.poll(async () => (await shapeBox(page)).width).toBeGreaterThan(SHAPE_DEFAULT_SIZE_WORLD + 100);
      const after = await metrics();
      expect(after.lines).toBeLessThan(before.lines);
      expect(Math.abs(after.dx)).toBeLessThanOrEqual(3);
      expect(Math.abs(after.dy)).toBeLessThanOrEqual(6);
    } finally {
      await closeAll([a]);
    }
  });
});
