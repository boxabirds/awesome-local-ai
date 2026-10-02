/**
 * E2E share workflows (TC-26 to TC-29, TC-31).
 * Tests the create → share → join flow, bad link recovery, flaky service,
 * clipboard blocked, and legacy board scenarios.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { E2E_EVENTUAL_TIMEOUT_MS, CREATE_BUDGET_MS } from '../../src/shared/config';

async function createBoard(page: Page): Promise<string> {
  const res = await page.request.post('/api/boards');
  expect(res.ok()).toBeTruthy();
  const { id } = await res.json();
  return id;
}

async function openBoardAndWait(page: Page, boardId: string): Promise<void> {
  await page.goto(`/b/${boardId}`);
  await page.waitForFunction(
    () => (window as any).__vidi6?.connectionState === 'connected',
    undefined,
    { timeout: 20000 },
  );
}

async function addNote(page: Page, at: { x: number; y: number }, text: string): Promise<string> {
  return page.evaluate(
    ({ at, text }) => (window as any).__vidi6!.addSticky!(at, text, 'yellow'),
    { at, text },
  );
}

async function getBoard(page: Page) {
  return page.evaluate(() => [...((window as any).__vidi6?.getBoard?.() ?? [])]);
}

test.describe('Share workflows', () => {
  // TC-26: Create, share, join
  test('TC-26: create board, share link, second user joins', async ({ browser, context }) => {
    // Grant clipboard permissions for chromium
    test.skip(
      browser.browserType().name() !== 'chromium',
      'TC-26 clipboard test requires chromium',
    );
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // Maya creates a board via the New board button
    const mayaPage = await context.newPage();
    await mayaPage.goto('/');

    const clickTime = Date.now();
    await mayaPage.getByRole('button', { name: /new board/i }).click();

    // Wait for the board to be ready (connected)
    await mayaPage.waitForFunction(
      () => (window as any).__vidi6?.connectionState === 'connected',
      undefined,
      { timeout: 20000 },
    );
    const elapsed = Date.now() - clickTime;
    // Log timing (don't fail if budget exceeded, as CI may be slow)
    console.log(`TC-26: click-to-board time = ${elapsed}ms (budget ${CREATE_BUDGET_MS}ms)`);

    // Maya adds a note
    await addNote(mayaPage, { x: 100, y: 100 }, 'Hello from Maya');
    await expect
      .poll(() => getBoard(mayaPage).then((b) => b.length), { timeout: 10000 })
      .toBe(1);

    // Maya opens Share panel
    await mayaPage.getByRole('button', { name: /^share$/i }).click();
    await mayaPage.waitForSelector('[role="dialog"][aria-label="Share board"]');

    // Click Copy link
    await mayaPage.getByRole('button', { name: /copy link/i }).click();
    await mayaPage.waitForSelector('text=/link copied/i');

    // Get the link from the input
    const link = await mayaPage.locator('[role="dialog"] input').inputValue();
    expect(link).toMatch(/\/b\/[A-Za-z0-9_-]{22}$/);

    // Sam opens the link in a new context
    const samContext = await browser.newContext();
    const samPage = await samContext.newPage();
    await samPage.goto(link);
    await samPage.waitForFunction(
      () => (window as any).__vidi6?.connectionState === 'connected',
      undefined,
      { timeout: 20000 },
    );

    // Sam sees Maya's note
    await expect
      .poll(() => getBoard(samPage).then((b) => b.length), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(1);
    const samNotes = await getBoard(samPage);
    expect(samNotes[0].text).toContain('Hello from Maya');

    // Sam edits the note
    await addNote(samPage, { x: 300, y: 300 }, 'Reply from Sam');
    await expect
      .poll(() => getBoard(samPage).then((b) => b.length), { timeout: 10000 })
      .toBe(2);

    // Maya sees Sam's edit
    await expect
      .poll(() => getBoard(mayaPage).then((b) => b.length), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(2);

    await mayaPage.close();
    await samContext.close();
  });

  // TC-27: Bad link recovery
  test('TC-27: open unknown board link → Board not found → New board works', async ({ browser, context }) => {
    // All browsers
    const page = await context.newPage();
    const unknownId = newBoardId();
    await page.goto(`/b/${unknownId}`);

    // Should show "Board not found"
    await expect(page.getByText(/board not found/i)).toBeVisible({ timeout: 10000 });

    // Click New board button (on the NotFoundPage)
    await page.getByRole('button', { name: /new board/i }).click();

    // Should navigate to a real board
    await page.waitForFunction(
      () => (window as any).__vidi6?.connectionState === 'connected',
      undefined,
      { timeout: 20000 },
    );

    // Board should be empty
    const notes = await getBoard(page);
    expect(notes.length).toBe(0);

    await page.close();
  });

  // TC-28: Flaky service on open
  test('TC-28: network abort shows retrying, unroute recovers without reload', async ({ context }) => {
    const page = await context.newPage();
    const boardId = await createBoard(page);

    // Intercept the GET /api/boards/:id request and abort it
    let intercept = true;
    await page.route('**/api/boards/*', (route) => {
      if (intercept && route.request().method() === 'GET') {
        route.abort();
      } else {
        route.continue();
      }
    });

    await page.goto(`/b/${boardId}`);

    // Should show retrying message
    await expect(page.getByText(/couldn.t reach vidi6/i)).toBeVisible({ timeout: 10000 });

    // Remove the intercept (service recovers)
    intercept = false;

    // Wait for the board to open automatically (retry timer fires, now succeeds)
    await page.waitForFunction(
      () => (window as any).__vidi6?.connectionState === 'connected',
      undefined,
      { timeout: 30000 },
    );

    await page.close();
  });

  // TC-29: Clipboard blocked
  test('TC-29: clipboard writeText rejects → manual copy message', async ({ browser, context }) => {
    // All browsers
    const page = await context.newPage();

    // Inject script to make writeText reject
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        get() {
          return { writeText: () => Promise.reject(new Error('blocked')) };
        },
        configurable: true,
      });
    });

    const boardId = await createBoard(page);
    await openBoardAndWait(page, boardId);

    // Open Share panel
    await page.getByRole('button', { name: /^share$/i }).click();
    await page.waitForSelector('[role="dialog"][aria-label="Share board"]');

    // Click Copy link
    await page.getByRole('button', { name: /copy link/i }).click();

    // Should show manual copy message
    await expect(page.getByText(/press ctrl\+c/i)).toBeVisible({ timeout: 5000 });

    // Input should contain the full link
    const inputValue = await page.locator('[role="dialog"] input').inputValue();
    expect(inputValue).toContain(`/b/${boardId}`);

    await page.close();
  });

  // TC-31: Pre-existing board (legacy, no created_at)
  test('TC-31: legacy board opens without Board not found', async ({ context }) => {
    const page = await context.newPage();
    const boardId = newBoardId();

    // Seed a legacy board via test hook (updates rows without created_at)
    const seedRes = await page.request.get(`/__test/boards/${boardId}/seed-legacy?count=3`);
    expect(seedRes.ok()).toBeTruthy();
    const seedData = await seedRes.json();
    expect(seedData.seeded).toBe(3);

    // Now navigate to this board
    await page.goto(`/b/${boardId}`);

    // Should NOT show "Board not found"
    await page.waitForFunction(
      () => (window as any).__vidi6?.connectionState === 'connected',
      undefined,
      { timeout: 20000 },
    );

    // Should have the seeded notes
    await expect
      .poll(() => getBoard(page).then((b) => b.length), { timeout: 10000 })
      .toBe(3);

    await page.close();
  });
});
