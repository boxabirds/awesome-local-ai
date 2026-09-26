import { test, expect } from '@playwright/test';
import { newBoardId, openBoard, closeAll } from '../participants';
import { WranglerProcess } from './wrangler-process';
import { buildBoardUpdates, notesKey, type ExpectedNote } from './boards';
import { seedBoard, getBoardNotes, waitForNoteCount, hook, waitStored } from './helpers';

/**
 * Story 4 e2e (TC-19..TC-21): persistence across REAL process restarts and a
 * large-board load budget. Each test owns its own `wrangler dev` process (own
 * --persist-to dir) and restarts it to prove the room reloads from SQLite.
 */

test.describe('Story 4 persistence (real wrangler restarts)', () => {
  test('TC-19: 25 varied notes survive a process restart', async ({ browser }) => {
    const wrangler = new WranglerProcess();
    await wrangler.start();
    const boardId = newBoardId();
    const { updates, notes: expected } = buildBoardUpdates(25, 20240601);
    try {
      // Seed the board through the real browser path.
      const p = await openBoard(browser, boardId);
      await seedBoard(p.page, updates);
      await waitForNoteCount(p.page, 25);
      // Durable before we tear anything down.
      await waitStored(wrangler.url, boardId, 1);
      const seeded = await getBoardNotes(p.page);
      await closeAll(p);

      // The process forgets its memory; storage remains.
      await wrangler.restart();

      // Reopen: the same 25 notes, field for field.
      const q = await openBoard(browser, boardId);
      await waitForNoteCount(q.page, 25);
      const reloaded = await getBoardNotes(q.page);
      expect(reloaded).toHaveLength(25);
      expect(notesKey(reloaded as ExpectedNote[])).toBe(notesKey(expected));
      expect(notesKey(reloaded as ExpectedNote[])).toBe(notesKey(seeded as ExpectedNote[]));
      await closeAll(q);
    } finally {
      await wrangler.stop();
    }
  });

  test('TC-20: a note is durable the moment a second client sees it', async ({ browser }) => {
    const wrangler = new WranglerProcess();
    await wrangler.start();
    const boardId = newBoardId();
    try {
      // Alex creates one note.
      const alex = await openBoard(browser, boardId);
      const before = (await getBoardNotes(alex.page)).length;
      await seedBoard(alex.page, buildBoardUpdates(1, 7).updates);
      await waitForNoteCount(alex.page, before + 1);
      const alexNotes = await getBoardNotes(alex.page);
      const noteId = alexNotes[alexNotes.length - 1].id;
      const noteText = alexNotes[alexNotes.length - 1].text;

      // Sam opens the same board and sees the note (write-before-broadcast:
      // by the time it is visible to Sam it is already stored).
      const sam = await openBoard(browser, boardId);
      await expect
        .poll(async () => (await getBoardNotes(sam.page)).some((n) => n.id === noteId), {
          timeout: 15_000,
          message: 'Sam sees Alex note',
        })
        .toBe(true);

      // Leave immediately and kill the process.
      await closeAll(alex, sam);
      await wrangler.restart();

      // Reopen: the note is there.
      const back = await openBoard(browser, boardId);
      const found = (await getBoardNotes(back.page)).find((n) => n.id === noteId);
      expect(found).toBeDefined();
      expect(found?.text).toBe(noteText);
      await closeAll(back);
    } finally {
      await wrangler.stop();
    }
  });

  test('TC-21: a 2000-note board opens within the load budget', async ({ browser }) => {
    const wrangler = new WranglerProcess();
    await wrangler.start();
    const boardId = newBoardId();
    const COUNT = 2000;
    const BUDGET_MS = 3000;
    try {
      // Seed the big board through the browser, then compact it to a snapshot.
      const p = await openBoard(browser, boardId);
      await seedBoard(p.page, buildBoardUpdates(COUNT, 0x5eed).updates);
      await waitForNoteCount(p.page, COUNT, 60_000);
      // The provider flushes the seeded updates to the server asynchronously;
      // wait until they are ALL durable before compacting and closing the
      // page (closing early would drop frames still in flight and the
      // snapshot would miss the notes).
      await expect
        .poll(
          async () => (await hook(wrangler.url, boardId, 'load-fresh')).json?.notes?.length ?? 0,
          { timeout: 60_000, message: `waiting for the server to store all ${COUNT} seeded notes` },
        )
        .toBe(COUNT);
      await hook(wrangler.url, boardId, 'store-compact', { force: true });
      await closeAll(p);

      // Forget memory; the fresh open must load from the compacted snapshot.
      await wrangler.restart();

      // Measure navigation-start -> all note elements rendered.
      const q = await browser.newContext();
      const page = await q.newPage();
      await page.goto(`/b/${boardId}`);
      const renderMs = await page.evaluate(
        (count) =>
          new Promise<number>((resolve) => {
            const deadline = performance.now() + 15_000;
            const check = () => {
              const n = document.querySelectorAll('[data-testid="sticky-note"]').length;
              if (n >= count) return resolve(performance.now());
              if (performance.now() > deadline) return resolve(-1);
              setTimeout(check, 20);
            };
            check();
          }),
        COUNT,
      );
      await q.close();
      // eslint-disable-next-line no-console
      console.log(`TC-21: ${COUNT} notes rendered in ${Math.round(renderMs)}ms (budget ${BUDGET_MS}ms)`);
      expect(renderMs).toBeGreaterThanOrEqual(0);
      expect(renderMs).toBeLessThanOrEqual(BUDGET_MS);
    } finally {
      await wrangler.stop();
    }
  });
});
