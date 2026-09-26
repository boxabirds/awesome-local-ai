import { expect, test } from '@playwright/test';
import { goHome, rowLink, rowNames } from './support/remembered.ts';
import { createNamed } from './support/remembered.ts';
import {
  ACCESS_STATEMENT,
  CONFLICT_TEXT,
  OFFLINE_TEXT,
  RECONNECTING_TEXT,
  announcer,
  join,
  rename,
  waitForLive,
} from './support/live.ts';
import { createWorkspace, linkField, nameField, saveLinkFromPanel } from './support/workspace.ts';

// Story 4 e2e runs on Chromium (clipboard permission, offline emulation, WebSocket routing).
test.skip(({ browserName }) => browserName !== 'chromium', 'Story 4 e2e is Chromium-only');

/** A creates a workspace named `name` and waits for its own live socket. */
async function ownerWith(page: import('@playwright/test').Page, name: string) {
  const live = waitForLive(page);
  const created = await createNamed(page, name);
  await live;
  return created;
}

test('W1 A shares and copies the link; B opens it and is in the same workspace with no prompts', async ({ page, browser, browserName }) => {
  const live = waitForLive(page);
  const created = await createWorkspace(page);
  await saveLinkFromPanel(page, browserName, created.link);
  await live;

  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Share' })).toBeVisible();
  await expect(linkField(page)).toHaveValue(created.link);
  // The access statement, shown as its two lines.
  const [keySentence, accessSentences] = ACCESS_STATEMENT.split(/(?<=to\.) /) as [string, string];
  await expect(dialog.getByText(keySentence, { exact: true })).toBeVisible();
  await expect(dialog.getByText(accessSentences, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Copy link' }).click();
  await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(created.link);

  const b = await join(browser, copied);
  await expect(nameField(b.page)).toHaveValue('My Todoodle');
  await expect(nameField(b.page)).toBeEnabled();
  await expect(b.page.getByRole('dialog')).toHaveCount(0);
  await goHome(b.page);
  expect(await rowNames(b.page)).toEqual(['My Todoodle']);
  await b.context.close();
});

test('W2 A renames; B shows the new name within 5 s without reloading and hears one polite summary', async ({ page, browser }) => {
  const a = await ownerWith(page, 'Groceries');
  const b = await join(browser, a.link);
  await expect(nameField(b.page)).toHaveValue('Groceries');

  let reloaded = false;
  b.page.on('framenavigated', (frame) => {
    if (frame === b.page.mainFrame()) reloaded = true;
  });
  await rename(page, 'Trip to Lisbon ✈️');
  await expect(nameField(b.page)).toHaveValue('Trip to Lisbon ✈️', { timeout: 5_000 });
  await expect(b.page).toHaveTitle('Todoodle - Trip to Lisbon ✈️');
  await expect(announcer(b.page)).toHaveText('1 change made by someone else');
  await expect(announcer(b.page)).toHaveAttribute('aria-live', 'polite');
  // The renamer hears nothing about its own change.
  await expect(announcer(page)).toHaveText('');
  expect(reloaded).toBe(false);
  await b.context.close();
});

test('W3 ten people in one workspace all see a rename within 5 s', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const a = await ownerWith(page, 'Team chores');
  const people = await Promise.all(Array.from({ length: 10 }, () => join(browser, a.link)));
  await rename(people[0]!.page, 'Team chores (week 40)');
  await Promise.all(
    [page, ...people.map((p) => p.page)].map((p) => expect(nameField(p)).toHaveValue('Team chores (week 40)', { timeout: 5_000 })),
  );
  await Promise.all(people.map((p) => p.context.close()));
});

test('W4 B offline for 8 s with a draft: banner, editing off, draft kept; back online heals the missed rename', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const a = await ownerWith(page, 'Groceries');
  const b = await join(browser, a.link);
  await nameField(b.page).click();
  await nameField(b.page).fill('Groceries 2');

  await b.context.setOffline(true);
  await expect(b.page.getByText(OFFLINE_TEXT)).toBeVisible();
  await expect(b.page.getByRole('status').filter({ hasText: OFFLINE_TEXT })).toHaveAttribute('aria-live', 'polite');
  await expect(nameField(b.page)).toBeDisabled();
  await expect(nameField(b.page)).toHaveValue('Groceries 2');
  await expect(b.page.getByRole('button', { name: 'Share' })).toBeEnabled();
  await expect(b.page.getByText(RECONNECTING_TEXT)).toHaveCount(0); // the banner takes precedence

  await rename(page, 'Chores'); // missed by B
  await b.page.waitForTimeout(8_000);
  await expect(nameField(b.page)).toHaveValue('Groceries 2');

  await b.context.setOffline(false);
  await expect(b.page.getByText(OFFLINE_TEXT)).toBeHidden({ timeout: 10_000 });
  await expect(nameField(b.page)).toBeEnabled();
  await expect(nameField(b.page)).toHaveValue('Groceries 2'); // the draft is still there
  await expect(b.page).toHaveTitle('Todoodle - Chores'); // healed by the refetch
  await b.context.close();
});

