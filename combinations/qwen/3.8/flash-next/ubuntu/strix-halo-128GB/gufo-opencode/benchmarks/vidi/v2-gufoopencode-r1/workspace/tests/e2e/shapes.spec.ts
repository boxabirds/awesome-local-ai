import { expect, test, type Page } from '@playwright/test';
import { openFreshBoard, readCamera, setCamera, settle } from './helpers/board';
import { boxOf, clickOn, dragOn } from './helpers/shapes';

async function lineCount(page: Page, labelTestId: string): Promise<number> {
  return page.getByTestId(labelTestId).evaluate((el) => {
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 16;
    return Math.round(el.scrollHeight / lh);
  });
}

test.describe('workflow: draw a flow', () => {
  test('TC-23 a real drag at 100% makes a 200x120 rect at that spot', async ({ page }) => {
    await openFreshBoard(page);
    await page.getByRole('button', { name: 'Shape (S)' }).click();
    await dragOn(page, { x: 100, y: 100 }, { x: 300, y: 220 });
    await settle(page);

    const shape = page.locator('[data-testid^="shape-"][data-kind]').first();
    await expect(shape).toBeVisible();
    const id = (await shape.getAttribute('data-testid'))?.replace('shape-', '') ?? '';
    const box = await boxOf(page, `shape-${id}`);
    expect(box.width).toBeCloseTo(200, 0);
    expect(box.height).toBeCloseTo(120, 0);
    expect(Math.abs(box.x - 100)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.y - 100)).toBeLessThanOrEqual(2);

    // Returns to Select and the new shape is selected.
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(shape).toHaveAttribute('data-selected', 'true');
  });

  test('TC-24 a diamond click at 200% is 160x160, wraps its label and stays centred after resize', async ({ page }) => {
    await openFreshBoard(page);
    const cam = await readCamera(page);
    await setCamera(page, { ...cam, zoom: 2 });

    await page.getByTestId('shape-kind-diamond').click();
    const click = { x: 640, y: 400 };
    await clickOn(page, click);
    await settle(page);

    const diamond = page.locator('[data-testid^="shape-"][data-kind="diamond"]').first();
    await expect(diamond).toBeVisible();
    const id = (await diamond.getAttribute('data-testid'))?.replace('shape-', '') ?? '';
    const before = await boxOf(page, `shape-${id}`);
    // 160 world units * zoom 2 on screen, centred on the click point.
    expect(before.width / 2).toBeCloseTo(160, 0);
    expect(before.height / 2).toBeCloseTo(160, 0);
    expect(Math.abs(before.x + before.width / 2 - click.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(before.y + before.height / 2 - click.y)).toBeLessThanOrEqual(3);

    // A label longer than the box wraps onto several lines, still centred.
    const long = 'checkout flow decision point wraps across the middle of the shape';
    await diamond.dblclick();
    await page.keyboard.type(long);
    await page.keyboard.press('Escape');
    await settle(page);
    await expect(page.getByTestId(`shape-label-${id}`)).toHaveText(long);
    expect(await lineCount(page, `shape-label-${id}`)).toBeGreaterThanOrEqual(2);

    // Resize via a corner handle; the label stays centred and intact.
    await page.getByTestId(`shape-${id}`).click();
    const se = page.getByTestId('resize-handle-se');
    await expect(se).toBeVisible();
    const hb = await se.boundingBox();
    if (hb === null) throw new Error('handle not visible');
    await dragOn(page, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, { x: hb.x - 60, y: hb.y - 20 });
    await settle(page);

    const after = await boxOf(page, `shape-${id}`);
    expect(after.width).toBeLessThan(before.width);
    await expect(page.getByTestId(`shape-label-${id}`)).toHaveText(long);
    const align = await page.getByTestId(`shape-label-${id}`).evaluate((el) => getComputedStyle(el).textAlign);
    expect(align).toBe('center');
  });
});
