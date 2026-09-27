import { type Page, expect, test } from '@playwright/test';
import { LIVE_UPDATE_TARGET_MS, PROJECT_COLORS } from '../packages/shared/src/limits.ts';
import { waitForLive } from './support/live.ts';
import { projectPath, seedProject } from './support/projects.ts';
import { modKey, newInbox, seriousAxeViolations, toastWith } from './support/tasks.ts';
import { overdueList, patchDueDate, seedDated, sidebarToday, storedDueDate, todayList, todayPath } from './support/today.ts';

// Story 8 workflows (design E2E table) against local wrangler dev with real D1 and Durable Objects. Every page runs
// in Europe/London (en-GB) with Playwright's clock at Fri 2026-09-25 09:00 local unless a test says otherwise.
// Chromium only, as the design says.

test.skip(({ browserName }) => browserName !== 'chromium', 'Story 8 e2e runs on Chromium (design: other browsers are not covered)');

test.use({ timezoneId: 'Europe/London', locale: 'en-GB' });

/** Fri 2026-09-25 09:00 in London (BST, UTC+1). */
const FRIDAY_9AM = new Date('2026-09-25T08:00:00Z');

async function openToday(page: Page) {
  await sidebarToday(page).click();
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
}

function rowIn(list: ReturnType<typeof todayList>, name: string) {
  return list.getByRole('option', { name, exact: true });
}