test('W5 A is editing (draft X) when B renames to Y; A sees the notice and chooses Use my version; both end with X', async ({ page, browser }) => {
  const a = await ownerWith(page, 'Groceries');
  const b = await join(browser, a.link);

  await nameField(page).click();
  await nameField(page).fill('Groceries for Saturday');
  await rename(b.page, 'Chores');

  const notice = page.getByRole('alert').filter({ hasText: CONFLICT_TEXT });
  await expect(notice).toBeVisible({ timeout: 5_000 });
  await expect(notice).toContainText('Chores');
  await expect(nameField(page)).toHaveValue('Chores');

  const saved = page.waitForResponse((res) => res.request().method() === 'PATCH' && res.ok());
  await notice.getByRole('button', { name: 'Use my version' }).click();
  await saved;
  await expect(notice).toBeHidden();
  await expect(nameField(page)).toHaveValue('Groceries for Saturday');
  await expect(nameField(b.page)).toHaveValue('Groceries for Saturday', { timeout: 5_000 });
  await b.context.close();
});

test('W6 a browser without the link cannot open the live socket and receives nothing', async ({ page, browser }) => {
  const a = await ownerWith(page, 'Private list');
  const context = await browser.newContext();
  const c = await context.newPage();
  await c.goto('/');
  const attempt = c.evaluate(
    (id) =>
      new Promise<{ opened: boolean; frames: string[]; closeCode: number | null }>((resolve) => {
        const result = { opened: false, frames: [] as string[], closeCode: null as number | null };
        const ws = new WebSocket(`ws://${location.host}/api/w/${id}/live`);
        ws.onopen = () => {
          result.opened = true;
        };
        ws.onmessage = (event) => result.frames.push(String(event.data));
        ws.onclose = (event) => {
          result.closeCode = event.code;
        };
        setTimeout(() => resolve(result), 3_000);
      }),
    a.id,
  );
  await rename(page, 'Private list 2');
  const result = await attempt;
  expect(result.opened).toBe(false);
  expect(result.frames).toEqual([]);
  expect(result.closeCode).not.toBeNull();
  await context.close();
});

test('W7 B returns via the remembered list (/w/:id) and Share shows the same link; copying works', async ({ page, browser }) => {
  const a = await ownerWith(page, 'Book club');
  const b = await join(browser, a.link);
  await goHome(b.page);
  await rowLink(b.page, 'Book club').click();
  await expect(b.page).toHaveURL(new RegExp(`/w/${a.id}$`));
  await expect(nameField(b.page)).toHaveValue('Book club');

  const fetched = b.page.waitForResponse((res) => res.url().endsWith(`/api/w/${a.id}/link`) && res.ok());
  await b.page.getByRole('button', { name: 'Share' }).click();
  await fetched;
  await expect(linkField(b.page)).toHaveValue(a.link);
  await b.page.getByRole('dialog').getByRole('button', { name: 'Copy link' }).click();
  expect(await b.page.evaluate(() => navigator.clipboard.readText())).toBe(a.link);
  await b.context.close();
});

test('W8 only the live socket drops: Reconnecting… after 5 s, saving still works; restored socket heals the missed rename', async ({ page, browser }) => {
  test.setTimeout(90_000);
  // Not renamed at creation: A has no recent save of its own, so B's rename below is not a conflict for A.
  const aLive = waitForLive(page);
  const a = await createWorkspace(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Skip for now' }).click();
  await aLive;

  const context = await browser.newContext();
  const b = await context.newPage();
  let blocked = false;
  let current: import('@playwright/test').WebSocketRoute | null = null;
  await b.routeWebSocket(/\/api\/w\/[^/]+\/live$/, (ws) => {
    if (blocked) {
      ws.close({ code: 4000, reason: 'blocked by test' });
      return;
    }
    current = ws;
    ws.connectToServer();
  });
  const live = waitForLive(b);
  await b.goto(a.link);
  await live;
  await expect(nameField(b)).toHaveValue('My Todoodle');

  blocked = true;
  const droppedAt = Date.now();
  await current!.close({ code: 4000, reason: 'dropped by test' });
  await expect(b.getByText(RECONNECTING_TEXT)).toBeVisible({ timeout: 10_000 });
  expect(Date.now() - droppedAt).toBeGreaterThanOrEqual(4_900);
  await expect(b.getByText(OFFLINE_TEXT)).toHaveCount(0);

  // Editing stays on and saves go through: A sees B's rename.
  await expect(nameField(b)).toBeEnabled();
  await rename(b, 'Groceries (B)');
  await expect(nameField(page)).toHaveValue('Groceries (B)', { timeout: 5_000 });

  // A renames during the outage: B misses the event.
  await rename(page, 'Groceries (A)');
  await b.waitForTimeout(500);
  await expect(nameField(b)).toHaveValue('Groceries (B)');

  blocked = false;
  await expect(b.getByText(RECONNECTING_TEXT)).toBeHidden({ timeout: 40_000 });
  await expect(nameField(b)).toHaveValue('Groceries (A)', { timeout: 5_000 });
  await context.close();
});
