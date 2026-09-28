/**
 * Story 4 e2e (task 9): the broken-board recovery flow (TC-24).
 *
 * A board whose snapshot is corrupted fails to load (close 4500) → the client
 * shows the red "load failed" badge and locks editing. Once the storage is
 * repaired, a later successful sync re-enables editing without a page reload.
 *
 * The board is driven through the real client and the gated `__test` hooks
 * (corrupt-snapshot / repair-snapshot), which are only registered when
 * TEST_HOOKS=1 (the e2e wrangler config, never production).
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { startWranglerProcess, type ServerHandle } from './helpers/wrangler-process';
import { getNotes } from './helpers/board';
import { newBoardId } from 'src/shared/board-id';
import { LOAD_FAILED_MESSAGE } from 'src/client/sync/ConnectionStatus';

// Local workerd evicts an idle Durable Object after ~10 s; the corruption only
// affects storage, so we must let the live room be evicted before a fresh
// connection re-constructs it (and loads the corrupted snapshot).
const EVICTION_WAIT_MS = 12_000;

async function openBoard(browser: Browser, server: ServerHandle, boardId: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${server.url}/b/${boardId}`);
  await page.waitForFunction(() => (window as any).__vidi6?.doc != null, null, { timeout: 20000 });
  return { context, page };
}

async function seed(page: Page, count: number): Promise<void> {
  await page.waitForFunction(
    (n: number) => (window as any).__vidi6?.seedNotes?.(n).length === n,
    count,
    { timeout: 30000 },
  );
}

/** Call a gated test hook on the board (only enabled when TEST_HOOKS=1). */
async function hook(server: ServerHandle, boardId: string, op: string): Promise<any> {
  const res = await fetch(`${server.url}/__test/boards/${boardId}/${op}`, { method: 'POST' });
  return res.json();
}

/** Number of notes durably stored in the room (server-side, via inspect). */
async function roomNoteCount(server: ServerHandle, boardId: string): Promise<number> {
  const info = await hook(server, boardId, 'inspect');
  return info.notes?.length ?? 0;
}

test.describe('persist.client_status e2e', () => {
  test('TC-24: broken board → honest failure + edit lock → recovery without reload', async ({ browser }) => {
    const server = await startWranglerProcess();
    const boardId = newBoardId();
    try {
      // 1. Create a 25-note board, compact it, then corrupt the snapshot.
      const setup = await openBoard(browser, server, boardId);
      await seed(setup.page, 25);
      // Wait until the room has durably stored all 25 notes (server-side), not
      // just the client's local doc — the room must have them before we compact.
      await expect
        .poll(() => roomNoteCount(server, boardId), { timeout: 30000 })
        .toBe(25);
      await setup.context.close();

      const compact = await hook(server, boardId, 'force-compact');
      expect(compact.compacted).toBe(true);
      expect(compact.chunks).toBeGreaterThanOrEqual(1);
      const corrupt = await hook(server, boardId, 'corrupt-snapshot');
      expect(corrupt.ok).toBe(true);
      // Let the live room be evicted so the next connection loads the corrupted
      // snapshot from storage (the live instance still holds the good doc).
      await new Promise((r) => setTimeout(r, EVICTION_WAIT_MS));

      // 2. A fresh context cannot load the board: red badge, editing locked.
      const { context, page } = await openBoard(browser, server, boardId);
      await expect
        .poll(() => page.evaluate(() => (window as any).__vidi6?.connectionState), {
          timeout: 20000,
        })
        .toBe('load_failed');

      // The red badge with the load-failed message.
      const badge = page.getByTestId('connection-status');
      await expect
        .poll(async () => (await badge.textContent()) ?? '')
        .toContain(LOAD_FAILED_MESSAGE);

      // Editing is locked: dblclick and the (disabled) Sticky note button create
      // nothing.
      const viewport = page.getByTestId('board-viewport');
      const box = await viewport.boundingBox();
      await page.mouse.dblclick(box!.x + 100, box!.y + 100);
      await expect.poll(async () => getNotes(page).then((n) => n.length)).toBe(0);
      await expect(page.getByTestId('sticky-note-button')).toBeDisabled();

      // 3. Repair the storage; after the retry interval the board recovers
      // without a page reload.
      const repair = await hook(server, boardId, 'repair-snapshot');
      expect(repair.ok).toBe(true);
      await expect
        .poll(() => page.evaluate(() => (window as any).__vidi6?.connectionState), {
          timeout: 30000,
        })
        .toBe('connected');

      // The board is back with all 25 notes and the badge is gone.
      await expect
        .poll(async () => getNotes(page).then((n) => n.length), { timeout: 20000 })
        .toBe(25);
      await expect(page.getByTestId('connection-status')).toHaveCount(0);

      // Creating a note works again (no reload needed).
      await page.mouse.dblclick(box!.x + 100, box!.y + 200);
      await expect
        .poll(async () => getNotes(page).then((n) => n.length), { timeout: 20000 })
        .toBe(26);

      await context.close();
      await server.dispose();
    } finally {
      await server.dispose();
    }
  });
});
