/**
 * Story 4 e2e: persistence across real process restarts (persist.room) and
 * the client load-failure state in a real browser (persist.client_status,
 * TC-24). Each test owns a `wrangler dev --persist-to` process — killing it
 * forgets all memory while the persist dir keeps the SQLite data.
 *
 * This project has no shared webServer (see playwright.persistence.config.ts):
 * the tests restart the server mid-test.
 *
 * Note on seeding: the `store-append-many` hook writes straight to SQLite but
 * leaves any already-constructed room's in-memory doc stale. We therefore
 * restart the process (or force `room-reset`) after seeding so the room
 * rebuilds its doc from disk before we observe it.
 */
import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import {
  BOARD_LOAD_BUDGET_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  PERSIST_TESTED_NOTES,
  type StickyColor,
} from '../../src/shared/config';
import { buildLargeBoard, buildRetroBoard, type FixtureResult } from '../fixtures/boards';
import {
  createNoteAt,
  moveNote,
  noteCount,
  openBoard,
  readText,
  recolorNote,
  setCamera,
  snapshotNotes,
  stackingOrder,
  typeText,
} from './helpers';
import { WranglerProcess } from './wrangler-process';

const PORT = 29044;
const INSPECTOR_PORT = 29045;

function newBoardId(): string {
  return randomBytes(16).toString('base64url');
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Seeds real DO storage through the test hook (SQLite, not memory). */
async function seedBoard(proc: WranglerProcess, boardId: string, fixture: FixtureResult): Promise<void> {
  const res = await fetch(`${proc.url}/__test/boards/${boardId}/store-append-many`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ updates: fixture.perNoteUpdates.map(toBase64) }),
  });
  if (!res.ok) throw new Error(`seed failed: ${res.status} ${await res.text()}`);
}

