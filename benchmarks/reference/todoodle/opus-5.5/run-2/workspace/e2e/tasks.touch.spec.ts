import { expect, test } from '@playwright/test';
import { rowNames } from './inbox-helpers';
import { row, sheet, undoToast, workspaceWith } from './tasks-helpers';

/* Story 6 on a phone (the mobile-touch project: iPhone 13, 390x844, touch). */

const THREE = ['Buy milk', 'Email Sam re: invoice #4411', 'Call Mum 📞'];

test('TC-E07 the row menu shows without hover; tap Delete, tap Undo; tap a name: the detail fills the screen', async ({ page }) => {
  await workspaceWith(page, THREE);
  const trigger = page.getByRole('button', { name: `Actions for ${THREE[1]}` });
  await expect(trigger).toBeVisible();
  expect(await trigger.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  const box = await trigger.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);

  await trigger.tap();
  await page.getByRole('menuitem', { name: 'Delete' }).tap();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect.poll(() => rowNames(page)).toEqual([THREE[0], THREE[2]]);
  await undoToast(page, 'Task deleted').getByRole('button', { name: 'Undo' }).tap();
  await expect.poll(() => rowNames(page)).toEqual(THREE);

  await row(page, THREE[0]!).getByRole('button', { name: THREE[0]!, exact: true }).tap();
  await expect(sheet(page)).toBeVisible();
  const viewport = page.viewportSize()!;
  const panel = (await sheet(page).boundingBox())!;
  expect(panel.x).toBeLessThanOrEqual(1);
  expect(panel.y).toBeLessThanOrEqual(1);
  expect(panel.width).toBeGreaterThanOrEqual(viewport.width - 1);
  expect(panel.height).toBeGreaterThanOrEqual(viewport.height - 1);
});
