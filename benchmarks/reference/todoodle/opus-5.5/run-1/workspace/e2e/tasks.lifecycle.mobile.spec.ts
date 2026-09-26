import { expect, test } from '@playwright/test';
import { expectRowNames, newInbox, rowNamed, seedTasks, toastWith } from './support/tasks.ts';

// Story 6, TC-E07: the phone layout (iPhone 13, touch, no hover).

test('TC-E07 phone: the row menu is visible without hover; tap Delete, tap Undo; tapping a name opens a full-screen detail', async ({ page }) => {
  expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
  const { id } = await newInbox(page);
  await seedTasks(page, id, ['Buy milk', 'Call Mum 📞']);
  await page.reload();
  await expectRowNames(page, ['Buy milk', 'Call Mum 📞']);
  const trigger = rowNamed(page, 'Buy milk').getByRole('button', { name: 'More actions for Buy milk' });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveCSS('opacity', '1');
  const box = (await trigger.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await trigger.tap();
  await page.getByRole('menuitem', { name: 'Delete' }).tap();
  await expectRowNames(page, ['Call Mum 📞']);
  await toastWith(page, 'Task deleted').getByRole('button', { name: 'Undo' }).tap();
  await expectRowNames(page, ['Buy milk', 'Call Mum 📞']);

  await rowNamed(page, 'Call Mum 📞').getByText('Call Mum 📞').tap();
  const sheet = page.getByRole('dialog', { name: 'Task details' });
  await expect(sheet).toBeVisible();
  const viewport = page.viewportSize()!;
  // Measured once the slide-in animation has finished.
  await expect
    .poll(async () => {
      const box = (await sheet.boundingBox())!;
      return [box.x, box.y, box.width, box.height].map(Math.round);
    })
    .toEqual([0, 0, viewport.width, viewport.height]);
});
