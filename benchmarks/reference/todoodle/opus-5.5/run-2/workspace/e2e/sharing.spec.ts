import { type Browser, type BrowserContext, expect, type Page, test, type WebSocketRoute } from '@playwright/test';

/*
 * Story 4: sharing the link, joining, live updates between people, offline vs live-paused, and
 * the conflict choice. Every participant is its own browser context (its own cookie jar).
 * Chromium only (clipboard permission, setOffline and routeWebSocket), as the design specifies.
 */

const OFFLINE_TEXT = "You're offline — changes can't be saved right now";
const CONFLICT_TEXT = 'Someone else changed this just now.';
const LIVE_TARGET_MS = 5_000;

test.beforeEach(({ browserName }) => {
  test.skip(browserName !== 'chromium', 'Story 4 e2e runs in Chromium only');
});

type Participant = { context: BrowserContext; page: Page };

async function participant(browser: Browser): Promise<Participant> {
  const context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  // No first-run nags in these flows: the link counts as saved in every participant's browser.
  await context.addInitScript(() => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(key: string) {
      if (key.startsWith('tdl:v1:linkSaved:')) return '1';
      return original.call(this, key);
    };
  });
  return { context, page: await context.newPage() };
}

/** A creates a workspace from Home, saves the link from the first-run panel and names it. */
async function createShared(page: Page, name: string): Promise<{ id: string; link: string }> {
  await page.goto('/');
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/workspaces') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Start a new list' }).click(),
  ]);
  const body = (await response.json()) as { workspace: { id: string }; secret: string };
  // Story 2's first-run panel (the same SharePanel) opens after creating: save the link.
  const saveDialog = page.getByRole('dialog', { name: 'Save your link' });
  await saveDialog.getByRole('button', { name: 'Copy link & continue' }).click();
  await expect(saveDialog).toBeHidden();
  await rename(page, name);
  return { id: body.workspace.id, link: `${new URL(page.url()).origin}/w#${body.secret}` };
}

async function rename(page: Page, name: string) {
  const field = page.getByLabel('Workspace name');
  await field.fill(name);
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.status() === 200);
  await field.press('Enter');
  await saved;
  await expect(field).toHaveValue(name);
}

/** Opens `url` and waits until the page's live socket is up. */
async function openLive(page: Page, url: string) {
  // A fresh page load (a hash-only navigation to the same URL would not reload).
  await page.goto('about:blank');
  const socket = page.waitForEvent('websocket', (ws) => ws.url().endsWith('/live'));
  await page.goto(url);
  await socket;
  await expect(page.getByLabel('Workspace name')).toBeEnabled();
  // The upgrade answers in a few ms locally; leave room for the 101 before others write.
  await page.waitForTimeout(300);
}

async function closeAll(...people: Participant[]) {
  await Promise.all(people.map((p) => p.context.close()));
}

test('W1 A shares the link and copies it; B opens it and is in, with no prompts; B remembers it', async ({ browser }) => {
  const a = await participant(browser);
  const b = await participant(browser);
  const { link } = await createShared(a.page, 'Household chores');

  await a.page.getByRole('button', { name: 'Share' }).click();
  const panel = a.page.getByRole('dialog', { name: 'Share' });
  await expect(panel.getByLabel('Workspace link')).toHaveValue(link);
  await expect(panel).toContainText('This link is the key to this workspace — for you and anyone you send it to.');
  await expect(panel).toContainText("Anyone with it can see and change everything. Access can't be removed yet.");
  await panel.getByRole('button', { name: 'Copy link' }).click();
  expect(await a.page.evaluate(() => navigator.clipboard.readText())).toBe(link);

  await b.page.goto(link);
  await expect(b.page.getByLabel('Workspace name')).toHaveValue('Household chores');
  await expect(b.page.getByLabel('Workspace name')).toBeEnabled();
  await expect(b.page.getByRole('dialog')).toHaveCount(0);

  await b.page.goto('/');
  await expect(b.page.getByRole('link', { name: /^Household chores/ })).toBeVisible();
  await closeAll(a, b);
});

