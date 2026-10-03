import { test, expect, type Page } from '@playwright/test';
import { openBoardPath, getNotesState } from './helpers/board';
import { newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';
import { makeSingleNoteUpdate } from '../fixtures/boards';

/**
 * Story 5 — share a board with a link (e2e, real browser + real worker).
 *
 * Covers: create a board (home → New board → /b/<id>), the board URL contract,
 * opening a link in a fresh context, the not-found page (unknown + malformed
 * ids), the Share panel (open/close, link field, note), copying the link
 * (clipboard + "Link copied" revert), a legacy board opening, and the
 * unreachable → retry → ready path.
 */

/** Grants clipboard permissions for a page's context (idempotent). */
async function grantClipboard(page: Page): Promise<void> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
}

/** The board viewport testid is only present once the board is ready. */
async function waitForBoardReady(page: Page): Promise<void> {
  await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: 15000 });
}

/** Base64-encode a Uint8Array (for the seed-board test hook). */
function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

test.describe('share.e2e (@playwright/test, chromium)', () => {
  test('TC-22/TC-01/TC-03: home → New board → empty editable board at /b/<22-char id>', async ({
    page,
  }) => {
    await page.goto('/');
    // Home page
    await expect(page.getByTestId('home-page')).toBeVisible();
    const newBoard = page.getByTestId('new-board-button');
    await expect(newBoard).toBeVisible();
    await expect(newBoard).toHaveText('New board');

    // Click → board created and opened
    await newBoard.click();

    // URL is /b/<id> with a 22-char base32 id (path only — no hash, no query)
    // Board ids are 22 base64url chars (A-Za-z0-9_-), per BOARD_ID_PATTERN.
    await page.waitForURL(/\/b\/[A-Za-z0-9_-]{22}$/, { timeout: 15000 });
    const url = new URL(page.url());
    expect(url.pathname).toMatch(/^\/b\/[A-Za-z0-9_-]{22}$/);
    // The id portion (after `/b/`) must be a valid board id.
    expect(url.pathname.replace(/^\/b\//, '')).toMatch(BOARD_ID_PATTERN);
    expect(url.hash).toBe('');
    expect(url.search).toBe('');

    // Board is ready, empty, and fully editable (no sign-in)
    await waitForBoardReady(page);
    await expect(page.getByTestId('toolbar')).toBeVisible();
    await expect(page.getByTestId('share-button')).toBeVisible();
    const notes = await getNotesState(page);
    expect(notes).toHaveLength(0);
  });

  test('TC-13: a copied link opens the board in a fresh context', async ({ page, browser }) => {
    // Create a board and add a note so the board is recognisably non-empty.
    const boardId = await openBoardPath(page.context().request, page);
    await waitForBoardReady(page);
    await page.evaluate((n) => (window as any).__vidi6.createNotes(n), 3);
    await expect
      .poll(async () => (await getNotesState(page)).length, { timeout: 10000 })
      .toBe(3);

    // A fresh context opens the same link → the same board.
    const ctx = await browser.newContext();
    const fresh = await ctx.newPage();
    await fresh.goto(`/b/${boardId}`);
    await waitForBoardReady(fresh);
    await expect
      .poll(async () => (await getNotesState(fresh)).length, { timeout: 10000 })
      .toBe(3);
    await ctx.close();
  });

  test('TC-14: an unknown (valid-format) id shows "Board not found"; nothing is created', async ({
    page,
  }) => {
    // A well-formed id that was never created.
    const unknownId = newBoardId();
    await page.goto(`/b/${unknownId}`);
    await expect(page.getByTestId('not-found-page')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Board not found')).toBeVisible();
    // The board UI is not mounted.
    await expect(page.getByTestId('board-viewport')).not.toBeVisible();
  });

  test('TC-14 (malformed): a malformed id shows "Board not found" with no existence request', async ({
    page,
  }) => {
    let checksSeen = 0;
    await page.route('**/api/boards/**', (route) => {
      if (route.request().method() === 'GET') checksSeen++;
      return route.continue();
    });

    // 21 chars — valid charset, wrong length → malformed.
    await page.goto(`/b/${'a'.repeat(21)}`);
    await expect(page.getByTestId('not-found-page')).toBeVisible({ timeout: 15000 });
    // Malformed ids are rejected client-side: no existence request is sent.
    expect(checksSeen).toBe(0);
  });

  test('TC-17: Share panel opens (dialog, link field, note) and closes on Escape / outside click', async ({
    page,
  }) => {
    const boardId = await openBoardPath(page.context().request, page);
    await waitForBoardReady(page);

    const shareBtn = page.getByTestId('share-button');
    await shareBtn.click();

    const panel = page.getByTestId('share-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('role', 'dialog');
    await expect(panel).toHaveAttribute('aria-label', 'Share board');

    // Link field shows the full link.
    const linkInput = page.getByTestId('share-link-input');
    await expect(linkInput).toBeVisible();
    await expect(linkInput).toHaveValue(`${page.url().split('/b/')[0]}/b/${boardId}`);

    // The note is present.
    await expect(
      page.getByText('Anyone with this link can view and edit this board.'),
    ).toBeVisible();

    // Copy button present.
    await expect(page.getByTestId('copy-link-button')).toBeVisible();

    // Escape closes.
    await page.keyboard.press('Escape');
    await expect(panel).not.toBeVisible();

    // Reopen, then close on outside click.
    await shareBtn.click();
    await expect(panel).toBeVisible();
    await page.mouse.click(10, 400); // well outside the panel (top-right)
    await expect(panel).not.toBeVisible();
  });

  test('TC-16: Copy link writes the full link to the clipboard and shows "Link copied" for 2s', async ({
    page,
  }) => {
    await grantClipboard(page);
    const boardId = await openBoardPath(page.context().request, page);
    await waitForBoardReady(page);

    const shareBtn = page.getByTestId('share-button');
    await shareBtn.click();
    const panel = page.getByTestId('share-panel');
    await expect(panel).toBeVisible();

    const copyBtn = page.getByTestId('copy-link-button');
    await copyBtn.click();

    // Clipboard contains the full link.
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(`${page.url().split('/b/')[0]}/b/${boardId}`);

    // "Link copied" is shown, then reverts to "Copy link" after ~2s.
    await expect(copyBtn).toHaveText(/Link copied/);
    await expect(copyBtn).toHaveText(/Copy link/, { timeout: 5000 });
  });

  test('TC-31: a legacy board (updates rows, no created_at) opens and renders', async ({ page }) => {
    // A valid id with only `updates` rows seeded (no created_at) — a pre-story-5
    // board. The existence check must still report it as existing.
    const legacyId = newBoardId();
    const { update } = makeSingleNoteUpdate();
    const seed = await page.context().request.post(`/__test/seed-board/${legacyId}`, {
      data: { updates: [toBase64(update)] },
    });
    expect(seed.status()).toBe(200);

    await page.goto(`/b/${legacyId}`);
    await waitForBoardReady(page);
    await expect
      .poll(async () => (await getNotesState(page)).length, { timeout: 10000 })
      .toBe(1);
  });

  test('TC-19/20/21: unreachable → "Retrying…" → board opens when the server recovers', async ({
    page,
  }) => {
    const req = page.context().request;
    const createRes = await req.post('/api/boards');
    expect(createRes.status()).toBe(201);
    const { id } = (await createRes.json()) as { id: string };

    // Fail the first two existence checks, then let them through.
    let checks = 0;
    await page.route(`**/api/boards/${id}`, (route) => {
      if (route.request().method() === 'GET' && checks < 2) {
        checks++;
        return route.fulfill({ status: 503, body: 'unreachable' });
      }
      return route.continue();
    });

    await page.goto(`/b/${id}`);

    // The unreachable state is shown while retrying.
    await expect(page.getByTestId('board-unreachable')).toBeVisible({ timeout: 15000 });

    // After the backoff retries, the board opens (later checks succeed).
    await waitForBoardReady(page);
    await expect(page.getByTestId('board-unreachable')).not.toBeVisible();
  });
});
