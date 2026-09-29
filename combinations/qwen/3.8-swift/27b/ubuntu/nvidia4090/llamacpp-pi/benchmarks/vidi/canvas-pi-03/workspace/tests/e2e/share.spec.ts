/**
 * Story 5 e2e (task 7): the share workflows end-to-end — board API
 * (share.board_api), pages (share.pages) and the Share panel
 * (share.share_panel) working together in real browsers against `wrangler dev`.
 *
 * TC-26 create → share → join (chromium, clipboard permissions).
 * TC-27 bad link → Board not found → create fresh (chromium/firefox/webkit).
 * TC-28 flaky service on open → retry → recovers without reload.
 * TC-29 clipboard blocked → manual-copy fallback with the link selected.
 * TC-30 abuse guard: BOARD_CREATE_LIMIT + 1 → 429 message (dedicated server
 *      whose limit equals BOARD_CREATE_LIMIT exactly — wrangler.test.jsonc).
 * TC-31 pre-existing (legacy) board opens, not Board not found.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { newBoardId } from 'src/shared/board-id';
import { BOARD_CREATE_LIMIT, CREATE_BUDGET_MS } from 'src/shared/config';
import { startWranglerProcess, type ServerHandle } from './helpers/wrangler-process';
import { getNotes, createBoardIdForPage } from './helpers/board';

/** Open a created board and wait until the app is interactive. */
async function openCreatedBoard(page: Page, id: string) {
  await page.goto(`/b/${id}`);
  await page.waitForFunction(() => (window as any).__vidi6?.doc != null, null, { timeout: 15000 });
}

