/**
 * Story 5 e2e: the share workflows (TC-26 to TC-29, TC-31) against
 * `wrangler dev` with the /__test hook routes enabled. Functional waits use
 * E2E_EVENTUAL_TIMEOUT_MS; wall-clock budgets are logged, never asserted.
 */
import { expect, test, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import {
  CREATE_BUDGET_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
} from '../../src/shared/config';
import { buildRetroBoard, type FixtureResult } from '../fixtures/boards';
import { apiCreateBoard, createNoteAt, noteCount, openBoard, setCamera, typeText } from './helpers';

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** A valid board id that was never created (for bad-link tests). */
function unknownBoardId(): string {
  return randomBytes(16).toString('base64url');
}

/** Wait until the board UI is interactive (connected + Share visible). */
async function waitBoardReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__vidi6?.connectionState === 'connected', undefined, {
    timeout: E2E_EVENTUAL_TIMEOUT_MS,
  });
  await page.getByRole('button', { name: 'Share' }).waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
}

test.describe('story 5: share workflows', () => {
  test('TC-26: create, share, join — the copied link opens the same board', async ({ browser }) => {
    // Clipboard permissions so the Copy link button uses the real API.
    const mayaCtx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const maya = await mayaCtx.newPage();
    const samCtx = await browser.newContext();
    const sam = await samCtx.newPage();
    try {
      // Maya starts from the home page and creates a board.
      await maya.goto('/');
      const t0 = Date.now();
      await maya.getByRole('button', { name: 'New board' }).click();
      await waitBoardReady(maya);
      const ms = Date.now() - t0;
      const within = ms <= CREATE_BUDGET_MS;
      // Reported, never asserted: budget is a UX target, not a contract.
      console.log(`[share] TC-26: click→board ${ms}ms (budget ${CREATE_BUDGET_MS}ms, ${within ? 'within' : 'over'})`);

      // Maya adds a note (fixed camera: world (0,0) at viewport centre).
      await setCamera(maya, -640, -400, 1);
      await createNoteAt(maya, 500, 300);
      await typeText(maya, 500, 300, 'meet me here');

      // Share → Copy link → "Link copied".
      await maya.getByRole('button', { name: 'Share' }).click();
      await expect(maya.getByRole('dialog', { name: 'Share board' })).toBeVisible();
      await maya.getByRole('button', { name: 'Copy link' }).click();
      await expect(maya.getByRole('button', { name: 'Link copied' })).toBeVisible();

      // Sam opens the copied link in a fresh context.
      const link = await maya.evaluate(() => navigator.clipboard.readText());
      await sam.goto(link);
      await waitBoardReady(sam);
      await setCamera(sam, -640, -400, 1);
      // Same board: Sam sees Maya's note.
      await expect.poll(() => noteCount(sam), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);
      await expect
        .poll(async () => (await sam.locator('.sticky-text').first().innerText()).trim(), {
          timeout: E2E_EVENTUAL_TIMEOUT_MS,
        })
        .toBe('meet me here');

      // Sam edits it; Maya sees the edit (same board, both directions).
      await typeText(sam, 500, 300, 'meet me HERE');
      await expect
        .poll(async () => (await maya.locator('.sticky-text').first().innerText()).trim(), {
          timeout: E2E_EVENTUAL_TIMEOUT_MS,
        })
        .toBe('meet me HERE');
    } finally {
      await mayaCtx.close();
      await samCtx.close();
    }
  });

  test('TC-27: bad link → Board not found → New board recovers', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto(`/b/${unknownBoardId()}`);
      await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();

      // Recovery: create a fresh board from the not-found page.
      await page.getByRole('button', { name: 'New board' }).click();
      await waitBoardReady(page);
      expect(await noteCount(page)).toBe(0);
    } finally {
      await ctx.close();
    }
  });

  test('TC-28: flaky service on open → retrying, then the board opens without reload', async ({
    browser,
    request,
  }) => {
    const boardId = await apiCreateBoard(request);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      // Count full document loads: the recovery must not reload the page.
      await page.addInitScript(() => {
        const k = 'vidi6-visit-count';
        window.localStorage.setItem(k, String(Number(window.localStorage.getItem(k) ?? '0') + 1));
      });

      // The existence check is aborted for the whole open attempt.
      await page.route('**/api/boards/*', (route) => route.abort());
      await page.goto(`/b/${boardId}`);
      await expect(page.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible();

      // Service recovers: the client's next retry lands and mounts the board.
      await page.unroute('**/api/boards/*');
      await waitBoardReady(page);

      // No full reload happened while waiting.
      expect(await page.evaluate(() => window.localStorage.getItem('vidi6-visit-count'))).toBe('1');
    } finally {
      await ctx.close();
    }
  });

  test('TC-29: clipboard blocked → manual-copy fallback with the full link selected', async ({
    browser,
    request,
  }) => {
    const boardId = await apiCreateBoard(request);
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
          readText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
        },
        configurable: true,
      });
    });
    const page = await ctx.newPage();
    try {
      await openBoard(page, boardId);
      await page.getByRole('button', { name: 'Share' }).click();
      await expect(page.getByRole('dialog', { name: 'Share board' })).toBeVisible();
      await page.getByRole('button', { name: 'Copy link' }).click();

      await expect(page.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeVisible();
      // The whole link is selected for a manual copy.
      const selected = await page.evaluate(() => window.getSelection()?.toString());
      const value = await page.getByLabel('Board link').inputValue();
      expect(selected).toBe(value);
      expect(value).toBe(new URL(page.url()).origin + `/b/${boardId}`);
    } finally {
      await ctx.close();
    }
  });

  test('TC-31: pre-existing (legacy) board opens with its seeded content', async ({ browser, request }) => {
    const boardId = unknownBoardId();
    // Seed through the TEST_HOOKS-only route: updates rows, no created_at —
    // the story 4-era shape that share.legacy_boards must keep working.
    const fixture: FixtureResult = buildRetroBoard();
    const res = await request.post(`/__test/boards/${boardId}/store-append-many`, {
      data: { updates: fixture.perNoteUpdates.map(toBase64) },
    });
    expect(res.status()).toBe(200);
    // The seed constructed the room with empty storage; force it to reload
    // from disk so the first real connection sees the seeded state.
    const reset = await request.post(`/__test/boards/${boardId}/room-reset`);
    expect(reset.status()).toBe(200);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto(`/b/${boardId}`);
      // It is the board — not "Board not found" — with all seeded notes.
      await expect(page.getByRole('heading', { name: 'Board not found' })).toHaveCount(0);
      await waitBoardReady(page);
      await expect.poll(() => noteCount(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(
        fixture.notes.length,
      );
    } finally {
      await ctx.close();
    }
  });
});
