import { expect, test } from '@playwright/test';
import { rowNames, taskRows } from './inbox-helpers';
import {
  checkboxFor,
  LIVE_UPDATE_TARGET_MS,
  rawTask,
  row,
  secondPerson,
  sheet,
  showCompleted,
  UNDO_WINDOW_MS,
  undoChord,
  undoToast,
  workspaceWith,
} from './tasks-helpers';

/*
 * Story 6: tick off, edit and remove tasks, with Undo. Local wrangler dev with local D1 and DO,
 * Chromium and WebKit (TC-E05 is Chromium only, like story 4's live specs).
 */

const THREE = ['Buy milk', 'Email Sam re: invoice #4411', 'Call Mum 📞'];

test('TC-E01 complete, Undo, reload: the task is back at its index and still open', async ({ page }) => {
  await workspaceWith(page, THREE);
  await checkboxFor(page, THREE[1]!).click();
  await expect(checkboxFor(page, THREE[1]!)).toHaveAttribute('aria-checked', 'true');
  await expect(undoToast(page, 'Task completed')).toBeVisible();
  await expect(taskRows(page)).toHaveCount(2);
  await undoToast(page, 'Task completed').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Task restored')).toBeVisible();
  await expect.poll(() => rowNames(page)).toEqual(THREE);
  await page.reload();
  await expect.poll(() => rowNames(page)).toEqual(THREE);
  await expect(checkboxFor(page, THREE[1]!)).toHaveAttribute('aria-checked', 'false');
});

test('TC-E02 complete, let Undo expire, show completed (struck through, dated), reopen: original index; the toggle is remembered', async ({ page }) => {
  test.setTimeout(60_000);
  await workspaceWith(page, THREE);
  await checkboxFor(page, THREE[1]!).click();
  await expect(undoToast(page, 'Task completed')).toBeVisible();
  await page.waitForTimeout(UNDO_WINDOW_MS + 500);
  await expect(undoToast(page, 'Task completed')).toHaveCount(0);
  await page.reload();
  await expect.poll(() => rowNames(page)).toEqual([THREE[0], THREE[2]]);

  await showCompleted(page).click();
  await expect(row(page, THREE[1]!)).toBeVisible();
  await expect(row(page, THREE[1]!).locator('span.break-words')).toHaveCSS('text-decoration-line', 'line-through');
  await expect(row(page, THREE[1]!)).toContainText(/Completed \S/);
  await checkboxFor(page, THREE[1]!).click();
  await expect.poll(() => rowNames(page)).toEqual(THREE);
  await expect(checkboxFor(page, THREE[1]!)).toHaveAttribute('aria-checked', 'false');

  await page.reload();
  await expect(showCompleted(page)).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => rowNames(page)).toEqual(THREE);
});

test('TC-E03 edit the name and description in the detail sheet; both persist after reload', async ({ page }) => {
  await workspaceWith(page, THREE);
  await page.getByRole('button', { name: 'Buy milk', exact: true }).click();
  await expect(sheet(page)).toBeVisible();
  const name = sheet(page).getByRole('textbox', { name: 'Name' });
  await expect(name).toBeFocused();
  await name.fill('Buy oat milk');
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.status() === 200);
  await name.press('Enter');
  await saved;
  const description = sheet(page).getByRole('textbox', { name: 'Description' });
  await description.fill('1 litre, barista edition\nand bread');
  const savedDescription = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.status() === 200);
  await sheet(page).getByRole('button', { name: 'Close' }).click();
  await savedDescription;
  await expect(sheet(page)).toHaveCount(0);

  await page.reload();
  await expect(row(page, 'Buy oat milk')).toContainText('1 litre, barista edition');
  await page.getByRole('button', { name: 'Buy oat milk', exact: true }).click();
  await expect(sheet(page).getByRole('textbox', { name: 'Description' })).toHaveValue('1 litre, barista edition\nand bread');
});

