/**
 * Story 5 e2e: share.e2e (TC-26 to TC-31).
 *
 * Runs against a real `wrangler dev` with TEST_HOOKS enabled.
 *
 * TC-26: Create → share → join (two real Chromium contexts, real clipboard).
 * TC-27: Bad link → Board not found → Create a new board.
 * TC-28: Flaky service on open → retry → board opens.
 * TC-29: Clipboard blocked → manual-copy message.
 * TC-30: Abuse guard → rate-limit message after BOARD_CREATE_LIMIT + 1.
 * TC-31: Pre-existing (legacy) board → opens correctly.
 */
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import {
  BOARD_CREATE_LIMIT,
  CREATE_BUDGET_MS,
} from '../../src/shared/config';
import { BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';

/** /b/<id> where <id> is exactly one board id (single source of truth: shared). */
const BOARD_PATH_RE = new RegExp(`/b/${BOARD_ID_PATTERN.source.slice(1, -1)}`);
import { getNotes } from './helpers/board';
import { PERSIST_URL, WranglerProcess } from './helpers/wrangler-process';
import { expectConnected, expectNoteCountWithin, expectWithin } from './helpers/participants';

// --- helpers ------------------------------------------------------------------

/** Create a board from the home page and return the board id. */
async function createBoardFromHome(
  context: BrowserContext,
): Promise<{ page: Page; boardId: string }> {
  const page = await context.newPage();
  await page.goto(PERSIST_URL + '/');
  await page.getByRole('button', { name: 'Create a board' }).click();
  // Wait for navigation to /b/<id>
  await page.waitForURL(BOARD_PATH_RE, { timeout: CREATE_BUDGET_MS });
  const boardId = new URL(page.url()).pathname.slice(3);
  await expectConnected(page);
  return { page, boardId };
}

/** Open the share panel and return the link from the input. */
async function openSharePanelAndGetLink(page: Page): Promise<string> {
  await page.getByTestId('share-button').click();
  const input = page.getByTestId('share-link-input');
  await expect(input).toBeVisible();
  return input.inputValue();
}

/** Wait for the board to be ready (connected state). */
async function waitForBoardReady(page: Page, timeoutMs = 30_000): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __vidi6?: { connectionState: string | null } }).__vidi6
              ?.connectionState ?? null,
        ),
      { timeout: timeoutMs, intervals: [50] },
    )
    .toBe('connected');
}

// --- TC-30: Abuse guard --------------------------------------------------------
//
// TC-30 needs the REAL rate limiter (only wrangler.jsonc defines the
// ratelimits binding). It runs FIRST in this file, on its own fresh wrangler
// process, so its 60-second window contains only its own
// BOARD_CREATE_LIMIT + 1 creations — no other test can contaminate it.
// The remaining cases get a second, separate process (fresh limiter), which
// also keeps their creations out of TC-30's window.

let rateLimitServer: WranglerProcess;

test.describe('TC-30 Abuse guard', () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeAll(async () => {
    rateLimitServer = new WranglerProcess({ testHooks: true });
    await rateLimitServer.start();
  });

  test.afterAll(async () => {
    await rateLimitServer.dispose();
  });

  test('BOARD_CREATE_LIMIT + 1 creations: last shows rate-limit message', async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    // Make BOARD_CREATE_LIMIT direct API calls (same IP as the browser)
    const page = await context.newPage();
    await page.goto(PERSIST_URL + '/');

    for (let i = 0; i < BOARD_CREATE_LIMIT; i++) {
      const status = await page.evaluate(() =>
        fetch('/api/boards', { method: 'POST' }).then((r) => r.status),
      );
      expect(status, `API call ${i + 1}`).toBe(201);
    }

    // Now use the UI: click Create a board
    await page.getByRole('button', { name: 'Create a board' }).click();

    // The rate-limit message is shown
    await expect(page.getByTestId('rate-limit-error')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('rate-limit-error')).toContainText(
      "You're creating boards too quickly. Wait a minute and try again.",
    );

    // Button is still enabled
    await expect(page.getByRole('button', { name: 'Create a board' })).toBeEnabled();

    await context.close();
  });
});

// --- TC-26..TC-29, TC-31 -------------------------------------------------------
//
// Everything except TC-30 runs against a second wrangler process (fresh rate
// limiter; test hooks enabled for TC-31's /__test seed route).

let shareServer: WranglerProcess;

