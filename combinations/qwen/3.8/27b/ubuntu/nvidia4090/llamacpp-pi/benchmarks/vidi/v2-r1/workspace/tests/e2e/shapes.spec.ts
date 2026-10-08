// Story 10 e2e (shapes config): drawing shapes with the Shape tool.
//
//   TC-23  real drag (100,100) -> (300,220) at 100% creates a 200x120 shape
//          at that position (±1px). Runs in chromium and firefox.
//   TC-24  at 200% zoom a Diamond click creates a 160x160 centred diamond; a
//          label longer than the width wraps and stays centred after the
//          shape is resized via a handle. Chromium-only.
//
// Each test runs its own `wrangler dev` (tests/e2e/wrangler-process.ts).
// The camera is pinned so world units are deterministic. (webkit is not in
// the matrix on this host — it needs the system library `libavif13`, which is
// missing and there is no root to install it; see NOTES.md.)

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createWranglerProcess, type WranglerProcess } from './wrangler-process';
import {
  createBoard,
  getObjects,
  openBoard,
  objectsOf,
  setCamera,
  toScreen,
  type ObjectInfo,
} from './shape-helpers';

const LONG_LABEL =
  'A label that is longer than the shape width so it must wrap onto several lines';

/** Skip unless running in chromium (TC-24). */
function chromiumOnly(): void {
  test.skip(test.info().project.name !== 'chromium', 'chromium-only');
}

async function dragShape(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 12 });
  await page.mouse.up();
}

/** Drag the selection handle named `label` by (dx, dy) screen px. */
async function dragHandle(page: Page, label: string, dx: number, dy: number): Promise<void> {
  const handle = page.getByRole('button', { name: label });
  const box = await handle.boundingBox();
  if (!box) throw new Error(`handle "${label}" not found`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 10 });
  await page.mouse.up();
}

test.describe('story 10: draw shapes (wrangler)', () => {
  test('TC-23: a real drag at 100% creates a 200x120 shape at the dragged rect', async ({ browser }) => {
    const ctxs: BrowserContext[] = [];
    const wrangler: WranglerProcess = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);
      const ctx = await browser.newContext();
      ctxs.push(ctx);
      const page = await ctx.newPage();
      await openBoard(page, boardId);

      // 100% zoom, camera at the origin: screen == world.
      await setCamera(page, { x: 0, y: 0, zoom: 1 });
      await page.keyboard.press('s');
      await page.getByRole('menuitemradio', { name: 'Rectangle' }).click();

      await dragShape(page, 100, 100, 300, 220);

      await expect
        .poll(async () => (await objectsOf(page, 'shape')).length, { timeout: 15000 })
        .toBe(1);
      const [s] = await objectsOf(page, 'shape');
      expect(s.x).toBeGreaterThanOrEqual(99);
      expect(s.x).toBeLessThanOrEqual(101);
      expect(s.y).toBeGreaterThanOrEqual(99);
      expect(s.y).toBeLessThanOrEqual(101);
      expect(s.width).toBeGreaterThanOrEqual(199);
      expect(s.width).toBeLessThanOrEqual(201);
      expect(s.height).toBeGreaterThanOrEqual(119);
      expect(s.height).toBeLessThanOrEqual(121);

      for (const c of ctxs) await c.close();
    } finally {
      await Promise.all(ctxs.map((c) => c.close().catch(() => undefined)));
      await wrangler.dispose();
    }
  });

  test('TC-24: 200% Diamond click is 160x160 centred; a long label wraps and stays centred', async ({ browser }) => {
    chromiumOnly();
    const ctxs: BrowserContext[] = [];
    const wrangler: WranglerProcess = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);
      const ctx = await browser.newContext();
      ctxs.push(ctx);
      const page = await ctx.newPage();
      await openBoard(page, boardId);

      // 200% zoom, camera at the origin: world = screen / 2.
      await setCamera(page, { x: 0, y: 0, zoom: 2 });
      await page.keyboard.press('s');
      await page.getByRole('menuitemradio', { name: 'Diamond' }).click();

      // Click at world (400, 250) -> screen (800, 500).
      await page.mouse.click(800, 500);

      await expect
        .poll(async () => (await objectsOf(page, 'shape')).length, { timeout: 15000 })
        .toBe(1);
      let s = (await objectsOf(page, 'shape'))[0];
      expect(s.kind).toBe('diamond');
      // A click (no drag) creates the default 160x160 centred on the point.
      expect(s.width).toBeGreaterThanOrEqual(159);
      expect(s.width).toBeLessThanOrEqual(161);
      expect(s.height).toBeGreaterThanOrEqual(159);
      expect(s.height).toBeLessThanOrEqual(161);
      expect(s.x).toBeGreaterThanOrEqual(319);
      expect(s.x).toBeLessThanOrEqual(321);
      expect(s.y).toBeGreaterThanOrEqual(169);
      expect(s.y).toBeLessThanOrEqual(171);

      // Type a label longer than the 160 width so it must wrap.
      const center = toScreen({ x: 0, y: 0, zoom: 2 }, 400, 250);
      await page.mouse.dblclick(center.x, center.y);
      const editor = page.locator('[data-testid="shape-label-editor"]');
      await editor.waitFor({ state: 'visible', timeout: 10000 });
      await editor.fill(LONG_LABEL);
      await page.keyboard.press('Escape');

      await expect
        .poll(async () => (await objectsOf(page, 'shape'))[0].label, { timeout: 10000 })
        .toBe(LONG_LABEL);

      // The label element is centred on the shape (before the resize).
      const centreOf = (box: { x: number; y: number; width: number; height: number }) => ({
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      });
      const assertCentred = async (tol = 3): Promise<void> => {
        const shapeBox = await page.locator('[data-testid="shape-object"]').boundingBox();
        const labelBox = await page.locator('.shape-object__label').boundingBox();
        if (!shapeBox || !labelBox) throw new Error('shape/label box not found');
        const sc = centreOf(shapeBox);
        const lc = centreOf(labelBox);
        expect(Math.abs(sc.x - lc.x)).toBeLessThanOrEqual(tol);
        expect(Math.abs(sc.y - lc.y)).toBeLessThanOrEqual(tol);
      };
      await assertCentred();

      // Resize larger via the bottom-right handle: +200 screen px at 200%
      // zoom is +100 world units each way (160 -> 260).
      await page.mouse.click(center.x, center.y); // ensure selected
      await dragHandle(page, 'Resize bottom-right', 200, 200);

      await expect
        .poll(async () => (await objectsOf(page, 'shape'))[0].width, { timeout: 10000 })
        .toBeCloseTo(260, 0);
      s = (await objectsOf(page, 'shape'))[0];
      expect(s.width).toBeGreaterThanOrEqual(259);
      expect(s.width).toBeLessThanOrEqual(261);
      expect(s.height).toBeGreaterThanOrEqual(259);
      expect(s.height).toBeLessThanOrEqual(261);
      // The label survived the resize, unchanged and still centred.
      expect(s.label).toBe(LONG_LABEL);
      await assertCentred();

      for (const c of ctxs) await c.close();
    } finally {
      await Promise.all(ctxs.map((c) => c.close().catch(() => undefined)));
      await wrangler.dispose();
    }
  });
});
