// Story 4 e2e (TC-24): a broken board fails honestly, locks editing, and
// recovers without a page reload.
//
// Runs against `wrangler dev` with TEST_HOOKS=1 (see playwright.config.ts),
// which exposes the /__test board-maintenance routes. Workflow follows the
// design's "Broken board" test:
//   1. create a 25-note board, compact it, corrupt its snapshot;
//   2. a fresh context sees the red "couldn't be loaded" badge and cannot edit;
//   3. repair the snapshot; after the retry interval the board syncs back and
//      editing re-enables — on the same page, with no reload.

import { expect, test, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { homeViewReady } from './helpers/board';
import { createNote, noteCount } from './helpers/participants';

const BADGE = '[data-testid="connection-status"]';
const STICKY_TEXT = "This board couldn't be loaded. Retrying…";

/** POST to a test hook (only present when the dev server sets TEST_HOOKS=1). */
async function hook(page: Page, boardId: string, action: string): Promise<void> {
  const res = await page.request.post(`/__test/boards/${boardId}/${action}`);
  expect(res.ok(), `hook /__test/boards/:id/${action} should succeed`).toBe(true);
}

/** The mapped connection state via the test hook. */
async function state(page: Page): Promise<string> {
  return page.evaluate(() => window.__vidi6?.connectionState ?? 'none');
}

/** Create `n` notes through the real UI (toolbar button + commit). */
async function seedNotes(page: Page, n: number): Promise<void> {
  for (let i = 1; i <= n; i++) {
    await createNote(page);
    await page.locator('[data-testid="sticky-editor"] textarea').fill(`Note ${i}`);
    // Commit: a pointerdown on empty canvas (left edge) ends editing.
    await page.mouse.click(10, 400);
  }
  await expect.poll(() => noteCount(page), { timeout: 20_000, message: `${n} notes rendered` }).toBe(n);
}

test.describe('Broken board (TC-24)', () => {
  test('fails honestly, locks editing, and recovers without a reload', async ({ browser }) => {
    test.setTimeout(120_000);
    const boardId = newBoardId();

    // ---- 1. Create a 25-note board, compact it, corrupt its snapshot. ----
    const setup = await browser.newContext();
    const setupPage = await setup.newPage();
    setupPage.setDefaultTimeout(30_000);
    await setupPage.goto(`/b/${boardId}`);
    await setupPage.waitForFunction(() => window.__vidi6?.connectionState === 'connected', { timeout: 30_000 });
    await homeViewReady(setupPage);
    await seedNotes(setupPage, 25);

    // Compact so a snapshot exists, corrupt chunk 0, then force the room to
    // re-read storage (simulating eviction) so it comes up LoadFailed.
    await hook(setupPage, boardId, 'compact');
    await hook(setupPage, boardId, 'corrupt-snapshot');
    await hook(setupPage, boardId, 'reconstruct');
    await setup.close();

    // ---- 2. A fresh context sees an honest, non-editable failure. ----
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.setDefaultTimeout(30_000);
    const url = `/b/${boardId}`;
    await page.goto(url);
    await page.waitForFunction(() => window.__vidi6?.connectionState === 'load_failed', { timeout: 30_000 });

    const badge = page.locator(BADGE);
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(STICKY_TEXT);
    await expect(badge).toHaveClass(/connection-badge--load_failed/);

    // Nothing is served from the unreadable board.
    await expect.poll(() => noteCount(page)).toBe(0);

    // The Sticky note button is disabled and a double-click creates nothing.
    const sticky = page.getByRole('button', { name: 'Sticky note' });
    await expect(sticky).toBeDisabled();
    await page.mouse.dblclick(640, 400);
    await expect.poll(() => noteCount(page)).toBe(0);

    // ---- 3. Repair; after the retry interval the board recovers in place. ----
    await hook(page, boardId, 'repair');

    // The provider keeps reconnecting; the room reloads once the retry
    // interval has passed and the snapshot is whole again.
    await expect.poll(
      async () => (await state(page)) === 'connected' && (await noteCount(page)) === 25,
      { timeout: 20_000, message: 'board reconnects with its 25 notes' },
    ).toBe(true);

    // The badge is gone and editing is back — on the same page, no reload
    // (same page/context, same URL; we never called page.reload()).
    await expect(badge).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/b/${boardId}$`));

    await createNote(page);
    await page.mouse.click(10, 400);
    await expect.poll(() => noteCount(page), { timeout: 10_000, message: 'new note after recovery' }).toBe(26);

    await ctx.close();
  });
});
