import { test, expect } from '@playwright/test';
import { getObjects, setCamera, type ObjectSnapshot } from './helpers/board';
import { closeAll, newBoardId, openBoard } from './participants';

/**
 * Story 10 e2e (chromium): the Shape tool against the real server.
 *
 * The e2e camera is (-640, -360) at zoom 1 (1280x720 viewport), so
 * screen = world + (640, 360).
 */

async function firstShape(page: Parameters<typeof getObjects>[0]): Promise<ObjectSnapshot> {
  const shapes = (await getObjects(page)).filter((o) => o.type === 'shape');
  if (shapes.length !== 1) throw new Error(`expected 1 shape, got ${shapes.length}`);
  return shapes[0];
}

test.describe('story 10: shapes (e2e)', () => {
  test('TC-23: a real drag with the Shape tool creates the dragged size and position', async ({ browser }) => {
    const dana = await openBoard(browser, newBoardId());
    try {
      const page = dana.page;
      await page.keyboard.press('s');
      await page.mouse.move(100, 100);
      await page.mouse.down();
      await page.mouse.move(300, 220, { steps: 10 });
      await page.mouse.up();

      await expect
        .poll(async () => (await getObjects(page)).filter((o) => o.type === 'shape').length, { timeout: 5000 })
        .toBe(1);
      const s = await firstShape(page);
      // World = screen + (-640, -360): (-540, -260) to (-340, -140).
      expect(Math.abs(s.x - (-540))).toBeLessThanOrEqual(1);
      expect(Math.abs(s.y - (-260))).toBeLessThanOrEqual(1);
      expect(Math.abs((s.width ?? 0) - 200)).toBeLessThanOrEqual(1);
      expect(Math.abs((s.height ?? 0) - 120)).toBeLessThanOrEqual(1);
      expect(s.kind).toBe('rect');
      expect(s.fill).toBe('white');
      expect(s.stroke).toBe('dark');
      // The new shape is selected and the tool is back to Select. (The
      // selection lands one effect tick after the object snapshot, so poll.)
      await expect
        .poll(async () => (await page.evaluate(() => (window as any).__vidi6?.getSelection?.() ?? [])), {
          timeout: 5000,
        })
        .toEqual([s.id]);
      expect(await page.locator('[data-testid="shape-tool-overlay"]').count()).toBe(0);
    } finally {
      await closeAll(dana);
    }
  });

  test('TC-24: diamond click makes 160x160 centred; a long label wraps and stays centred after a resize', async ({ browser }) => {
    const dana = await openBoard(browser, newBoardId());
    try {
      const page = dana.page;
      // 200% zoom centred on the world origin: screen (640,360) = world (0,0).
      await setCamera(page, { x: -320, y: -180, zoom: 2 });

      // Pick the diamond kind and activate the Shape tool.
      await page.getByTestId('shape-tool-button').click();
      await page.getByTestId('shape-kind-diamond').click();

      // Click at the screen centre: a default 160x160 diamond centred on
      // world (0,0) -> box (-80, -80, 160, 160).
      await page.mouse.click(640, 360);
      await expect
        .poll(async () => (await getObjects(page)).filter((o) => o.type === 'shape').length, { timeout: 5000 })
        .toBe(1);
      let s = await firstShape(page);
      expect(s.kind).toBe('diamond');
      expect(s.width).toBe(160);
      expect(s.height).toBe(160);
      expect(Math.abs(s.x - (-80))).toBeLessThanOrEqual(1);
      expect(Math.abs(s.y - (-80))).toBeLessThanOrEqual(1);

      // Double-click enters label editing; type a label far longer than the
      // shape's width so it must wrap.
      await page.mouse.dblclick(640, 360);
      const ta = page.getByTestId('shape-label-textarea');
      await expect(ta).toBeVisible({ timeout: 5000 });
      await page.keyboard.type('A fairly long checkout-flow label that must wrap inside the small diamond');
      await page.keyboard.press('Escape');
      await expect(ta).toBeHidden({ timeout: 5000 });
      s = await firstShape(page);
      expect(s.label).toBe('A fairly long checkout-flow label that must wrap inside the small diamond');

      // The label text (the span inside the flex-centred container) renders
      // inside the shape and is centred on it.
      const shapeBox = async () => {
        const box = await page.locator(`[data-testid="shape"][data-id="${s.id}"]`).boundingBox();
        if (!box) throw new Error('shape box not found');
        return box;
      };
      const textBox = async () => {
        const box = await page.locator('[data-testid="shape-label"] span').boundingBox();
        if (!box) throw new Error('label text not found');
        return box;
      };
      const assertCentred = async () => {
        const shape = await shapeBox();
        const text = await textBox();
        expect(Math.abs(text.x + text.width / 2 - (shape.x + shape.width / 2))).toBeLessThanOrEqual(3);
        expect(Math.abs(text.y + text.height / 2 - (shape.y + shape.height / 2))).toBeLessThanOrEqual(3);
      };

      // Wrapping: at 200% zoom one line is 16 * 1.25 * 2 = 40 screen px;
      // the long label needs several lines.
      const textBefore = await textBox();
      expect(textBefore.height).toBeGreaterThan(45); // more than one line
      await assertCentred();

      // Resize wider by dragging the east handle: world right edge -80..80
      // moves to 130 (drag +100 screen px at 200% = +50 world).
      const handle = page.locator('[data-handle="e"]');
      await expect(handle).toBeVisible({ timeout: 5000 });
      const hb = await handle.boundingBox();
      if (!hb) throw new Error('east handle not found');
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.mouse.down();
      await page.mouse.move(hb.x + hb.width / 2 + 100, hb.y + hb.height / 2, { steps: 10 });
      await page.mouse.up();

      s = await firstShape(page);
      expect(Math.abs((s.width ?? 0) - 210)).toBeLessThanOrEqual(2);
      expect(s.height).toBe(160);

      // The label reflows to the wider box and stays centred: the text
      // needs no more lines than before, and remains centred on the shape.
      const textAfter = await textBox();
      expect(textAfter.height).toBeLessThanOrEqual(textBefore.height + 2);
      await assertCentred();
    } finally {
      await closeAll(dana);
    }
  });
});
