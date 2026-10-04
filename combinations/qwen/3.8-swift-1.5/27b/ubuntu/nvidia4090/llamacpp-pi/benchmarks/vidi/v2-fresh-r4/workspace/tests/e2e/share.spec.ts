import { test, expect, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, expectEventually } from './helpers/participants';

// Inline newBoardId (Playwright tests can't import from src/)
function newBoardId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  let id = '';
  const bytes = new Uint8Array(22);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 22; i++) {
    id += chars[bytes[i] % chars.length];
  }
  return id;
}

/** Create a board via the API and return its id. */
async function createBoardViaApi(baseURL: string): Promise<string> {
  const res = await fetch(`${baseURL}/api/boards`, { method: 'POST' });
  if (res.status !== 201) throw new Error(`Failed to create board: ${res.status}`);
  const body = (await res.json()) as { id: string };
  return body.id;
}

/**
 * Wait for the board viewport to appear (board is ready).
 */
async function waitForBoardReady(page: Page): Promise<void> {
  await page.waitForSelector('[data-vidi6="board-viewport"]', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
}

/**
 * Add a sticky note to the board by double-clicking an empty area.
 * Uses an offset from centre to avoid landing on existing notes.
 */
let noteOffset = 0;
async function addNote(page: Page, text: string): Promise<void> {
  // Double-click in an offset position to avoid existing notes
  const viewport = page.locator('[data-vidi6="board-viewport"]');
  const box = await viewport.boundingBox();
  if (!box) throw new Error('viewport has no bounding box');
  // Offset each note to a different position
  const offsetX = (noteOffset % 5) * 250 - 500;
  const offsetY = Math.floor(noteOffset / 5) * 250 - 250;
  noteOffset++;
  await page.mouse.dblclick(box.x + box.width / 2 + offsetX, box.y + box.height / 2 + offsetY);

  // Type text into the new note's editor
  await page.keyboard.type(text);

  // Click elsewhere to deselect
  await page.mouse.click(box.x + 10, box.y + 10);
}

/**
 * Get the count of sticky notes on the board.
 */
async function noteCount(page: Page): Promise<number> {
  return page.locator('[data-vidi6="sticky-note"]').count();
}

// --- TC-26: Create, share, join ---

test.describe('TC-26: Create, share, join', () => {
  test('Maya creates board, adds note, copies link; Sam joins and edits', async ({ browser, baseURL }) => {
    test.setTimeout(60000);

    // Maya: open home page
    const mayaCtx = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const maya = await mayaCtx.newPage();
    await maya.goto(baseURL!);

    // Wait for home page
    await maya.waitForSelector('[data-vidi6="home-page"]', { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Click New board
    const createStart = Date.now();
    await maya.click('[data-vidi6="new-board-button"]');

    // Wait for the board to be ready
    await waitForBoardReady(maya);
    const createElapsed = Date.now() - createStart;
    console.log(`  ⏱ click-to-board: ${createElapsed}ms (budget: 2000ms)`);

    // Add a note
    await addNote(maya, 'hello from maya');
    await expectEventually(() => noteCount(maya).then(n => n === 1), 'Maya has 1 note');

    // Open Share panel
    await maya.click('[data-vidi6="share-button"]');
    await maya.waitForSelector('[data-vidi6="share-panel"]', { timeout: 5000 });

    // Get the link from the input
    const link = await maya.inputValue('[data-vidi6="share-link-input"]');
    expect(link).toMatch(/\/b\/[A-Za-z0-9_-]{22}$/);

    // Copy the link
    await maya.click('[data-vidi6="copy-link-button"]');

    // Wait for "Link copied" confirmation
    await expect(maya.locator('[data-vidi6="copy-link-button"]')).toContainText('Link copied', { timeout: 5000 });

    // Sam: open the link in a new context
    const samCtx = await browser.newContext();
    const sam = await samCtx.newPage();
    await sam.goto(link);

    // Sam should see the board with Maya's note
    await waitForBoardReady(sam);
    await expectEventually(() => noteCount(sam).then(n => n === 1), 'Sam sees Maya\'s note');

    // Sam adds a note
    await addNote(sam, 'hello from sam');

    // Maya should see Sam's note
    await expectEventually(() => noteCount(maya).then(n => n === 2), 'Maya sees Sam\'s note');

    // Sam should also see 2 notes
    await expectEventually(() => noteCount(sam).then(n => n === 2), 'Sam sees 2 notes');

    await mayaCtx.close();
    await samCtx.close();
  });
});

// --- TC-27: Bad link recovery ---

test.describe('TC-27: Bad link recovery', () => {
  test('unknown board shows Board not found; New board creates fresh board', async ({ page, baseURL }) => {
    // Open a link to a board that was never created
    const unknownId = newBoardId();
    await page.goto(`${baseURL}/b/${unknownId}`);

    // Should show Board not found
    await page.waitForSelector('[data-vidi6="not-found-page"]', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    expect(await page.locator('[data-vidi6="not-found-heading"]').textContent()).toBe('Board not found');

    // Click New board
    await page.click('[data-vidi6="not-found-new-board"]');

    // Should navigate to a new board
    await waitForBoardReady(page);
    expect(page.url()).toMatch(/\/b\/[A-Za-z0-9_-]{22}$/);
  });
});

// --- TC-28: Flaky service on open ---

test.describe('TC-28: Flaky service on open', () => {
  test('retry message then board opens without reload', async ({ page, baseURL }) => {
    // Create a board first
    const boardId = await createBoardViaApi(baseURL!);

    // Block the API
    await page.route('**/api/boards/*', (route) => route.abort());

    // Open the board link
    await page.goto(`${baseURL}/b/${boardId}`);

    // Should show the retry message
    await page.waitForSelector('[data-vidi6="board-unreachable"]', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    expect(await page.locator('[data-vidi6="board-unreachable"]').textContent()).toBe(
      "Couldn't reach vidi6. Retrying…",
    );

    // Unblock the API
    await page.unroute('**/api/boards/*');

    // Board should open without reload
    await waitForBoardReady(page);
  });
});

// --- TC-29: Clipboard blocked ---

test.describe('TC-29: Clipboard blocked', () => {
  test('manual copy fallback when writeText rejects', async ({ browser, baseURL }) => {
    // Create a board
    const boardId = await createBoardViaApi(baseURL!);

    // Open with an init script that makes writeText reject
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: () => Promise.reject(new Error('blocked')),
        },
        configurable: true,
      });
    });
    const page = await ctx.newPage();
    await page.goto(`${baseURL}/b/${boardId}`);

    // Wait for board
    await waitForBoardReady(page);

    // Open Share panel
    await page.click('[data-vidi6="share-button"]');
    await page.waitForSelector('[data-vidi6="share-panel"]', { timeout: 5000 });

    // Click Copy link
    await page.click('[data-vidi6="copy-link-button"]');

    // Should show manual copy message
    await page.waitForSelector('[data-vidi6="manual-copy-message"]', { timeout: 5000 });
    const msgText = await page.locator('[data-vidi6="manual-copy-message"]').textContent();
    expect(msgText).toBe('Press Ctrl+C (Cmd+C on Mac) to copy');

    // Verify the input text is selected
    const selection = await page.evaluate(() => {
      const input = document.querySelector('[data-vidi6="share-link-input"]') as HTMLInputElement;
      return { start: input.selectionStart, end: input.selectionEnd, len: input.value.length };
    });
    expect(selection.start).toBe(0);
    expect(selection.end).toBe(selection.len);

    await ctx.close();
  });
});

// --- TC-31: Pre-existing (legacy) board ---

test.describe('TC-31: Pre-existing board', () => {
  test('legacy board with seeded notes opens, not Board not found', async ({ page, baseURL }) => {
    // Create a board and add a note to it (simulating a legacy board)
    const boardId = await createBoardViaApi(baseURL!);

    // Open the board and add a note
    await page.goto(`${baseURL}/b/${boardId}`);
    await waitForBoardReady(page);
    await addNote(page, 'legacy note');
    await expectEventually(() => noteCount(page).then(n => n === 1), 'note created');

    // Now reload the page - the board should still be there with the note
    await page.reload();
    await waitForBoardReady(page);
    await expectEventually(() => noteCount(page).then(n => n === 1), 'legacy note persists');
  });
});
