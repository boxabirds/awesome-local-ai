// Story 5 E2E (tasks.md TC-26 to TC-31): the share-a-board-with-a-link
// workflows against wrangler dev with the real rate limiter and storage.
//   TC-26 create-share-join  TC-27 bad link recovery  TC-28 flaky service
//   TC-29 clipboard blocked  TC-30 abuse guard        TC-31 pre-existing board

import { expect, test } from '@playwright/test';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import {
  BOARD_CHECK_MAX_RETRIES,
  BOARD_CHECK_RETRY_BASE_MS,
  BOARD_CREATE_LIMIT,
  CREATE_BUDGET_MS,
} from '../../src/shared/config';
import { openBoard } from './helpers/board';
import { getNotes, type StickyNoteInfo } from './helpers/participants';
import { startWrangler } from './helpers/wrangler-process';

/** The board page's retry backoff sequence (ms), from the first retry on. */
const RETRY_DELAYS: number[] = Array.from({ length: BOARD_CHECK_MAX_RETRIES }, (_, i) =>
  Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** i, 5000),
);

/** Notes on the page matched by text, in board (z,id) order. */
async function texts(page: Parameters<typeof getNotes>[0]): Promise<string[]> {
  return (await getNotes(page)).map((n: StickyNoteInfo) => n.text);
}

