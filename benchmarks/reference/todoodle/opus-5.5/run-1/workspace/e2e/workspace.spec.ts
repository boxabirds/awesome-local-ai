import { type Request, expect, test } from '@playwright/test';
import { TOKENS } from '../packages/shared/src/tokens.ts';
import {
  BANNER_TEXT,
  createWorkspace,
  denyClipboardOnWebkit,
  linkField,
  nameField,
  saveLinkFromPanel,
} from './support/workspace.ts';

test.beforeEach(async ({ context, browserName }) => {
  await denyClipboardOnWebkit(context, browserName);
});

function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

test('WF-1 / TC-54 create: in under 1 s, Save your link, Copy link & continue closes it, Share reopens it', async ({ page, browserName }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const { link, secret, elapsedMs } = await createWorkspace(page);
  expect(elapsedMs).toBeLessThan(1000);
  expect(link).toBe(`${new URL(page.url()).origin}/w#${secret}`);
  expect(page.url()).toBe(link);
  await expect(page.getByRole('heading', { name: 'Inbox', includeHidden: true })).toBeVisible();
  // The modal locks page scroll without any inline <style> (the CSP would block one).
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');

  await saveLinkFromPanel(page, browserName, link);

  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Share' })).toBeVisible();
  await expect(linkField(page)).toHaveValue(link);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Share' })).toBeFocused();
  // Nothing the app does is blocked by the CSP (violations surface as console errors).
  expect(consoleErrors).toEqual([]);
});

