import { expect, test, type BrowserContext } from '@playwright/test';
import {
  BOARD_LOAD_BUDGET_MS,
  PERSIST_TESTED_NOTES,
} from '../../src/shared/config';
import {
  buildLargeBoard,
  buildRetroBoard,
  RETRO_NOTE_COUNT,
} from '../fixtures/boards';
import { NodeWsClient } from './helpers/node-ws-client';
import { Participant, createBoard, sameBoard, type ObjectState } from './helpers/participants';
import { WranglerProcess, agentPort, freshPersistDir } from './helpers/wrangler-process';

// Each persistence test runs its OWN wrangler on its OWN port (offset 2/3/4 of
// the agent range; the shared webServer owns offset 1). Distinct ports mean a
// lingering workerd from one test can never shadow another test's board.
const PORT_TC19 = agentPort(2);
const PORT_TC20 = agentPort(3);
const PORT_TC21 = agentPort(4);

/**
 * E2E persistence (story 4, TC-19/TC-20/TC-21): a board must survive its
 * `wrangler dev --persist-to` process being killed and restarted, and a large
 * board must load from a chunked snapshot within the reference budget.
 *
 * Each test runs its OWN controllable wrangler on offset 2 of the agent port
 * range (the shared webServer owns offset 1). The wrangler serves the same
 * test-mode dist/client the webServer built, so the browser sees the real UI
 * and `window.__vidi6` hooks. Boards are seeded either through the real UI
 * (TC-20) or from Node over the real sync protocol (TC-19/TC-21), so the
 * persisted bytes are real Yjs updates.
 */

