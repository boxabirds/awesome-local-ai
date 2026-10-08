import { expect, test, type BrowserContext } from '@playwright/test';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { applySpec } from '../fixtures/boards';
import { createBoard, sharedServerUrl } from './helpers/participants';
import { WranglerProcess, agentPort, freshPersistDir } from './helpers/wrangler-process';

/**
 * Story 5 e2e (design "E2E workflows"): TC-26 to TC-29 run against the
 * shared webServer (offset 1); TC-31 runs its OWN wrangler (offset 7,
 * TEST_HOOKS=1) because it needs the test-only legacy-seed hook.
 */

const NOT_FOUND_HEADING = 'Board not found';
const NOT_FOUND_TEXT = 'Check the link, or ask the person who shared it to send it again.';

/** Asserts the full "Board not found" page (heading, text, CTAs, no board UI). */
async function expectNotFoundPage(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.getByRole('heading', { name: NOT_FOUND_HEADING })).toBeVisible();
  await expect(page.getByText(NOT_FOUND_TEXT)).toBeVisible();
  await expect(page.getByRole('button', { name: 'New board' })).toBeVisible();
  await expect(page.getByTestId('back-home')).toBeVisible();
  // No board UI was rendered for a missing/malformed link.
  expect(await page.locator('[data-testid="board-viewport"]').count()).toBe(0);
}

test.describe('share.e2e', () => {
  test('TC-26: the home page creates a board and lands on its link; the link survives a reload', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByText('A shared board for thinking together')).toBeVisible();

    await page.getByRole('button', { name: 'New board' }).click();
    // The client navigates to /b/<22-char id> as soon as the 201 lands.
    await page.waitForURL(/\/b\/[A-Za-z0-9_-]{22}$/);

    // The link is copy-pasteable: a fresh load of the same URL renders the
    // same board (the Worker knows the id).
    await page.reload();
    await page.waitForSelector('[data-testid="board-viewport"]');
  });

  test('TC-27: an unknown id shows the "Board not found" page', async ({ page }) => {
    const unknownId = newBoardId(); // never created
    await page.goto(`/b/${encodeURIComponent(unknownId)}`);
    await expectNotFoundPage(page);
  });

  test('TC-28: a malformed id shows "Board not found" immediately', async ({ page }) => {
    await page.goto('/b/definitely-not-a-board-id');
    await expectNotFoundPage(page);
  });

  test('TC-29: the Share panel shows the exact link and the board stays usable', async ({
    page,
  }) => {
    const boardId = await createBoard(sharedServerUrl());
    await page.goto(`/b/${encodeURIComponent(boardId)}`);
    await page.waitForSelector('[data-testid="board-viewport"]');

    await page.getByRole('button', { name: 'Share' }).click();
    const dialog = page.getByRole('dialog', { name: 'Share board' });
    await expect(dialog).toBeVisible();

    // The field shows the exact board link (this page's origin + path).
    const origin = new URL(page.url()).origin;
    await expect(page.getByTestId('share-link-input')).toHaveValue(`${origin}/b/${boardId}`);
    await expect(page.getByTestId('share-note')).toHaveText(
      'Anyone with this link can view and edit this board.',
    );
    await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();

    // The board is still fully visible behind the panel…
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    // …and Escape closes the panel and returns to the board.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('board-viewport')).toBeVisible();
  });

  test('TC-31: a legacy board (log rows, no created_at) exists and opens', async ({ browser }, testInfo) => {
    testInfo.setTimeout(120_000);
    const persistTo = freshPersistDir();
    const wrangler = new WranglerProcess(agentPort(7), persistTo, { TEST_HOOKS: '1' });
    await wrangler.start();
    let ctx: BrowserContext | null = null;
    try {
      const boardId = newBoardId();
      // Seed one real Yjs note through the legacy hook: the board gets log
      // rows + schema version but NO created_at, i.e. the pre-story-5 shape.
      const doc = new Y.Doc();
      applySpec(doc, { x: 0, y: 0, text: 'legacy note', color: 'yellow' });
      const hex = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('hex');
      const seed = await fetch(
        `${wrangler.url}/__test/boards/${encodeURIComponent(boardId)}/seed-legacy`,
        { method: 'POST', body: hex },
      );
      expect(seed.status).toBe(200);
      await seed.body?.cancel();

      // The existence check sees the legacy board (via its updates rows).
      const check = await fetch(`${wrangler.url}/api/boards/${encodeURIComponent(boardId)}`);
      expect(check.status).toBe(200);
      await check.body?.cancel();

      // The board opens and syncs its legacy content in a real browser.
      ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`${wrangler.url}/b/${encodeURIComponent(boardId)}`);
      await page.waitForSelector('[data-testid="board-viewport"]');
      await page.waitForFunction(
        () => window.__vidi6?.connectionState === 'connected',
        undefined,
        { timeout: 30_000, polling: 100 },
      );
      expect(await page.locator('[data-sticky-note]').count()).toBe(1);
    } finally {
      if (ctx !== null) {
        await ctx.close().catch(() => undefined);
      }
      await wrangler.stop();
    }
  });
});
