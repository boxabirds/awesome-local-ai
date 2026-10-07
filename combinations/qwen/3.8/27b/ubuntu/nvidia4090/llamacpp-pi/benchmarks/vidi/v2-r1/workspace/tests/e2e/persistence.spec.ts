// E2E (story 4, task 6): persistence across real process restarts and
// large-board load time (TC-19 to TC-21).
//
// Runs against a real `wrangler dev` process (wrangler-process.ts) with
// `--persist-to` durable SQLite — NOT the Vite dev server relay — so the
// restarts genuinely forget the in-memory rooms. Its own Playwright config
// (playwright.persistence.config.ts) has no shared webServer.

import { test, expect } from '@playwright/test';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { snapshot } from '../../src/shared/board-model';
import { BOARD_LOAD_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS, PERSIST_TESTED_NOTES, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { createRetroBoard, generateLargeBoardUpdate } from '../fixtures/boards';
import { createWranglerProcess, testHook } from './wrangler-process';

type NoteSpec = { x: number; y: number; color: string; text: string; z: number };

/**
 * The 25 varied notes of the "overnight" board, generated with the same
 * deterministic fixture the unit/integration suites use and read back as a
 * comparable spec (top-left coords, colour, text, stacking).
 */
function retroSpec(): NoteSpec[] {
  const doc = new Y.Doc();
  createRetroBoard(doc, 7);
  const spec: NoteSpec[] = snapshot(doc).map((n) => ({
    x: n.x,
    y: n.y,
    color: n.color,
    text: n.text,
    z: n.z,
  }));
  doc.destroy();
  return spec;
}

const STICKY_COUNT_SELECTOR = '[data-testid="sticky-note"]';

/** Wait until the page's test hooks are installed. */
async function waitForHooks(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => (window as { __vidi6?: unknown }).__vidi6 !== undefined, null, {
    timeout: 15_000,
  });
}

/** Create a board through the story 5 API and return its id. */
async function createBoard(base: string): Promise<string> {
  const res = await fetch(`${base}/api/boards`, { method: 'POST' });
  if (res.status !== 201) throw new Error(`board creation failed: ${res.status}`);
  const body = (await res.json()) as { id: string };
  return body.id;
}

