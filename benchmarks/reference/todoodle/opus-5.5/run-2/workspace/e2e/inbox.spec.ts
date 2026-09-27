import { expect, test } from '@playwright/test';
import {
  CLIENT,
  counter,
  EMPTY_TEXT,
  nameField,
  newTaskId,
  openNewWorkspace,
  quickAddForm,
  rowNames,
  runAxe,
  seedTasks,
  seriousOrCritical,
  storedTasks,
  taskRows,
} from './inbox-helpers';

/*
 * Story 5: capture tasks into the Inbox. Real wrangler dev and local D1; page.route is used only
 * for fault injection (TC-82, TC-83, TC-90).
 */

/** The task list and create endpoint (with or without a query string). */
const TASKS_POST = /\/api\/w\/[^/]+\/tasks(\?.*)?$/;

test.describe('Inbox capture', () => {
  test('TC-80 W1 golden path: Start, Q, "Buy milk", Enter; kept after reload; Inbox count 1', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /start/i }).first().click();
    await page.waitForURL(/\/w#/);
    await page.getByRole('dialog').getByRole('button', { name: 'Skip for now' }).click();
    await expect(page.getByText(EMPTY_TEXT)).toBeVisible();

    await page.locator('body').press('q');
    await expect(nameField(page)).toBeFocused();
    await expect(quickAddForm(page).getByText('→ Inbox')).toBeVisible();
    await page.keyboard.type('Buy milk');
    await page.keyboard.press('Enter');

    await expect(taskRows(page).last()).toContainText('Buy milk');
    await expect(nameField(page)).toHaveValue('');
    await expect(nameField(page)).toBeFocused();
    await expect(quickAddForm(page)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Inbox, 1 open task' })).toBeVisible();

    await page.reload();
    const skip = page.getByRole('dialog').getByRole('button', { name: 'Skip for now' });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await expect(taskRows(page)).toHaveCount(1);
    expect(await rowNames(page)).toEqual(['Buy milk']);
    await expect(page.getByRole('link', { name: 'Inbox, 1 open task' })).toBeVisible();
  });

  test('TC-81 W2 rapid capture: One, Two, Three with Enter only keep their order after reload', async ({ page }) => {
    await openNewWorkspace(page);
    await page.locator('body').press('q');
    for (const name of ['One', 'Two', 'Three']) {
      await page.keyboard.type(name);
      await page.keyboard.press('Enter');
    }
    await expect(taskRows(page)).toHaveCount(3);
    expect(await rowNames(page)).toEqual(['One', 'Two', 'Three']);
    await page.reload();
    await expect(taskRows(page)).toHaveCount(3);
    expect(await rowNames(page)).toEqual(['One', 'Two', 'Three']);
  });

  test('TC-82 W3 lost response: the first POST reaches the server but its answer is lost; Retry leaves exactly one task', async ({ page }) => {
    const ws = await openNewWorkspace(page);
    let posts = 0;
    // After the lost answer the app refetches once it can reach Todoodle again (story 4), which
    // would already show the committed task as saved. Hold that refetch (an HTTP error, not a
    // network one) until Retry, so the Retry path itself is what's tested.
    let holdList = false;
    await page.route(TASKS_POST, async (route) => {
      if (route.request().method() !== 'POST') {
        if (holdList) return route.fulfill({ status: 503, json: { error: 'internal', message: 'held' } });
        return route.continue();
      }
      posts++;
      if (posts === 1) {
        holdList = true;
        await route.fetch(); // committed on the server...
        return route.abort('connectionreset'); // ...but the browser never hears back
      }
      holdList = false;
      return route.continue();
    });
    await page.locator('body').press('q');
    await page.keyboard.type('Buy milk');
    await page.keyboard.press('Enter');
    const row = taskRows(page).filter({ hasText: 'Buy milk' });
    await expect(row.getByRole('alert')).toHaveText("Couldn't save this task.");
    await row.getByRole('button', { name: 'Retry' }).click();
    await expect(row.getByRole('alert')).toHaveCount(0);
    await expect(row).not.toHaveAttribute('aria-busy', 'true');
    expect(posts).toBe(2);

    await page.reload();
    await expect(taskRows(page)).toHaveCount(1);
    expect(await rowNames(page)).toEqual(['Buy milk']);
    expect((await storedTasks(page.request, ws.id)).map((t) => t.name)).toEqual(['Buy milk']);
  });

  test('TC-83 W4 discard: a POST that never reached the server, then Discard; gone after reload, count 0', async ({ page }) => {
    const ws = await openNewWorkspace(page);
    await page.route(TASKS_POST, (route) => (route.request().method() === 'POST' ? route.abort('failed') : route.continue()));
    await page.locator('body').press('q');
    await page.keyboard.type('Buy milk');
    await page.keyboard.press('Enter');
    const row = taskRows(page).filter({ hasText: 'Buy milk' });
    await expect(row.getByRole('alert')).toBeVisible();
    await row.getByRole('button', { name: 'Discard' }).click();
    await expect(taskRows(page)).toHaveCount(0);
    await page.unroute(TASKS_POST);
    await page.reload();
    await expect(page.getByText(EMPTY_TEXT)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Inbox', exact: true })).toBeVisible();
    expect(await storedTasks(page.request, ws.id)).toEqual([]);
  });

  test('TC-84 W5 shortcut guard: typing "quiet" in the workspace name does not open quick add', async ({ page }) => {
    await openNewWorkspace(page);
    const rename = page.getByRole('textbox', { name: 'Workspace name' });
    await rename.click();
    await rename.press('ControlOrMeta+a');
    await page.keyboard.type('quiet');
    await expect(rename).toHaveValue('quiet');
    await expect(quickAddForm(page)).toHaveCount(0);
  });

  test('TC-85 W6 the empty state shows on a new workspace and goes once a task is added', async ({ page }) => {
    await openNewWorkspace(page);
    await expect(page.getByText(EMPTY_TEXT)).toBeVisible();
    await page.getByRole('button', { name: 'Add task' }).click();
    await nameField(page).fill('First thing');
    await nameField(page).press('Enter');
    await expect(taskRows(page)).toHaveCount(1);
    await expect(page.getByText(EMPTY_TEXT)).toHaveCount(0);
  });

  test('TC-86 W7 limits: 600 pasted characters are all kept; Add disabled until shortened; the saved task has 500', async ({ page }) => {
    const ws = await openNewWorkspace(page);
    await page.locator('body').press('q');
    const pasted = 'x'.repeat(600);
    await page.keyboard.insertText(pasted);
    await expect(nameField(page)).toHaveValue(pasted);
    const form = quickAddForm(page);
    await expect(counter(page, '100 characters over')).toBeVisible();
    await expect(form.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
    await page.keyboard.press('Enter');
    await expect(taskRows(page)).toHaveCount(0);

    await nameField(page).press('End');
    for (let i = 0; i < 100; i++) await page.keyboard.press('Backspace');
    await expect(nameField(page)).toHaveValue('x'.repeat(500));
    await expect(counter(page, '0 characters left')).toBeVisible();
    await expect(form.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
    await page.keyboard.press('Enter');
    await expect(taskRows(page)).toHaveCount(1);
    await expect(taskRows(page).first()).not.toHaveAttribute('aria-busy', 'true');
    const [saved] = await storedTasks(page.request, ws.id);
    expect(saved?.name).toHaveLength(500);
  });

  test('TC-87 W8 Escape closes quick add and creates nothing', async ({ page }) => {
    const ws = await openNewWorkspace(page);
    await page.locator('body').press('q');
    await page.keyboard.type('Not this one');
    await page.keyboard.press('Escape');
    await expect(quickAddForm(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(EMPTY_TEXT)).toBeVisible();
    expect(await storedTasks(page.request, ws.id)).toEqual([]);
  });

  test('TC-88 W9 keyboard only, and axe on the Inbox with quick add open finds nothing serious', async ({ page }) => {
    await openNewWorkspace(page);
    await page.keyboard.press('q');
    await expect(nameField(page)).toBeFocused();
    await page.keyboard.type('Buy milk');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Semi-skimmed');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(taskRows(page)).toHaveCount(1);
    await expect(taskRows(page).first()).not.toHaveAttribute('aria-busy', 'true');
    expect(seriousOrCritical(await runAxe(page))).toEqual([]);
  });

  test('TC-89 W10 the API refuses a 501-character name even without quick add', async ({ page }) => {
    const ws = await openNewWorkspace(page);
    await seedTasks(page.request, ws.id, ['Buy milk']);
    const res = await page.request.post(`/api/w/${ws.id}/tasks`, { headers: CLIENT, data: { id: newTaskId(), name: 'a'.repeat(501) } });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation' });
    expect((await storedTasks(page.request, ws.id)).map((t) => t.name)).toEqual(['Buy milk']);
  });

  test('TC-90 W11 the new row shows while the POST is still pending', async ({ page }) => {
    await openNewWorkspace(page);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(TASKS_POST, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await Promise.race([held, new Promise((r) => setTimeout(r, 1_500))]);
      return route.continue();
    });
    await page.locator('body').press('q');
    await page.keyboard.type('Buy milk');
    await page.keyboard.press('Enter');
    const row = taskRows(page).filter({ hasText: 'Buy milk' });
    await expect(row).toBeVisible({ timeout: 500 });
    await expect(row).toHaveAttribute('aria-busy', 'true');
    release();
    await expect(row).not.toHaveAttribute('aria-busy', 'true');
  });

  test('TC-98 W13 light and dark: the background differs and axe colour contrast passes in both', async ({ page }) => {
    const ws = await openNewWorkspace(page);
    await seedTasks(page.request, ws.id, ['Buy milk', 'Email Sam re: invoice #4411']);
    const backgrounds: string[] = [];
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.reload();
      await expect(taskRows(page)).toHaveCount(2);
      await page.locator('body').press('q');
      await nameField(page).fill('a'.repeat(460));
      await expect(counter(page, '40 characters left')).toBeVisible();
      backgrounds.push(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
      expect(await runAxe(page, { only: ['color-contrast'] }), `colour contrast in ${colorScheme}`).toEqual([]);
    }
    expect(backgrounds[0]).not.toBe(backgrounds[1]);
  });

  test('TC-105 W14 ? shows every shortcut, grouped; axe finds nothing serious', async ({ page }) => {
    await openNewWorkspace(page);
    await page.locator('body').press('?');
    const panel = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(panel).toBeVisible();
    for (const group of ['General', 'Tasks', 'Navigation']) await expect(panel.getByRole('heading', { name: group })).toBeVisible();
    await expect(panel.getByText('Add task')).toBeVisible();
    await expect(panel.getByText('Show keyboard shortcuts')).toBeVisible();
    await expect(panel.getByText('Move between tasks').first()).toBeVisible();
    expect(seriousOrCritical(await runAxe(page, { include: '[role="dialog"]' }))).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  });

  test('TC-114 W15 20 tasks, keyboard only: Tab into the list, End, Home', async ({ page, browserName }) => {
    const ws = await openNewWorkspace(page);
    const names = Array.from({ length: 20 }, (_, i) => `Task ${i + 1}`);
    await seedTasks(page.request, ws.id, names);
    await page.reload();
    await expect(taskRows(page)).toHaveCount(20);
    // Tab from the heading area until focus lands in the list (one stop: the first row).
    await page.getByRole('heading', { level: 1, name: 'Inbox' }).focus();
    const activeName = () => page.evaluate(() => document.activeElement?.querySelector('span.break-words')?.textContent ?? null);
    const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    for (let i = 0; i < 10 && (await activeName()) === null; i++) await page.keyboard.press(tab);
    expect(await activeName()).toBe('Task 1');
    await page.keyboard.press('End');
    expect(await activeName()).toBe('Task 20');
    await page.keyboard.press('Home');
    expect(await activeName()).toBe('Task 1');
  });
});