test('WF-2 / TC-55 return by link: a fresh browser opens the same workspace; reload keeps URL and workspace', async ({ page, browser }) => {
  const { link } = await createWorkspace(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Skip for now' }).click();
  const saved = page.waitForResponse((res) => res.request().method() === 'PATCH' && res.ok());
  await nameField(page).fill('Returning');
  await nameField(page).press('Enter');
  await saved;

  const other = await browser.newContext();
  const visitor = await other.newPage();
  await visitor.goto(link);
  await expect(nameField(visitor)).toHaveValue('Returning');
  await visitor.reload();
  expect(visitor.url()).toBe(link);
  await expect(nameField(visitor)).toHaveValue('Returning');
  // No 'Save your link' panel for a returning visitor, and none after reload.
  await expect(visitor.getByRole('dialog')).toBeHidden();
  await other.close();
});

test('WF-3 / TC-56 bad link: Workspace not found with the cut-off tip; Start creates a new list', async ({ page }) => {
  const random = 'Zq9'.repeat(14) + 'x'; // 43 base64url chars that match no workspace
  await page.goto(`/w#${random}`);
  await expect(page.getByRole('heading', { name: 'Workspace not found' })).toBeVisible();
  await expect(page.getByText("Links are long — check it wasn't cut off when it was copied.")).toBeVisible();
  await page.getByRole('button', { name: 'Start a new list' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Save your link' })).toBeVisible();
  await expect(nameField(page)).toHaveValue('My Todoodle');
  expect(page.url()).not.toContain(random);
});

test('WF-4 / TC-57 rename persists: reload shows it, and a second person with the link sees it', async ({ page, browser }) => {
  const { link } = await createWorkspace(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Skip for now' }).click();
  const saved = page.waitForResponse((res) => res.request().method() === 'PATCH' && res.ok());
  await nameField(page).fill('  Weekend jobs  ');
  await nameField(page).press('Enter');
  await saved;
  await expect(page).toHaveTitle('Todoodle - Weekend jobs');
  await page.reload();
  await expect(nameField(page)).toHaveValue('Weekend jobs');

  const other = await browser.newContext();
  const second = await other.newPage();
  await second.goto(link);
  await expect(nameField(second)).toHaveValue('Weekend jobs');
  await other.close();
});

test('WF-5 / TC-58 no leak: the secret never appears in a URL or Referer and every request is same-origin', async ({ page, browser, baseURL, browserName }) => {
  const origin = new URL(baseURL!).origin;
  type Seen = { url: string; referer: string; body: string };
  const pending: Promise<Seen>[] = [];
  // allHeaders() never settles for a request cancelled by a navigation (e.g. the Inbox list during a
  // reload); fall back to the headers the browser reported when it sent the request.
  const headersOf = (r: Request) =>
    Promise.race([r.allHeaders(), new Promise<Record<string, string>>((resolve) => setTimeout(() => resolve(r.headers()), 2_000))]);
  const record = (r: Request) =>
    pending.push(headersOf(r).then((headers) => ({ url: r.url(), referer: headers.referer ?? '', body: r.postData() ?? '' })));
  page.on('request', record);

  const { link, secret, id } = await createWorkspace(page);
  await saveLinkFromPanel(page, browserName, link);
  const saved = page.waitForResponse((res) => res.request().method() === 'PATCH' && res.ok());
  await nameField(page).fill('Private');
  await nameField(page).press('Enter');
  await saved;
  await page.reload();
  await expect(nameField(page)).toHaveValue('Private');
  // WF-6 path: the id route fetches the link only on demand.
  await page.goto(`/w/${id}`);
  await page.getByRole('button', { name: 'Share' }).click();
  await expect(linkField(page)).toHaveValue(link);

  const other = await browser.newContext();
  const visitor = await other.newPage();
  visitor.on('request', record);
  await visitor.goto(link);
  await expect(nameField(visitor)).toHaveValue('Private');
  const requests = await Promise.all(pending);
  await other.close();

  expect(requests.length).toBeGreaterThan(5);
  for (const { url, referer, body } of requests) {
    expect(new URL(url).origin, url).toBe(origin);
    expect(url, 'secret in a request URL').not.toContain(secret);
    expect(referer, `Referer of ${url}`).not.toContain(secret);
    if (body.includes(secret)) expect(new URL(url).pathname).toBe('/api/workspaces/open');
  }
  expect(requests.some(({ url, body }) => new URL(url).pathname === '/api/workspaces/open' && body.includes(secret))).toBe(true);
});

test('WF-6 / TC-63 id route: Share shows the creation link, and it opens the same workspace elsewhere', async ({ page, browser }) => {
  const { link, id } = await createWorkspace(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Skip for now' }).click();

  const linkRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/link')) linkRequests.push(r.url());
  });
  await page.goto(`/w/${id}`);
  await expect(nameField(page)).toHaveValue('My Todoodle');
  expect(linkRequests).toEqual([]); // never on page load
  await page.getByRole('button', { name: 'Share' }).click();
  await expect(linkField(page)).toHaveValue(link);
  expect(linkRequests).toHaveLength(1);

  await page.getByRole('dialog').getByRole('button', { name: 'Bookmark this page' }).click();
  await expect(page.getByRole('dialog').getByText(/Press (⌘D|Ctrl\+D)/)).toBeVisible();
  expect(page.url()).toBe(link); // the address bar is now the portable link

  const other = await browser.newContext();
  const visitor = await other.newPage();
  await visitor.goto(link);
  await expect(nameField(visitor)).toHaveValue('My Todoodle');
  await visitor.getByRole('button', { name: 'Share' }).click();
  await expect(linkField(visitor)).toHaveValue(link);
  await other.close();
});

test('WF-7 / TC-88 the reminder banner goes after saving, stays gone after reload, and shows in a fresh browser', async ({ page, browser, browserName }) => {
  const { link } = await createWorkspace(page);
  await expect(page.getByText(BANNER_TEXT)).toBeVisible();
  await saveLinkFromPanel(page, browserName, link);
  await expect(page.getByText(BANNER_TEXT)).toBeHidden();
  await page.reload();
  await expect(nameField(page)).toHaveValue('My Todoodle');
  await expect(page.getByText(BANNER_TEXT)).toBeHidden();

  const other = await browser.newContext();
  const visitor = await other.newPage();
  await visitor.goto(link);
  await expect(nameField(visitor)).toHaveValue('My Todoodle');
  await expect(visitor.getByText(BANNER_TEXT)).toBeVisible();
  await other.close();
});

test('WF-8 / TC-89 Email it to me makes no request and no web storage value holds the secret', async ({ page }) => {
  const { link, secret } = await createWorkspace(page);
  const email = page.getByRole('dialog').getByRole('link', { name: 'Email it to me' });
  await expect(email).toHaveAttribute('href', `mailto:?subject=Your%20Todoodle%20link&body=${encodeURIComponent(link)}`);
  // Keep the test browser from handing mailto: to the OS; the app's own click handler still runs.
  await email.evaluate((a) => a.addEventListener('click', (e) => e.preventDefault()));

  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await email.click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText(BANNER_TEXT)).toBeHidden();
  expect(requests).toEqual([]);

  const stored = await page.evaluate(() =>
    [localStorage, sessionStorage].flatMap((s) => Object.keys(s).flatMap((k) => [k, s.getItem(k) ?? ''])),
  );
  expect(stored.length).toBeGreaterThan(0);
  for (const value of stored) expect(value).not.toContain(secret);
  expect(await page.evaluate(() => JSON.stringify(history.state))).not.toContain(secret);
});

test('WF-9 / TC-86 boot open starts before the Workspace route chunk has finished loading', async ({ page, browser }) => {
  const { link } = await createWorkspace(page);
  const other = await browser.newContext();
  const visitor = await other.newPage();
  const events: string[] = [];
  visitor.on('request', (r) => {
    if (new URL(r.url()).pathname === '/api/workspaces/open') events.push('open:start');
  });
  visitor.on('requestfinished', (r) => {
    if (/\/assets\/Workspace-[^/]+\.js$/.test(new URL(r.url()).pathname)) events.push('chunk:finished');
  });
  await visitor.goto(link);
  await expect(nameField(visitor)).toHaveValue('My Todoodle');
  expect(events).toContain('chunk:finished');
  expect(events.indexOf('open:start')).toBeGreaterThanOrEqual(0);
  expect(events.indexOf('open:start')).toBeLessThan(events.indexOf('chunk:finished'));
  await other.close();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`WF-10 / TC-87 ${scheme} appearance: body background is the ${scheme} --background token`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(background).toBe(rgb(TOKENS[scheme].background));
    const color = await page.evaluate(() => getComputedStyle(document.body).color);
    expect(color).toBe(rgb(TOKENS[scheme].foreground));
  });
}
