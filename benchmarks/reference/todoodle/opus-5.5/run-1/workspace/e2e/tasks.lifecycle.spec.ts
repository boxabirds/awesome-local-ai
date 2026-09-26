import { expect, test } from '@playwright/test';
import { LIVE_UPDATE_TARGET_MS, UNDO_WINDOW_MS } from '../packages/shared/src/limits.ts';
import { join } from './support/live.ts';
import { expectRowNames, modKey, newInbox, rawTask, rowNamed, seedTasks, seriousAxeViolations, taskRows, toastWith } from './support/tasks.ts';

// Story 6 workflows (design E2E table, TC-E01..TC-E06, TC-E08) against local wrangler dev with real D1
// and Durable Objects. Chromium only, as the design says (the APIs used are standards-only).

const NAMES = ['Buy milk', 'Email Sam re: invoice #4411', 'Call Mum 📞', 'Book dentist — ask about Tuesday'];
/** Enough for the toast to run out after the window, with slack for a busy machine. */
const PAST_WINDOW_MS = UNDO_WINDOW_MS + 5_000;

test.skip(({ browserName }) => browserName !== 'chromium', 'Story 6 e2e runs on Chromium (design: standards-only APIs)');

test.describe('story 6: tick off, edit and remove tasks', () => {
  test('TC-E01 complete then Undo then reload: the task is back at its original index and still open', async ({ page }) => {
    const { id } = await newInbox(page);
    await seedTasks(page, id, NAMES.slice(0, 3));
    await page.reload();
    await expectRowNames(page, NAMES.slice(0, 3));
    await rowNamed(page, NAMES[1]!).getByRole('checkbox', { name: `Complete ${NAMES[1]}` }).click();
    await expectRowNames(page, [NAMES[0]!, NAMES[2]!]);
    const toast = toastWith(page, 'Task completed');
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expectRowNames(page, NAMES.slice(0, 3));
    await expect(toastWith(page, 'Task restored')).toBeVisible();
    await page.reload();
    await expectRowNames(page, NAMES.slice(0, 3));
  });

  test('TC-E02 complete, let Undo expire, reload, show completed (struck through, dated), reopen: original index; the toggle survives a reload', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const { id } = await newInbox(page);
    await seedTasks(page, id, NAMES.slice(0, 3));
    await page.reload();
    await rowNamed(page, NAMES[1]!).getByRole('checkbox').click();
    await expect(toastWith(page, 'Task completed')).toBeVisible();
    await expect(toastWith(page, 'Task completed')).toBeHidden({ timeout: PAST_WINDOW_MS });
    await page.reload();
    await expectRowNames(page, [NAMES[0]!, NAMES[2]!]);
    await page.getByRole('switch', { name: 'Show completed' }).click();
    const completed = page.getByRole('listbox', { name: 'Completed tasks' }).getByRole('option');
    await expect(completed).toHaveCount(1);
    await expect(completed.first().locator('p').first()).toHaveCSS('text-decoration-line', 'line-through');
    await expect(completed.first().locator('time')).toHaveText(/\S/);
    expect(await seriousAxeViolations(page)).toEqual([]);
    await completed.first().getByRole('checkbox', { name: `Reopen ${NAMES[1]}` }).click();
    await expectRowNames(page, NAMES.slice(0, 3));
    await expect(page.getByText('No completed tasks')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('switch', { name: 'Show completed' })).toHaveAttribute('aria-checked', 'true');
    await expectRowNames(page, NAMES.slice(0, 3));
  });

  test('TC-E03 edit name and description in the detail sheet, reload: both persisted', async ({ page }) => {
    const { id } = await newInbox(page);
    await seedTasks(page, id, [NAMES[3]!]);
    await page.reload();
    await rowNamed(page, NAMES[3]!).getByText(NAMES[3]!).click();
    const sheet = page.getByRole('dialog', { name: 'Task details' });
    await expect(sheet.getByRole('textbox', { name: 'Name' })).toBeFocused();
    expect(await seriousAxeViolations(page)).toEqual([]);
    const saved = page.waitForResponse((res) => res.request().method() === 'PATCH' && res.ok());
    await sheet.getByRole('textbox', { name: 'Name' }).fill('Book dentist for Tuesday 9am');
    await page.keyboard.press('Enter');
    await saved;
    const savedDescription = page.waitForResponse((res) => res.request().method() === 'PATCH' && res.ok());
    await sheet.getByRole('textbox', { name: 'Description' }).fill('Ask about:\n- the new insurance card');
    await sheet.getByRole('textbox', { name: 'Name' }).focus();
    await savedDescription;
    await page.reload();
    await expectRowNames(page, ['Book dentist for Tuesday 9am']);
    await expect(taskRows(page).first()).toContainText('Ask about:');
    await rowNamed(page, 'Book dentist for Tuesday 9am').getByText('Book dentist for Tuesday 9am').click();
    await expect(page.getByRole('textbox', { name: 'Description' })).toHaveValue('Ask about:\n- the new insurance card');
  });

  test('TC-E04 delete with no confirmation, Undo restores; delete and let it expire: gone after reload, retained in D1', async ({ page }) => {
    test.setTimeout(60_000);
    const { id } = await newInbox(page);
    const ids = await seedTasks(page, id, NAMES.slice(0, 3));
    await page.reload();
    let dialogs = 0;
    page.on('dialog', () => dialogs++);
    await rowNamed(page, NAMES[0]!).hover();
    await rowNamed(page, NAMES[0]!).getByRole('button', { name: `More actions for ${NAMES[0]}` }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expectRowNames(page, NAMES.slice(1, 3));
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await toastWith(page, 'Task deleted').getByRole('button', { name: 'Undo' }).click();
    await expectRowNames(page, NAMES.slice(0, 3));

    await rowNamed(page, NAMES[2]!).hover();
    await rowNamed(page, NAMES[2]!).getByRole('button', { name: `More actions for ${NAMES[2]}` }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expectRowNames(page, NAMES.slice(0, 2));
    await expect(toastWith(page, 'Task deleted')).toBeHidden({ timeout: PAST_WINDOW_MS });
    await page.reload();
    await expectRowNames(page, NAMES.slice(0, 2));
    const raw = await rawTask(page, ids[2]!);
    expect(raw).toMatchObject({ id: ids[2], name: NAMES[2], deleted: 1 });
    expect(raw.deleted_at).toEqual(expect.any(String));
    expect(dialogs).toBe(0);
  });

  test('TC-E05 two browsers: A completes, B sees it within LIVE_UPDATE_TARGET_MS; B edits a task A deletes, B sees the deleted notice', async ({
    page,
    browser,
  }) => {
    const { id, link } = await newInbox(page);
    await seedTasks(page, id, NAMES.slice(0, 3));
    await page.reload();
    await expectRowNames(page, NAMES.slice(0, 3));
    const b = await join(browser, link);
    await expectRowNames(b.page, NAMES.slice(0, 3));

    await rowNamed(page, NAMES[0]!).getByRole('checkbox').click();
    await expectRowNames(b.page, NAMES.slice(1, 3));
    await expect(b.page.getByRole('listbox', { name: 'Tasks' }).getByRole('option')).toHaveCount(2, { timeout: LIVE_UPDATE_TARGET_MS });

    await rowNamed(b.page, NAMES[1]!).getByText(NAMES[1]!).click();
    const sheet = b.page.getByRole('dialog', { name: 'Task details' });
    await sheet.getByRole('textbox', { name: 'Name' }).fill('Email Sam about the invoice');
    await rowNamed(page, NAMES[1]!).hover();
    await rowNamed(page, NAMES[1]!).getByRole('button', { name: `More actions for ${NAMES[1]}` }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(b.page.getByText('This task was deleted')).toBeVisible({ timeout: LIVE_UPDATE_TARGET_MS });
    await expect(sheet).toBeHidden();
    await expectRowNames(b.page, [NAMES[2]!]);
    await b.context.close();
  });

  test('TC-E06 keyboard only: Tab to the list, Down, E, edit, Enter, Escape twice, Delete, mod+z', async ({ page }) => {
    const { id } = await newInbox(page);
    await seedTasks(page, id, NAMES.slice(0, 3));
    await page.reload();
    await expectRowNames(page, NAMES.slice(0, 3));
    await page.getByRole('switch', { name: 'Show completed' }).focus();
    await page.keyboard.press('Tab');
    await expect(rowNamed(page, NAMES[0]!)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(rowNamed(page, NAMES[1]!)).toBeFocused();
    await page.keyboard.press('e');
    const name = page.getByRole('dialog', { name: 'Task details' }).getByRole('textbox', { name: 'Name' });
    await expect(name).toBeFocused();
    // Native select-all uses the host's own modifier.
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Email Sam re: invoice #4412');
    const saved = page.waitForResponse((res) => res.request().method() === 'PATCH' && res.ok());
    await page.keyboard.press('Enter');
    await saved;
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(rowNamed(page, 'Email Sam re: invoice #4412')).toBeFocused();
    await page.keyboard.press('Delete');
    await expectRowNames(page, [NAMES[0]!, NAMES[2]!]);
    await expect(rowNamed(page, NAMES[2]!)).toBeFocused();
    await expect(toastWith(page, 'Task deleted')).toBeVisible();
    await page.keyboard.press(`${await modKey(page)}+z`);
    await expectRowNames(page, [NAMES[0]!, 'Email Sam re: invoice #4412', NAMES[2]!]);
    await page.reload();
    await expectRowNames(page, [NAMES[0]!, 'Email Sam re: invoice #4412', NAMES[2]!]);
  });

  test('TC-E08 hover the undo toast for 15 s, then move away: it survives, then goes about UNDO_WINDOW_MS later', async ({ page }) => {
    test.setTimeout(60_000);
    const { id } = await newInbox(page);
    await seedTasks(page, id, NAMES.slice(0, 2));
    await page.reload();
    await rowNamed(page, NAMES[0]!).getByRole('checkbox').click();
    const toast = toastWith(page, 'Task completed');
    await expect(toast).toBeVisible();
    await toast.hover();
    await page.waitForTimeout(15_000);
    await expect(toast).toBeVisible();
    await page.mouse.move(5, 5);
    const left = Date.now();
    await page.waitForTimeout(UNDO_WINDOW_MS - 2_000);
    await expect(toast).toBeVisible();
    await expect(toast).toBeHidden({ timeout: 6_000 });
    expect(Date.now() - left).toBeGreaterThanOrEqual(UNDO_WINDOW_MS - 2_000);
  });
});
