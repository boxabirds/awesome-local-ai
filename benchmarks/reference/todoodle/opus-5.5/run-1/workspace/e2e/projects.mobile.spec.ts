import { type Locator, expect, test } from '@playwright/test';
import { lists, projectEntry, projectMenuButton, projectPath, seedProject, seedTasksIn } from './support/projects.ts';
import { expectRowNames, newInbox, rowNamed } from './support/tasks.ts';

// Story 7, W9 / TC-86: the phone layout (the iPhone 13 device, touch and no hover, at the design's 390x844:
// Playwright's preset viewport is 390x664, the screen without browser chrome).
test.use({ viewport: { width: 390, height: 844 } });

async function expectHitArea(control: Locator) {
  const box = (await control.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
}

test('W9 / TC-86 phone: drawer, visible 44px project controls, rename by tap, tap a project (drawer closes), Move to… as a bottom panel', async ({ page }) => {
  expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
  const { id } = await newInbox(page);
  const work = await seedProject(page, id, 'Work');
  await seedProject(page, id, 'Home');
  const names = Array.from({ length: 14 }, (_, i) => `Work task ${i + 1}`);
  await seedTasksIn(page, id, work, names);
  await page.reload();

  // The sidebar lives in the ☰ drawer.
  await page.getByRole('button', { name: 'Open navigation' }).tap();
  const drawer = page.getByRole('dialog', { name: 'Lists' });
  await expect(drawer).toBeVisible();
  const menu = projectMenuButton(page, 'Work');
  // No hover on touch screens: '…' is visible anyway.
  await expect(menu).toHaveCSS('opacity', '1');
  for (const control of [projectEntry(page, 'Work'), menu, lists(page).getByRole('button', { name: 'Add project' })]) await expectHitArea(control);

  // Rename by tap.
  await menu.tap();
  await page.getByRole('menuitem', { name: 'Rename' }).tap();
  const field = lists(page).getByRole('textbox', { name: 'Project name' });
  await field.fill('Job');
  await field.press('Enter');
  await expect(projectEntry(page, 'Job')).toBeVisible();

  // The create dialog's swatches are finger-sized too.
  await lists(page).getByRole('button', { name: 'Add project' }).tap();
  const create = page.getByRole('dialog', { name: 'Add project' });
  const swatches = create.getByRole('radio');
  await expect(swatches).toHaveCount(12);
  for (let i = 0; i < 12; i++) await expectHitArea(swatches.nth(i));
  await create.getByRole('button', { name: 'Cancel' }).tap();
  await expect(create).toBeHidden();

  // Still in the drawer (cancelling the dialog returns to it). Choosing a project closes it and shows the project.
  await expect(page.getByRole('dialog', { name: 'Lists' })).toBeVisible();
  await projectEntry(page, 'Job').tap();
  await expect(page.getByRole('dialog', { name: 'Lists' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Job', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${projectPath(id, work)}`));

  // A long list: the task menu's Move to… opens as a panel from the bottom; tap Inbox.
  const last = names.at(-1)!;
  await rowNamed(page, last).scrollIntoViewIfNeeded();
  await rowNamed(page, last).getByRole('button', { name: `More actions for ${last}` }).tap();
  await page.getByRole('menuitem', { name: /Move to…/ }).tap();
  const input = page.getByRole('combobox', { name: 'Move to…' });
  await expect(input).toBeVisible();
  const panel = page.locator('[data-drawer]');
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(Math.round(box.x)).toBe(0);
  expect(Math.round(box.width)).toBe(390);
  await expect.poll(async () => Math.round(((await panel.boundingBox())!.y + (await panel.boundingBox())!.height))).toBe(844);
  const options = page.getByRole('listbox', { name: 'Lists' }).getByRole('option');
  await expect(options).toHaveText(['Inbox', 'Job', 'Home']);
  for (let i = 0; i < 3; i++) await expectHitArea(options.nth(i));
  await options.first().tap();
  await expect(input).toBeHidden();
  await expectRowNames(page, names.slice(0, -1));

  await page.getByRole('button', { name: 'Open navigation' }).tap();
  await lists(page).getByRole('button', { name: /^Inbox/ }).tap();
  await expectRowNames(page, [last]);
});
