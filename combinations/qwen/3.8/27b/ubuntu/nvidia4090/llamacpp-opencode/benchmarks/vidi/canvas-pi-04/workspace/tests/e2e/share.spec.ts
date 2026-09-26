// Story 5, task 7: E2E share workflows (TC-26 to TC-31).
//
// Real browsers against `wrangler dev` (with TEST_HOOKS, see
// playwright.config.ts): the board API (share.board_api), the pages
// (share.pages) and the Share panel (share.share_panel) working together.
//
// Rate limiting is per visitor IP and in `wrangler dev` the visitor key
// falls back to the CF-Connecting-IP header, so every test that creates
// boards from the UI routes those POSTs through a UNIQUE ip — tests never
// share a rate bucket (and TC-30's abuse bucket is isolated from the rest).

import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import {
  BOARD_CREATE_LIMIT,
  CREATE_BUDGET_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../src/shared/config';
import { RATE_LIMITED_MESSAGE } from '../../src/client/pages/HomePage';
import { expectWithin, newBoard, uniqueVisitorIp } from './participants';

/** Give this page's POST /api/boards requests a fixed visitor ip. */
function routeUiCreates(page: Page, ip: string): void {
  page.route('**/api/boards**', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await route.continue({
      headers: { ...route.request().headers(), 'cf-connecting-ip': ip },
    });
  });
}

/** Skip the tests that only run in chromium (TC-27 and TC-29 run everywhere). */
function skipUnlessChromium(testInfo: TestInfo): void {
  testInfo.skip(testInfo.project.name !== 'chromium', 'chromium only');
}

const VIEWPORT = '[data-testid="board-viewport"]';

test('TC-26: create, share, join', async ({ browser, baseURL }, testInfo) => {
  skipUnlessChromium(testInfo);

  // Maya (clipboard permissions granted for the app origin).
  const mayaCtx = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const maya = await mayaCtx.newPage();
  routeUiCreates(maya, uniqueVisitorIp());

  // Warm the client bundle (cold dev-server compile is not part of the
  // create-path budget under test).
  await maya.goto('/');

  // Create: the board (POST 201 + BoardPage exists path) is visible within
  // the create budget.
  const t0 = Date.now();
  await maya.getByRole('button', { name: 'Create a board' }).click();
  await expect(maya.locator(VIEWPORT)).toBeVisible({ timeout: 10_000 });
  expect(Date.now() - t0).toBeLessThanOrEqual(CREATE_BUDGET_MS);

  // Maya adds a note.
  const vp = (await maya.locator(VIEWPORT).boundingBox())!;
  await maya.locator(VIEWPORT).dblclick({ position: { x: vp.width / 2, y: vp.height / 2 } });
  await maya.keyboard.type('shared');
  await maya.keyboard.press('Escape');
  await expect(maya.locator('.sticky-note__text')).toHaveText('shared');

  // Share: copy the link and check the copied state.
  await maya.getByRole('button', { name: 'Share' }).click();
  await expect(maya.getByRole('dialog', { name: 'Share board' })).toBeVisible();
  await maya.getByRole('button', { name: 'Copy link' }).click();
  await expect(maya.getByRole('button', { name: '✓ Link copied' })).toBeVisible();

  // The clipboard holds the board link.
  const link = await maya.evaluate(() => navigator.clipboard.readText());
  expect(link).toBe(new URL(maya.url()).href);
  expect(link).toMatch(/^https?:\/\/.+\/b\/[A-Za-z0-9_-]{22}$/);

  // Sam opens the shared link in a fresh context: same board, sees the note.
  const samCtx = await browser.newContext();
  const sam = await samCtx.newPage();
  await sam.goto(link);
  await expect(sam.locator(VIEWPORT)).toBeVisible({ timeout: 15_000 });
  await expect(sam.locator('.sticky-note__text')).toHaveText('shared');

  // Sam edits; Maya sees it live.
  const samVp = (await sam.locator(VIEWPORT).boundingBox())!;
  await sam
    .locator(VIEWPORT)
    .dblclick({ position: { x: samVp.width / 4, y: samVp.height * 0.75 } });
  await sam.keyboard.type('from sam');
  await sam.keyboard.press('Escape');
  await expect(sam.locator('.sticky-note')).toHaveCount(2);
  await expectWithin(async () => maya.locator('.sticky-note').count(), 2);
  await expectWithin(
    async () => (await maya.locator('.sticky-note__text').allInnerTexts()).join('\n'),
    'shared\nfrom sam',
  );

  await samCtx.close();
  await mayaCtx.close();
});