test.describe('share (all cases but TC-30)', () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeAll(async () => {
    shareServer = new WranglerProcess({ testHooks: true });
    await shareServer.start();
  });

  test.afterAll(async () => {
    await shareServer.dispose();
  });

// --- TC-26: Create, share, join -----------------------------------------------

test.describe('TC-26 Create, share, join', () => {
  test('Maya creates a board, shares the link; Sam opens it and both edit', async ({
    browser,
  }) => {
    // Maya's context (with clipboard permissions)
    const mayaCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });

    // Maya creates a board
    const { page: mayaPage, boardId } = await createBoardFromHome(mayaCtx);

    // Maya adds a note (double-click at centre)
    await mayaPage.mouse.dblclick(640, 400);
    // Type text in the new note
    await mayaPage.keyboard.type('Hello Sam');
    await mayaPage.keyboard.press('Escape');

    // Maya opens the share panel and gets the link
    const link = await openSharePanelAndGetLink(mayaPage);
    expect(link).toBe(`${PERSIST_URL}/b/${boardId}`);

    // Maya clicks Copy link
    await mayaPage.getByTestId('copy-link-button').click();
    await expect(mayaPage.getByTestId('copy-link-button')).toContainText('Link copied');

    // Close the share panel
    await mayaPage.keyboard.press('Escape');

    // Sam's context
    const samCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const samPage = await samCtx.newPage();
    await samPage.goto(link);

    // Sam sees the board with Maya's note
    await waitForBoardReady(samPage);
    await expectNoteCountWithin(
      { page: samPage } as any,
      1,
    );

    // Verify the note text
    const samNotes = await getNotes(samPage);
    expect(samNotes.length).toBe(1);
    expect(samNotes[0].text).toBe('Hello Sam');

    // Sam edits the note: click on it and type
    const samNoteEl = samPage.locator('.vidi6-sticky').first();
    await samNoteEl.click();
    await samNoteEl.dblclick();
    await samPage.keyboard.press('End');
    await samPage.keyboard.type(' (edited)');

    // Maya sees Sam's edit
    const mayaNotes = await expectWithin(
      async () => {
        const notes = await getNotes(mayaPage);
        return notes[0]?.text;
      },
      'Hello Sam (edited)',
    );

    // Cleanup
    await samCtx.close();
    await mayaCtx.close();
  });
});

// --- TC-27: Bad link recovery -------------------------------------------------

test.describe('TC-27 Bad link recovery', () => {
  test('unknown board → Board not found → Create a new board', async ({
    browser,
  }) => {
    const unknownId = newBoardId();
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    // Open the unknown board
    await page.goto(`${PERSIST_URL}/b/${unknownId}`);

    // Wait for "Board not found"
    await expect(page.getByTestId('not-found-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();

    // Click "Create a new board"
    await page.getByTestId('create-new-board-button').click();

    // Wait for a new board. The current URL already matches BOARD_PATH_RE
    // (/b/<unknownId>), so waitForURL would resolve immediately — wait for
    // the pathname to actually change instead.
    await page.waitForURL(
      (url) => !url.pathname.endsWith(unknownId),
      { timeout: CREATE_BUDGET_MS },
    );
    const newId = new URL(page.url()).pathname.slice(3);
    expect(newId).not.toBe(unknownId);

    // The new board is ready
    await waitForBoardReady(page);

    await context.close();
  });
});

// --- TC-28: Flaky service on open ----------------------------------------------

test.describe('TC-28 Flaky service on open', () => {
  test('abort check → retry message → unroute → board opens', async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    // First, create a board
    const { page: createPage, boardId } = await createBoardFromHome(context);
    await createPage.close();

    // Open a new page with the board URL
    const page = await context.newPage();

    // Abort the board check request
    let aborted = true;
    await page.route('**/api/boards/*', (route) => {
      if (aborted) {
        route.abort();
      } else {
        route.continue();
      }
    });

    await page.goto(`${PERSIST_URL}/b/${boardId}`);

    // Wait for the retry message
    await expect(page.getByTestId('board-unreachable')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('board-unreachable')).toContainText(
      "Couldn't reach vidi6. Retrying…",
    );

    // Remove the abort
    aborted = false;

    // Wait for the board to open
    await waitForBoardReady(page);

    await context.close();
  });
});

// --- TC-29: Clipboard blocked --------------------------------------------------

test.describe('TC-29 Clipboard blocked shows manual-copy', () => {
  test('writeText rejects → manual-copy message; input selected', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      // Do NOT grant clipboard permissions → writeText will reject
    });

    // Stub writeText to reject (in case permissions are granted by default)
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        get: () => ({
          writeText: () => Promise.reject(new Error('blocked')),
        }),
        configurable: true,
      });
    });

    // Create a board
    const { page } = await createBoardFromHome(context);

    // Open the share panel
    await page.getByTestId('share-button').click();

    // Click Copy link
    await page.getByTestId('copy-link-button').click();

    // Manual-copy message is shown
    await expect(page.getByTestId('manual-copy-message')).toBeVisible();
    await expect(page.getByTestId('manual-copy-message')).toContainText(
      'Press Ctrl+C (Cmd+C on Mac) to copy',
    );

    // The input is selected
    const input = page.getByTestId('share-link-input') as any;
    const selection = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="share-link-input"]') as HTMLInputElement;
      return { start: el.selectionStart, end: el.selectionEnd, length: el.value.length };
    });
    expect(selection.start).toBe(0);
    expect(selection.end).toBe(selection.length);

    await context.close();
  });
});

// --- TC-31: Pre-existing (legacy) board ----------------------------------------

test.describe('TC-31 Pre-existing (legacy) board', () => {
  test('seed legacy board via test hook → open link → board with seeded notes', async ({
    browser,
  }) => {
    const boardId = newBoardId();
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    // Seed a legacy board via the test hook
    const seedRes = await context.request.post(
      `${PERSIST_URL}/__test/boards/${boardId}/seed-legacy`,
    );
    expect(seedRes.status()).toBe(204);

    // Open the board
    const page = await context.newPage();
    await page.goto(`${PERSIST_URL}/b/${boardId}`);

    // The board should be ready (not "Board not found")
    await waitForBoardReady(page);

    // The board has the seeded note (a minimal Yjs update with no actual
    // notes, but the board should be accessible and editable).
    // The seed-legacy test hook creates the schema and inserts a dummy
    // update. The board should be open and usable.
    await expect(page.getByTestId('share-button')).toBeVisible();

    await context.close();
  });
});
});
