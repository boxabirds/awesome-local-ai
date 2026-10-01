import { expect, test, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, SHAPE_DEFAULT_SIZE_WORLD } from '../../src/shared/config';
import { setCamera, settled } from './helpers/board';
import { createBoardVia } from './helpers/create';

const EVENTUALLY = { timeout: E2E_EVENTUAL_TIMEOUT_MS };
// 1280x800 viewport, camera starts with the world origin in the centre: screen = world + (640, 400).
const shapes = (page: Page) => page.locator('[data-shape]');

test.beforeEach(async ({ page, request }) => {
  const id = await createBoardVia(request);
  await page.goto(`/b/${id}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible(EVENTUALLY);
  await settled(page);
});

test('TC-23 dragging with the Shape tool creates a 200 x 120 rectangle at the dragged position', async ({ page }) => {
  await page.keyboard.press('s');
  await expect(page.getByRole('menuitemradio', { name: 'Rectangle' })).toHaveAttribute('aria-checked', 'true');
  await page.mouse.move(100, 100);
  await page.mouse.down();
  await page.mouse.move(200, 160, { steps: 4 });
  await expect(page.getByTestId('shape-preview')).toBeVisible();
  await page.mouse.move(300, 220, { steps: 4 });
  await page.mouse.up();
  await expect(shapes(page)).toHaveCount(1);
  const shape = shapes(page).first();
  const box = (await shape.boundingBox())!;
  expect(Math.abs(box.x - 100)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.y - 100)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.width - 200)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.height - 120)).toBeLessThanOrEqual(1);
  await expect(shape).toHaveAttribute('data-selected', 'true');
  await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('shape-tool-layer')).toHaveCount(0);
  // Recolour from the shape toolbar: only the fill changes.
  await page.getByRole('button', { name: 'blue fill' }).click();
  await expect(shape).toHaveAttribute('data-fill', 'blue');
  await expect(shape).toHaveAttribute('data-stroke', 'dark');
  await expect(shape).toHaveAttribute('data-selected', 'true');
});

test('TC-24 a diamond dropped at 200% zoom is 160 x 160 and its long label wraps and stays centred after a resize', async ({ page }) => {
  await setCamera(page, { x: -320, y: -200, zoom: 2 }); // world origin stays at the screen centre
  await settled(page);
  await page.getByRole('button', { name: 'Shape (S)' }).click();
  await page.getByRole('menuitemradio', { name: 'Diamond' }).click();
  await page.mouse.click(640, 400);
  await expect(shapes(page)).toHaveCount(1);
  const shape = shapes(page).first();
  await expect(shape).toHaveAttribute('data-kind', 'diamond');
  await expect(shape).toHaveAttribute('data-width', String(SHAPE_DEFAULT_SIZE_WORLD));
  await expect(shape).toHaveAttribute('data-height', String(SHAPE_DEFAULT_SIZE_WORLD));
  const box = (await shape.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.y + box.height / 2 - 400)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.width - 2 * SHAPE_DEFAULT_SIZE_WORLD)).toBeLessThanOrEqual(1);

  await shape.dblclick();
  const editor = page.getByRole('textbox', { name: 'Shape label' });
  await expect(editor).toBeFocused();
  await page.keyboard.insertText('Customer pays with a saved card or a new card');
  await page.keyboard.press('Escape');
  await expect(shape).toHaveAttribute('data-selected', 'true');

  const measure = () => shape.evaluate((el) => {
    const s = el.getBoundingClientRect();
    const t = el.querySelector('.shape-label-text')!.getBoundingClientRect();
    return {
      dx: t.left + t.width / 2 - (s.left + s.width / 2), dy: t.top + t.height / 2 - (s.top + s.height / 2),
      textWidth: t.width, textHeight: t.height, shapeWidth: s.width,
    };
  });
  const before = await measure();
  expect(Math.abs(before.dx)).toBeLessThanOrEqual(2);
  expect(Math.abs(before.dy)).toBeLessThanOrEqual(2);
  expect(before.textHeight).toBeGreaterThan(16 * 1.3 * 2 * 2 - 1); // at least two lines at 200%
  expect(before.textWidth).toBeLessThanOrEqual(before.shapeWidth);

  const handle = page.getByRole('button', { name: 'Resize right' });
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 - 60, h.y + h.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await shape.getAttribute('data-width'))).toBeLessThan(SHAPE_DEFAULT_SIZE_WORLD - 20);
  const after = await measure();
  expect(Math.abs(after.dx)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.dy)).toBeLessThanOrEqual(2);
  expect(after.textHeight).toBeGreaterThanOrEqual(before.textHeight);
  expect(after.textWidth).toBeLessThanOrEqual(after.shapeWidth);
});