test('W2 A renames; B shows it within 5 s without reloading and hears one polite announcement', async ({ browser }) => {
  const a = await participant(browser);
  const b = await participant(browser);
  const { link } = await createShared(a.page, 'Trip to Lisbon');
  await openLive(a.page, link);
  await openLive(b.page, link);
  let reloaded = false;
  b.page.on('framenavigated', () => {
    reloaded = true;
  });

  await rename(a.page, 'Trip to Porto');
  await expect(b.page.getByLabel('Workspace name')).toHaveValue('Trip to Porto', { timeout: LIVE_TARGET_MS });
  await expect(b.page.getByTestId('live-announcer')).toHaveText('1 change made by someone else');
  await expect(b.page.getByTestId('live-announcer')).toHaveAttribute('aria-live', 'polite');
  expect(reloaded).toBe(false);
  await closeAll(a, b);
});

test('W3 10 people in one workspace: one rename reaches all 10 within 5 s', async ({ browser }) => {
  test.setTimeout(90_000);
  const owner = await participant(browser);
  const { link } = await createShared(owner.page, 'Team board');
  const people = await Promise.all(Array.from({ length: 10 }, () => participant(browser)));
  for (const p of people) await openLive(p.page, link);

  await rename(people[0]!.page, 'Team board v2');
  await Promise.all(
    people.map((p) => expect(p.page.getByLabel('Workspace name')).toHaveValue('Team board v2', { timeout: LIVE_TARGET_MS })),
  );
  await closeAll(owner, ...people);
});

test('W4 B offline for 8 s with a draft: banner, editing off, draft kept; back online heals A’s rename', async ({ browser }) => {
  test.setTimeout(60_000);
  const a = await participant(browser);
  const b = await participant(browser);
  const { link } = await createShared(a.page, 'Groceries');
  await openLive(a.page, link);
  await openLive(b.page, link);

  const field = b.page.getByLabel('Workspace name');
  await field.fill('Groceries 2');
  await b.context.setOffline(true);
  await expect(b.page.getByText(OFFLINE_TEXT)).toBeVisible();
  await expect(b.page.getByText(OFFLINE_TEXT)).toHaveAttribute('role', 'status');
  await expect(field).toBeDisabled();
  await expect(field).toHaveValue('Groceries 2');
  await expect(b.page.getByRole('button', { name: 'Share' })).toBeEnabled();

  await rename(a.page, 'Groceries for Saturday');
  await b.page.waitForTimeout(8_000);
  await expect(field).toHaveValue('Groceries 2');
  await expect(b.page.getByText(OFFLINE_TEXT)).toBeVisible();

  await b.context.setOffline(false);
  await expect(b.page.getByText(OFFLINE_TEXT)).toBeHidden({ timeout: 10_000 });
  await expect(field).toBeEnabled();
  await expect(field).toHaveValue('Groceries 2');
  // The refetch on recovery brought A's rename into B's cache (the title follows the cache).
  await expect(b.page).toHaveTitle('Todoodle - Groceries for Saturday', { timeout: 10_000 });
  await closeAll(a, b);
});

test('W5 A is typing when B renames: A sees the notice with B’s name, chooses Use my version, both end with A’s', async ({ browser }) => {
  const a = await participant(browser);
  const b = await participant(browser);
  const { link } = await createShared(a.page, 'Weekend plans');
  await openLive(a.page, link);
  await openLive(b.page, link);

  const aField = a.page.getByLabel('Workspace name');
  await aField.fill('Weekend plans (A)');
  await rename(b.page, 'Weekend plans (B)');

  const notice = a.page.getByRole('alert').filter({ hasText: CONFLICT_TEXT });
  await expect(notice).toBeVisible({ timeout: LIVE_TARGET_MS });
  await expect(notice).toContainText('Weekend plans (B)');
  await expect(aField).toHaveValue('Weekend plans (B)');
  await notice.getByRole('button', { name: 'Use my version' }).click();

  await expect(notice).toBeHidden();
  await expect(aField).toHaveValue('Weekend plans (A)');
  await expect(b.page.getByLabel('Workspace name')).toHaveValue('Weekend plans (A)', { timeout: LIVE_TARGET_MS });
  await closeAll(a, b);
});

