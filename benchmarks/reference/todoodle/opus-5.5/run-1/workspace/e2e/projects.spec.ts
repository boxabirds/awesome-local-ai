import { expect, test } from '@playwright/test';
import { LIVE_UPDATE_TARGET_MS } from '../packages/shared/src/limits.ts';
import { join, waitForLive } from './support/live.ts';
import {
  completeTask,
  deleteTaskApi,
  lists,
  projectEntry,
  projectMenuButton,
  projectPath,
  seedProject,
  seedTasksIn,
  sidebarProjects,
} from './support/projects.ts';
import { expectRowNames, newInbox, rawTask, rowNamed, sidebarInbox, taskRows, toastWith } from './support/tasks.ts';

// Story 7 workflows W1-W8 and W10 (design E2E table) against local wrangler dev with real D1 and Durable
// Objects. Chromium only, as the design says; the phone workflow W9 is projects.mobile.spec.ts.

test.skip(({ browserName }) => browserName !== 'chromium', 'Story 7 e2e runs on Chromium (design: Chromium desktop and touch emulation only)');

test.describe('story 7: projects', () => {
  test('W1 / TC-65 create Work with +, add 2 tasks with Q, move one to the Inbox through the task menu', async ({ page }) => {
    await newInbox(page);
    await lists(page).getByRole('button', { name: 'Add project' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add project' });
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Work');
    await dialog.getByRole('textbox', { name: 'Name' }).press('Enter');
    await expect(page.getByRole('heading', { name: 'Work', level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/w\/[0-9A-F]{32}\/project\/[0-9a-f]{32}#/);
    await expect(page.getByText('No tasks yet. Press Q to add one.')).toBeVisible();
    expect(await sidebarProjects(page)).toEqual(['Work']);

    await page.keyboard.press('q');
    const name = page.getByRole('textbox', { name: 'Task name' });
    await expect(page.getByRole('form', { name: 'Add task' }).getByText('→ Work')).toBeVisible();
    await name.fill('Draft Q3 plan');
    await name.press('Enter');
    await name.fill('Book room');
    await name.press('Enter');
    await name.press('Escape');
    await expectRowNames(page, ['Draft Q3 plan', 'Book room']);
    await expect(projectEntry(page, 'Work')).toHaveAccessibleName('Work, 2 open tasks');
    await expect(sidebarInbox(page)).toHaveAccessibleName('Inbox');

    await rowNamed(page, 'Book room').hover();
    await rowNamed(page, 'Book room').getByRole('button', { name: 'More actions for Book room' }).click();
    await page.getByRole('menuitem', { name: /Move to…/ }).click();
    const picker = page.getByRole('combobox', { name: 'Move to…' });
    await expect(picker).toBeFocused();
    await expect(page.getByRole('listbox', { name: 'Lists' }).getByRole('option')).toHaveText(['Inbox', 'Work']);
    await page.getByRole('listbox', { name: 'Lists' }).getByRole('option', { name: 'Inbox' }).click();
    await expectRowNames(page, ['Draft Q3 plan']);
    await expect(projectEntry(page, 'Work')).toHaveAccessibleName('Work, 1 open task');
    await expect(sidebarInbox(page)).toHaveAccessibleName('Inbox, 1 open task');
    await sidebarInbox(page).click();
    await expectRowNames(page, ['Book room']);
  });

  test('W2 / TC-66 delete a project with 2 open + 1 completed: the dialog says 3 tasks; Undo brings all back, completion kept', async ({ page }) => {
    const { id } = await newInbox(page);
    const work = await seedProject(page, id, 'Work');
    const [, , done] = await seedTasksIn(page, id, work, ['Draft Q3 plan', 'Book room', 'File expenses']);
    await completeTask(page, id, done!);
    await page.goto(projectPath(id, work));
    await expectRowNames(page, ['Draft Q3 plan', 'Book room']);

    await projectEntry(page, 'Work').hover();
    await projectMenuButton(page, 'Work').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm.getByRole('heading', { name: 'Delete "Work" and its 3 tasks?' })).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
    expect(await sidebarProjects(page)).toEqual([]);
    expect(await rawTask(page, done!)).toMatchObject({ deleted: 1 });

    await toastWith(page, 'Project deleted').getByRole('button', { name: 'Undo' }).click();
    await expect(toastWith(page, 'Project restored')).toBeVisible();
    await expect(projectEntry(page, 'Work')).toHaveAccessibleName('Work, 2 open tasks');
    await projectEntry(page, 'Work').click();
    await expectRowNames(page, ['Draft Q3 plan', 'Book room']);
    await page.getByRole('switch', { name: 'Show completed' }).click();
    await expect(page.getByRole('listbox', { name: 'Completed tasks' }).getByRole('option')).toHaveCount(1);
    expect(await rawTask(page, done!)).toMatchObject({ deleted: 0, completed_at: expect.any(String) });
  });

  test('W3 / TC-67 a task deleted on its own stays deleted when the project deletion is undone', async ({ page }) => {
    const { id } = await newInbox(page);
    const work = await seedProject(page, id, 'Work');
    const [alone] = await seedTasksIn(page, id, work, ['Old ticket', 'Draft Q3 plan']);
    await deleteTaskApi(page, id, alone!);
    await page.goto(projectPath(id, work));
    await expectRowNames(page, ['Draft Q3 plan']);
    await projectEntry(page, 'Work').hover();
    await projectMenuButton(page, 'Work').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(page.getByRole('alertdialog').getByRole('heading', { name: 'Delete "Work" and its 1 task?' })).toBeVisible();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await toastWith(page, 'Project deleted').getByRole('button', { name: 'Undo' }).click();
    await expect(projectEntry(page, 'Work')).toBeVisible();
    await projectEntry(page, 'Work').click();
    await expectRowNames(page, ['Draft Q3 plan']);
    expect(await rawTask(page, alone!)).toMatchObject({ deleted: 1, delete_batch_id: null });
  });

  test('W4 / TC-68 rename Work to Job; it persists across a reload', async ({ page }) => {
    const { id } = await newInbox(page);
    await seedProject(page, id, 'Work');
    await page.reload();
    await projectEntry(page, 'Work').hover();
    await projectMenuButton(page, 'Work').click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const field = lists(page).getByRole('textbox', { name: 'Project name' });
    await expect(field).toBeFocused();
    const saved = page.waitForResponse((res) => res.request().method() === 'PATCH' && res.ok());
    await field.fill('Job');
    await field.press('Enter');
    await saved;
    await expect(projectEntry(page, 'Job')).toBeFocused();
    await page.reload();
    expect(await sidebarProjects(page)).toEqual([]);
    await expect(projectEntry(page, 'Job')).toBeVisible();
    expect(await sidebarProjects(page)).toEqual(['Job']);
  });

  test('W5 / TC-69 two collaborators: B deletes the project A is viewing (A goes to the Inbox with a notice); B creates Q (A sees it)', async ({
    page,
    browser,
  }) => {
    const { id, link } = await newInbox(page);
    const work = await seedProject(page, id, 'Work');
    await seedTasksIn(page, id, work, ['Draft Q3 plan']);
    const liveA = waitForLive(page);
    await page.goto(projectPath(id, work));
    await expect(page.getByRole('heading', { name: 'Work', level: 1 })).toBeVisible();
    await liveA;

    const b = await join(browser, link);
    try {
      await projectEntry(b.page, 'Work').hover();
      await projectMenuButton(b.page, 'Work').click();
      await b.page.getByRole('menuitem', { name: 'Delete' }).click();
      await b.page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();

      await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible({ timeout: LIVE_UPDATE_TARGET_MS });
      await expect(toastWith(page, 'This project was deleted')).toBeVisible();
      await expect(projectEntry(page, 'Work')).toHaveCount(0);

      await lists(b.page).getByRole('button', { name: 'Add project' }).click();
      await b.page.getByRole('dialog', { name: 'Add project' }).getByRole('textbox', { name: 'Name' }).fill('Q4 launch');
      await b.page.getByRole('dialog', { name: 'Add project' }).getByRole('button', { name: 'Add' }).click();
      await expect(projectEntry(page, 'Q4 launch')).toBeVisible({ timeout: LIVE_UPDATE_TARGET_MS });
    } finally {
      await b.context.close();
    }
  });

  test('W6 / TC-70 reloading /w/:id/project/:pid in the browser that remembers the workspace shows the project with its tasks', async ({ page }) => {
    const { id } = await newInbox(page);
    const work = await seedProject(page, id, 'Café ☕ plans');
    await seedTasksIn(page, id, work, ['Pick a date', 'Book the table']);
    await page.goto(projectPath(id, work));
    await expect(page.getByRole('heading', { name: 'Café ☕ plans', level: 1 })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Café ☕ plans', level: 1 })).toBeVisible();
    await expectRowNames(page, ['Pick a date', 'Book the table']);
    await expect(page).toHaveTitle(/^Café ☕ plans · /);
    await expect(projectEntry(page, 'Café ☕ plans')).toHaveAttribute('aria-current', 'page');
  });

  test('W7 / TC-71 keyboard only: create with + and Enter, rename and delete from the menu; focus returns to the trigger', async ({ page }) => {
    await newInbox(page);
    await sidebarInbox(page).focus();
    await page.keyboard.press('Tab');
    await expect(lists(page).getByRole('button', { name: 'Add project' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Add project' }).getByRole('textbox', { name: 'Name' })).toBeFocused();
    await page.keyboard.type('Work');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Work', level: 1 })).toBeVisible();

    await projectEntry(page, 'Work').focus();
    await page.keyboard.press('Tab');
    await expect(projectMenuButton(page, 'Work')).toBeFocused();
    await expect(projectMenuButton(page, 'Work')).toHaveCSS('opacity', '1');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(lists(page).getByRole('textbox', { name: 'Project name' })).toBeFocused();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Job');
    await page.keyboard.press('Enter');
    await expect(projectEntry(page, 'Job')).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(projectMenuButton(page, 'Job')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(projectMenuButton(page, 'Job')).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('alertdialog').getByRole('button', { name: 'Delete' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
    await expect(lists(page).getByRole('heading', { name: 'Projects' })).toBeFocused();
    expect(await sidebarProjects(page)).toEqual([]);
  });

  test('W8 / TC-72 a fresh browser without the cookie opening a project path gets Workspace not found and no project data', async ({ page, browser }) => {
    const { id } = await newInbox(page);
    const work = await seedProject(page, id, 'Secret plans');
    await seedTasksIn(page, id, work, ['Buy the ring']);
    const stranger = await browser.newContext();
    try {
      const other = await stranger.newPage();
      await other.goto(projectPath(id, work));
      await expect(other.getByRole('heading', { name: 'Workspace not found' })).toBeVisible();
      const html = await other.content();
      expect(html).not.toContain('Secret plans');
      expect(html).not.toContain('Buy the ring');
    } finally {
      await stranger.close();
    }
  });

  test('W10 / TC-87 keyboard move: ↓ to the second task, M, type jo, Enter; then M and Escape keeps focus on the row', async ({ page }) => {
    const { id } = await newInbox(page);
    await seedProject(page, id, 'Job');
    await seedProject(page, id, 'Home');
    await seedTasksIn(page, id, null, ['Buy milk', 'Email Sam re: invoice #4411', 'Call Mum 📞']);
    await page.reload();
    await expectRowNames(page, ['Buy milk', 'Email Sam re: invoice #4411', 'Call Mum 📞']);
    await taskRows(page).first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(rowNamed(page, 'Email Sam re: invoice #4411')).toBeFocused();
    await page.keyboard.press('m');
    await expect(page.getByRole('combobox', { name: 'Move to…' })).toBeFocused();
    await page.keyboard.type('jo');
    await expect(page.getByRole('listbox', { name: 'Lists' }).getByRole('option')).toHaveText(['Job']);
    await page.keyboard.press('Enter');
    await expectRowNames(page, ['Buy milk', 'Call Mum 📞']);
    await expect(rowNamed(page, 'Call Mum 📞')).toBeFocused();
    await expect(projectEntry(page, 'Job')).toHaveAccessibleName('Job, 1 open task');

    await page.keyboard.press('m');
    await expect(page.getByRole('combobox', { name: 'Move to…' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox', { name: 'Move to…' })).toHaveCount(0);
    await expect(rowNamed(page, 'Call Mum 📞')).toBeFocused();
  });
});