test('TC-27: bad link recovery', async ({ browser, baseURL }) => {
  // Runs in every project (chromium, firefox, webkit).
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  routeUiCreates(page, uniqueVisitorIp());

  // A well-formed id that was never created -> GET 404 -> Board not found.
  await page.goto(`/b/${newBoardId()}`);
  await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();

  // Recovery: create a fresh board from the page itself.
  await page.getByRole('button', { name: 'Create a new board' }).click();
  await expect(page.locator(VIEWPORT)).toBeVisible({ timeout: 10_000 });
  expect(new URL(page.url()).pathname).toMatch(/^\/b\/[A-Za-z0-9_-]{22}$/);
  await expect(page.locator('.sticky-note')).toHaveCount(0);
  await ctx.close();
});

test('TC-28: flaky service on open — retry recovers without reload', async ({
  browser,
  baseURL,
}, testInfo) => {
  skipUnlessChromium(testInfo);

  const boardId = await newBoard(baseURL!);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // The existence check is down: the board page reports it and keeps
  // retrying on the backoff.
  await page.route('**/api/boards/**', (route) => route.abort());
  await page.goto(`/b/${boardId}`);
  await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible();
  await expect(page.locator(VIEWPORT)).toHaveCount(0);

  // Mark the page so a full reload would be detectable.
  await page.evaluate(() => {
    (window as unknown as { __noReload?: boolean }).__noReload = true;
  });

  // The service recovers: the next backoff tick opens the board — no reload.
  await page.unroute('**/api/boards/**');
  await expect(page.locator(VIEWPORT)).toBeVisible({
    timeout: RECONNECT_MAX_BACKOFF_MS + 10_000,
  });
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload))
    .toBe(true);
  await ctx.close();
});

test('TC-29: clipboard blocked — manual copy fallback', async ({ browser, baseURL }) => {
  // Runs in every project (chromium, firefox, webkit).
  const boardId = await newBoard(baseURL!);
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    // Block the clipboard API: writeText rejects, so the panel must fall
    // back to the manual-copy path.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error('clipboard blocked by test')),
        readText: () => Promise.reject(new Error('clipboard blocked by test')),
      },
    });
  });
  const page = await ctx.newPage();
  await page.goto(`/b/${boardId}`);
  await expect(page.locator(VIEWPORT)).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page.getByRole('dialog', { name: 'Share board' })).toBeVisible();
  await page.getByRole('button', { name: 'Copy link' }).click();

  // The manual-copy hint is shown...
  await expect(page.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeVisible();
  // ...and the link is selected in full, ready for a manual Ctrl+C.
  const input = page.getByLabel('Board link');
  const value = await input.inputValue();
  expect(value).toBe(new URL(page.url()).href);
  const selection = await input.evaluate((el) => {
    const textInput = el as HTMLInputElement;
    return [textInput.selectionStart, textInput.selectionEnd] as const;
  });
  expect(selection[0]).toBe(0);
  expect(selection[1]).toBe(value.length);
  await ctx.close();
});

test('TC-30: abuse guard — rate limit after BOARD_CREATE_LIMIT creations', async ({
  browser,
}, testInfo) => {
  skipUnlessChromium(testInfo);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // A dedicated abuse visitor: BOARD_CREATE_LIMIT + 1 creations from the
  // same ip must trip the limit on the last one.
  routeUiCreates(page, uniqueVisitorIp());
  await page.goto('/');

  for (let i = 0; i < BOARD_CREATE_LIMIT; i++) {
    await page.getByRole('button', { name: 'Create a board' }).click();
    // A 201 navigates to /b/<id> immediately (pushState) — waiting for the
    // URL instead of the mounted board keeps the loop well inside the
    // 60s rolling rate-limit window even on a loaded machine.
    await expect(page).toHaveURL(/\/b\/[A-Za-z0-9_-]{22}/, { timeout: 10_000 });
    await page.goto('/');
  }

  // One too many: 429 -> the exact rate-limit message, button still enabled.
  await page.getByRole('button', { name: 'Create a board' }).click();
  await expect(page.getByRole('alert')).toHaveText(RATE_LIMITED_MESSAGE);
  const button = page.getByRole('button', { name: 'Create a board' });
  await expect(button).toBeEnabled();
  await ctx.close();
});

test('TC-31: pre-existing (legacy) board opens with its notes', async ({
  browser,
  baseURL,
}, testInfo) => {
  skipUnlessChromium(testInfo);

  // A board whose storage predates created_at (updates table only) is a
  // valid, existing board (share.board_api legacy rule).
  const boardId = newBoardId();
  const res = await fetch(`${baseURL}/__test/boards/${boardId}/seed-legacy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ count: 3 }),
  });
  expect(res.status, await res.text()).toBe(200);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/b/${boardId}`);

  // Not "Board not found" — the board opens with its seeded notes.
  await expect(page.getByRole('heading', { name: 'Board not found' })).toHaveCount(0);
  await expect(page.locator(VIEWPORT)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.sticky-note')).toHaveCount(3);
  await ctx.close();
});