test.describe('story 5: share a board with a link', () => {
  test('TC-26: create, share, join (chromium, clipboard)', async ({ browserName, context, page }) => {
    // Clipboard permissions are granted by the runner only for chromium.
    test.skip(browserName !== 'chromium', 'clipboard read-back is chromium-only');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // Maya creates a board from the home page.
    await page.goto('/');
    await page.getByTestId('create-board').click();
    await page.getByTestId('board-viewport').waitFor({ state: 'visible', timeout: CREATE_BUDGET_MS });
    expect(page.url()).toMatch(/\/b\/[A-Za-z0-9_-]{22}$/);
    const boardId = new URL(page.url()).pathname.split('/').pop()!;

    // Maya adds a note.
    const noteId = (await page.evaluate(() => window.__vidi6?.createSticky(0, 0))) as string;
    await page.evaluate(([nid]) => window.__vidi6?.setStickyText(nid, 'hello sam'), [noteId]);

    // Maya shares and copies the link.
    await page.getByTestId('share-button').click();
    await page.getByTestId('share-copy').click();
    await expect(page.getByTestId('share-copy')).toHaveText(/Link copied/);
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toBe(`${new URL(page.url()).origin}/b/${boardId}`);

    // Sam opens the shared link: same board, sees Maya's note.
    const sam = await context.newPage();
    await sam.goto(link);
    await sam.getByTestId('board-viewport').waitFor({ state: 'visible' });
    expect(await texts(sam)).toContain('hello sam');

    // Sam edits; Maya sees it (live sync through the shared board).
    const samNote = (await sam.evaluate(() => window.__vidi6?.createSticky(40, 40))) as string;
    await sam.evaluate(([nid]) => window.__vidi6?.setStickyText(nid, 'hi maya'), [samNote]);
    await expect.poll(() => texts(page)).toContain('hi maya');
    expect((await texts(page)).sort()).toEqual(['hello sam', 'hi maya']);
  });

  test('TC-27: bad link recovery @firefox @webkit', async ({ page }) => {
    // A never-created board link: 404s, retries exhaust, "Board not found".
    await page.clock.install();
    const id = newBoardId();
    await page.goto(`/b/${id}`);
    expect(await page.getByTestId('board-loading').textContent()).toContain('Opening board…');
    for (const delay of RETRY_DELAYS) {
      await page.clock.fastForward(delay);
      // Let the in-flight 404 fetch complete between timer jumps.
      await page.waitForTimeout(100);
    }
    // Catch-up: the first check completes in real time, so the nominal 27s
    // of backoff can drift a tick behind the faked clock.
    await page.clock.fastForward(20_000);
    await page.waitForTimeout(200);
    expect(await page.getByTestId('not-found-create').textContent()).toContain('Create a new board');

    // "Create a new board" reuses the create action -> a fresh empty board.
    await page.getByTestId('not-found-create').click();
    await page.getByTestId('board-viewport').waitFor({ state: 'visible' });
    const pathname = new URL(page.url()).pathname;
    expect(pathname).toMatch(/^\/b\/[A-Za-z0-9_-]{22}$/);
    expect(pathname).not.toContain(id);
    expect(await texts(page)).toEqual([]);
  });

  test('TC-28: flaky service on open: retry until it recovers, no reload', async ({ page }) => {
    const id = await openBoard(page);

    // Reopen the board with the board API unreachable: the page keeps
    // retrying ("Couldn't reach vidi6. Retrying…").
    await page.route('**/api/boards/*', (route) => route.abort());
    await page.goto(`/b/${id}`);
    await expect(page.getByTestId('board-loading')).toHaveText(/Couldn't reach vidi6\. Retrying/);

    // The service recovers: the board opens on the next retry, no reload.
    await page.unroute('**/api/boards/*');
    await page.getByTestId('board-viewport').waitFor({ state: 'visible' });
    expect(await texts(page)).toEqual([]);
  });

  test('TC-29: clipboard blocked -> manual-copy guidance + selection @firefox @webkit', async ({ page }) => {
    // Block the clipboard API before any page scripts run.
    await page.addInitScript(() => {
      if (navigator.clipboard) {
        Object.defineProperty(navigator.clipboard, 'writeText', {
          value: () => Promise.reject(new Error('blocked')),
          configurable: true,
        });
      }
    });

    const id = await openBoard(page);
    await page.getByTestId('share-button').click();
    await page.getByTestId('share-copy').click();

    await expect(page.getByTestId('share-manual-copy')).toHaveText(/Press Ctrl\+C/);

    // The link is fully selected for a manual Ctrl/Cmd+C.
    const selected = await page.evaluate(() => {
      const el = document.querySelector<HTMLInputElement>('input[data-testid="share-link"]');
      if (el === null) return { ok: false as const, full: false, value: '' };
      return {
        ok: true as const,
        full: el.selectionStart === 0 && el.selectionEnd === el.value.length,
        value: el.value,
      };
    });
    expect(selected.ok).toBe(true);
    expect(selected.full).toBe(true);
    expect(selected.value).toBe(`${new URL(page.url()).origin}/b/${id}`);
  });

  test('TC-30: abuse guard: the (BOARD_CREATE_LIMIT + 1)th creation is rate limited (429 path)', async ({ page }) => {
    // A dedicated instance so the per-IP limiter state is deterministic.
    const wrangler = await startWrangler(8792, { wipeBuildCache: false });
    try {
      await page.goto(`http://127.0.0.1:8792/`);
      const req = page.request;
      for (let i = 0; i < BOARD_CREATE_LIMIT; i++) {
        const res = await req.post('http://127.0.0.1:8792/api/boards');
        expect(res.status()).toBe(201);
      }
      // The next creation from the same visitor is 429 (server) and the UI
      // shows the exact rate-limit message.
      const limited = await req.post('http://127.0.0.1:8792/api/boards');
      expect(limited.status()).toBe(429);

      await page.getByTestId('create-board').click();
      await expect(page.getByTestId('create-error')).toHaveText(/You're creating boards too quickly/);
      expect(page.getByTestId('create-board')).toBeEnabled();
    } finally {
      await wrangler.stop();
    }
  });

  test('TC-31: pre-existing board (legacy schema) loads via its link', async ({ page }) => {
    const boardId = newBoardId();

    // Legacy shape: an objects map with one sticky note and NO meta (no
    // schemaVersion, no created_at) — the pre-story-5 layout.
    const legacy = new Y.Doc();
    const entry = new Y.Map();
    entry.set('type', 'sticky');
    entry.set('x', 100);
    entry.set('y', 100);
    entry.set('color', '#fde68a');
    entry.set('text', new Y.Text('hello legacy'));
    entry.set('z', 1);
    entry.set('createdAt', 1700000000000);
    legacy.getMap('objects').set('legacy-note-1', entry);
    const update = Buffer.from(Y.encodeStateAsUpdate(legacy)).toString('base64');

    // The hook expects JSON { updates: [base64, ...] } (story 4 shape).
    const seed = await page.request.post(`/_test/${boardId}/seed-legacy`, {
      data: { updates: [update] },
    });
    expect(seed.status()).toBe(200);

    // Opening the shared link mounts the board and the legacy content shows
    // (once the initial sync has delivered the seeded state).
    await page.goto(`/b/${boardId}`);
    await page.getByTestId('board-viewport').waitFor({ state: 'visible' });
    await expect.poll(() => texts(page)).toContain('hello legacy');
  });
});