test('W6 a browser without the link cannot open the live socket and receives nothing', async ({ browser }) => {
  const a = await participant(browser);
  const c = await participant(browser);
  const { id } = await createShared(a.page, 'Private list');
  await c.page.goto('/');
  const outcome = await c.page.evaluate(
    (workspaceId) =>
      new Promise<{ opened: boolean; messages: number; closed: boolean }>((resolve) => {
        const result = { opened: false, messages: 0, closed: false };
        const socket = new WebSocket(`ws://${location.host}/api/w/${workspaceId}/live`);
        socket.onopen = () => {
          result.opened = true;
        };
        socket.onmessage = () => {
          result.messages++;
        };
        socket.onclose = () => {
          result.closed = true;
          resolve(result);
        };
        setTimeout(() => resolve(result), 3_000);
      }),
    id,
  );
  await rename(a.page, 'Private list 2');
  expect(outcome).toEqual({ opened: false, messages: 0, closed: true });
  await closeAll(a, c);
});

test('W7 B returns via the remembered list (/w/:id); Share shows the same link, fetched, and copying works', async ({ browser }) => {
  const a = await participant(browser);
  const b = await participant(browser);
  const { id, link } = await createShared(a.page, 'Book club');
  await b.page.goto(link);
  await expect(b.page.getByLabel('Workspace name')).toHaveValue('Book club');

  await b.page.goto('/');
  await b.page.getByRole('link', { name: /^Book club/ }).click();
  await expect(b.page).toHaveURL(new RegExp(`/w/${id}$`));
  const fetched = b.page.waitForResponse((r) => r.url().endsWith(`/api/w/${id}/link`));
  await b.page.getByRole('button', { name: 'Share' }).click();
  expect((await fetched).status()).toBe(200);
  const panel = b.page.getByRole('dialog', { name: 'Share' });
  await expect(panel.getByLabel('Workspace link')).toHaveValue(link);
  await panel.getByRole('button', { name: 'Copy link' }).click();
  expect(await b.page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  await closeAll(a, b);
});

test('W8 only B’s socket drops: pill after 5 s, renaming still works; restored socket clears the pill and heals', async ({ browser }) => {
  test.setTimeout(90_000);
  const a = await participant(browser);
  const b = await participant(browser);
  const { link } = await createShared(a.page, 'Garden');
  await openLive(a.page, link);

  let blocked = false;
  const live: WebSocketRoute[] = [];
  await b.page.routeWebSocket(/\/live$/, (ws) => {
    if (blocked) {
      ws.close({ code: 4000, reason: 'dropped by test' });
      return;
    }
    ws.connectToServer();
    live.push(ws);
  });
  await openLive(b.page, link);

  blocked = true;
  for (const ws of live) await ws.close({ code: 4000, reason: 'dropped by test' });
  const pill = b.page.getByText('Reconnecting…');
  await expect(pill).toBeHidden();
  await expect(pill).toBeVisible({ timeout: 8_000 });
  await expect(pill).toHaveAttribute('role', 'status');
  await expect(b.page.getByText(OFFLINE_TEXT)).toBeHidden();

  // HTTP still works: B's rename saves and A sees it live.
  await rename(b.page, 'Garden (B)');
  await expect(a.page.getByLabel('Workspace name')).toHaveValue('Garden (B)', { timeout: LIVE_TARGET_MS });
  // A renames while B's socket is down.
  await rename(a.page, 'Garden (A)');
  await b.page.waitForTimeout(500);
  await expect(b.page.getByLabel('Workspace name')).toHaveValue('Garden (B)');

  blocked = false;
  await expect(pill).toBeHidden({ timeout: 40_000 });
  await expect(b.page.getByLabel('Workspace name')).toHaveValue('Garden (A)', { timeout: LIVE_TARGET_MS });
  await closeAll(a, b);
});
