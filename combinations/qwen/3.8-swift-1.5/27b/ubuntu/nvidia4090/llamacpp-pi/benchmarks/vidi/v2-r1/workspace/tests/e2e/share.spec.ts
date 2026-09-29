import { test, expect, Page, BrowserContext } from '@playwright/test';
import { startWrangler, type WranglerProcess } from './helpers/wrangler-process';
import { newBoardId } from '../../src/shared/board-id';
import { CREATE_BUDGET_MS } from '../../src/shared/config';

/**
 * Story 5 e2e: share workflows against a real `wrangler dev` (with
 * TEST_HOOKS enabled for the legacy-board fixture).
 *
 * - TC-26 "Create, share, join" (chromium + clipboard permissions)
 * - TC-27 "Bad link recovery" (chromium, firefox, webkit)
 * - TC-28 "Flaky service on open" (chromium)
 * - TC-29 "Clipboard blocked" (chromium, firefox, webkit)
 * - TC-31 "Pre-existing board" (chromium)
 *
 * Wall-clock budgets (CREATE_BUDGET_MS) are logged, not asserted.
 */

let wrangler: WranglerProcess;
let base: string;

test.beforeAll(async () => {
  wrangler = await startWrangler({ vars: { TEST_HOOKS: '1' } });
  base = `http://127.0.0.1:${wrangler.port}`;
});

test.afterAll(async () => {
  await wrangler.kill();
});

const isChromium = () => test.info().project.name === 'chromium';

/** Create a board through the public API and return its id. */
async function createBoardViaApi(): Promise<string> {
  const resp = await fetch(`${base}/api/boards`, { method: 'POST' });
  expect(resp.status).toBe(201);
  const data = (await resp.json()) as { id: string };
  return data.id;
}

test.describe('TC-26: Create, share, join', () => {
  test('Maya creates, shares the link, Sam joins and edits, Maya sees it', async ({ browser }) => {
    test.skip(!isChromium(), 'clipboard workflow is covered on chromium');

    // Maya: context with clipboard permissions.
    const mayaCtx: BrowserContext = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const maya: Page = await mayaCtx.newPage();
    await maya.goto(`${base}/`);

    // New board → the empty board is shown.
    const t0 = Date.now();
    await maya.getByTestId('new-board').click();
    await maya.getByTestId('board-viewport').waitFor({ timeout: 20_000 });
    const createMs = Date.now() - t0;
    console.log(`[TC-26] click→board: ${createMs}ms (budget ${CREATE_BUDGET_MS}ms)`);

    // Maya adds a note.
    await maya.mouse.dblclick(400, 300);
    const mayaNote = maya.getByTestId('sticky-note');
    await expect(mayaNote).toBeVisible({ timeout: 5_000 });
    await maya.keyboard.type('Ship it');

    // Share → copy link → "Link copied".
    await maya.getByTestId('share-button').click();
    await expect(maya.getByTestId('share-panel')).toBeVisible();
    const linkInput = maya.getByTestId('share-link-input');
    await expect(linkInput).toHaveValue(new URL(maya.url()).origin + `/b/` + new URL(maya.url()).pathname.split('/b/')[1]);
    await maya.getByTestId('copy-link').click();
    await expect(maya.getByTestId('copy-link')).toContainText('Link copied');

    // The clipboard holds the full board link.
    const link = await maya.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/^https?:\/\/[^/]+\/b\/[A-Za-z0-9_-]{22}$/);

    // Sam: a fresh context opens the copied link → same board, sees the note.
    const samCtx: BrowserContext = await browser.newContext();
    const sam: Page = await samCtx.newPage();
    await sam.goto(link);
    const samNote = sam.getByTestId('sticky-note');
    await expect(samNote).toBeVisible({ timeout: 10_000 });
    await expect(sam.getByTestId('sticky-text')).toContainText('Ship it', { timeout: 5_000 });

    // Sam edits the note; Maya sees the edit.
    await sam.getByTestId('sticky-note').click();
    await sam.keyboard.press('Enter');
    await sam.getByTestId('sticky-text-editor').waitFor({ timeout: 5_000 });
    await sam.keyboard.press('End');
    await sam.keyboard.type('!');

    await expect(maya.getByTestId('sticky-text')).toContainText('Ship it!', { timeout: 5_000 });

    await samCtx.close();
    await mayaCtx.close();
  });
});

