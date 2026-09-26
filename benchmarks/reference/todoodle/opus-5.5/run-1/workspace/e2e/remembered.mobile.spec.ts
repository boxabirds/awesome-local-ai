import { expect, test } from '@playwright/test';
import { createNamed, goHome } from './support/remembered.ts';

const MIN_TOUCH_TARGET_PX = 44;

async function expectTouchSize(box: { width: number; height: number } | null) {
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
  expect(box!.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
}

test('TC-91 touch: the row menu is visible without hover, tap-to-forget works, targets are at least 44x44', async ({ page }) => {
  expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
  const a = await createNamed(page, 'Pocket list');
  await goHome(page);
  const trigger = page.getByRole('button', { name: `More actions for ${a.name}` });
  await expect(trigger).toBeVisible();
  expect(await trigger.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await expectTouchSize(await trigger.boundingBox());

  await trigger.tap();
  const item = page.getByRole('menuitem', { name: 'Forget on this browser' });
  await expectTouchSize(await item.boundingBox());
  await item.tap();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  for (const name of ['Cancel', 'Forget', 'Copy link']) await expectTouchSize(await dialog.getByRole('button', { name }).boundingBox());
  await dialog.getByRole('button', { name: 'Forget' }).tap();
  await expect(page.getByRole('link', { name: /^Pocket list/ })).toHaveCount(0);
});
