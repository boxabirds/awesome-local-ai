// tests/e2e/undo.spec.ts
// Story 8 e2e: per-client undo/redo through real browsers and the real sync
// provider. Requires `wrangler dev` running with the Durable Object (port 8787).
//
// Boards are created on-demand when the first client connects (the Durable
// Object initialises on the WebSocket handshake), then pre-populated with the
// test-only seed hook (POST /__test/boards/:id/seed?count=N) so every context
// starts from the same known state.

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

const BASE_URL = 'http://localhost:8787';

type APIRequest = import('@playwright/test').APIRequestContext;

async function navigateToBoard(page: Page, boardId: string): Promise<void> {
  await page.goto(`${BASE_URL}/b/${boardId}`);
  await page.waitForSelector('canvas', { timeout: 15000 });
}

async function noteCount(page: Page): Promise<number> {
  return page.locator('[data-testid="sticky-note"]').count();
}

async function waitForNotes(page: Page, count: number): Promise<void> {
  await expect.poll(() => noteCount(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(count);
}

async function seedBoard(request: APIRequest, boardId: string, count: number): Promise<void> {
  const res = await request.post(`${BASE_URL}/__test/boards/${boardId}/seed?count=${count}`);
  expect(res.status()).toBe(200);
}

// Create a board on-demand (first client connects), seed it, and return a
// handle for adding more contexts.
async function setupBoard(
  browser: import('@playwright/test').Browser,
  request: APIRequest,
  count: number,
): Promise<{ boardId: string; first: Page; firstCtx: BrowserContext; addContext: () => Promise<{ page: Page; ctx: BrowserContext }> }> {
  const boardId = newBoardId();
  const firstCtx = await browser.newContext();
  const first = await firstCtx.newPage();
  await navigateToBoard(first, boardId); // creates the board on-demand
  await seedBoard(request, boardId, count);
  await waitForNotes(first, count);

  return {
    boardId,
    first,
    firstCtx,
    addContext: async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await navigateToBoard(page, boardId);
      await waitForNotes(page, count);
      return { page, ctx };
    },
  };
}

test.describe('e2e.undo: recover my mistakes while colleagues work', () => {
  test.describe.configure({ mode: 'serial' });

  // TC-22: Recover an accidental delete
  test('TC-22: delete 8, colleague adds one, undo restores 8, redo re-deletes', async ({ browser, request }) => {
    const { first: mia, firstCtx: ctxA, addContext } = await setupBoard(browser, request, 8);
    const { page: raj, ctx: ctxB } = await addContext();

    try {
      // Mia deletes all 8 notes (select all + delete = one undo step)
      await mia.keyboard.press('Control+a');
      await mia.keyboard.press('Delete');
      await waitForNotes(mia, 0);
      await waitForNotes(raj, 0);

      // Raj adds a note (his own change, not in Mia's history)
      await raj.getByTestId('create-sticky-btn').click();
      await waitForNotes(mia, 1);
      await waitForNotes(raj, 1);

      // Mia undoes her delete → the 8 notes return, Raj's note remains
      await mia.keyboard.press('Control+z');
      await waitForNotes(mia, 9);
      await waitForNotes(raj, 9);

      // Mia clicks the Redo button → the 8 disappear again (Raj's note remains)
      await mia.getByRole('button', { name: 'Redo' }).click();
      await waitForNotes(mia, 1);
      await waitForNotes(raj, 1);

      // Undo once more (history: [delete]) → 8 return; now Mia's undo stack is
      // empty so the Undo button is disabled.
      await mia.keyboard.press('Control+z');
      await waitForNotes(mia, 9);
      await expect(mia.getByRole('button', { name: 'Undo' })).toBeDisabled();
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  // TC-23: Colleague deleted my object
  test('TC-23: peer deleted my moved note; undo does not throw, note stays gone', async ({ browser, request }) => {
    const { first: mia, firstCtx: ctxA, addContext } = await setupBoard(browser, request, 1);
    const { page: raj, ctx: ctxB } = await addContext();

    try {
      // Mia moves the note twice (two undo steps in her history)
      const note = mia.locator('[data-testid="sticky-note"]').first();
      await note.click();
      await mia.keyboard.press('ArrowRight');
      await mia.keyboard.press('ArrowRight');

      // Raj deletes the note
      const rajNote = raj.locator('[data-testid="sticky-note"]').first();
      await rajNote.click();
      await raj.keyboard.press('Delete');
      await waitForNotes(mia, 0);
      await waitForNotes(raj, 0);

      // Mia undoes: both of her moves target a now-deleted note → ineffective,
      // no error, note stays absent, and the second undo still works.
      const consoleErrors: string[] = [];
      mia.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      await mia.keyboard.press('Control+z');
      await mia.keyboard.press('Control+z');

      // Note is still absent on both screens
      expect(await noteCount(mia)).toBe(0);
      expect(await noteCount(raj)).toBe(0);

      // No console errors from the ineffective undos
      expect(consoleErrors).toHaveLength(0);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  // TC-24: Everyone undoing at once
  test('TC-24: per-client undo — one editor undoing leaves others’ changes intact', async ({ browser, request }) => {
    const n = MAX_CONCURRENT_EDITORS;
    // 2n notes: first n are moved, last n are typed into.
    const { first, firstCtx, addContext } = await setupBoard(browser, request, 2 * n);

    const contexts: BrowserContext[] = [firstCtx];
    const pages: Page[] = [first];
    for (let i = 1; i < n; i++) {
      const { page, ctx } = await addContext();
      contexts.push(ctx);
      pages.push(page);
    }

    try {
      // Each context i moves note i and types in note (n + i).
      for (let i = 0; i < n; i++) {
        const page = pages[i];
        // Move note i (0-based)
        await page.locator('[data-testid="sticky-note"]').nth(i).click();
        await page.keyboard.press('ArrowRight');
        // Type in note (n + i)
        await page.locator('[data-testid="sticky-note"]').nth(n + i).dblclick();
        const editor = page.getByTestId('sticky-text-editor');
        await editor.waitFor({ timeout: 5000 });
        await editor.fill(`typed-by-${i}`);
        await page.keyboard.press('Escape');
      }

      // Let everything sync
      for (const page of pages) {
        await page.waitForTimeout(300);
      }

      // Context 0 undoes twice: undoes its typing, then its move.
      await pages[0].keyboard.press('Control+z');
      await pages[0].keyboard.press('Control+z');

      // Context 0's typing (note n) is reverted
      await expect
        .poll(() => pages[0].locator('[data-testid="sticky-note"]').nth(n).textContent(), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .not.toContain('typed-by-0');

      // Context 1's typing (note n+1) is intact (not reverted by context 0's undo)
      await expect
        .poll(() => pages[1].locator('[data-testid="sticky-note"]').nth(n + 1).textContent(), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toContain('typed-by-1');

      // All boards identical: every context sees the same text in note n+1 and
      // the same absence of typed-by-0 in note n.
      for (const page of pages) {
        await expect(page.locator('[data-testid="sticky-note"]').nth(n + 1)).toContainText('typed-by-1');
        const noteN = await page.locator('[data-testid="sticky-note"]').nth(n).textContent();
        expect(noteN).not.toContain('typed-by-0');
      }
    } finally {
      for (const ctx of contexts) {
        await ctx.close();
      }
    }
  });
});
