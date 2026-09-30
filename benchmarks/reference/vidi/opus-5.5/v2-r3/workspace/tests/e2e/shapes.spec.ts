// Story 10 — draw shapes (workflow "Draw a flow", TC-23 → TC-24). Real layout
// decides the exact geometry and the label's wrapping and centring.
import { expect, test, type Page } from '@playwright/test';
import { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_LABEL_FONT_PX } from '../../src/shared/config';
import { openBoard, setCamera, viewport } from './helpers/board';

interface ShapeState {
  id: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

async function shapeStates(page: Page): Promise<ShapeState[]> {
  return page.evaluate(() => {
    const out: ShapeState[] = [];
    window.__vidi6!.doc.getMap('objects').forEach((value, id) => {
      const m = value as unknown as { get(k: string): unknown };
      if (m.get('type') !== 'shape') return;
      out.push({
        id,
        kind: m.get('kind') as string,
        x: m.get('x') as number,
        y: m.get('y') as number,
        width: m.get('width') as number,
        height: m.get('height') as number,
        label: String(m.get('label')),
      });
    });
    return out;
  });
}

function shapeEl(page: Page, id: string) {
  return page.locator(`[data-shape-id="${id}"]`);
}

/** Bounding box of the label's rendered text (the union of its line boxes). */
async function labelTextBox(page: Page, id: string) {
  return shapeEl(page, id)
    .locator('[data-testid="shape-label-content"]')
    .evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
      return { x: r.x, y: r.y, width: r.width, height: r.height, lines: Math.round(el.getBoundingClientRect().height / lineHeight) };
    });
}

test.describe('Workflow: draw a flow', () => {
  test('TC-23 a real drag from (100,100) to (300,220) at 100% creates a 200x120 shape at that position', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });
    const vp = (await viewport(page).boundingBox())!;
    await page.keyboard.press('s');
    await expect(page.getByRole('button', { name: 'Shape (S)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Rectangle' })).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(vp.x + 100, vp.y + 100);
    await page.mouse.down();
    await page.mouse.move(vp.x + 200, vp.y + 160, { steps: 5 });
    await page.mouse.move(vp.x + 300, vp.y + 220, { steps: 5 });
    await expect(page.getByTestId('shape-preview')).toBeVisible();
    await page.mouse.up();
    const [shape] = await shapeStates(page);
    expect(shape.kind).toBe('rect');
    expect(Math.abs(shape.x - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(shape.y - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(shape.width - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(shape.height - 120)).toBeLessThanOrEqual(1);
    const box = (await shapeEl(page, shape.id).boundingBox())!;
    expect(Math.abs(box.x - (vp.x + 100))).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y - (vp.y + 100))).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - 120)).toBeLessThanOrEqual(1);
    // Selected, and back to Select.
    await expect(shapeEl(page, shape.id)).toHaveAttribute('data-selected', 'true');
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('TC-24 at 200%: a Diamond click drops a centred 160x160 shape; its long label wraps and stays centred after a resize', async ({
    page,
  }) => {
    await openBoard(page);
    const cam = { x: 0, y: 0, zoom: 2 };
    await setCamera(page, cam);
    const vp = (await viewport(page).boundingBox())!;
    await page.getByRole('button', { name: 'Shape (S)' }).click();
    await page.getByRole('button', { name: 'Diamond' }).click();
    const click = { x: 500, y: 350 };
    await page.mouse.click(vp.x + click.x, vp.y + click.y);
    const [shape] = await shapeStates(page);
    expect(shape.kind).toBe('diamond');
    expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape.x + shape.width / 2).toBeCloseTo(click.x / cam.zoom + cam.x, 6);
    expect(shape.y + shape.height / 2).toBeCloseTo(click.y / cam.zoom + cam.y, 6);
    const el = shapeEl(page, shape.id);
    const box = (await el.boundingBox())!;
    expect(Math.abs(box.width - 320)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.x + box.width / 2 - (vp.x + click.x))).toBeLessThanOrEqual(1);

    // A label longer than the shape is wide.
    await el.dblclick();
    const editor = page.getByRole('textbox', { name: 'Shape label' });
    await expect(editor).toBeFocused();
    await page.keyboard.type('Paid by card?');
    await page.keyboard.press('Escape');
    await expect(el).toHaveAttribute('data-editing', 'false');
    await expect(el).toHaveAttribute('aria-label', 'Diamond: Paid by card?');

    const expectCentred = async () => {
      const shapeBox = (await el.boundingBox())!;
      const text = await labelTextBox(page, shape.id);
      expect(text.width).toBeLessThanOrEqual(shapeBox.width);
      // A wrapped line's trailing space is part of its line box, so allow up to half a space's width.
      const halfSpace = SHAPE_LABEL_FONT_PX * cam.zoom * 0.3;
      expect(Math.abs(text.x + text.width / 2 - (shapeBox.x + shapeBox.width / 2))).toBeLessThanOrEqual(halfSpace);
      expect(Math.abs(text.y + text.height / 2 - (shapeBox.y + shapeBox.height / 2))).toBeLessThanOrEqual(2);
      return text;
    };
    const before = await expectCentred();
    expect(before.lines).toBeGreaterThan(1); // wraps

    // Resize wider via the right handle: re-wraps into fewer lines, still centred.
    await el.click();
    const handle = page.getByRole('button', { name: 'Resize right' });
    const h = (await handle.boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2 + 200, h.y + h.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await shapeStates(page))[0].width).toBeCloseTo(260, 0);
    const after = await expectCentred();
    expect(after.lines).toBeLessThan(before.lines);
  });
});