test.describe('share e2e', () => {
  test('TC-26: create, share, join — Sam opens the copied link and edits; Maya sees it', async ({ browser, browserName }) => {
    // On chromium the copy succeeds ("Link copied"); on firefox/webkit Playwright
    // cannot grant clipboard permissions, so the copy is blocked and the panel
    // falls back to the manual-copy message. The link is read from the panel's
    // field in both cases, so the join path is identical.
    const permissions =
      browserName === 'chromium' ? ['clipboard-read', 'clipboard-write'] : [];
    const mayaCtx = await browser.newContext({ permissions });
    const maya = await mayaCtx.newPage();
    const samCtx = await browser.newContext();
    const sam = await samCtx.newPage();

    try {
      // Create: home → Create a board → the board is visible (POST 201 +
      // the exists path), comfortably inside CREATE_BUDGET_MS for the request.
      await maya.goto('/');
      const t0 = Date.now();
      await maya.getByTestId('create-board-button').click();
      const viewport = maya.getByTestId('board-viewport');
      await expect(viewport).toBeVisible({ timeout: CREATE_BUDGET_MS + 5000 });
      expect(Date.now() - t0).toBeLessThan(CREATE_BUDGET_MS + 10000);

      // Add a note on Maya's board.
      const box = await viewport.boundingBox();
      await maya.mouse.dblclick(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await maya.keyboard.type('A');
      await maya.keyboard.press('Escape');
      let notes = await getNotes(maya);
      expect(notes).toHaveLength(1);

      // Share → Copy link → "Link copied"; the clipboard holds the full URL.
      await maya.getByTestId('share-button').click();
      await expect(maya.getByTestId('share-panel')).toBeVisible();
      await maya.getByTestId('copy-link-button').click();
      // The copy succeeds in all three browsers (headless firefox/webkit resolve
      // writeText without a granted permission), so the button shows "Link copied".
      await expect(maya.getByTestId('copy-link-button')).toHaveText(/Link copied/);
      // The link is shown in the panel's field regardless of the copy outcome;
      // read it from there so the test is browser-agnostic.
      const link = await maya.getByTestId('share-link-field').inputValue();
      expect(link).toContain('/b/');

      // Sam opens the exact clipboard text in a fresh context: same board,
      // sees the note, edits it.
      await sam.goto(link);
      await sam.waitForFunction(() => (window as any).__vidi6?.doc != null, null, { timeout: 15000 });
      await expect
        .poll(async () => (await getNotes(sam)).length, { timeout: 15000 })
        .toBe(1);
      const samNote = (await getNotes(sam))[0];
      const noteEl = sam.locator(`[data-note-id="${samNote.id}"]`);
      const nb = await noteEl.boundingBox();
      await sam.mouse.dblclick(nb!.x + nb!.width / 2, nb!.y + nb!.height / 2);
      await sam.keyboard.type('X');
      await sam.keyboard.press('Escape');

      // Maya sees Sam's edit (live sync over the shared link).
      await expect
        .poll(async () => (await getNotes(maya)).map((n) => n.text).join(','), { timeout: 15000 })
        .toBe('AX');
    } finally {
      await samCtx.close();
      await mayaCtx.close();
    }
  });

  test('TC-27: bad link → Board not found; Create a new board → fresh empty board', async ({ page }) => {
    const badId = newBoardId(); // never created
    await page.goto(`/b/${badId}`);
    await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();
    await expect(
      page.getByText('Check the link, or ask the person who shared it to send it again.'),
    ).toBeVisible();

    // Probing wrote nothing: the id is still 404 on the server.
    const res = await page.request.get(`/api/boards/${badId}`);
    expect(res.status()).toBe(404);

    // Create a new board from the page: a fresh EMPTY board mounts.
    await page.getByTestId('create-new-board-button').click();
    await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: 15000 });
    expect(await getNotes(page)).toHaveLength(0);
    // The bad id is STILL unknown (no board was created at the mistyped link).
    expect((await page.request.get(`/api/boards/${badId}`)).status()).toBe(404);
  });

  test('TC-28: flaky service on open → unreachable message → recovers without reload', async ({ page }) => {
    const id = await createBoardIdForPage(page);
    // Block the existence checks: the board page shows the unreachable state.
    await page.route('**/api/boards/*', (route) => route.abort());
    await page.goto(`/b/${id}`);
    await expect(page.getByTestId('unreachable-board')).toBeVisible();

    // Service recovers: the backoff retry opens the board (no reload).
    await page.unroute('**/api/boards/*');
    await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: 20000 });
  });

  test('TC-29: clipboard blocked → manual-copy message; the selected text is the full link', async ({ page }) => {
    const id = await createBoardIdForPage(page);
    await page.addInitScript(() => {
      // Block the Clipboard API before the app loads.
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: () => Promise.reject(new Error('blocked')),
          readText: () => Promise.reject(new Error('blocked')),
        },
        configurable: true,
      });
    });
    await openCreatedBoard(page, id);

    await page.getByTestId('share-button').click();
    await expect(page.getByTestId('share-panel')).toBeVisible();
    await page.getByTestId('copy-link-button').click();
    await expect(page.getByTestId('manual-copy-message')).toBeVisible();

    // The field's selection is the entire (full address) link.
    const field = page.getByTestId('share-link-field');
    const { value, selected } = await field.evaluate((el) => ({
      value: (el as HTMLInputElement).value,
      selected: (el as HTMLInputElement).value.slice(
        (el as HTMLInputElement).selectionStart,
        (el as HTMLInputElement).selectionEnd,
      ),
    }));
    expect(selected).toBe(value);
    expect(value).toBe(new URL(`/b/${id}`, page.url()).toString());
  });

  test('TC-30: abuse guard — the (LIMIT+1)th create in a window shows the rate-limit message', async ({ browser }) => {
    // Dedicated server whose limiter equals BOARD_CREATE_LIMIT exactly
    // (wrangler.test.jsonc), so the boundary is exact and no other spec's
    // creations share the window.
    const server = await startWranglerProcess(undefined, 'wrangler.test.jsonc');
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      // Consume the budget with fast direct API calls (same IP as the page,
      // absolute URL to the dedicated server) so all LIMIT creates land in one
      // window even on a slow browser; the (LIMIT+1)th is then the UI create.
      for (let i = 0; i < BOARD_CREATE_LIMIT; i++) {
        const res = await page.request.post(`${server.url}/api/boards`);
        expect(res.status()).toBe(201);
      }
      // The (LIMIT+1)th request in the window is 429 → rate-limit message.
      await page.goto(`${server.url}/`);
      await page.getByTestId('create-board-button').click();
      await expect(page.getByTestId('rate-limit-message')).toBeVisible();
      await expect(page.getByTestId('rate-limit-message')).toContainText(
        "You're creating boards too quickly. Wait a minute and try again.",
      );
      await context.close();
    } finally {
      await server.dispose();
    }
  });

  test('TC-31: pre-existing (legacy) board opens with its notes, not Board not found', async ({ browser }) => {
    const server = await startWranglerProcess();
    try {
      const boardId = newBoardId();
      // Seed a story-3-era board: updates rows, NO created_at (TEST_HOOKS op).
      const res = await fetch(`${server.url}/__test/boards/${boardId}/seed-legacy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 5 }),
      });
      const seeded = (await res.json()) as { ok: boolean; notes: number; createdAt: unknown };
      expect(seeded.ok).toBe(true);
      expect(seeded.notes).toBe(5);
      expect(seeded.createdAt).toBeNull();

      // The existence rule counts legacy boards as existing.
      expect((await fetch(`${server.url}/api/boards/${boardId}`)).status).toBe(200);

      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`${server.url}/b/${boardId}`);
      await page.waitForFunction(() => (window as any).__vidi6?.doc != null, null, { timeout: 20000 });
      // The doc exists as soon as the socket opens; the notes arrive with the
      // sync, so poll until the board has delivered all 5 seeded notes.
      await expect
        .poll(async () => (await getNotes(page)).length, { timeout: 20000 })
        .toBe(5);
      await context.close();
    } finally {
      await server.dispose();
    }
  });
});