async function postHook(
  proc: WranglerProcess,
  boardId: string,
  op: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${proc.url}/__test/boards/${boardId}/${op}`, { method: 'POST' });
  if (!res.ok) throw new Error(`hook ${op} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Kill + restart the process on the same persist dir (memory lost, data kept). */
async function restart(proc: WranglerProcess): Promise<void> {
  await proc.stop();
  await proc.start();
}

test.describe('persistence e2e (real wrangler dev --persist-to restarts)', () => {
  test('TC-19: overnight return — the restart forgets memory, not the board', async ({ browser }) => {
    const proc = new WranglerProcess(PORT, INSPECTOR_PORT);
    await proc.start();
    try {
      const boardId = newBoardId();
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await openBoard(page, boardId);
      // zoom out: a 5x5 grid of well-separated anchors (same layout as TC-26)
      await setCamera(page, -640, -400, 0.5);
      const cellX = (c: number) => 140 + c * 220;
      const rowY = (r: number) => 140 + r * 120;
      const colors: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink'];

      for (let i = 0; i < 25; i++) {
        const p = { x: cellX(i % 5), y: rowY(Math.floor(i / 5)) };
        await createNoteAt(page, p.x, p.y);
        await typeText(page, p.x, p.y, `Note ${i + 1}\nsecond line ${i + 1}`);
        await recolorNote(page, p.x, p.y, colors[i % colors.length]);
      }
      // re-stack three notes to the front with small deterministic drags
      const drag = (x: number, y: number, dx: number, dy: number) =>
        moveNote(page, { x, y }, { x: x + dx, y: y + dy });
      await drag(cellX(2), rowY(1), 25, 15);
      await drag(cellX(1), rowY(3), 30, 10);
      await drag(cellX(4), rowY(4), 20, 20);

      const before = await snapshotNotes(page);
      const stackBefore = await stackingOrder(page);
      expect(before).toHaveLength(25);
      expect(new Set(before.map((n) => n.color)).size).toBeGreaterThan(1);

      // the user leaves, the process dies, a fresh process starts
      await ctx.close();
      await restart(proc);

      const ctx2 = await browser.newContext();
      const page2 = await ctx2.newPage();
      await openBoard(page2, boardId);
      await setCamera(page2, -640, -400, 0.5);
      await expect.poll(() => noteCount(page2), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(25);
      const after = await snapshotNotes(page2);
      expect(after).toEqual(before); // text, colour, position
      expect(await stackingOrder(page2)).toEqual(stackBefore); // stacking
      await ctx2.close();
    } finally {
      await proc.cleanup();
    }
  });

  test('TC-20: leave immediately — a seen note survives exit and restart', async ({ browser }) => {
    const proc = new WranglerProcess(PORT, INSPECTOR_PORT);
    await proc.start();
    try {
      const boardId = newBoardId();
      const alexCtx = await browser.newContext();
      const alex = await alexCtx.newPage();
      await openBoard(alex, boardId);
      await createNoteAt(alex, 640, 400);
      await typeText(alex, 640, 400, 'survivor');

      const samCtx = await browser.newContext();
      const sam = await samCtx.newPage();
      await openBoard(sam, boardId);
      // the note is visible to the other person…
      await expect.poll(() => noteCount(sam), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

      // …and both leave immediately (no grace period for a delayed save)
      const t0 = Date.now();
      await alexCtx.close();
      await samCtx.close();
      const closeMs = Date.now() - t0;
      console.log(`[persistence] TC-20: both contexts closed in ${closeMs}ms`);
      expect(closeMs).toBeLessThan(1000);

      await restart(proc);

      const backCtx = await browser.newContext();
      const back = await backCtx.newPage();
      await openBoard(back, boardId);
      await expect.poll(() => noteCount(back), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);
      expect(await readText(back, 640, 400)).toBe('survivor');
      await backCtx.close();
    } finally {
      await proc.cleanup();
    }
  });

  test('TC-21: big board opens completely (load time logged, not asserted)', async ({ browser }) => {
    const proc = new WranglerProcess(PORT, INSPECTOR_PORT);
    await proc.start();
    try {
      const boardId = newBoardId();
      await seedBoard(proc, boardId, buildLargeBoard(PERSIST_TESTED_NOTES));
      // restart so the room rebuilds from disk, then compact so the open we
      // measure goes through the snapshot-chunk path (the real old-board load)
      await restart(proc);
      const compacted = await postHook(proc, boardId, 'room-compact-now');
      expect(compacted.compacted).toBe(true);
      await postHook(proc, boardId, 'room-reset');

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const t0 = Date.now(); // navigation start
      await page.goto(`/b/${boardId}`);
      await expect
        .poll(() => noteCount(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(PERSIST_TESTED_NOTES);
      const ms = Date.now() - t0;
      const within = ms <= BOARD_LOAD_BUDGET_MS;
      // reported, never asserted: model, browser and server share one machine
      console.log(
        `[load] TC-21: ${PERSIST_TESTED_NOTES} notes rendered in ${ms}ms ` +
          `(budget ${BOARD_LOAD_BUDGET_MS}ms, ${within ? 'within' : 'over'})`,
      );
      await ctx.close();
    } finally {
      await proc.cleanup();
    }
  });

  test('TC-24: broken board — honest failure, edit lock, recovery without reload', async ({ browser }) => {
    const proc = new WranglerProcess(PORT, INSPECTOR_PORT);
    await proc.start();
    try {
      const boardId = newBoardId();
      await seedBoard(proc, boardId, buildRetroBoard());
      // restart so the room rebuilds the 25-note doc from disk, then compact
      // to create a real snapshot to corrupt
      await restart(proc);
      const compacted = await postHook(proc, boardId, 'room-compact-now');
      expect(compacted.compacted).toBe(true);
      const corrupted = await postHook(proc, boardId, 'corrupt-snapshot');
      expect(corrupted.ok).toBe(true);

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`/b/${boardId}`);
      await setCamera(page, -640, -400, 1);

      // honest failure: the red message, no notes
      await expect
        .poll(async () => (await page.evaluate(() => window.__vidi6?.connectionState)), {
          timeout: E2E_EVENTUAL_TIMEOUT_MS,
        })
        .toBe('load_failed');
      await expect(page.getByText("This board couldn't be loaded. Retrying…")).toBeVisible();
      await expect.poll(() => noteCount(page)).toBe(0);

      // edit lock: double-click creates nothing, the Sticky note button is disabled
      await page.mouse.dblclick(150, 650);
      await expect.poll(() => noteCount(page)).toBe(0);
      await expect(page.getByRole('button', { name: 'Sticky note' })).toBeDisabled();

      // repair the storage; the provider's next retry syncs the board — no
      // page reload (room-reset forces the room to reload on that retry)
      const repaired = await postHook(proc, boardId, 'repair-snapshot');
      expect(repaired.ok).toBe(true);
      await postHook(proc, boardId, 'room-reset');
      await expect
        .poll(async () => (await page.evaluate(() => window.__vidi6?.connectionState)), {
          timeout: 30_000, // client reconnect backoff can reach RECONNECT_MAX_BACKOFF_MS
        })
        .toBe('connected');
      await expect.poll(() => noteCount(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(25);
      await expect(page.getByText("This board couldn't be loaded. Retrying…")).toHaveCount(0);

      // editing works again
      await createNoteAt(page, 150, 650);
      await typeText(page, 150, 650, 'recovered');
      await expect.poll(() => noteCount(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(26);
      await ctx.close();
    } finally {
      await proc.cleanup();
    }
  });
});