test.describe('TC-27: Bad link recovery', () => {
  test('never-created link → Board not found → New board → fresh empty board', async ({ browser }) => {
    const page: Page = await (await browser.newContext()).newPage();
    const neverCreated = newBoardId();

    await page.goto(`${base}/b/${neverCreated}`);
    await expect(page.getByTestId('not-found-heading')).toHaveText('Board not found');

    // Click New board → a fresh empty board opens.
    await page.getByTestId('new-board').click();
    await page.getByTestId('board-viewport').waitFor({ timeout: 20_000 });
    expect(await page.getByTestId('sticky-note').count()).toBe(0);
    // The new board has a valid 22-char id in the address.
    expect(new URL(page.url()).pathname).toMatch(/^\/b\/[A-Za-z0-9_-]{22}$/);
  });
});

test.describe('TC-28: Flaky service on open', () => {
  test('blocked checks show "Retrying…"; unblocking opens the board without reload', async ({ browser }) => {
    test.skip(!isChromium(), 'flaky-service workflow is covered on chromium');

    const boardId = await createBoardViaApi();
    const context = await browser.newContext();
    const page = await context.newPage();

    // Block the existence checks.
    await page.route('**/api/boards/*', (route) => route.abort());
    await page.goto(`${base}/b/${boardId}`);
    await expect(page.getByTestId('unreachable')).toContainText(
      "Couldn't reach vidi6. Retrying…",
    );

    // Unblock: the automatic retry opens the board (no reload is performed).
    await page.unroute('**/api/boards/*');
    await page.getByTestId('board-viewport').waitFor({ timeout: 20_000 });

    await context.close();
  });
});

test.describe('TC-29: Clipboard blocked', () => {
  test('writeText rejects → manual-copy message; selected text equals the full link', async ({ browser }) => {
    const boardId = await createBoardViaApi();
    const context = await browser.newContext();
    const page = await context.newPage();

    // Block the clipboard API before any page script runs.
    await page.addInitScript(() => {
      if (navigator.clipboard) {
        navigator.clipboard.writeText = () => Promise.reject(new Error('blocked'));
      }
    });

    await page.goto(`${base}/b/${boardId}`);
    await page.getByTestId('board-viewport').waitFor({ timeout: 20_000 });

    await page.getByTestId('share-button').click();
    await expect(page.getByTestId('share-panel')).toBeVisible();
    await page.getByTestId('copy-link').click();

    // Manual-copy hint is shown…
    await expect(page.getByTestId('manual-copy')).toBeVisible();

    // …and the fully-selected input text equals the full board link.
    const value = await page.getByTestId('share-link-input').inputValue();
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    expect(value).toBe(`${base}/b/${boardId}`);
    expect(selected).toBe(`${base}/b/${boardId}`);

    await context.close();
  });
});

test.describe('TC-31: Pre-existing board', () => {
  test('legacy board (updates rows, no created_at) opens with its notes', async ({ browser }) => {
    test.skip(!isChromium(), 'legacy-board workflow is covered on chromium');

    const legacyId = newBoardId();
    const seed = await fetch(`${base}/__test/boards/${legacyId}/seed-legacy`, {
      method: 'POST',
    });
    expect(seed.status).toBe(200);

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${base}/b/${legacyId}`);

    // The board opens (not "Board not found") with the seeded note.
    await expect(page.getByTestId('not-found-heading')).not.toBeVisible();
    const note = page.getByTestId('sticky-note');
    await expect(note).toBeVisible({ timeout: 15_000 });
    expect(await note.count()).toBe(1);

    await context.close();
  });
});