test.describe('persistence across process restarts', () => {
  test('TC-19: overnight return — 25 varied notes survive a kill and restart', async ({ browser }) => {
    const wrangler = await createWranglerProcess();
    try {
      await wrangler.start();
      // Story 5: the board must exist before its link opens.
      const boardId = await createBoard(wrangler.base);
      const spec = retroSpec();
      expect(spec).toHaveLength(25);

      // --- evening: create the board in the browser, then leave ---
      const ctx1 = await browser.newContext();
      const page1 = await ctx1.newPage();
      await page1.goto(`/b/${boardId}`);
      await waitForHooks(page1);
      await page1.evaluate(
        ([specs, offset]) => {
          const hooks = (window as { __vidi6: { createNoteAt: (x: number, y: number, c: string, t: string) => string | null } }).__vidi6;
          for (const n of specs) {
            // createNoteAt centres on the given point; the spec holds top-left.
            const id = hooks.createNoteAt(n.x + offset, n.y + offset, n.color, n.text);
            if (id === null) throw new Error('note creation failed');
          }
        },
        [spec, STICKY_SIZE_WORLD / 2] as [NoteSpec[], number],
      );
      await page1.waitForFunction(
        ([sel, count]) => document.querySelectorAll(sel as string).length === count,
        [STICKY_COUNT_SELECTOR, 25],
        { timeout: E2E_EVENTUAL_TIMEOUT_MS },
      );
      // Let the updates be delivered to the room and stored, then leave.
      await page1.waitForTimeout(1000);
      await ctx1.close();

      // --- the process is killed (no graceful flush) and restarted ---
      await wrangler.stop();
      await wrangler.start();

      // --- morning: reopen; everything must be as left ---
      const ctx2 = await browser.newContext();
      const page2 = await ctx2.newPage();
      await page2.goto(`/b/${boardId}`);
      await waitForHooks(page2);
      await page2.waitForFunction(
        ([sel, count]) => document.querySelectorAll(sel as string).length === count,
        [STICKY_COUNT_SELECTOR, 25],
        { timeout: E2E_EVENTUAL_TIMEOUT_MS },
      );
      const rawSeen: Array<NoteSpec & { id: string }> = await page2.evaluate(
        () => (window as { __vidi6: { getNotes: () => Array<NoteSpec & { id: string }> } }).__vidi6.getNotes(),
      );
      // Note ids are client-side random; text, colour, position and stacking
      // are the persisted state the story guarantees.
      const seen: NoteSpec[] = rawSeen.map(({ id, ...rest }) => rest);
      expect(seen).toEqual(spec);
      await ctx2.close();
    } finally {
      await wrangler.dispose();
    }
  });

  test('TC-20: leave immediately — append-before-broadcast survives a same-second kill', async ({ browser }) => {
    const wrangler = await createWranglerProcess();
    try {
      await wrangler.start();
      // Story 5: the board must exist before its link opens.
      const boardId = await createBoard(wrangler.base);

      const ctxAlex = await browser.newContext();
      const pageAlex = await ctxAlex.newPage();
      await pageAlex.goto(`/b/${boardId}`);
      await waitForHooks(pageAlex);

      const ctxSam = await browser.newContext();
      const pageSam = await ctxSam.newPage();
      await pageSam.goto(`/b/${boardId}`);
      await waitForHooks(pageSam);

      // Alex creates a note; Sam observes it. Sam seeing it proves the room
      // stored the update first (broadcast follows the append).
      await pageAlex.evaluate(() => {
        const hooks = (window as { __vidi6: { createNoteAt: (x: number, y: number, c: string, t: string) => string | null } }).__vidi6;
        const id = hooks.createNoteAt(400, 300, 'green', 'Alex was here');
        if (id === null) throw new Error('note creation failed');
      });
      await pageSam.waitForFunction(
        () => (window as { __vidi6: { getNotes: () => NoteSpec[] } }).__vidi6.getNotes().length === 1,
        null,
        { timeout: E2E_EVENTUAL_TIMEOUT_MS },
      );

      // Leave immediately: close both contexts and kill the process.
      const t0 = Date.now();
      await ctxAlex.close();
      await ctxSam.close();
      await wrangler.stop();
      const killElapsed = Date.now() - t0;
      console.log(`[TC-20] contexts closed and process killed in ${killElapsed}ms (workflow budget 1000ms, reported only)`);

      await wrangler.start();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`/b/${boardId}`);
      await waitForHooks(page);
      await page.waitForFunction(
        () => (window as { __vidi6: { getNotes: () => NoteSpec[] } }).__vidi6.getNotes().some((n) => n.text === 'Alex was here'),
        null,
        { timeout: E2E_EVENTUAL_TIMEOUT_MS },
      );
      await ctx.close();
    } finally {
      await wrangler.dispose();
    }
  });

  test('TC-21: big board opens completely (load time logged against budget)', async ({ browser }) => {
    const wrangler = await createWranglerProcess();
    try {
      await wrangler.start();
      const boardId = newBoardId();

      // Seed a PERSIST_TESTED_NOTES board through the test-only endpoint:
      // one large update, stored by the room exactly like a client update.
      const update = generateLargeBoardUpdate(42, PERSIST_TESTED_NOTES);
      const seeded = await testHook(boardId, 'seed', update);
      expect(seeded.status).toBe(200);
      const compacted = await testHook(boardId, 'compact');
      expect(compacted.status).toBe(200);

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const t0 = Date.now(); // navigation start (client side)
      await page.goto(`/b/${boardId}`);
      await page.waitForFunction(
        ([sel, count]) => document.querySelectorAll(sel as string).length === count,
        [STICKY_COUNT_SELECTOR, PERSIST_TESTED_NOTES],
        { timeout: E2E_EVENTUAL_TIMEOUT_MS },
      );
      const elapsed = Date.now() - t0;
      // The budget is reported, not asserted: model, browser and server share
      // one machine (design timing policy).
      console.log(
        `[TC-21] ${PERSIST_TESTED_NOTES} notes fully rendered in ${elapsed}ms (budget ${BOARD_LOAD_BUDGET_MS}ms, reported only)`,
      );
      await ctx.close();
    } finally {
      await wrangler.dispose();
    }
  });
});
