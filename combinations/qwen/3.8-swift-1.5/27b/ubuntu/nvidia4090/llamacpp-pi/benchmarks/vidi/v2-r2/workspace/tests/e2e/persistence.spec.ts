import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import {
  createSticky,
  initDoc,
  type StickySnapshot,
} from '../../src/shared/board-model';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  BOARD_LOAD_BUDGET_MS,
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
  type StickyColor,
} from '../../src/shared/config';
import {
  startWranglerProcess,
  stopWranglerProcess,
  makePersistDir,
  PERSIST_URL,
} from './helpers/wrangler-process';

/**
 * Story 4 e2e: persistence across real `wrangler dev --persist-to` process
 * restarts. Each test owns its worker process lifecycle (start → kill →
 * restart → kill) against its own storage dir on port 8990 — NOT the shared
 * Playwright webServer.
 */

type Snapshot = readonly StickySnapshot[];

async function getSnapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => (window as any).__vidi6?.snapshot?.() ?? []);
}

/** Stable key of a board: every note's identity, text, colour, position, z. */
function boardKey(snap: Snapshot): string {
  const key = (n: StickySnapshot) =>
    `${n.id}|${n.color}|${n.x.toFixed(2)}|${n.y.toFixed(2)}|${n.z}|${n.text}`;
  return JSON.stringify(snap.map(key).sort());
}

/** The server-side snapshot of a board, read straight from storage. */
async function serverSnapshot(boardId: string): Promise<Snapshot> {
  const res = await fetch(`${PERSIST_URL}/__test/boards/${boardId}/store`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'load' }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`server load failed: ${JSON.stringify(body)}`);
  return (body.notes ?? []) as Snapshot;
}

/**
 * Waits until the server's stored board matches the given snapshot. Closing a
 * browser context can discard in-flight WebSocket frames, so "the browser saw
 * its own notes" is not the same as "the server stored them" — this makes the
 * latter explicit before a process kill.
 */
async function waitForServerBoard(boardId: string, expected: Snapshot, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const server = await serverSnapshot(boardId);
    if (server.length === expected.length && boardKey(server) === boardKey(expected)) return;
    if (Date.now() > deadline) {
      throw new Error(`server board did not converge: ${server.length}/${expected.length} notes`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function waitForConnected(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as any).__vidi6?.connectionState === 'connected',
    { timeout: E2E_EVENTUAL_TIMEOUT_MS }
  );
}

/**
 * Seeds `count` notes into a board's storage via the test store hook (real
 * Yjs update bytes produced by the board-model functions).
 */
async function seedBoardStorage(boardId: string, count: number): Promise<void> {
  const doc = new Y.Doc();
  initDoc(doc);
  const colors = Object.keys(STICKY_COLORS) as StickyColor[];
  for (let i = 0; i < count; i++) {
    const col = i % 10;
    const row = Math.floor(i / 10);
    createSticky(doc, { x: col * 220, y: row * 220 }, colors[i % colors.length]);
  }
  const update = Y.encodeStateAsUpdate(doc);
  const res = await fetch(`${PERSIST_URL}/__test/boards/${boardId}/store`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'append', updateB64: Buffer.from(update).toString('base64') }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`seed failed: ${body.detail}`);
}

