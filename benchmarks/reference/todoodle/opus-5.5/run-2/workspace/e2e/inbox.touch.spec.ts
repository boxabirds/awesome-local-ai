import { devices, expect, type Locator, type Page, test } from '@playwright/test';
import { nameField, openNewWorkspace, quickAddForm, seedTasks, taskRows } from './inbox-helpers';

/*
 * Story 5 on touch screens (the mobile-touch project: iPhone 13 with touch). TC-97 also runs at a
 * 1024-wide touch tablet size.
 */

const MIN = 44;

/** Every visible button, link and checkbox inside `scope` whose box is under 44x44. */
async function undersized(scope: Locator): Promise<string[]> {
  const controls = scope.locator('button, a[href], [role="checkbox"], input[type="checkbox"]');
  const small: string[] = [];
  let measured = 0;
  for (const control of await controls.all()) {
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    if (!box) continue;
    measured++;
    if (box.width < MIN || box.height < MIN) {
      const label = (await control.getAttribute('aria-label')) ?? (await control.innerText()).trim();
      small.push(`${label || (await control.evaluate((el) => el.outerHTML.slice(0, 80)))}: ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
  }
  expect(measured, 'controls measured').toBeGreaterThan(0);
  return small;
}

async function expectAllTouchSized(page: Page) {
  expect(await undersized(page.locator('[data-app-shell]').first())).toEqual([]);
}

async function checkTouchTargets(page: Page) {
  const ws = await openNewWorkspace(page);
  await seedTasks(page.request, ws.id, ['Buy milk', 'Email Sam re: invoice #4411']);
  await page.reload();
  await expect(taskRows(page)).toHaveCount(2);
  // Shell and list.
  await expectAllTouchSized(page);
  // Quick add (docked from the floating button): its fields and buttons too.
  await page.getByRole('button', { name: 'Add task' }).tap();
  await expect(quickAddForm(page)).toBeVisible();
  await nameField(page).fill('Milk');
  await expectAllTouchSized(page);
  for (const name of ['Add', 'Cancel']) {
    const box = (await quickAddForm(page).getByRole('button', { name, exact: true }).boundingBox())!;
    expect(Math.min(box.width, box.height), `${name} button`).toBeGreaterThanOrEqual(MIN);
  }
  expect((await nameField(page).boundingBox())!.height).toBeGreaterThanOrEqual(MIN);
  // Rows themselves are at least 44 high.
  for (const row of await taskRows(page).all()) expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(MIN);
  // The drawer, where there is one.
  const menu = page.getByRole('button', { name: 'Open navigation' });
  if (await menu.isVisible()) {
    await page.keyboard.press('Escape');
    await menu.tap();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    expect(await undersized(drawer)).toEqual([]);
  }
}

test('TC-97 W12 iPhone: every button, link and checkbox in the shell, list and quick add is at least 44x44', async ({ page }) => {
  await checkTouchTargets(page);
});

test.describe('tablet', () => {
  const { defaultBrowserType: _ignored, ...ipad } = devices['iPad (gen 7)'];
  test.use({ ...ipad, viewport: { width: 1024, height: 768 }, hasTouch: true });

  test('TC-97 W12 1024-wide touch tablet: every control is at least 44x44; inline sidebar with the floating button', async ({ page }) => {
    await checkTouchTargets(page);
    await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
  });
});

test('TC-125 W16 phone capture: tap +, type "Milk", Enter; docked at the bottom; the drawer closes on Inbox', async ({ page }) => {
  await openNewWorkspace(page);
  await expect(page.getByText('Your Inbox is clear. Tap + to add a task.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Lists' })).toHaveCount(0);
  const fab = page.getByRole('button', { name: 'Add task' });
  await fab.tap();
  await expect(nameField(page)).toBeFocused();
  await expect(fab).toBeHidden();
  await page.keyboard.type('Milk');
  await page.keyboard.press('Enter');
  await expect(taskRows(page)).toHaveCount(1);
  await expect(taskRows(page).first()).toContainText('Milk');
  await expect(nameField(page)).toHaveValue('');

  const form = (await quickAddForm(page).boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.abs(form.y + form.height - viewport.height)).toBeLessThanOrEqual(2);
  expect(form.width).toBeGreaterThanOrEqual(viewport.width - 2);

  await page.keyboard.press('Escape');
  await expect(fab).toBeVisible();
  const menu = page.getByRole('button', { name: 'Open navigation' });
  await menu.tap();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await drawer.getByRole('link', { name: 'Inbox, 1 open task' }).tap();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  await expect(menu).toBeFocused();
});
