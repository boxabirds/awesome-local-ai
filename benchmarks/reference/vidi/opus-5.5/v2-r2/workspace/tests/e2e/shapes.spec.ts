import { type Page, expect, test } from '@playwright/test';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import { SHAPE_DEFAULT_SIZE_WORLD } from '../../src/shared/config';
import { FLOW_SHAPES, seedCheckoutFlow } from '../fixtures/checkout-flow';
import { nextFrames, openBoard, setCamera } from './helpers/board';

async function objects(page: Page): Promise<ObjectSnapshot[]> {
  return page.evaluate(() => [...(window.__vidi6?.getObjects?.() ?? [])]);
}

async function shapes(page: Page): Promise<ObjectSnapshot[]> {
  return (await objects(page)).filter((o) => o.type === 'shape');
}

function shapeLocator(page: Page, id: string) {
  return page.locator(`[data-shape-object][data-id="${id}"]`);
}

async function centreOf(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width, height: box.height };
}

test.describe('Draw a flow', () => {
  test('TC-23 a real drag (100,100)→(300,220) at 100% creates a 200×120 shape there', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });
    await page.keyboard.press('s');
    await expect(page.getByRole('button', { name: 'Shape (S)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('group', { name: 'Shape kind' }).getByRole('button', { name: 'Rectangle' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.mouse.move(100, 100);
    await page.mouse.down();
    await page.mouse.move(200, 160, { steps: 5 });
    await expect(page.getByTestId('shape-preview')).toBeVisible();
    await page.mouse.move(300, 220, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await shapes(page)).length).toBe(1);
    const [s] = await shapes(page);
    expect(Math.abs(s!.x - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(s!.y - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(s!.width - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(s!.height - 120)).toBeLessThanOrEqual(1);
    const box = await shapeLocator(page, s!.id).boundingBox();
    expect(Math.abs(box!.x - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.y - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.width - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.height - 120)).toBeLessThanOrEqual(1);
    // Selected, back to Select.
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.__vidi6?.getSelection?.())).toEqual([s!.id]);
  });

  test('TC-24 at 200% a Diamond click drops a 160×160 diamond; a long label wraps and stays centred after a resize', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 2 });
    await page.getByRole('button', { name: 'Shape (S)' }).click();
    await page.getByRole('button', { name: 'Diamond' }).click();
    await page.mouse.click(700, 400);
    await expect.poll(async () => (await shapes(page)).length).toBe(1);
    const [d] = await shapes(page);
    expect(d).toMatchObject({ kind: 'diamond', width: SHAPE_DEFAULT_SIZE_WORLD, height: SHAPE_DEFAULT_SIZE_WORLD });
    expect(d!.x + d!.width / 2).toBeCloseTo(350, 5);
    expect(d!.y + d!.height / 2).toBeCloseTo(200, 5);

    await shapeLocator(page, d!.id).dblclick();
    const editor = page.getByRole('textbox', { name: 'Shape label' });
    await expect(editor).toBeFocused();
    await page.keyboard.type('Was the payment accepted?');
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect.poll(async () => (await shapes(page))[0]!.label).toBe('Was the payment accepted?');

    const labelSel = `[data-shape-object][data-id="${d!.id}"] [data-testid="shape-label"]`;
    const shapeSel = `[data-shape-object][data-id="${d!.id}"]`;
    const lineHeightPx = await page.locator(labelSel).evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    const before = await centreOf(page, labelSel);
    const shapeBefore = await centreOf(page, shapeSel);
    // Wraps: several lines (the label is longer than the shape is wide), inside the shape, centred.
    expect(before.height / (lineHeightPx * 2)).toBeGreaterThanOrEqual(2);
    expect(before.width).toBeLessThan(shapeBefore.width);
    expect(Math.abs(before.x - shapeBefore.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(before.y - shapeBefore.y)).toBeLessThanOrEqual(2);

    // Resize via the right handle (the diamond is still selected).
    const handle = page.getByRole('button', { name: 'Resize right' });
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + 300, hb.y + hb.height / 2, { steps: 8 });
    await page.mouse.up();
    await nextFrames(page);
    await expect.poll(async () => (await shapes(page))[0]!.width).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD + 150, 5);
    const after = await centreOf(page, labelSel);
    const shapeAfter = await centreOf(page, shapeSel);
    expect(after.height).toBeLessThan(before.height);
    expect(Math.abs(after.x - shapeAfter.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.y - shapeAfter.y)).toBeLessThanOrEqual(2);
  });

  test('checkout-flow fixture renders every shape and arrow with its label', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: 100, y: 100, zoom: 1 });
    const flow = await seedCheckoutFlow(page);
    for (const s of FLOW_SHAPES) await expect(page.locator('[data-shape-object]').getByText(s.label)).toBeVisible();
    for (const id of flow.arrows) await expect(page.locator(`[data-connector-object][data-id="${id}"]`)).toHaveCount(1);
    await expect(page.getByRole('group', { name: 'Arrow from Rectangle "Checkout" to Diamond "Paid?"' })).toHaveCount(1);
    await expect(page.getByRole('group', { name: 'Arrow from Rectangle "Retry payment" to a point' })).toHaveCount(1);
  });
});
