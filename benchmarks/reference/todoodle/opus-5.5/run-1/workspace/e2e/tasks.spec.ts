import { expect, test } from '@playwright/test';
import { TASK_NAME_MAX } from '../packages/shared/src/limits.ts';
import { TOKENS } from '../packages/shared/src/tokens.ts';
import {
  axeViolations,
  descriptionInput,
  expectRowNames,
  nameInput,
  newInbox,
  postTask,
  quickAdd,
  seriousAxeViolations,
  sidebarInbox,
  taskRows,
} from './support/tasks.ts';
import { nameField } from './support/workspace.ts';

const isCreate = (url: URL, method: string) => method === 'POST' && /^\/api\/w\/[^/]+\/tasks$/.test(url.pathname);

test.describe('story 5: capture a task into the Inbox', () => {
  test('TC-80 W1 golden path: Q, type, Enter -> row at the bottom, box ready again; persists after reload; count 1', async ({ page }) => {
    await newInbox(page);
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('q');
    await expect(nameInput(page)).toBeFocused();
    await expect(quickAdd(page).getByText('→ Inbox')).toBeVisible();
    await page.keyboard.type('Buy milk');
    await page.keyboard.press('Enter');
    await expectRowNames(page, ['Buy milk']);
    await expect(nameInput(page)).toHaveValue('');
    await expect(nameInput(page)).toBeFocused();
    await expect(quickAdd(page)).toBeVisible();
    await expect(taskRows(page).first()).not.toHaveAttribute('aria-busy', 'true');
    await expect(sidebarInbox(page)).toHaveAccessibleName('Inbox, 1 open task');

    await page.reload();
    await expectRowNames(page, ['Buy milk']);
    await expect(sidebarInbox(page)).toHaveAccessibleName('Inbox, 1 open task');
  });

  test('TC-81 W2 rapid capture: One, Two, Three with Enter only keep their order, before and after reload', async ({ page }) => {
    await newInbox(page);
    await page.keyboard.press('q');
    for (const name of ['One', 'Two', 'Three']) {
      await page.keyboard.type(name);
      await page.keyboard.press('Enter');
    }
    await expectRowNames(page, ['One', 'Two', 'Three']);
    await expect(page.locator('[data-local-status]')).toHaveCount(0);
    await page.reload();
    await expectRowNames(page, ['One', 'Two', 'Three']);
  });

  test('TC-82 W3 lost response: the first POST commits but its response never arrives (502); Retry leaves exactly one task', async ({
    page,
  }) => {
    await newInbox(page);
    let intercepted = 0;
    await page.route('**/api/w/*/tasks', async (route) => {
      const request = route.request();
      if (!isCreate(new URL(request.url()), request.method()) || intercepted++ > 0) return route.continue();
      // The request reaches Todoodle and commits; a gateway then loses the answer.
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad gateway' });
    });
    await page.keyboard.press('q');
    await nameInput(page).fill('Buy milk');
    await nameInput(page).press('Enter');
    const row = taskRows(page).filter({ hasText: 'Buy milk' });
    await expect(row.getByRole('alert')).toHaveText("Couldn't save this task.");
    const replay = page.waitForResponse((res) => isCreate(new URL(res.url()), res.request().method()));
    await row.getByRole('button', { name: 'Retry' }).click();
    // Same id again: the server answers with the task it already has (200), not a second one.
    expect((await replay).status()).toBe(200);
    await expect(row).not.toHaveAttribute('data-local-status');
    await expectRowNames(page, ['Buy milk']);
    await page.reload();
    await expectRowNames(page, ['Buy milk']);
  });

  test('TC-82 W3 lost response (connection reset after commit): once Todoodle is reachable again there is exactly one task', async ({
    page,
  }) => {
    await newInbox(page);
    let intercepted = 0;
    await page.route('**/api/w/*/tasks', async (route) => {
      const request = route.request();
      if (!isCreate(new URL(request.url()), request.method()) || intercepted++ > 0) return route.continue();
      await route.fetch();
      await route.abort('connectionreset');
    });
    await page.keyboard.press('q');
    await nameInput(page).fill('Buy milk');
    await nameInput(page).press('Enter');
    const row = taskRows(page).filter({ hasText: 'Buy milk' });
    await expect(row.getByRole('alert')).toHaveText("Couldn't save this task.");
    // A network failure takes the app offline (story 4). When the health probe answers, the list is
    // refetched and the server's copy (same id) replaces the failed row: never a duplicate.
    await expect(row.getByRole('alert')).toHaveCount(0, { timeout: 15_000 });
    await expectRowNames(page, ['Buy milk']);
    await page.reload();
    await expectRowNames(page, ['Buy milk']);
  });

  test('TC-83 W4 discard: the first POST never reaches the server; Discard removes it for good; count 0', async ({ page }) => {
    await newInbox(page);
    await page.route('**/api/w/*/tasks', (route) =>
      isCreate(new URL(route.request().url()), route.request().method()) ? route.abort('internetdisconnected') : route.continue(),
    );
    await page.keyboard.press('q');
    await nameInput(page).fill('Buy milk');
    await nameInput(page).press('Enter');
    const row = taskRows(page).filter({ hasText: 'Buy milk' });
    await expect(row.getByRole('alert')).toBeVisible();
    await row.getByRole('button', { name: 'Discard' }).click();
    await expect(taskRows(page)).toHaveCount(0);
    await expect(sidebarInbox(page)).toHaveAccessibleName('Inbox');
    await page.unroute('**/api/w/*/tasks');
    await page.reload();
    await expect(page.getByText('Your Inbox is clear. Press Q to add a task.')).toBeVisible();
    await expect(sidebarInbox(page)).toHaveAccessibleName('Inbox');
  });

  test("TC-84 W5 shortcut guard: typing 'quiet' in the workspace name field stays there; quick add does not open", async ({ page }) => {
    await newInbox(page);
    await nameField(page).click();
    await nameField(page).press('End');
    await page.keyboard.type('quiet');
    await expect(nameField(page)).toHaveValue(/quiet$/);
    await expect(quickAdd(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('TC-85 W6 empty state: a new workspace shows it; adding a task removes it', async ({ page }) => {
    await newInbox(page);
    const empty = page.getByText('Your Inbox is clear. Press Q to add a task.');
    await expect(empty).toBeVisible();
    await page.getByRole('button', { name: 'Add task' }).click();
    await nameInput(page).fill('First task');
    await page.keyboard.press('Enter');
    await expect(empty).toHaveCount(0);
    await expectRowNames(page, ['First task']);
  });

  test("TC-86 W7 limits: 600 pasted chars are all kept, '100 characters over', Add disabled; shortened to 500 it saves", async ({ page }) => {
    await newInbox(page);
    await page.keyboard.press('q');
    await nameInput(page).focus();
    await page.keyboard.insertText('m'.repeat(600));
    await expect(nameInput(page)).toHaveValue('m'.repeat(600));
    await expect(quickAdd(page).getByText('100 characters over', { exact: true })).toBeVisible();
    const add = quickAdd(page).getByRole('button', { name: 'Add', exact: true });
    await expect(add).toBeDisabled();
    await nameInput(page).press('Enter');
    await expect(taskRows(page)).toHaveCount(0);
    // Select the last 100 characters and delete them.
    await nameInput(page).evaluate((el: HTMLInputElement, max) => el.setSelectionRange(max, el.value.length), TASK_NAME_MAX);
    await page.keyboard.press('Backspace');
    await expect(nameInput(page)).toHaveValue('m'.repeat(TASK_NAME_MAX));
    await expect(add).toBeEnabled();
    const created = page.waitForResponse((res) => isCreate(new URL(res.url()), res.request().method()));
    await add.click();
    const body = (await (await created).json()) as { task: { name: string } };
    expect(body.task.name).toHaveLength(TASK_NAME_MAX);
  });

  test('TC-87 W8 Escape: open, type, Escape -> closed, and nothing was created', async ({ page }) => {
    await newInbox(page);
    const posts: string[] = [];
    page.on('request', (r) => {
      if (isCreate(new URL(r.url()), r.method())) posts.push(r.url());
    });
    await page.keyboard.press('q');
    await page.keyboard.type('Never mind');
    await page.keyboard.press('Escape');
    await expect(quickAdd(page)).toHaveCount(0);
    // Opened with Q: focus goes back to what had it before (Share, after the link panel closed).
    await expect(page.getByRole('button', { name: 'Share' })).toBeFocused();
    await page.reload();
    await expect(page.getByText('Your Inbox is clear. Press Q to add a task.')).toBeVisible();
    expect(posts).toEqual([]);
  });

  test('TC-88 W9 keyboard only: golden path without the mouse; axe finds nothing serious with quick add open', async ({ page }) => {
    await newInbox(page);
    // Keyboard only from here. (WebKit's default Tab order skips buttons, so Q opens quick add.)
    await page.keyboard.press('q');
    await expect(nameInput(page)).toBeFocused();
    await page.keyboard.type('Email Sam re: invoice #4411');
    await page.keyboard.press('Tab');
    await expect(descriptionInput(page)).toBeFocused();
    await page.keyboard.type('Attach the PDF');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expectRowNames(page, ['Email Sam re: invoice #4411']);
    await expect(nameInput(page)).toBeFocused();
    expect(await seriousAxeViolations(page)).toEqual([]);
  });

  test('TC-89 W10 API bypass: a 501-char name posted directly is rejected with 400; the list is unchanged', async ({ page }) => {
    const { id } = await newInbox(page);
    const res = await postTask(page, id, 'x'.repeat(TASK_NAME_MAX + 1));
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation' });
    await page.reload();
    await expect(page.getByText('Your Inbox is clear. Press Q to add a task.')).toBeVisible();
  });

  test('TC-90 W11 optimistic latency: with the POST delayed 1.5 s the row is visible while the request is pending', async ({ page }) => {
    await newInbox(page);
    let answered = false;
    await page.route('**/api/w/*/tasks', async (route) => {
      if (!isCreate(new URL(route.request().url()), route.request().method())) return route.continue();
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
      answered = true;
    });
    await page.keyboard.press('q');
    await nameInput(page).fill('Call Mum 📞');
    await nameInput(page).press('Enter');
    const row = taskRows(page).filter({ hasText: 'Call Mum 📞' });
    await expect(row).toBeVisible({ timeout: 500 });
    await expect(row).toHaveAttribute('aria-busy', 'true');
    expect(answered).toBe(false);
    await expect(row).not.toHaveAttribute('aria-busy', 'true', { timeout: 5_000 });
  });

  test('TC-105 W14 ? opens the shortcuts panel listing every shortcut; axe finds nothing serious', async ({ page }) => {
    await newInbox(page);
    await page.keyboard.press('Shift+?');
    const panel = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(panel).toBeVisible();
    for (const text of ['Add task', 'Show keyboard shortcuts', 'Move between tasks']) await expect(panel.getByText(text).first()).toBeVisible();
    for (const group of ['General', 'Tasks', 'Navigation']) await expect(panel.getByRole('heading', { name: group })).toBeVisible();
    await expect(panel.locator('kbd', { hasText: 'Q' })).toBeVisible();
    expect(await seriousAxeViolations(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });

  test('TC-114 W15 20 tasks, keyboard only: Tab into the list, End -> row 20, Home -> row 1', async ({ page }) => {
    const { id } = await newInbox(page);
    for (let i = 1; i <= 20; i++) expect((await postTask(page, id, `Task ${i}`)).status()).toBe(201);
    await page.reload();
    await expect(taskRows(page)).toHaveCount(20);
    await sidebarInbox(page).focus();
    await page.keyboard.press('Tab');
    await expect(taskRows(page).first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(taskRows(page).nth(19)).toBeFocused();
    await expect(taskRows(page).nth(19)).toContainText('Task 20');
    await page.keyboard.press('Home');
    await expect(taskRows(page).first()).toBeFocused();
    await expect(taskRows(page).first()).toContainText('Task 1');
  });
});

function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

test('TC-98 W13 light and dark: the background token differs; axe colour-contrast has zero violations in both', async ({ page }) => {
  const { id } = await newInbox(page);
  await postTask(page, id, 'Buy milk', 'Semi-skimmed, two pints');
  await postTask(page, id, 'Book dentist — ask about Tuesday');
  const backgrounds: string[] = [];
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.reload();
    await expect(taskRows(page)).toHaveCount(2);
    await page.keyboard.press('q');
    await nameInput(page).fill('Draft');
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(background).toBe(rgb(TOKENS[scheme].background));
    backgrounds.push(background);
    expect(await axeViolations(page, { runOnly: ['color-contrast'] })).toEqual([]);
  }
  expect(backgrounds[0]).not.toBe(backgrounds[1]);
});
