import { devices, expect, type Page, test } from '@playwright/test';
import { MIN_TOUCH_TARGET_PX } from '../packages/shared/src/limits.ts';
import { expectRowNames, nameInput, newInbox, postTask, quickAdd, taskRows } from './support/tasks.ts';

/** Every visible button, link and checkbox in the shell, list and quick add is at least 44x44. */
async function expectTouchTargets(page: Page) {
  const controls = page.locator('button:visible, a[href]:visible, input[type="checkbox"]:visible, [role="option"]:visible');
  const count = await controls.count();
  expect(count).toBeGreaterThan(3);
  const small: string[] = [];
  for (let i = 0; i < count; i++) {
    const control = controls.nth(i);
    const box = await control.boundingBox();
    if (!box) continue;
    if (box.width < MIN_TOUCH_TARGET_PX || box.height < MIN_TOUCH_TARGET_PX) {
      const label = (await control.getAttribute('aria-label')) ?? (await control.innerText()).slice(0, 30);
      small.push(`${label}: ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
  }
  expect(small).toEqual([]);
}

function fab(page: Page) {
  return page.locator('[data-fab]');
}

test('TC-97 W12 iPhone: every control in the shell, list, quick add and drawer is at least 44x44', async ({ page }) => {
  expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
  const { id } = await newInbox(page);
  await postTask(page, id, 'Buy milk', 'Semi-skimmed');
  await page.reload();
  await expect(taskRows(page)).toHaveCount(1);
  await expectTouchTargets(page);
  await fab(page).tap();
  await expect(nameInput(page)).toBeFocused();
  await expectTouchTargets(page);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open navigation' }).tap();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectTouchTargets(page);
});

test('TC-125 W16 iPhone capture: tap +, type, Enter adds the task with quick add docked at the bottom; the drawer closes on selection', async ({
  page,
}) => {
  await newInbox(page);
  // Phone layout: ☰ instead of the inline sidebar, the round + instead of '+ Add task'.
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Lists' })).toHaveCount(0);
  await expect(page.getByText('Your Inbox is clear. Tap + to add a task.')).toBeVisible();
  await fab(page).tap();
  await expect(nameInput(page)).toBeFocused();
  await expect(fab(page)).toHaveCount(0);
  await page.keyboard.type('Milk');
  await page.keyboard.press('Enter');
  await expectRowNames(page, ['Milk']);
  await expect(nameInput(page)).toHaveValue('');
  const box = await quickAdd(page).boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(Math.abs(box!.y + box!.height - viewport.height)).toBeLessThanOrEqual(2);
  expect(box!.width).toBeGreaterThanOrEqual(viewport.width - 2);

  await page.keyboard.press('Escape');
  await expect(fab(page)).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).tap();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: /^Inbox/ }).tap();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
});

test.describe('iPad (1024px, touch)', () => {
  const { defaultBrowserType: _browser, ...ipad } = devices['iPad (gen 7)'];
  test.use(ipad);

  test('TC-97 W12 iPad: inline sidebar and the + button; every control is at least 44x44', async ({ page }) => {
    const { id } = await newInbox(page);
    await postTask(page, id, 'Book dentist — ask about Tuesday');
    await page.reload();
    await expect(taskRows(page)).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
    await expect(fab(page)).toBeVisible();
    await expectTouchTargets(page);
    await fab(page).tap();
    await expect(nameInput(page)).toBeFocused();
    await expectTouchTargets(page);
  });
});
