// Story 10 e2e, workflow "Draw a flow" (TC-23, TC-24): shapes drawn and labelled with real
// layout in real browsers against the real sync service (wrangler dev).
import { type Page, expect, test } from '@playwright/test';
import { SHAPE_DEFAULT_SIZE_WORLD } from '../../src/shared/config';
import { getCamera, openBoard, setCamera, waitForFrame } from './helpers/board';

interface ShapeObj {
  id: string;
  type: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

async function showCamera(page: Page, cam: { x: number; y: number; zoom: number }) {
  await setCamera(page, cam);
  await expect.poll(() => getCamera(page)).toEqual(cam);
  await waitForFrame(page);
}

async function shapes(page: Page): Promise<ShapeObj[]> {
  return page.evaluate(
    () => (window.__vidi6!.getObjects!() as unknown as ShapeObj[]).filter((o) => o.type === 'shape'),
  );
}

const shapeEl = (page: Page, id: string) => page.locator(`[data-shape-id="${id}"]`);

/**
 * Line count and centre offsets (page px) of a shape's label inside the shape. Words only: the
 * spaces a line wraps at hang past its end and are not part of the centred text.
 */
async function labelLayout(page: Page, id: string) {
  return page.evaluate((shapeId) => {
    const shape = document.querySelector<HTMLElement>(`[data-shape-id="${shapeId}"]`)!;
    const node = shape.querySelector<HTMLElement>('.shape-label-text')!.firstChild as Text;
    const s = shape.getBoundingClientRect();
    const rects: DOMRect[] = [];
    for (const m of node.data.matchAll(/\S+/g)) {
      const range = document.createRange();
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      rects.push(...range.getClientRects());
    }
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    // Each line's own centre (the widest line alone would hide a skewed short line).
    const lines = new Map<number, { l: number; r: number }>();
    for (const r of rects) {
      const key = Math.round(r.top);
      const line = lines.get(key) ?? { l: r.left, r: r.right };
      lines.set(key, { l: Math.min(line.l, r.left), r: Math.max(line.r, r.right) });
    }
    const centreX = s.left + s.width / 2;
    return {
      lines: lines.size,
      dx: Math.max(...[...lines.values()].map((l) => Math.abs((l.l + l.r) / 2 - centreX))),
      dy: (top + bottom) / 2 - (s.top + s.height / 2),
      insideX: left >= s.left - 0.5 && right <= s.right + 0.5,
    };
  }, id);
}

test.describe('Workflow: Draw a flow', () => {
  test('TC-23 a real drag (100,100)→(300,220) at 100% draws a 200x120 shape there', async ({ page }) => {
    await openBoard(page);
    await showCamera(page, { x: 0, y: 0, zoom: 1 });
    await page.keyboard.press('s');
    await expect(page.getByRole('button', { name: 'Shape (S)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Rectangle' })).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(100, 100);
    await page.mouse.down();
    await page.mouse.move(200, 160, { steps: 5 });
    await page.mouse.move(300, 220, { steps: 5 });
    await expect(page.getByTestId('shape-preview')).toBeVisible();
    await page.mouse.up();
    await waitForFrame(page);

    await expect.poll(async () => (await shapes(page)).length).toBe(1);
    const [shape] = await shapes(page);
    expect(shape.kind).toBe('rect');
    for (const [k, v] of Object.entries({ x: 100, y: 100, width: 200, height: 120 })) {
      expect(Math.abs(shape[k as 'x'] - v)).toBeLessThanOrEqual(1);
    }
    const box = (await shapeEl(page, shape.id).boundingBox())!;
    expect(Math.abs(box.x - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - 120)).toBeLessThanOrEqual(1);
    // Back to Select, with the new shape selected (its toolbar shows).
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('toolbar', { name: 'Shape toolbar' })).toBeVisible();
    await page.getByRole('button', { name: 'blue fill' }).click();
    await expect.poll(async () => (await page.evaluate(() => window.__vidi6!.getObjects!()))[0]).toMatchObject({
      fill: 'blue',
    });
  });

  test('TC-24 at 200% a Diamond click is 160x160 centred; a long label wraps and stays centred after a resize', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'Chromium only (design)');
    await openBoard(page);
    await showCamera(page, { x: 0, y: 0, zoom: 2 });
    await page.getByRole('button', { name: 'Shape (S)' }).click();
    await page.getByRole('button', { name: 'Diamond' }).click();
    // Page (600, 400) is world (300, 200) at 200%.
    await page.mouse.click(600, 400);
    await expect.poll(async () => (await shapes(page)).length).toBe(1);
    const [shape] = await shapes(page);
    const s = SHAPE_DEFAULT_SIZE_WORLD;
    expect(shape).toMatchObject({ kind: 'diamond', x: 300 - s / 2, y: 200 - s / 2, width: s, height: s });

    await page.mouse.dblclick(600, 400);
    const editor = page.getByRole('textbox', { name: 'Shape label' });
    await expect(editor).toBeFocused();
    await page.keyboard.type('Has the customer paid for everything in the basket?');
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect.poll(async () => (await shapes(page))[0].label).toBe(
      'Has the customer paid for everything in the basket?',
    );

    const before = await labelLayout(page, shape.id);
    expect(before.lines).toBeGreaterThan(2);
    expect(before.insideX).toBe(true);
    expect(Math.abs(before.dx)).toBeLessThanOrEqual(2);
    expect(Math.abs(before.dy)).toBeLessThanOrEqual(2);

    // Wider via the right handle: fewer lines, still centred.
    const handle = page.getByRole('button', { name: 'Resize right' });
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + 100, hb.y + hb.height / 2, { steps: 5 });
    await page.mouse.move(hb.x + hb.width / 2 + 200, hb.y + hb.height / 2, { steps: 5 });
    await page.mouse.up();
    await waitForFrame(page);
    await expect.poll(async () => (await shapes(page))[0].width).toBeCloseTo(s + 100, 0);
    const after = await labelLayout(page, shape.id);
    expect(after.lines).toBeLessThan(before.lines);
    expect(after.insideX).toBe(true);
    expect(Math.abs(after.dx)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.dy)).toBeLessThanOrEqual(2);
  });
});
