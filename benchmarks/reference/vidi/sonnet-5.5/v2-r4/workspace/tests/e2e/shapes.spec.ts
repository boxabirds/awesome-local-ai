import { expect, test, type Page } from '@playwright/test';
import { openNewBoard, setCamera } from './helpers/board';

const shapes = (page: Page) => page.locator('[data-shape-id]');

async function box(page: Page, i = 0) {
  return (await shapes(page).nth(i).boundingBox())!;
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

test.describe('draw a flow', () => {
  test('TC-23 dragging (100,100)→(300,220) at 100% creates a 200 x 120 shape there', async ({ page }) => {
    await openNewBoard(page);
    await setCamera(page, -640, -400, 1);
    await page.keyboard.press('s');
    await expect(page.getByRole('menuitemradio', { name: 'Rectangle' })).toHaveAttribute('aria-checked', 'true');
    await drag(page, { x: 100, y: 100 }, { x: 300, y: 220 });
    await expect(shapes(page)).toHaveCount(1);
    const b = await box(page);
    expect(Math.abs(b.x - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.y - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.width - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.height - 120)).toBeLessThanOrEqual(1);
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(shapes(page).first()).toHaveAttribute('data-selected', 'true');
  });

  test('TC-24 a diamond dropped at 200% is 160 x 160 centred; its label wraps and stays centred after a resize', async ({ page }) => {
    await openNewBoard(page);
    await setCamera(page, -320, -200, 2); // world (0,0) at the centre of the viewport
    await page.keyboard.press('s');
    await page.getByRole('menuitemradio', { name: 'Diamond' }).click();
    await page.mouse.click(640, 400);
    await expect(shapes(page)).toHaveCount(1);
    let b = await box(page);
    expect(Math.abs(b.width - 320)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.height - 320)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.x + b.width / 2 - 640)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.y + b.height / 2 - 400)).toBeLessThanOrEqual(1);

    await shapes(page).first().dblclick();
    const long = 'Order paid and confirmed';
    await page.keyboard.type(long);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('group', { name: `Diamond: ${long}` })).toBeVisible();

    const label = () => shapes(page).first().locator('[data-testid="shape-label"] > div');
    const centred = async () => {
      const s = await box(page);
      const l = (await label().boundingBox())!;
      expect(Math.abs(l.x + l.width / 2 - (s.x + s.width / 2))).toBeLessThanOrEqual(2);
      expect(Math.abs(l.y + l.height / 2 - (s.y + s.height / 2))).toBeLessThanOrEqual(2);
      return l;
    };
    const before = await centred();
    expect(before.height).toBeGreaterThan(18 * 1.25 * 2 * 1.5); // wrapped onto at least two lines (200% zoom)

    await shapes(page).first().click();
    const handle = page.locator('[data-handle="e"]');
    const hb = (await handle.boundingBox())!;
    await drag(page, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, { x: hb.x + hb.width / 2 + 200, y: hb.y + hb.height / 2 });
    b = await box(page);
    expect(b.width).toBeGreaterThan(500);
    const after = await centred();
    expect(after.height).toBeLessThan(before.height);
  });
});
