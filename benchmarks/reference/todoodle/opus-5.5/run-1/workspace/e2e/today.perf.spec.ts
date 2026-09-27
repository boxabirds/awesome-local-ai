import { type Page, expect, test } from '@playwright/test';
import { PROJECT_COLORS } from '../packages/shared/src/limits.ts';
import { waitForLive } from './support/live.ts';
import { newInbox } from './support/tasks.ts';
import { newId, overdueList, seedBulk, todayList, todayPath } from './support/today.ts';

// Story 8 performance (TC-94, TC-118) with 5,000 open tasks, against local wrangler dev. The 'perf' Playwright
// project runs this file on its own with one worker, after the other e2e projects (bun run test:e2e): timings taken
// while other specs load the same local server would measure the machine, not Todoodle. Chromium only.

test.use({ timezoneId: 'Europe/London', locale: 'en-GB' });

test.describe('story 8: performance (5,000 open tasks)', () => {
  // Real clock here: Playwright's clock also fakes performance.now(), which would make the timings meaningless.
  // Dates are relative to the real date in London.
  test.describe.configure({ timeout: 120_000 });

  async function seedLarge(page: Page, id: string) {
    const londonToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
    const day = (offset: number) => {
      const date = new Date(`${londonToday}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    };
    const projects = Array.from({ length: 50 }, (_, i) => ({
      id: newId(),
      name: `Project ${i + 1}`,
      color: PROJECT_COLORS[i % PROJECT_COLORS.length]!.key,
    }));
    const names = ['Renew passport', 'Pay council tax', 'Book dentist — ask about Tuesday', 'Water the plants', 'Email Sam re: invoice #4411'];
    const tasks = Array.from({ length: 5_000 }, (_, i) => ({
      name: `${names[i % names.length]} ${i + 1}`,
      description: i % 7 === 0 ? 'Ask about:\n- the Tuesday slot' : '',
      projectId: i % 3 === 0 ? null : projects[i % 50]!.id,
      // 2,000 due on or before today (500 of them overdue by up to 60 days), the rest later or undated.
      dueDate: i < 500 ? day(-1 - (i % 60)) : i < 2_000 ? day(0) : i < 4_000 ? day(1 + (i % 90)) : null,
    }));
    await seedBulk(page, id, { projects, tasks });
    return projects;
  }

  test('TC-94 Today is interactive in under 500 ms after navigating to it', async ({ page }) => {
    const { id } = await newInbox(page);
    await seedLarge(page, id);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
    // The page has settled: the Today chunk's idle preload is done (as it is a moment after any page load).
    await page.waitForFunction(() => performance.getEntriesByType('resource').some((entry) => entry.name.includes('TodayView')));
    // A programmatic click (no hover or focus prefetch of the data): the data and the first rows on screen.
    const elapsed = await page.evaluate(async () => {
      performance.mark('today-nav-start');
      const link = document.querySelector<HTMLAnchorElement>('[data-nav-item="today"]')!;
      link.click();
      await new Promise<void>((resolve) => {
        const check = () => (document.querySelector('[role="listbox"][aria-label="Tasks due today"] [role="option"]') ? resolve() : requestAnimationFrame(check));
        check();
      });
      performance.mark('today-interactive');
      return performance.measure('today', 'today-nav-start', 'today-interactive').duration;
    });
    console.log(`TC-94 Today interactive after ${elapsed.toFixed(0)} ms`);
    expect(elapsed).toBeLessThan(500);
    await expect(overdueList(page).getByRole('option')).toHaveCount(500);
    await expect(todayList(page).getByRole('option')).toHaveCount(1_500);
  });

  test('TC-118 typing 30 characters in quick add during a 500-task reschedule and a live bulk change: every keystroke under 100 ms', async ({ page, browser }) => {
    const { id, link } = await newInbox(page);
    const projects = await seedLarge(page, id);
    const live = waitForLive(page);
    await page.goto(todayPath(id));
    await live;
    await expect(overdueList(page).getByRole('option')).toHaveCount(500);
    await page.evaluate(() => {
      const durations: number[] = [];
      (window as unknown as { __keyDurations: number[] }).__keyDurations = durations;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (entry.name === 'keydown' || entry.name === 'keypress' || entry.name === 'input') durations.push(entry.duration);
      }).observe({ type: 'event', buffered: false, durationThreshold: 16 } as PerformanceObserverInit);
    });
    await page.keyboard.press('q');
    const name = page.getByRole('textbox', { name: 'Task name' });
    await expect(name).toBeFocused();

    // Reschedule the 500 overdue tasks (a confirmation, then the optimistic move) while typing.
    await page.getByRole('button', { name: 'Reschedule' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Move' }).click();
    await name.focus();
    // Meanwhile another person makes a bulk change (a project delete sends tasks.bulk).
    const other = await browser.newContext({ timezoneId: 'Europe/London', locale: 'en-GB' });
    try {
      const b = await other.newPage();
      await b.goto(link);
      await expect(b.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
      const res = await b.request.delete(`/api/w/${id}/projects/${projects[1]!.id}`, { headers: { 'X-Todoodle-Client': 'web' } });
      expect(res.status()).toBe(200);
      const text = 'Call the landlord about boiler';
      expect(text).toHaveLength(30);
      await page.keyboard.type(text, { delay: 20 });
      await expect(name).toHaveValue(text);
    } finally {
      await other.close();
    }
    const durations = await page.evaluate(() => (window as unknown as { __keyDurations: number[] }).__keyDurations);
    console.log(`TC-118 slowest keystroke event: ${Math.max(0, ...durations).toFixed(0)} ms over ${durations.length} slow (>16 ms) events`);
    expect(durations.every((duration) => duration < 100)).toBe(true);
  });
});
