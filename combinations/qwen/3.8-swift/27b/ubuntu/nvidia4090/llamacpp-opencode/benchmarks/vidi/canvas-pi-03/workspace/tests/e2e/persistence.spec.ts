/**
 * Story 4 e2e (task 6): persistence across real `wrangler dev` process
 * restarts and large-board load time.
 *
 * Each test owns a `wrangler dev --persist-to <tmp>` process (its own Playwright
 * project, no shared webServer) so it can be killed and restarted — the room
 * reloads from SQLite after "forgetting" memory.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { startWranglerProcess, type ServerHandle } from './helpers/wrangler-process';
import { getNotes } from './helpers/board';
import { newBoardId } from 'src/shared/board-id';
import { PERSIST_TESTED_NOTES, BOARD_LOAD_BUDGET_MS } from 'src/shared/config';

/** Call a gated test hook (enabled in the e2e wrangler config only). */
async function hook(server: ServerHandle, boardId: string, op: string): Promise<any> {
  const res = await fetch(`${server.url}/__test/boards/${boardId}/${op}`, { method: 'POST' });
  return res.json();
}

/** Number of notes durably stored in the room (server-side, via inspect). */
async function roomNoteCount(server: ServerHandle, boardId: string): Promise<number> {
  const info = await hook(server, boardId, 'inspect');
  return info.notes?.length ?? 0;
}

/** Open a fresh context on the board and wait until it is fully synced. */
async function openBoard(browser: Browser, server: ServerHandle, boardId: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  if (process.env.VIDI_DEBUG_E2E) {
    page.on('console', (msg) => console.log(`  [browser:${msg.type()}] ${msg.text().slice(0, 200)}`));
    page.on('requestfailed', (req) => console.log(`  [reqfailed] ${req.url()} :: ${req.failure()?.errorText}`));
    page.on('response', (res) => {
      if (res.status() >= 400) console.log(`  [http ${res.status()}] ${res.url()}`);
    });
  }
  await page.goto(`${server.url}/b/${boardId}`);
  await page.waitForFunction(() => (window as any).__vidi6?.doc != null, null, { timeout: 20000 });
  await page.waitForFunction(
    () => (window as any).__vidi6?.connectionState === 'connected',
    null,
    { timeout: 20000 },
  );
  return { context, page };
}

/** Seed `count` varied notes through the real board-model (test hook). */
async function seed(page: Page, count: number): Promise<void> {
  await page.waitForFunction(
    (n: number) => (window as any).__vidi6?.seedNotes?.(n).length === n,
    count,
    { timeout: 90000 },
  );
}

/** Restart the same process against the same persisted storage directory. */
async function restart(server: ServerHandle): Promise<ServerHandle> {
  const dir = server.persistDir;
  await server.stop();
  return startWranglerProcess(dir);
}

test.describe('persist.room e2e', () => {
  test('TC-19: overnight return — 25 notes survive a process restart', async ({ browser }) => {
    const server = await startWranglerProcess();
    const boardId = newBoardId();
    try {
      const { context, page } = await openBoard(browser, server, boardId);
      await seed(page, 25);
      // The room must durably store all 25 notes before we kill the process
      // (the client's local doc can be ahead of the room's storage).
      await expect
        .poll(() => roomNoteCount(server, boardId), { timeout: 30000 })
        .toBe(25);
      const before = (await getNotes(page)).sort((a, b) => a.id.localeCompare(b.id));
      await context.close();

      // Kill and restart the process (same storage).
      const server2 = await restart(server);
      const { context: ctx2, page: page2 } = await openBoard(browser, server2, boardId);
      const after = (await getNotes(page2)).sort((a, b) => a.id.localeCompare(b.id));
      await ctx2.close();

      expect(after).toHaveLength(25);
      // Identical in text, colour, position and stacking.
      for (let i = 0; i < 25; i++) {
        expect(after[i].id).toBe(before[i].id);
        expect(after[i].text).toBe(before[i].text);
        expect(after[i].color).toBe(before[i].color);
        expect(after[i].x).toBe(before[i].x);
        expect(after[i].y).toBe(before[i].y);
        expect(after[i].z).toBe(before[i].z);
      }
      await server2.dispose();
    } finally {
      await server.dispose();
    }
  });

  test('TC-20: leave immediately — append-before-broadcast survives a fast kill', async ({ browser }) => {
    const server = await startWranglerProcess();
    const boardId = newBoardId();
    try {
      // Alex creates a note (and the room stores it before Sam joins).
      const alex = await openBoard(browser, server, boardId);
      await seed(alex.page, 1);
      const note = (await getNotes(alex.page))[0];
      await expect
        .poll(() => roomNoteCount(server, boardId), { timeout: 20000 })
        .toBe(1);

      // Sam polls until the note is visible to them.
      const sam = await openBoard(browser, server, boardId);
      await expect
        .poll(async () => (await getNotes(sam.page)).some((n) => n.id === note.id), {
          timeout: 20000,
        })
        .toBe(true);

      // Within 1s, close both contexts and kill the process.
      const t0 = Date.now();
      await alex.context.close();
      await sam.context.close();
      const killAt = Date.now() - t0;
      expect(killAt).toBeLessThan(1000);

      const server2 = await restart(server);
      const { context, page } = await openBoard(browser, server2, boardId);
      const reopened = await getNotes(page);
      expect(reopened.some((n) => n.id === note.id)).toBe(true);
      await context.close();
      await server2.dispose();
    } catch (err) {
      if (process.env.VIDI_DEBUG_E2E) {
        console.log('=== SERVER OUTPUT (TC-20) ===\n' + server.getOutput().slice(-4000));
      }
      throw err;
    } finally {
      await server.dispose();
    }
  });

  test('TC-21: big board opens within the load budget', async ({ browser }) => {
    const server = await startWranglerProcess();
    const boardId = newBoardId();
    try {
      // Seed the large board through the client (triggers compaction server-side).
      const seedCtx = await openBoard(browser, server, boardId);
      await seed(seedCtx.page, PERSIST_TESTED_NOTES);
      await expect
        .poll(async () => getNotes(seedCtx.page).then((n) => n.length), { timeout: 60000 })
        .toBe(PERSIST_TESTED_NOTES);
      await seedCtx.context.close();

      // A fresh context: measure navigation start → all notes rendered.
      const { context, page } = await openBoard(browser, server, boardId);
      const t0 = Date.now();
      await expect
        .poll(async () => getNotes(page).then((n) => n.length), { timeout: 15000 })
        .toBe(PERSIST_TESTED_NOTES);
      const loadMs = Date.now() - t0;
      console.log(`TC-21 large-board load: ${loadMs}ms (budget ${BOARD_LOAD_BUDGET_MS}ms)`);
      expect(loadMs).toBeLessThanOrEqual(BOARD_LOAD_BUDGET_MS);
      await context.close();
      await server.dispose();
    } finally {
      await server.dispose();
    }
  });
});