test('TC-E04 delete with no confirmation, Undo; delete and let it expire: gone after reload, retained in D1', async ({ page }) => {
  test.setTimeout(60_000);
  const { tasks } = await workspaceWith(page, THREE);
  let dialogs = 0;
  page.on('dialog', () => dialogs++);

  await row(page, THREE[0]!).hover();
  await page.getByRole('button', { name: `Actions for ${THREE[0]}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => rowNames(page)).toEqual(THREE.slice(1));
  await undoToast(page, 'Task deleted').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => rowNames(page)).toEqual(THREE);

  await row(page, THREE[2]!).hover();
  await page.getByRole('button', { name: `Actions for ${THREE[2]}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(undoToast(page, 'Task deleted')).toBeVisible();
  await page.waitForTimeout(UNDO_WINDOW_MS + 500);
  await expect(undoToast(page, 'Task deleted')).toHaveCount(0);
  await page.reload();
  await expect.poll(() => rowNames(page)).toEqual(THREE.slice(0, 2));
  const raw = await rawTask(page.request, tasks[2]!.id);
  expect(raw).toMatchObject({ deleted: 1, name: THREE[2] });
  expect(raw.deleted_at).toBeTruthy();
  expect(dialogs).toBe(0);
});

test('TC-E05 two people: B sees A\'s completion live; B editing a task A deletes sees the deleted notice', async ({ page, browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Live e2e runs in Chromium only (as story 4)');
  const { ws } = await workspaceWith(page, THREE);
  const b = await secondPerson(browser, ws.secret);
  await expect.poll(() => rowNames(b.page)).toEqual(THREE);

  await checkboxFor(page, THREE[0]!).click();
  await expect.poll(() => rowNames(b.page), { timeout: LIVE_UPDATE_TARGET_MS }).toEqual(THREE.slice(1));

  await b.page.getByRole('button', { name: THREE[2]!, exact: true }).click();
  await expect(sheet(b.page)).toBeVisible();
  await sheet(b.page).getByRole('textbox', { name: 'Name' }).fill('Call Mum on Sunday');
  await row(page, THREE[2]!).hover();
  await page.getByRole('button', { name: `Actions for ${THREE[2]}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(b.page.getByText('This task was deleted')).toBeVisible({ timeout: LIVE_UPDATE_TARGET_MS });
  await expect(sheet(b.page)).toHaveCount(0);
  await b.context.close();
});

test('TC-E06 keyboard only: edit, Escape twice back to the row, Delete moves to the next row, Cmd/Ctrl+Z restores', async ({ page, browserName }) => {
  // Safari's Tab skips buttons unless Option is held (as in story 5's TC-114).
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await workspaceWith(page, THREE);
  await page.locator('#view-title').focus();
  // Heading -> Show completed -> the list (one tab stop).
  await page.keyboard.press(tab);
  await expect(showCompleted(page)).toBeFocused();
  await page.keyboard.press(tab);
  await expect(row(page, THREE[0]!)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(row(page, THREE[1]!)).toBeFocused();
  await page.keyboard.press('e');
  const name = sheet(page).getByRole('textbox', { name: 'Name' });
  await expect(name).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Email Sam re: invoice #4412');
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.status() === 200);
  await page.keyboard.press('Enter');
  await saved;
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await expect(row(page, 'Email Sam re: invoice #4412')).toBeFocused();

  await page.keyboard.press('Delete');
  await expect(undoToast(page, 'Task deleted')).toBeVisible();
  await expect(row(page, THREE[2]!)).toBeFocused();
  await page.keyboard.press(await undoChord(page));
  await expect(page.getByText('Task restored')).toBeVisible();
  await expect.poll(() => rowNames(page)).toEqual([THREE[0], 'Email Sam re: invoice #4412', THREE[2]]);
});

test('TC-E08 the undo toast survives 15 s of hovering and goes about 10 s after the pointer leaves', async ({ page }) => {
  test.setTimeout(60_000);
  await workspaceWith(page, THREE);
  await checkboxFor(page, THREE[0]!).click();
  const toast = undoToast(page, 'Task completed');
  await expect(toast).toBeVisible();
  await toast.hover();
  await page.waitForTimeout(15_000);
  await expect(toast).toBeVisible();
  await page.mouse.move(5, 5);
  const left = Date.now();
  await page.waitForTimeout(UNDO_WINDOW_MS - 2_000);
  await expect(toast).toBeVisible();
  await expect(toast).toHaveCount(0, { timeout: 4_000 });
  expect(Date.now() - left).toBeGreaterThan(UNDO_WINDOW_MS - 2_000);
});