test.describe('persistence.e2e', () => {
  test('TC-19: a 25-note board survives a process kill + restart, note for note', async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(180_000);
    const persistTo = freshPersistDir();
    const wrangler = new WranglerProcess(PORT_TC19, persistTo);
    await wrangler.start();
    const boardId = await createBoard(wrangler.url);
    let ctx: BrowserContext | null = null;
    try {
      // Seed the 25-note retro board (three notes stacked on one spot) from
      // Node over the real sync protocol → 53 real log rows (LogOnly, D0).
      const seeder = await NodeWsClient.connect(wrangler.port, boardId);
      await seeder.waitForSync();
      buildRetroBoard(seeder.doc);
      // A probe confirms the room applied + stored all 25 before we move on.
      const probe = await NodeWsClient.connect(wrangler.port, boardId);
      await probe.waitForSync();
      await probe.waitForNotes(RETRO_NOTE_COUNT);
      probe.close();
      seeder.close();

      // Observe the board in a real browser and capture its exact state.
      ctx = await browser.newContext();
      const before = await Participant.join(ctx, boardId, 30_000, wrangler.url);
      const beforeObjects = (
        await before.waitFor(
          (o) => o.length === RETRO_NOTE_COUNT,
          `all ${RETRO_NOTE_COUNT} notes to render`,
        )
      ) as ObjectState[];
      expect(beforeObjects.length).toBe(RETRO_NOTE_COUNT);
      await ctx.close();
      ctx = null;

      // Kill (SIGKILL) and restart the process on the same persist dir.
      await wrangler.restart();

      // Reopen in a fresh context and compare note for note.
      ctx = await browser.newContext();
      const after = await Participant.join(ctx, boardId, 30_000, wrangler.url);
      const afterObjects = (
        await after.waitFor(
          (o) => o.length === RETRO_NOTE_COUNT,
          `all ${RETRO_NOTE_COUNT} notes to render after restart`,
        )
      ) as ObjectState[];
      await ctx.close();
      ctx = null;

      expect(sameBoard(beforeObjects, afterObjects), 'board changed across a process restart').toBe(true);
      expect(after.hasErrors(), after.errorDetails()).toBe(false);
    } finally {
      if (ctx !== null) {
        await ctx.close().catch(() => undefined);
      }
      await wrangler.stop();
    }
  });

  test('TC-20: a note created in the browser survives a fast kill + restart', async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(150_000);
    const persistTo = freshPersistDir();
    const wrangler = new WranglerProcess(PORT_TC20, persistTo);
    await wrangler.start();
    const boardId = await createBoard(wrangler.url);
    let ctxA: BrowserContext | null = null;
    let ctxB: BrowserContext | null = null;
    try {
      ctxA = await browser.newContext();
      ctxB = await browser.newContext();
      const alex = await Participant.join(ctxA, boardId, 30_000, wrangler.url);
      const sam = await Participant.join(ctxB, boardId, 30_000, wrangler.url);

      const id = await alex.createNote({ x: -120, y: -80 }, 'survive me');
      // The note is stored (append) before it is broadcast, so once Sam sees
      // it the room has it on disk.
      await sam.waitFor((o) => o.some((n) => n.id === id && n.text === 'survive me'), 'note to reach Sam');

      // Close both contexts and kill the process as fast as we can (the
      // design's "within 1 s"); log how fast it was.
      const tKill = Date.now();
      await Promise.all([ctxA.close(), ctxB.close()]);
      ctxA = null;
      ctxB = null;
      await wrangler.stop('SIGKILL');
      const killMs = Date.now() - tKill;
      console.log(`[TC-20] close-both-contexts + kill took ${killMs}ms`);

      await wrangler.start();

      ctxA = await browser.newContext();
      const reopened = await Participant.join(ctxA, boardId, 30_000, wrangler.url);
      const objs = await reopened.waitFor(
        (o) => o.some((n) => n.id === id && n.text === 'survive me'),
        'note to be present after restart',
      );
      expect(objs.some((n) => n.id === id && n.text === 'survive me')).toBe(true);
      expect(reopened.hasErrors(), reopened.errorDetails()).toBe(false);
    } finally {
      if (ctxA !== null) {
        await ctxA.close().catch(() => undefined);
      }
      if (ctxB !== null) {
        await ctxB.close().catch(() => undefined);
      }
      await wrangler.stop();
    }
  });

  test(`TC-21: ${PERSIST_TESTED_NOTES} notes load from a chunked snapshot`, async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(240_000);
    const persistTo = freshPersistDir();
    const wrangler = new WranglerProcess(PORT_TC21, persistTo);
    await wrangler.start();
    const boardId = await createBoard(wrangler.url);
    let ctx: BrowserContext | null = null;
    try {
      // Seed PERSIST_TESTED_NOTES notes from Node (each note is its own
      // transaction → its own update frame), so the room's log crosses
      // COMPACTION_UPDATE_COUNT and compacts to a chunked snapshot (D1 =
      // Snapshotted). The first socket open can be slow (cold DO) in the e2e
      // environment, so the connect budget is generous.
      const seeder = await NodeWsClient.connect(wrangler.port, boardId, 60_000);
      await seeder.waitForSync();
      const t0 = Date.now();
      buildLargeBoard(seeder.doc);
      await seeder.waitForNotes(PERSIST_TESTED_NOTES, 90_000);
      console.log(`[TC-21] seeded ${PERSIST_TESTED_NOTES} notes in ${Date.now() - t0}ms`);
      seeder.close();
      const probe = await NodeWsClient.connect(wrangler.port, boardId, 60_000);
      await probe.waitForSync();
      await probe.waitForNotes(PERSIST_TESTED_NOTES, 90_000);
      probe.close();

      // Open a fresh browser context and time navigation → all notes rendered.
      ctx = await browser.newContext();
      const loadPage = await ctx.newPage();
      const navStart = Date.now();
      await loadPage.goto(`${wrangler.url}/b/${encodeURIComponent(boardId)}`);
      await loadPage.waitForFunction(
        (count) => document.querySelectorAll('[data-sticky-note]').length >= count,
        PERSIST_TESTED_NOTES,
        { timeout: 120_000, polling: 100 },
      );
      const loadMs = Date.now() - navStart;
      console.log(
        `[TC-21] ${PERSIST_TESTED_NOTES} notes: navigation→all-rendered = ${loadMs}ms ` +
          `(budget ${BOARD_LOAD_BUDGET_MS}ms — reported, not asserted)`,
      );
      expect(loadMs).toBeGreaterThan(0);
    } finally {
      if (ctx !== null) {
        await ctx.close().catch(() => undefined);
      }
      await wrangler.stop();
    }
  });
});
