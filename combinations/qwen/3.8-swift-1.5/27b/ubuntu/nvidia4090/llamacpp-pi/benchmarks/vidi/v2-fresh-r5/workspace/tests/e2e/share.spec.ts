/**
 * E2E share workflows (story 5):
 *
 * - TC-26 Create → Share → copy link → a second user opens the exact copied
 *   link and sees the same board; edits sync both ways.
 * - TC-27 A bad (unknown, well-formed) board link shows "Board not found"
 *   with a New board button that opens a fresh empty board.
 * - TC-28 The service is unreachable while opening a board: the retry
 *   message shows, the board opens when the service recovers, no reload.
 * - TC-29 Clipboard blocked: Copy link falls back to the manual-copy
 *   message; the selected input text is the full link.
 * - TC-31 A legacy board (updates rows, no created_at) opens with its
 *   content — it is not "Board not found".
 *
 * TC-31 runs its own wrangler process with TEST_HOOKS (port 20617) so it can
 * use the seed-legacy hook; the other cases use the shared e2e webServer.
 */
import { test, expect } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { CREATE_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { E2E_BASE_URL, createBoard } from './helpers/api';
import { Participant, expectEventually } from './helpers/participants';
import { startWranglerProcess } from './helpers/wrangler-process';

const LEGACY_PORT = 20617;
const HINT_TEXT = /Drag to move around/;

test.describe('story 5: share a board with a link', () => {
  test('TC-26: create, share, join — Sam opens the copied link and collabores', async ({ browser }) => {
    // Long multi-step flow (two browsers, create, share, join, edit): allow
    // more than the default 30 s.
    test.setTimeout(60_000);
    // Maya (with clipboard permissions).
    const mayaCtx = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const maya = await mayaCtx.newPage();
    const mayaP = new Participant('Maya', mayaCtx, maya);

    await maya.goto('/');
    // Click New board; the new board must open within the creation budget.
    const t0 = Date.now();
    await maya.getByRole('button', { name: 'New board' }).click();
    await expect(maya.getByText(HINT_TEXT)).toBeVisible({ timeout: 10000 });
    const createMs = Date.now() - t0;
    console.log(
      `[create] click-to-board: ${createMs}ms` +
        `${createMs > CREATE_BUDGET_MS ? ` (over ${CREATE_BUDGET_MS}ms budget — reported, not asserted)` : ''}`,
    );

    // Maya adds a note.
    await mayaP.createNote('MayaNote', 640, 400);

    // Share → Copy link.
    await maya.getByTestId('share-btn').click();
    const panel = maya.getByRole('dialog', { name: 'Share board' });
    await expect(panel).toBeVisible();
    await expect(maya.getByTestId('share-link-input')).toHaveValue(maya.url());
    await maya.getByTestId('copy-link-btn').click();
    await expect(maya.getByTestId('copy-link-btn')).toContainText('Link copied');

    // The clipboard holds exactly the current board URL.
    const copied = await maya.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(maya.url());
    expect(copied).toMatch(/^https?:\/\/[^/]+\/b\/[A-Za-z0-9_-]{22}$/);

    // Sam opens the copied link in a new context: same board, Maya's note.
    const samCtx = await browser.newContext();
    const sam = await samCtx.newPage();
    const samP = new Participant('Sam', samCtx, sam);
    await sam.goto(copied);
    await sam.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected');
    await expect(samP.note('MayaNote').first()).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Sam edits the note; Maya sees it (live sync both ways).
    await samP.startEditNote('MayaNote');
    await samP.page.getByTestId('sticky-textarea').press('End');
    await samP.page.keyboard.type(' +Sam');
    await samP.ensureNoEditing();
    await expectEventually('Maya sees Sam’s edit', async () =>
      (await mayaP.noteTexts()).some((t) => t.includes('MayaNote +Sam')),
    );

    // Sam sees Maya's board state too (her original note text, now edited).
    await expect(samP.note('MayaNote +Sam').first()).toBeVisible();

    await mayaCtx.close();
    await samCtx.close();
  });

  test('TC-27: bad link → Board not found → New board opens a fresh board', async ({ page }) => {
    const unknownId = newBoardId(); // well-formed, never created
    await page.goto(`/b/${unknownId}`);

    await expect(page.getByText('Board not found')).toBeVisible();
    await expect(
      page.getByText('Check the link, or ask the person who shared it to send it again.'),
    ).toBeVisible();

    // New board → a fresh empty board opens (not the unknown one).
    await page.getByRole('button', { name: 'New board' }).click();
    await expect(page.getByText(HINT_TEXT)).toBeVisible({ timeout: 10000 });
    expect(page.url()).not.toContain(unknownId);
  });

  test('TC-28: flaky service on open → retry message → board opens without reload', async ({ page }) => {
    const boardId = await createBoard(E2E_BASE_URL);

    // Block the existence check (and only it) while the board page loads.
    await page.route('**/api/boards/*', (route) => route.abort());
    await page.goto(`/b/${boardId}`);
    await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible({
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });

    // The service recovers: the board opens on the next retry (no reload).
    await page.unroute('**/api/boards/*');
    await expect(page.getByText(HINT_TEXT)).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
    expect(page.url()).toContain(`/b/${boardId}`);
  });

  test('TC-29: clipboard blocked → manual-copy message; selection is the full link', async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('clipboard blocked')) },
      });
    });
    const page = await ctx.newPage();
    const boardId = await createBoard(E2E_BASE_URL);
    await page.goto(`/b/${boardId}`);
    await expect(page.getByText(HINT_TEXT)).toBeVisible({ timeout: 10000 });

    await page.getByTestId('share-btn').click();
    await page.getByRole('dialog', { name: 'Share board' }).waitFor();
    await page.getByTestId('copy-link-btn').click();

    // The manual-copy message appears…
    await expect(page.getByTestId('manual-copy')).toHaveText(
      'Press Ctrl+C (Cmd+C on Mac) to copy',
    );
    // …and the input is fully selected: selection text == the full link.
    const sel = await page.getByTestId('share-link-input').evaluate((el) => {
      const input = el as HTMLInputElement;
      return {
        start: input.selectionStart,
        end: input.selectionEnd,
        value: input.value,
      };
    });
    expect(sel.value).toBe(page.url());
    expect(sel.start).toBe(0);
    expect(sel.end).toBe(sel.value.length);

    await ctx.close();
  });

  test('TC-31: legacy board (updates rows, no created_at) opens with its content', async ({ browser }) => {
    const wrangler = await startWranglerProcess(LEGACY_PORT, undefined, {
      config: 'wrangler.test-hooks.jsonc',
    });
    try {
      const boardId = newBoardId();
      // Seed a legacy board: real Yjs updates as rows, NO created_at.
      const res = await fetch(`http://127.0.0.1:${LEGACY_PORT}/__test/boards/${boardId}/seed-legacy`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { ok?: boolean }).ok).toBe(true);

      // The existence check agrees: the legacy board exists.
      const check = await fetch(`http://127.0.0.1:${LEGACY_PORT}/api/boards/${boardId}`);
      expect(check.status).toBe(200);

      // A fresh context opens it: the seeded note is visible, not "Board not found".
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`http://127.0.0.1:${LEGACY_PORT}/b/${boardId}`);
      await expect(page.getByText('Board not found')).toHaveCount(0);
      await expect(
        page.locator('[data-testid="sticky-text-display"]', { hasText: 'legacy note' }),
      ).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
      await ctx.close();
    } finally {
      await wrangler.stop();
    }
  });
});