test.describe('Story 4: persistence e2e (TC-19 to TC-24)', () => {
  test.describe.configure({ mode: 'serial' });

  // These specs drive a live `wrangler dev` that serves the *built* client
  // from `dist/`. Build first so they always test the current client code —
  // a stale bundle would, e.g., lack the load-failure (4500) state machine
  // and TC-24 would time out waiting for `load_failed`.
  test.beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' });
  });
  // Each test starts (and restarts) its own `wrangler dev` process.
  test.setTimeout(180_000);

  test('TC-19: overnight return — 25 varied notes survive a real process restart', async ({ browser }) => {
    const persistDir = makePersistDir();
    const boardId = newBoardId();
    let firstSnapshot: Snapshot = [];

    await startWranglerProcess(persistDir);
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      await page.goto(`${PERSIST_URL}/b/${boardId}`);
      await waitForConnected(page);

      // Zoom out so a 5×5 grid of 200px notes fits the viewport.
      await page.evaluate(() => (window as any).__vidi6?.setCamera({ x: -1600, y: -1000, zoom: 0.4 }));
      // Let the app settle after the camera jump (the very first interaction
      // right after load can otherwise race React's event wiring).
      await page.waitForTimeout(150);

      // 25 notes in a 5×5 grid, each with distinct text.
      for (let i = 0; i < 25; i++) {
        const col = i % 5;
        const row = Math.floor(i / 5);
        await page.mouse.dblclick(320 + col * 160, 120 + row * 160);
        await page.keyboard.type(`Note ${i + 1}`);
        await page.keyboard.press('Escape');
      }

      // A dblclick can occasionally be swallowed (e.g. the first one right
      // after load). Verify the grid is complete and re-dblclick any empty
      // position; a position that already has a note just opens its editor.
      for (let attempt = 0; attempt < 3; attempt++) {
        const snap = await getSnapshot(page);
        if (snap.length === 25) break;
        for (let i = 0; i < 25; i++) {
          const col = i % 5;
          const row = Math.floor(i / 5);
          const wx = 320 + col * 160; // screen x of the grid position
          const wy = 120 + row * 160;
          // World coords of the note centre for this position.
          const centerX = wx / 0.4 + -1600;
          const centerY = wy / 0.4 + -1000;
          const present = snap.some((n) => Math.abs(n.x + 100 - centerX) < 10 && Math.abs(n.y + 100 - centerY) < 10);
          if (!present) {
            await page.mouse.dblclick(wx, wy);
            await page.keyboard.type(`Note ${i + 1}`);
            await page.keyboard.press('Escape');
          }
        }
        await page.waitForTimeout(300);
      }

      // The selected note's counter-scaled toolbar creates a large hit-region
      // above it that can intercept a click on a neighbouring note, so always
      // deselect (click empty canvas) before selecting the next note.
      const deselect = () => page.mouse.click(10, 10);

      // Varied colours on six notes (select by DOM index, click a swatch).
      const colors = ['Orange', 'Green', 'Blue', 'Pink', 'Violet', 'Orange'];
      for (let i = 0; i < colors.length; i++) {
        await deselect();
        await page.locator('[data-note-id]').nth(i).click();
        await page.getByLabel(`${colors[i]} colour`).click();
      }

      // Shuffle the stacking order at the doc level (no UI drag: the selected
      // note's counter-scaled toolbar can intercept clicks on neighbours).
      // The first and last notes (by id) get the two highest z values, so the
      // final z-order is not the plain creation order.
      await page.evaluate(() => {
        const doc = (window as any).__vidi6.doc;
        const objects = doc.getMap('objects');
        const entries = Array.from(objects.entries()) as Array<[string, { get(k: string): unknown; set(k: string, v: unknown): void }]>;
        if (entries.length < 2) return;
        let maxZ = 0;
        for (const [, m] of entries) {
          const z = m.get('z');
          if (typeof z === 'number' && z > maxZ) maxZ = z;
        }
        doc.transact(() => {
          entries[entries.length - 1][1].set('z', maxZ + 1);
          entries[0][1].set('z', maxZ + 2);
        });
      });
      await deselect();

      firstSnapshot = await getSnapshot(page);
      expect(firstSnapshot).toHaveLength(25);
      expect(new Set(firstSnapshot.map((n) => n.color)).size).toBeGreaterThan(1);
      // Make sure every update reached the server's storage before we kill
      // anything (closing the context can drop in-flight frames).
      await waitForServerBoard(boardId, firstSnapshot);
      await ctx.close();
    } finally {
      await stopWranglerProcess();
    }

    // Restart the process over the same storage (the "overnight" part).
    await startWranglerProcess(persistDir);
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      await page.goto(`${PERSIST_URL}/b/${boardId}`);
      await waitForConnected(page);
      const secondSnapshot = await getSnapshot(page);
      expect(secondSnapshot).toHaveLength(25);
      // Identical in text, colour, position and stacking.
      expect(boardKey(secondSnapshot)).toEqual(boardKey(firstSnapshot));
      await ctx.close();
    } finally {
      await stopWranglerProcess();
    }
  });

  test('TC-20: leave immediately — a note seen by Sam survives instant exit + restart', async ({ browser }) => {
    const persistDir = makePersistDir();
    const boardId = newBoardId();

    await startWranglerProcess(persistDir);
    try {
      const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();
      await pageA.goto(`${PERSIST_URL}/b/${boardId}`);
      await pageB.goto(`${PERSIST_URL}/b/${boardId}`);
      await waitForConnected(pageA);
      await waitForConnected(pageB);

      // Alex creates a note; poll until Sam sees it WITH ITS FULL TEXT.
      // (The note element appears as soon as the create update arrives; the
      // text updates follow. Closing before the text lands would lose it.)
      await pageA.mouse.dblclick(400, 300);
      await pageA.keyboard.type('Survivor');
      await pageA.keyboard.press('Escape');
      await expect.poll(
        async () => {
          const snap = await getSnapshot(pageB);
          return snap.length === 1 ? snap[0].text : '';
        },
        { timeout: E2E_EVENTUAL_TIMEOUT_MS }
      ).toBe('Survivor');

      // Within 1 s: close both contexts and kill the process.
      await Promise.all([ctxA.close(), ctxB.close()]);
    } finally {
      await stopWranglerProcess();
    }

    // Restart and reopen: the note is present (append-before-broadcast).
    await startWranglerProcess(persistDir);
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      await page.goto(`${PERSIST_URL}/b/${boardId}`);
      await waitForConnected(page);
      const snap = await getSnapshot(page);
      expect(snap).toHaveLength(1);
      expect(snap[0].text).toBe('Survivor');
      await ctx.close();
    } finally {
      await stopWranglerProcess();
    }
  });

  test('TC-21: big board open — PERSIST_TESTED_NOTES notes render completely; open time logged', async ({ browser }) => {
    const persistDir = makePersistDir();
    const boardId = newBoardId();

    // Seed the large board directly in storage (real Yjs update bytes).
    await startWranglerProcess(persistDir);
    try {
      await seedBoardStorage(boardId, PERSIST_TESTED_NOTES);
    } finally {
      await stopWranglerProcess();
    }

    // Restart so the fresh process must load the board from disk.
    await startWranglerProcess(persistDir);
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();

      const navStart = Date.now();
      await page.goto(`${PERSIST_URL}/b/${boardId}`);
      await waitForConnected(page);
      // Wait until all note elements are rendered.
      await page.waitForFunction(
        (n: number) => document.querySelectorAll('[data-note-id]').length >= n,
        PERSIST_TESTED_NOTES,
        { timeout: E2E_EVENTUAL_TIMEOUT_MS }
      );
      const elapsed = Date.now() - navStart;

      // Budget is reported, not asserted: the model, browser and server
      // share one machine.
      const status = elapsed > BOARD_LOAD_BUDGET_MS ? '⚠️ EXCEEDS' : '✓ within';
      console.log(`  [load-time] big board (${PERSIST_TESTED_NOTES} notes): ${elapsed}ms (${status} ${BOARD_LOAD_BUDGET_MS}ms budget)`);

      const snap = await getSnapshot(page);
      expect(snap).toHaveLength(PERSIST_TESTED_NOTES);
      await ctx.close();
    } finally {
      await stopWranglerProcess();
    }
  });

  test('TC-24: broken board — honest failure, edit lock, recovery without reload', async ({ browser }) => {
    const persistDir = makePersistDir();
    const boardId = newBoardId();

    // 1. A 25-note board, compacted to a snapshot, then corrupted. The reset
    //    hook simulates a fresh DO instance: it discards the in-memory doc and
    //    re-loads from (now corrupted) storage, so the load fails.
    await startWranglerProcess(persistDir);
    try {
      await seedBoardStorage(boardId, 25);
      const compactRes = await fetch(`${PERSIST_URL}/__test/boards/${boardId}/store`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'force-compact' }),
      });
      expect((await compactRes.json()).ok).toBe(true);
      const corruptRes = await fetch(`${PERSIST_URL}/__test/boards/${boardId}/corrupt`, {
        method: 'POST',
        body: '{}',
      });
      expect((await corruptRes.json()).ok).toBe(true);
      const resetRes = await fetch(`${PERSIST_URL}/__test/boards/${boardId}/reset`, {
        method: 'POST',
        body: '{}',
      });
      expect((await resetRes.json()).state).toBe('load-failed');
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      await page.goto(`${PERSIST_URL}/b/${boardId}`);

      // 2. Honest failure: the red badge, no empty board, editing blocked.
      console.log('  [tc24] waiting for load_failed');
      await page.waitForFunction(
        () => (window as any).__vidi6?.connectionState === 'load_failed',
        { timeout: 20_000 }
      );
      console.log('  [tc24] load_failed reached');
      const badge = page.getByText("This board couldn't be loaded. Retrying…");
      await expect(badge).toBeVisible();
      expect(await getSnapshot(page)).toHaveLength(0);

      // Dblclick and the Sticky note button create nothing. (The button is
      // disabled; force-click so Playwright does not wait for it to enable.)
      await page.mouse.dblclick(400, 300);
      await page.getByLabel('Sticky note').click({ force: true });
      await page.waitForTimeout(500);
      expect(await getSnapshot(page)).toHaveLength(0);

      // 3. Repair; the background reconnect triggers a reload (gated by
      // LOAD_RETRY_MIN_INTERVAL_MS) and the board recovers WITHOUT a reload.
      const repairRes = await fetch(`${PERSIST_URL}/__test/boards/${boardId}/repair`, {
        method: 'POST',
        body: '{}',
      });
      expect((await repairRes.json()).ok).toBe(true);
      console.log('  [tc24] repaired, waiting for recovery');

      await page.waitForFunction(
        () => (window as any).__vidi6?.connectionState === 'connected',
        { timeout: 25_000 }
      );
      console.log('  [tc24] recovered (connected)');
      await expect(badge).not.toBeVisible();
      await expect.poll(async () => (await getSnapshot(page)).length, { timeout: 10_000 }).toBe(25);
      console.log('  [tc24] 25 notes visible');

      // Editing works again on the same page. Screen (200,400) → world
      // (−440,0) at the default camera — left of every seeded note, so the
      // dblclick creates a new note rather than opening an existing one.
      await page.mouse.dblclick(200, 400);
      console.log('  [tc24] dblclicked for 26th note, state=' + (await page.evaluate(() => (window as any).__vidi6?.connectionState)));
      await expect.poll(async () => (await getSnapshot(page)).length, { timeout: 10_000 }).toBe(26);
      console.log('  [tc24] 26 notes');
      await ctx.close();
    } finally {
      await stopWranglerProcess();
    }
  });
});
