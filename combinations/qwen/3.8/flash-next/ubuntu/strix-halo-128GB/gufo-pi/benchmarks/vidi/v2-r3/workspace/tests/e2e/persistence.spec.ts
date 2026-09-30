/**
 * E2E persistence across real process restarts (TC-19 to TC-21).
 *
 * These run against a dedicated `wrangler dev --persist-to <dir>` (started per
 * test) so that killing the process genuinely drops in-memory state and the
 * board is reloaded from SQLite on the next start. Uses the TEST_HOOKS storage
 * endpoints for inspection/seeding. This spec relies on its own wrangler, not
 * the shared Playwright webServer.
 * Story 4: persist.room.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_LOAD_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS, PERSIST_TESTED_NOTES } from '../../src/shared/config';
import {
  startWrangler,
  cleanupPersistDir,
  testHook,
  type WranglerHandle,
} from './helpers/wrangler-process';

const PORT = 5411;

async function createBoardViaApi(handle: WranglerHandle): Promise<string> {
  const res = await fetch(`${handle.url}/api/boards`, { method: 'POST' });
  if (!res.ok) throw new Error(`POST /api/boards failed: ${res.status}`);
  const { id } = await res.json();
  return id;
}

async function openBoard(handle: WranglerHandle, context: BrowserContext, boardId?: string): Promise<Page> {
  const id = boardId ?? await createBoardViaApi(handle);
  const page = await context.newPage();
  await page.goto(`${handle.url}/b/${id}`);
  await page.waitForFunction(
    () => (window as any).__vidi6?.connectionState === 'connected',
    undefined,
    { timeout: 20000 },
  );
  return page;
}

async function getBoard(page: Page) {
  return page.evaluate(() => [...((window as any).__vidi6?.getBoard?.() ?? [])]);
}

async function addNote(
  page: Page,
  at: { x: number; y: number },
  text: string,
  color: string,
): Promise<string> {
  return page.evaluate(
    ({ at, text, color }) => (window as any).__vidi6!.addSticky!(at, text, color),
    { at, text, color },
  );
}

const COLORS = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

test.describe('Persistence across restarts', () => {
  let handle: WranglerHandle;

  test.afterEach(async () => {
    if (handle) {
      await handle.stop();
      cleanupPersistDir(handle.persistDir);
    }
  });

  // TC-19 "Overnight return": create 25 varied notes in the browser, close the
  // browser, kill and restart the process, reopen → identical board.
  test('TC-19: overnight return restores the board exactly', async ({ browser }) => {
    handle = await startWrangler(PORT);
    const boardId = await createBoardViaApi(handle);

    const ctx = await browser.newContext();
    const page = await openBoard(handle, ctx, boardId);

    for (let i = 0; i < 25; i++) {
      await addNote(
        page,
        { x: (i % 5) * 220 + 110, y: Math.floor(i / 5) * 220 + 110 },
        `Retro note ${i}: what we learned on day ${i}.`,
        COLORS[i % COLORS.length],
      );
    }

    await expect
      .poll(() => getBoard(page).then((b) => b.length), { timeout: 15000, intervals: [200] })
      .toBe(25);
    const before = await getBoard(page);
    expect(before.length).toBe(25);

    // Confirm the room has durably stored all notes before we kill it.
    await expect
      .poll(() => testHook(handle, boardId, 'rows').then((r) => r.freshDocNoteCount), {
        timeout: 15000,
        intervals: [250],
      })
      .toBe(25);

    // "Overnight": close the browser and fully kill the process.
    await ctx.close();
    await handle.stop();

    // Restart over the SAME storage directory.
    handle = await startWrangler(PORT, handle.persistDir);

    const ctx2 = await browser.newContext();
    const page2 = await openBoard(handle, ctx2, boardId);
    await expect
      .poll(() => getBoard(page2).then((b) => b.length), { timeout: 15000, intervals: [200] })
      .toBe(25);
    const after = await getBoard(page2);

    // Identical text, colour, position and stacking (z), sorted by (z, id).
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      expect(after[i].text).toBe(before[i].text);
      expect(after[i].color).toBe(before[i].color);
      expect(after[i].x).toBeCloseTo(before[i].x, 3);
      expect(after[i].y).toBeCloseTo(before[i].y, 3);
      expect(after[i].z).toBe(before[i].z);
    }

    await ctx2.close();
  });

  // TC-20 "Leave immediately": a note visible to a peer is durably stored;
  // even if both clients leave within 1s, it survives a restart.
  test('TC-20: a change a peer observed survives an immediate restart', async ({ browser }) => {
    handle = await startWrangler(PORT);
    const boardId = await createBoardViaApi(handle);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const alex = await openBoard(handle, ctxA, boardId);
    const sam = await openBoard(handle, ctxB, boardId);

    const noteId = await addNote(alex, { x: 120, y: 120 }, 'leave immediately', 'green');

    // Poll until Sam sees it (the append-before-broadcast guarantee).
    await expect
      .poll(() => getBoard(sam).then((b) => b.filter((n) => n.id === noteId).length), {
        timeout: 10000,
        intervals: [100],
      })
      .toBe(1);

    // Within 1s: both clients leave and the process is killed.
    await ctxA.close();
    await ctxB.close();
    await handle.stop();

    // Restart over the same storage.
    handle = await startWrangler(PORT, handle.persistDir);
    const ctx3 = await browser.newContext();
    const page3 = await openBoard(handle, ctx3, boardId);
    await expect
      .poll(() => getBoard(page3).then((b) => b.filter((n) => n.id === noteId).length), {
        timeout: 10000,
        intervals: [200],
      })
      .toBe(1);
    const note = (await getBoard(page3)).find((n) => n.id === noteId);
    expect(note.text).toBe('leave immediately');
    expect(note.color).toBe('green');

    await ctx3.close();
  });

  // TC-21 "Big board open": a large seeded board opens completely; open time is
  // reported against BOARD_LOAD_BUDGET_MS (never fails on timing).
  test('TC-21: a large board opens fully (open time reported, not asserted)', async ({ browser }) => {
    handle = await startWrangler(PORT);
    const boardId = await createBoardViaApi(handle);

    // Seed server-side (fast) so we do not drive thousands of browser actions.
    await testHook(handle, boardId, `seed?count=${PERSIST_TESTED_NOTES}`, 'POST');

    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    const navStart = Date.now();
    await page.goto(`${handle.url}/b/${boardId}`);
    // Wait until the Y.Doc carries every note (the room's load + sync path).
    await expect
      .poll(() => getBoard(page).then((b) => b.length), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
        intervals: [200],
      })
      .toBe(PERSIST_TESTED_NOTES);

    // Also wait until every note has a rendered element in the DOM.
    await page.waitForFunction(
      (expected) => document.querySelectorAll('[data-note-id]').length >= expected,
      PERSIST_TESTED_NOTES,
      { timeout: E2E_EVENTUAL_TIMEOUT_MS },
    );
    const elapsed = Date.now() - navStart;
    console.log(
      `[persist] big board (${PERSIST_TESTED_NOTES} notes) navigation→rendered: ${elapsed}ms ` +
        `(budget ${BOARD_LOAD_BUDGET_MS}ms — reported only)`,
    );

    const notes = await getBoard(page);
    expect(notes.length).toBe(PERSIST_TESTED_NOTES);
    const texts = new Set(notes.map((n) => n.text));
    expect(texts.size).toBeGreaterThanOrEqual(PERSIST_TESTED_NOTES - 1);

    await ctx.close();
  });
});
