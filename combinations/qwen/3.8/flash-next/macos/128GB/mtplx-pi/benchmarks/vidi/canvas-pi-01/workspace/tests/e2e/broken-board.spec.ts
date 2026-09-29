/**
 * Story 4 · TC-24 — a broken board, in a real browser.
 *
 * The point of the story is what a *returning* user sees when the room cannot
 * read their board. Everything here runs against `wrangler dev --env e2e`, so
 * the WebSocket, the Durable Object's SQLite storage and the reconnecting
 * provider are all real; only the damage is injected, through the test-only
 * `/__test/boards/:id/*` routes (which exist only in that environment — the
 * last case below proves they do not exist otherwise).
 *
 * The recovery half is the part that cannot be faked with a page reload: the
 * board reappears on the *same* page, through the provider's own retry, with
 * editing switched back on.
 */
import { expect, test, type Page, type APIRequestContext } from '@playwright/test';

/** The five states; mirrors `ConnectionState`. */
type LiveHook = {
  connectionState: () => string;
  snapshot: () => Array<{ id: string }>;
  seedNotes: (count: number, seed?: number) => unknown;
  waitForStableDoc: (stableMs?: number, timeoutMs?: number) => Promise<unknown>;
};

const LOAD_FAILED_TEXT = 'This board couldn\u2019t be loaded. Retrying…';

/**
 * A fresh board, created the way the app creates one.
 *
 * Story 5 removed "any address is a board": a made-up id is now a *not found*
 * page, so a test that wants a working room has to create it first. Each call
 * makes a brand-new board, which is also what keeps state from leaking between
 * cases.
 */
async function newBoard(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/boards');
  expect(response.status(), 'the board must be created before it can be opened').toBe(201);
  return (await response.json()).id as string;
}

/** The connection state the page currently reports (test hook). */
async function connectionState(page: Page): Promise<string> {
  return page.evaluate(
    () => (window as unknown as { __vidi6Live?: LiveHook }).__vidi6Live?.connectionState() ?? 'none',
  );
}

async function noteCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { __vidi6Live?: LiveHook }).__vidi6Live?.snapshot().length ?? -1,
  );
}

/** Wait for the provider to report a state (no fixed sleeps). */
async function waitForState(page: Page, state: string, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    (wanted) =>
      (window as unknown as { __vidi6Live?: LiveHook }).__vidi6Live?.connectionState() === wanted,
    state,
    { timeout },
  );
}

async function openBoard(page: Page, boardId: string): Promise<void> {
  await page.goto(`/b/${boardId}`);
  await waitForState(page, 'connected');
}

test('a board whose snapshot cannot be read says so, locks editing, and recovers on its own', async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const boardId = await newBoard(request);

  // ---- a board with real content, stored and compacted --------------------
  const seedContext = await browser.newContext();
  const seedPage = await seedContext.newPage();
  await openBoard(seedPage, boardId);
  await seedPage.evaluate(() => {
    const hook = (window as unknown as { __vidi6Live?: LiveHook }).__vidi6Live;
    hook?.seedNotes(25, 7);
  });
  await seedPage.evaluate(() =>
    (window as unknown as { __vidi6Live?: LiveHook }).__vidi6Live?.waitForStableDoc(),
  );
  expect(await noteCount(seedPage)).toBe(25);
  await seedContext.close();

  // ---- damage the stored snapshot ----------------------------------------
  const corrupt = await request.post(`/__test/boards/${boardId}/corrupt-snapshot`);
  expect(corrupt.status()).toBe(200);
  expect((await corrupt.json()).ok).toBe(true);

  // ---- a returning visitor gets the honest failure ------------------------
  const brokenContext = await browser.newContext();
  const page = await brokenContext.newPage();
  await page.goto(`/b/${boardId}`);

  await waitForState(page, 'load_failed');
  expect(await connectionState(page)).toBe('load_failed');

  const badge = page.getByTestId('connection-status');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText(LOAD_FAILED_TEXT);

  // Nothing was invented: the board is empty *and* read-only.
  expect(await noteCount(page)).toBe(0);
  await expect(page.getByTestId('create-sticky')).toBeDisabled();
  await page.mouse.dblclick(640, 400);
  expect(await noteCount(page)).toBe(0);

  // ---- repair: the board reappears without a reload -----------------------
  const repair = await request.post(`/__test/boards/${boardId}/repair-snapshot`);
  expect(repair.status()).toBe(200);
  expect((await repair.json()).ok).toBe(true);

  // The provider reconnects by itself (4500 is not a terminal code), the second
  // sync succeeds, and the badge is gone.
  await waitForState(page, 'connected');
  await page.waitForFunction(
    () =>
      (window as unknown as { __vidi6Live?: LiveHook }).__vidi6Live?.snapshot().length === 25,
    undefined,
    { timeout: 30_000 },
  );
  await expect(badge).toHaveCount(0);
  await expect(page.getByTestId('create-sticky')).toBeEnabled();

  await page.getByTestId('create-sticky').click();
  await page.waitForFunction(
    () =>
      (window as unknown as { __vidi6Live?: LiveHook }).__vidi6Live?.snapshot().length === 26,
    undefined,
    { timeout: 15_000 },
  );

  await brokenContext.close();
});

/**
 * TC-24b — the same server *without* `TEST_HOOKS`.
 *
 * The storage-surgery routes are a test seam, so the plain environment must
 * not expose them: a POST to the path is served by the asset worker (the
 * single-page app), and a board's stored state is left alone. Run against the
 * second `webServer` in `playwright.config.ts` (port 8788, no `--env e2e`).
 */
test('the storage routes do not exist without TEST_HOOKS, and leave data alone', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const production = 'http://localhost:8788';

  // A board with content, on the plain server.
  const context = await browser.newContext({ baseURL: production });
  const page = await context.newPage();
  const boardId = await newBoard(page.request);
  await openBoard(page, boardId);
  await page.evaluate(() => {
    const hook = (window as unknown as { __vidi6Live?: LiveHook }).__vidi6Live;
    hook?.seedNotes(3, 11);
  });
  await page.evaluate(() =>
    (window as unknown as { __vidi6Live?: LiveHook }).__vidi6Live?.waitForStableDoc(),
  );
  expect(await noteCount(page)).toBe(3);

  // The hook path answers with the single-page app, not with the hook: no
  // JSON body, and nothing that could be read back as a storage mutation.
  const response = await page.request.post(`${production}/__test/boards/${boardId}/corrupt-snapshot`);
  const type = response.headers()['content-type'] ?? '';
  expect(type).not.toContain('application/json');
  expect(await response.text()).not.toContain('"ok"');

  // ...and nothing was written: the same board reloads with its three notes.
  await page.reload();
  await waitForState(page, 'connected');
  expect(await noteCount(page)).toBe(3);
  expect(await connectionState(page)).toBe('connected');

  await context.close();
});
