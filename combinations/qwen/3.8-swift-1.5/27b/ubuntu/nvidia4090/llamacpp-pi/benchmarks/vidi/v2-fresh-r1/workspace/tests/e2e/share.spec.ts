// E2E tests for story 5: Share a board with others using a link.
// TC-26 to TC-29, TC-31.

import { test, expect } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { CREATE_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import {
  openParticipant,
  joinBoard,
  closeParticipant,
  createNoteWithText,
  noteTexts,
  waitForNotes,
  type Participant,
} from './helpers/participants';

test.describe('story 5: share a board', () => {
  // TC-26: Create, share, join
  test('TC-26: Maya creates board, adds note, copies link; Sam joins and edits', async ({ browser }) => {
    test.setTimeout(60_000);
    // Grant clipboard permissions (Chromium supports them; Firefox does not).
    const ctxOptions: Record<string, unknown> = {};
    if (browser.browserType().name() === 'chromium') {
      ctxOptions.permissions = ['clipboard-read', 'clipboard-write'];
    }
    const mayaCtx = await browser.newContext(ctxOptions);
    const maya = await mayaCtx.newPage();

    // Maya goes to the home page.
    await maya.goto('/');
    await maya.getByTestId('home-page').waitFor();

    // Click New board and time it.
    const t0 = Date.now();
    await maya.getByTestId('new-board-button').click();
    await maya.getByTestId('app-root').waitFor();
    const createMs = Date.now() - t0;
    console.log(`[TC-26] Click-to-board time: ${createMs}ms (budget: ${CREATE_BUDGET_MS}ms)`);

    // Maya is on a board now.
    const boardId = await maya.evaluate(() => window.__vidi6?.getBoardId() ?? '');
    expect(boardId).toMatch(/^[A-Za-z0-9_-]{22}$/);

    // Maya adds a note.
    await createNoteWithText(maya, 'hello from Maya', 400, 300);
    await waitForNotes(maya, 1);

    // Maya clicks Share.
    await maya.getByTestId('share-button').click();
    await maya.getByTestId('share-dialog').waitFor();

    // Read the link from the input.
    const link = await maya.getByTestId('share-link-input').inputValue();
    expect(link).toBe(`/b/${boardId}`.replace('/b/', `${maya.url().replace(/\/b\/.*/, '')}/b/`));

    // Maya clicks Copy link.
    await maya.getByTestId('copy-link-button').click();
    await expect(maya.getByTestId('copy-link-button')).toHaveText('Link copied ✓');

    // Sam opens the link in a new context.
    const samCtx = await browser.newContext();
    const sam = await samCtx.newPage();
    await sam.goto(link);
    await sam.getByTestId('app-root').waitFor();

    // Sam sees Maya's note.
    await waitForNotes(sam, 1);
    const samTexts = await noteTexts(sam);
    expect(samTexts).toContain('hello from Maya');

    // Sam edits: adds a note.
    await createNoteWithText(sam, 'hi from Sam', 500, 400);
    await waitForNotes(sam, 2);

    // Maya sees Sam's note (wait for full text to sync).
    await expect
      .poll(async () => noteTexts(maya), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toContain('hi from Sam');

    await samCtx.close();
    await mayaCtx.close();
  });

  // TC-27: Bad link recovery
  test('TC-27: unknown board link shows Board not found; New board creates fresh board', async ({ page }) => {
    const unknownId = newBoardId();
    await page.goto(`/b/${unknownId}`);

    // Board not found page appears.
    await page.getByTestId('not-found-page').waitFor();
    expect(page.getByText('Board not found')).toBeVisible();
    expect(page.getByText('Check the link, or ask the person who shared it to send it again.')).toBeVisible();

    // Click New board → fresh empty board.
    await page.getByTestId('new-board-button').click();
    await page.getByTestId('app-root').waitFor();

    // We're on a new board (different id).
    const newId = await page.evaluate(() => window.__vidi6?.getBoardId() ?? '');
    expect(newId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newId).not.toBe(unknownId);

    // Board is empty.
    await expect(page.locator('[data-testid="sticky-note"]')).toHaveCount(0);
  });

  // TC-28: Flaky service on open
  test('TC-28: service unreachable then recovers → board opens without reload', async ({ page }) => {
    test.setTimeout(30_000);
    // Create a board first.
    const createRes = await page.request.post('/api/boards');
    expect(createRes.status()).toBe(201);
    const { id: boardId } = await createRes.json();

    // Block the API.
    await page.route('**/api/boards/*', (route) => route.abort());

    // Open the board link.
    await page.goto(`/b/${boardId}`);

    // Should show the retry message.
    await page.getByTestId('board-unreachable').waitFor();
    expect(page.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible();

    // Unblock the API.
    await page.unroute('**/api/boards/*');

    // Board opens without reload.
    await page.getByTestId('app-root').waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  });

  // TC-29: Clipboard blocked
  test('TC-29: clipboard writeText rejects → manual-copy message with full link selected', async ({ page }) => {
    // Create a board.
    const createRes = await page.request.post('/api/boards');
    expect(createRes.status()).toBe(201);
    const { id: boardId } = await createRes.json();

    // Stub writeText to reject before the page loads.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: () => Promise.reject(new Error('Permission denied')),
        },
        configurable: true,
      });
    });

    await page.goto(`/b/${boardId}`);
    await page.getByTestId('app-root').waitFor();

    // Open Share panel.
    await page.getByTestId('share-button').click();
    await page.getByTestId('share-dialog').waitFor();

    // Click Copy link.
    await page.getByTestId('copy-link-button').click();

    // Manual copy message appears.
    await expect(page.getByTestId('manual-copy-message')).toHaveText(
      'Press Ctrl+C (Cmd+C on Mac) to copy',
    );

    // The input has the full link selected.
    const input = page.getByTestId('share-link-input');
    const value = await input.inputValue();
    const selection = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="share-link-input"]') as HTMLInputElement;
      return { start: el.selectionStart, end: el.selectionEnd, len: el.value.length };
    });
    expect(selection.start).toBe(0);
    expect(selection.end).toBe(value.length);
  });

  // TC-31: Pre-existing (legacy) board
  test('TC-31: legacy board with seeded notes opens (not Board not found)', async ({ page }) => {
    test.setTimeout(30_000);
    const boardId = newBoardId();

    // Seed a legacy board via the test hook.
    const seedRes = await page.request.post(`/api/test/seed-legacy?id=${boardId}`, {
      headers: { 'x-test-hook': 'true' },
    });
    expect(seedRes.status()).toBe(200);

    // Open the board link.
    await page.goto(`/b/${boardId}`);
    await page.getByTestId('app-root').waitFor();

    // Board has the seeded note (not Board not found).
    await waitForNotes(page, 1);
    expect(page.getByTestId('not-found-page')).not.toBeVisible();
  });
});
