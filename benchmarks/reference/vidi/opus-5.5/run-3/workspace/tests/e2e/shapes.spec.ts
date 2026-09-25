// Story 10 in real browsers: drawing shapes by drag and click, and labels that wrap and stay centred.
import { expect, test, type Page } from '@playwright/test';
import { openBoard, setCamera, settle } from './helpers/board';
import { createBoardAt } from './helpers/boards-api';
import { dragBy } from './helpers/notes';
import { handleCentre, seedBoard, selectedIds } from './helpers/selection';
import { centreOfShape, connectors, mouseDrag, shapeById, shapes } from './helpers/shapes';
import { checkoutFlow } from '../fixtures/checkout-flow';
import { SHAPE_DEFAULT_SIZE_WORLD } from '../../src/shared/config';

/** The drawn lines of a shape's label, in page px: their union and how many lines there are. */
async function labelLines(page: Page, id: string) {
  return shapeById(page, id)
    .locator('.shape-object__content')
    .evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right));
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      const lines = new Set(rects.map((r) => Math.round(r.top))).size;
      return { left, right, top, bottom, lines };
    });
}

test.describe('Workflow "Draw a flow"', () => {
  test('TC-23 at 100% a drag from (100,100) to (300,220) makes a 200 x 120 shape at that position', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });
    await settle(page);
    await page.keyboard.press('s');
    await expect(page.getByRole('button', { name: 'Shape (S)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('menuitemradio', { name: 'Rectangle' })).toHaveAttribute('aria-checked', 'true');
    await mouseDrag(page, { x: 100, y: 100 }, { x: 300, y: 220 });
    await expect.poll(async () => (await shapes(page)).length).toBe(1);
    const [s] = await shapes(page);
    expect(Math.abs(s.x - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(s.y - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(s.width - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(s.height - 120)).toBeLessThanOrEqual(1);
    expect({ kind: s.kind, fill: s.fill, stroke: s.stroke }).toEqual({ kind: 'rect', fill: 'white', stroke: 'dark' });
    const box = (await shapeById(page, s.id).boundingBox())!;
    expect(Math.abs(box.x - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - 120)).toBeLessThanOrEqual(1);
    expect(await selectedIds(page)).toEqual([s.id]);
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('TC-24 at 200% a Diamond click makes a 160 x 160 diamond centred on it; its long label wraps and stays centred after a resize', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 2 });
    await settle(page);
    await page.keyboard.press('s');
    await page.getByRole('menuitemradio', { name: 'Diamond' }).click();
    await page.mouse.click(400, 300);
    await expect.poll(async () => (await shapes(page)).length).toBe(1);
    const [d] = await shapes(page);
    const size = SHAPE_DEFAULT_SIZE_WORLD;
    expect(d).toMatchObject({ kind: 'diamond', x: 200 - size / 2, y: 150 - size / 2, width: size, height: size });

    await page.mouse.dblclick(400, 300);
    const editor = page.getByRole('textbox', { name: 'Shape label' });
    await expect(editor).toBeFocused();
    await page.keyboard.insertText('Has the payment been received and confirmed?');
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);

    const check = async () => {
      const shapeBox = (await shapeById(page, d.id).boundingBox())!;
      const lines = await labelLines(page, d.id);
      expect(lines.lines).toBeGreaterThan(1);
      // Inside the shape and centred in it (within half a space at 200%: a wrapped line keeps its trailing space).
      expect(lines.left).toBeGreaterThanOrEqual(shapeBox.x);
      expect(lines.right).toBeLessThanOrEqual(shapeBox.x + shapeBox.width);
      expect(Math.abs((lines.left + lines.right) / 2 - (shapeBox.x + shapeBox.width / 2))).toBeLessThanOrEqual(6);
      expect(Math.abs((lines.top + lines.bottom) / 2 - (shapeBox.y + shapeBox.height / 2))).toBeLessThanOrEqual(6);
      return lines;
    };
    const before = await check();

    // Wider via the right handle: the label re-wraps into fewer lines and stays centred.
    await dragBy(page, await handleCentre(page, 'right'), 300, 0);
    await expect.poll(async () => (await shapes(page))[0].width).toBeGreaterThan(size + 100);
    const after = await check();
    expect(after.lines).toBeLessThan(before.lines);
  });

  test('a seeded checkout flow shows its shapes and arrows', async ({ page }) => {
    const flow = checkoutFlow();
    const boardId = await createBoardAt();
    await seedBoard(boardId, flow.doc);
    await page.goto(`/b/${boardId}`);
    await expect(page.locator('[data-shape-id]')).toHaveCount(4);
    await expect(page.locator('.connector-object')).toHaveCount(4);
    await expect(page.getByRole('group', { name: 'Diamond: Paid?' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Arrow from Checkout to Paid?' })).toHaveCount(1);
    await page.waitForFunction(() => window.__vidi6?.setCamera !== undefined);
    expect((await connectors(page)).length).toBe(4);
    // A click on a shape selects it and shows the shape toolbar.
    await setCamera(page, { x: -100, y: -200, zoom: 1 });
    await settle(page);
    await page.mouse.click((await centreOfShape(page, flow.shapes.cart)).x, (await centreOfShape(page, flow.shapes.cart)).y);
    await expect(page.getByRole('toolbar', { name: 'Shape' })).toBeVisible();
    await page.getByRole('button', { name: 'blue fill' }).click();
    await expect(shapeById(page, flow.shapes.cart)).toHaveAttribute('data-fill', 'blue');
  });
});