test.describe('story 8: due dates and Today', () => {
  test('TC-86 set a date in the task detail, then Today lists it with its project; the sidebar badge says 1', async ({ page }) => {
    await page.clock.install({ time: FRIDAY_9AM });
    const { id } = await newInbox(page);
    const work = await seedProject(page, id, 'Work', 'red');
    await seedDated(page, id, 'Send the report', null, work);
    await page.goto(projectPath(id, work));
    await expect(page.getByRole('heading', { name: 'Work', level: 1 })).toBeVisible();
    await page.getByRole('option', { name: 'Send the report' }).getByText('Send the report').click();
    const sheet = page.getByRole('dialog', { name: 'Task details' });
    await sheet.getByRole('button', { name: 'Set due date' }).click();
    await page.getByRole('dialog', { name: 'Due date' }).getByRole('button', { name: 'Today, Friday 25 September' }).click();
    await expect(sheet.getByRole('button', { name: 'Due date: Today' })).toBeVisible();
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('option', { name: 'Send the report' }).getByText('Today')).toBeVisible();

    await openToday(page);
    const row = rowIn(todayList(page), 'Send the report');
    await expect(row.locator('[data-project-tag]')).toHaveText('Work');
    await expect(sidebarToday(page)).toHaveAccessibleName('Today, 1 open task');
  });

  test('TC-87 quick add from Today: the task shows in Today, and in the Inbox with a Today chip', async ({ page }) => {
    await page.clock.install({ time: FRIDAY_9AM });
    await newInbox(page);
    await openToday(page);
    await expect(page.getByText('All clear for today')).toBeVisible();
    await page.keyboard.press('q');
    const name = page.getByRole('textbox', { name: 'Task name' });
    await name.fill('Pay rent');
    await name.press('Enter');
    await expect(rowIn(todayList(page), 'Pay rent')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('navigation', { name: 'Lists' }).getByRole('button', { name: /^Inbox/ }).click();
    await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Pay rent' }).getByText('Today')).toBeVisible();
  });

  test('TC-88 reschedule 3 overdue: the confirmation says 3; Move puts them in Today; Undo restores the dates (checked in the project view)', async ({ page }) => {
    await page.clock.install({ time: FRIDAY_9AM });
    const { id } = await newInbox(page);
    const work = await seedProject(page, id, 'Work', PROJECT_COLORS[3].key);
    const ids = [
      await seedDated(page, id, 'Renew passport', '2026-09-20', work),
      await seedDated(page, id, 'Pay council tax', '2026-09-22', work),
      await seedDated(page, id, 'Book dentist', '2026-09-24', work),
    ];
    await openToday(page);
    await expect(overdueList(page).getByRole('option')).toHaveCount(3);
    await page.getByRole('button', { name: 'Reschedule' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toHaveText(/Move 3 overdue tasks to today\?/);
    await dialog.getByRole('button', { name: 'Move' }).click();
    await expect(todayList(page).getByRole('option')).toHaveCount(3);
    await expect(overdueList(page)).toHaveCount(0);
    for (const taskId of ids) expect(await storedDueDate(page, taskId)).toBe('2026-09-25');

    await toastWith(page, '3 tasks rescheduled to today').getByRole('button', { name: 'Undo' }).click();
    await expect(overdueList(page).getByRole('option')).toHaveCount(3);
    await expect(toastWith(page, 'Due dates restored')).toBeVisible();
    expect([await storedDueDate(page, ids[0]!), await storedDueDate(page, ids[1]!), await storedDueDate(page, ids[2]!)]).toEqual([
      '2026-09-20',
      '2026-09-22',
      '2026-09-24',
    ]);
    await page.goto(projectPath(id, work));
    await expect(page.getByRole('option', { name: 'Renew passport' }).getByText('5 days overdue')).toBeVisible();
    await expect(page.getByRole('option', { name: 'Pay council tax' }).getByText('3 days overdue')).toBeVisible();
    await expect(page.getByRole('option', { name: 'Book dentist' }).getByText('Yesterday')).toBeVisible();
  });

  test('TC-89 per-viewer dates: at 11:00Z London sees the task in Today, Kiritimati (UTC+14) in Overdue as "Yesterday" with the icon', async ({ page, browser }) => {
    const instant = new Date('2026-09-25T11:00:00Z');
    await page.clock.install({ time: instant });
    const { id, link } = await newInbox(page);
    await seedDated(page, id, 'Renew passport', '2026-09-25');
    await openToday(page);
    await expect(rowIn(todayList(page), 'Renew passport').getByText('Today')).toBeVisible();

    const kiritimati = await browser.newContext({ timezoneId: 'Pacific/Kiritimati', locale: 'en-GB' });
    try {
      const other = await kiritimati.newPage();
      await other.clock.install({ time: instant });
      await other.goto(link);
      await expect(other.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
      await openToday(other);
      const row = rowIn(overdueList(other), 'Renew passport');
      await expect(row.getByText('Yesterday')).toBeVisible();
      await expect(row.getByRole('img', { name: 'Overdue: due Friday 25 September' })).toBeVisible();
      await expect(row.locator('[data-chip-warning]')).toBeVisible();
    } finally {
      await kiritimati.close();
    }
  });

  test('TC-90 midnight rolls over without a reload: tomorrow\'s task joins Today; the badge and the tab title follow', async ({ page }) => {
    // 23:59:30 on Fri 25 Sep in London.
    await page.clock.install({ time: new Date('2026-09-25T22:59:30Z') });
    const { id } = await newInbox(page);
    await seedDated(page, id, 'Renew passport', '2026-09-26');
    await openToday(page);
    await expect(page.getByText('All clear for today')).toBeVisible();
    await expect(page).toHaveTitle('Today · My Todoodle');
    await expect(sidebarToday(page)).toHaveAccessibleName('Today');
    await page.clock.runFor(60_000);
    await expect(rowIn(todayList(page), 'Renew passport')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Today · Sat 26 Sep', level: 2 })).toBeVisible();
    await expect(sidebarToday(page)).toHaveAccessibleName('Today, 1 open task');
    await expect(page).toHaveTitle('(1) Today · My Todoodle');
  });

  test('TC-91 a collaborator clears a date: it leaves this Today within LIVE_UPDATE_TARGET_MS', async ({ page, browser }) => {
    await page.clock.install({ time: FRIDAY_9AM });
    const { id, link } = await newInbox(page);
    const taskId = await seedDated(page, id, 'Renew passport', '2026-09-25');
    await seedDated(page, id, 'Pay council tax', '2026-09-25');
    const live = waitForLive(page);
    await page.goto(todayPath(id));
    await live;
    await expect(todayList(page).getByRole('option')).toHaveCount(2);

    const other = await browser.newContext({ timezoneId: 'Europe/London', locale: 'en-GB' });
    try {
      const b = await other.newPage();
      await b.goto(link);
      await expect(b.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
      await patchDueDate(b, id, taskId, null);
      await expect(rowIn(todayList(page), 'Renew passport')).toHaveCount(0, { timeout: LIVE_UPDATE_TARGET_MS });
      await expect(sidebarToday(page)).toHaveAccessibleName('Today, 1 open task', { timeout: LIVE_UPDATE_TARGET_MS });
    } finally {
      await other.close();
    }
  });

  test('TC-92 No date clears the chip and the task leaves Today', async ({ page }) => {
    await page.clock.install({ time: FRIDAY_9AM });
    const { id } = await newInbox(page);
    const taskId = await seedDated(page, id, 'Renew passport', '2026-09-25');
    await openToday(page);
    await rowIn(todayList(page), 'Renew passport').getByRole('img', { name: 'Due Today' }).click();
    await page.getByRole('dialog', { name: 'Due date' }).getByRole('button', { name: 'No date' }).click();
    await expect(page.getByText('All clear for today')).toBeVisible();
    await expect.poll(() => storedDueDate(page, taskId)).toBeNull();
    await page.getByRole('navigation', { name: 'Lists' }).getByRole('button', { name: /^Inbox/ }).click();
    const row = page.getByRole('option', { name: 'Renew passport' });
    await expect(row).toBeVisible();
    await expect(row.locator('[data-date-chip]')).toHaveCount(0);
  });

  test('TC-123 Today has its own address: reload stays on Today, back returns to it', async ({ page }) => {
    await page.clock.install({ time: FRIDAY_9AM });
    const { id } = await newInbox(page);
    await seedDated(page, id, 'Renew passport', '2026-09-25');
    await openToday(page);
    await expect(page).toHaveURL(new RegExp(`/w/${id}/today(#.*)?$`));
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
    await expect(rowIn(todayList(page), 'Renew passport')).toBeVisible();
    await page.getByRole('navigation', { name: 'Lists' }).getByRole('button', { name: /^Inbox/ }).click();
    await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/w/${id}/today(#.*)?$`));
    await page.goForward();
    await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
  });

  test('TC-125 axe: no serious or critical violations on Today with overdue rows, and with the date picker open', async ({ page }) => {
    await page.clock.install({ time: FRIDAY_9AM });
    const { id } = await newInbox(page);
    const work = await seedProject(page, id, 'Work', 'red');
    await seedDated(page, id, 'Renew passport', '2026-09-20');
    await seedDated(page, id, 'Pay council tax', '2026-09-24', work);
    await seedDated(page, id, 'Buy milk', '2026-09-25');
    await openToday(page);
    await expect(overdueList(page).getByRole('option')).toHaveCount(2);
    expect(await seriousAxeViolations(page)).toEqual([]);
    await rowIn(todayList(page), 'Buy milk').focus();
    await page.keyboard.press('d');
    await expect(page.getByRole('dialog', { name: 'Due date' })).toBeVisible();
    expect(await seriousAxeViolations(page)).toEqual([]);
  });

  test("TC-126 keyboard only: arrow to a task, D, N: the chip reads 'Monday' and focus is back on the row", async ({ page }) => {
    await page.clock.install({ time: FRIDAY_9AM });
    const { id } = await newInbox(page);
    await seedDated(page, id, 'Buy milk', null);
    await seedDated(page, id, 'Renew passport', null);
    await page.reload();
    await expect(page.getByRole('option')).toHaveCount(2);
    // Tab into the list (one Tab stop), then arrow to the second task.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(() => document.activeElement?.getAttribute('role') === 'option')) break;
    }
    await page.keyboard.press('ArrowDown');
    const row = page.getByRole('option', { name: 'Renew passport' });
    await expect(row).toBeFocused();
    await page.keyboard.press('d');
    await expect(page.getByRole('dialog', { name: 'Due date' })).toBeVisible();
    await page.keyboard.press('n');
    await expect(page.getByRole('dialog', { name: 'Due date' })).toBeHidden();
    await expect(row.getByText('Monday')).toBeVisible();
    await expect(row).toBeFocused();
  });

  test('Undo with Cmd/Ctrl+Z after a single-task reschedule (no confirmation)', async ({ page }) => {
    await page.clock.install({ time: FRIDAY_9AM });
    const { id } = await newInbox(page);
    const taskId = await seedDated(page, id, 'Renew passport', '2026-09-20');
    await openToday(page);
    await page.getByRole('button', { name: 'Reschedule' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(rowIn(todayList(page), 'Renew passport')).toBeVisible();
    await expect(toastWith(page, '1 task rescheduled to today')).toBeVisible();
    await page.locator('body').focus();
    await page.keyboard.press(`${await modKey(page)}+z`);
    await expect(rowIn(overdueList(page), 'Renew passport')).toBeVisible();
    await expect.poll(() => storedDueDate(page, taskId)).toBe('2026-09-20');
  });
});

// TC-94 and TC-118 (performance) are in today.perf.spec.ts, run alone by the 'perf' project.
