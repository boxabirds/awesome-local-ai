import { expect, test } from '@playwright/test';
import { apiCreate } from './remembered-helpers';

const MIN = 44;

async function expectTouchSize(locator: import('@playwright/test').Locator) {
  const box = (await locator.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(MIN);
  expect(box.height).toBeGreaterThanOrEqual(MIN);
}

test('TC-91 touch: the "..." is visible without hover; tap to forget; 44x44 targets', async ({ page, baseURL }) => {
  await apiCreate(page.request, baseURL!, 'Alpha');
  await apiCreate(page.request, baseURL!, 'Beta');
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'More actions for Alpha' });
  await expect(trigger).toBeVisible();
  expect(await trigger.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await expectTouchSize(trigger);

  await trigger.tap();
  const item = page.getByRole('menuitem', { name: 'Forget on this browser' });
  await expectTouchSize(item);
  await item.tap();
  const dialog = page.getByRole('alertdialog', { name: 'Forget Alpha on this browser?' });
  await expect(dialog).toBeVisible();
  for (const name of ['Copy link', 'Cancel', 'Forget']) await expectTouchSize(dialog.getByRole('button', { name, exact: true }));
  await dialog.getByRole('button', { name: 'Forget', exact: true }).tap();
  await expect(page.getByRole('link', { name: /^Alpha\s*Opened/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Beta\s*Opened/ })).toBeVisible();
});
