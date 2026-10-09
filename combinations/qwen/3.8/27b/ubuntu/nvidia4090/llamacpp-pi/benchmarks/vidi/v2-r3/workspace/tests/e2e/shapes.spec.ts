import { expect, test } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { apiCreateBoard, openBoard, setCamera } from './helpers';

/**
 * Story 10 e2e (shapes.spec.ts): drawing shapes with real drags (TC-23) and
 * the default-size + label behaviour (TC-24).
 *
 * Camera (0,0,1): screen coordinates equal world units, so positions can be
 * asserted exactly (±1px).
 */
const shapeLayer = (page: import('@playwright/test').Page) => page.locator('[data-shape-tool-layer]');

test.describe('shapes (real browser + wrangler dev)', () => {
  test('TC-23: a real drag (100,100)→(300,220) at 100% creates a 200x120 shape at that position', async ({
    page,
    request,
  }) => {
    const board = await apiCreateBoard(request);
    await openBoard(page, board);
    await setCamera(page, 0, 0, 1);

    await page.keyboard.press('s');
    await expect(shapeLayer(page)).toBeVisible();

    await page.mouse.move(100, 100);
    await page.mouse.down();
    await page.mouse.move(200, 160, { steps: 5 });
    await page.mouse.move(300, 220, { steps: 5 });
    // the preview follows the drag
    await expect(page.locator('[data-shape-preview]')).toBeVisible();
    await page.mouse.up();

    const shape = page.locator('[data-shape-id]');
    await expect(shape).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    const box = (await shape.first().boundingBox())!;
    expect(Math.abs(box.x - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - 120)).toBeLessThanOrEqual(1);
    // back at Select after creating
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('TC-24: a Diamond click at 200% creates a 160x160 world square centred on the click; a long label wraps and stays centred after a handle resize', async ({
    page,
    request,
  }) => {
    const board = await apiCreateBoard(request);
    await openBoard(page, board);
    await setCamera(page, 0, 0, 2); // 200% zoom

    // Shape tool, Diamond kind from the toolbar menu.
    await page.keyboard.press('s');
    await expect(shapeLayer(page)).toBeVisible();
    await page.getByRole('button', { name: 'Shape (S)' }).click();
    await page.getByRole('button', { name: 'Diamond' }).click();

    // A single click at screen (640,400) = world (320,200).
    await page.mouse.click(640, 400);

    const shape = page.locator('[data-shape-id]');
    await expect(shape).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    const kind = await page.evaluate(() => {
      let k = '';
      window.__vidi6!.doc.getMap('objects').forEach((it) => {
        if (it.get('type') === 'shape') k = String(it.get('kind'));
      });
      return k;
    });
    expect(kind).toBe('diamond');
    // 160 world units at 200% = 320px, centred on (640,400) → (480,240).
    const box = (await shape.first().boundingBox())!;
    expect(Math.abs(box.x - 480)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y - 240)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - 320)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - 320)).toBeLessThanOrEqual(1);

    // Type a label longer than the shape's width: it must wrap.
    await page.mouse.dblclick(640, 400);
    const ta = page.getByLabel('Shape label');
    await ta.waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await ta.pressSequentially('A long checkout-flow label that must wrap inside the shape box', { delay: 5 });
    await page.keyboard.press('Escape'); // keep the shape selected
    const label = page.locator('.shape-label');
    // One line at 200% is ~40px tall (16px font x 1.25 line-height x 2);
    // 63 characters at ~8px/char = ~500px > 320px, so at least 2 lines.
    await expect.poll(async () => (await label.boundingBox())!.height, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    }).toBeGreaterThan(60);

    // Widen via the right handle: (800,400) → (1040,400).
    await page.mouse.move(800, 400);
    await page.mouse.down();
    await page.mouse.move(1040, 400, { steps: 8 });
    await page.mouse.up();

    const sbox = (await shape.first().boundingBox())!;
    const lbox = (await label.boundingBox())!;
    // The label block stays centred on the shape horizontally and vertically.
    expect(Math.abs(lbox.x + lbox.width / 2 - (sbox.x + sbox.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(lbox.y + lbox.height / 2 - (sbox.y + sbox.height / 2))).toBeLessThanOrEqual(2);
  });
});
