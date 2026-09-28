// E2E persistence (story 4): TC-19 to TC-21.
// Each test runs its own `wrangler dev --persist-to` process (own port, own
// SQLite dir) so "kill and restart" is a real process restart: the room
// reloads from SQLite after the process forgets its memory.

import { expect, test } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import {
  BOARD_LOAD_BUDGET_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
} from '../../src/shared/config';
import { phraseFor } from '../fixtures/boards';
import {
  removePersistDir,
  startWrangler,
  type WranglerProcess,
} from './helpers/wrangler-process';

const PORT = 8791;
const COLORS = Object.keys(STICKY_COLORS);

interface Note {
  id: string;
  x: number;
  y: number;
  color: string;
  text: string;
  z: number;
}

function sorted(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

async function notesOf(page: import('@playwright/test').Page): Promise<Note[]> {
  return page.evaluate(() => window.__vidi6?.getStickyNotes() ?? []);
}

/** Opens a fresh context on the board and waits for a full sync. */
async function openBoard(
  browser: import('@playwright/test').Browser,
  url: string,
  boardId: string,
) {
  // Story 5: create the board first (test seam) — unknown boards are 404.
  const init = await fetch(`${url}/_test/${boardId}/initialize`, { method: 'POST' });
  if (init.status !== 200) throw new Error(`initialize failed: ${init.status}`);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${url}/b/${boardId}`);
  await page.waitForFunction(() => typeof window.__vidi6 !== 'undefined');
  await expect
    .poll(async () => page.evaluate(() => window.__vidi6?.connectionState ?? null))
    .toBe('connected');
  return { context, page };
}

async function expectNoteCount(page: import('@playwright/test').Page, count: number): Promise<void> {
  await expect.poll(async () => (await notesOf(page)).length).toBe(count);
}

test('TC-19: overnight return — 25 varied notes survive a process restart', async ({ browser }) => {
  let server: WranglerProcess | null = null;
  try {
    server = await startWrangler(PORT);
    const boardId = newBoardId();
    const colors = COLORS;
    const notes = await openBoard(browser, server.url, boardId);

    // Create 25 varied notes: grid positions, cycled colours, realistic
    // phrases (some multi-line), and a stacking pass (three notes fronted).
    await notes.page.evaluate(async ([cols, phrases]) => {
      const api = window.__vidi6!;
      const ids: string[] = [];
      for (let i = 0; i < 25; i++) {
        const x = 80 + (i % 5) * 260;
        const y = 80 + Math.floor(i / 5) * 240;
        const id = api.createSticky(x, y, cols[i % cols.length])!;
        api.setStickyText(id, phrases[i]);
        ids.push(id);
        // Local dev only: workerd's hibernation emulation drops buffered WS
        // frames when a durable write suspends the instance, so seed one note
        // per macrotask and let each update be acknowledged before the next.
        await new Promise((r) => setTimeout(r, 60));
      }
      await new Promise((r) => setTimeout(r, 60));
      api.bringStickyToFront(ids[3]);
      await new Promise((r) => setTimeout(r, 60));
      api.bringStickyToFront(ids[7]);
      await new Promise((r) => setTimeout(r, 60));
      api.bringStickyToFront(ids[11]);
    }, [colors, Array.from({ length: 25 }, (_, i) => phraseFor(i))]);
    await expectNoteCount(notes.page, 25);
    const before = sorted(await notesOf(notes.page));
    expect(before).toHaveLength(25);

    // Close the browser, then kill the process (it forgets its memory).
    await notes.context.close();
    const persistDir = server.persistDir;
    await server.stop();
    server = null;

    // Restart over the same store and reopen the board.
    server = await startWrangler(PORT, { persistDir });
    const reopened = await openBoard(browser, server.url, boardId);
    await expectNoteCount(reopened.page, 25);
    const restored = sorted(await notesOf(reopened.page));

    // Identical in text, colour, position and stacking.
    expect(restored).toEqual(before);
    await reopened.context.close();
  } finally {
    if (server) {
      await server.stop();
      await removePersistDir(server.persistDir);
    }
  }
});



// NOTE (local dev): workerd's local hibernation emulation re-keys a
// hibernated DO's storage when it is woken within the same process, so a
// late joiner (connecting to a board that already has stored updates)
// cannot be relied on in wrangler dev. These specs therefore use the real
// process restart as the "memory loss" mechanism — the same guarantee the
// story cares about — and let both clients join the empty board first
// (live propagation, which local dev handles correctly).
test('TC-20: leave immediately — append-before-broadcast survives a crash', async ({ browser }) => {
  let server: WranglerProcess | null = null;
  try {
    server = await startWrangler(PORT);
    const boardId = newBoardId();
    // Both clients join the (empty) board before anything is created.
    const alex = await openBoard(browser, server.url, boardId);
    const sam = await openBoard(browser, server.url, boardId);
    const text = 'Alex: ship the export story';
    await alex.page.evaluate(([t, color]) => {
      const api = window.__vidi6!;
      const id = api.createSticky(120, 120, color)!;
      api.setStickyText(id, t);
    }, [text, COLORS[0]]);
    await expectNoteCount(alex.page, 1);

    // Sam observes the note: the room stored it before broadcasting it
    // (broadcast is the only path, and it runs after the durable write).
    await expect.poll(async () => (await notesOf(sam.page)).length, {
      timeout: LIVE_UPDATE_LATENCY_BUDGET_MS,
    }).toBe(1);

    // Both leave within the same instant and the process is killed —
    // nothing is flushed, nothing is retried.
    await Promise.all([alex.context.close(), sam.context.close()]);
    const persistDir = server.persistDir;
    await server.stop();
    server = null;

    // Restart: the process forgets its memory, the storage does not.
    server = await startWrangler(PORT, { persistDir });
    const reopened = await openBoard(browser, server.url, boardId);
    await expectNoteCount(reopened.page, 1);
    const note = (await notesOf(reopened.page))[0];
    expect(note.text).toBe(text);
    await reopened.context.close();
  } finally {
    if (server) {
      await server.stop();
      await removePersistDir(server.persistDir);
    }
  }
});

test('TC-21: big board open — PERSIST_TESTED_NOTES notes render within the load budget', async ({ browser }) => {
  let server: WranglerProcess | null = null;
  try {
    server = await startWrangler(PORT);
    const boardId = newBoardId();
    const seed = await openBoard(browser, server.url, boardId);

    // Seed PERSIST_TESTED_NOTES notes (one transaction each, all stored by
    // the room — compaction keeps the log bounded along the way).
    const phrases = Array.from({ length: PERSIST_TESTED_NOTES }, (_, i) => phraseFor(i));
    // Seed PERSIST_TESTED_NOTES notes, one per macrotask. Local dev only:
    // workerd's hibernation emulation drops buffered WS frames when a
    // durable write suspends the instance, so fire-and-forget seeding
    // loses notes; at one note per 60 ms every update is processed (and
    // stored) before the next one arrives — the same pacing that keeps
    // TC-19 deterministic.
    const api = seed.page;
    for (let i = 0; i < PERSIST_TESTED_NOTES; i++) {
      await api.evaluate(([i, c, p]: [number, string, string]) => {
        const a = window.__vidi6!;
        const id = a.createSticky(80 + (i % 10) * 220, 80 + Math.floor(i / 10) * 200, c)!;
        a.setStickyText(id, p);
      }, [i, COLORS[i % COLORS.length], phrases[i]] as [number, string, string]);
      await new Promise((r) => setTimeout(r, 60));
    }
    await expectNoteCount(seed.page, PERSIST_TESTED_NOTES);

    // Kill the process: nothing is flushed after the last client leaves —
    // whatever survives is what the durable store holds.
    await seed.context.close();
    const persistDir = server.persistDir;
    await server.stop();
    server = null;

    // Fresh process, fresh context: measure navigation start -> board open
    // (the full board in the doc, the visible notes rendered; off-screen
    // notes are culled, see App.tsx).
    server = await startWrangler(PORT, { persistDir });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${server.url}/b/${boardId}`);
    const open = await page.evaluate(
      ({ total }: { total: number }) => {
        return new Promise<{ docNotes: number; visible: number }>((resolve) => {
          const start = performance.now();
          const iv = setInterval(() => {
            const doc = (window as any).__vidi6Doc;
            const docNotes = doc ? Array.from(doc.getMap('objects').values()).length : 0;
            const visible = document.querySelectorAll('[data-testid="sticky-note"]').length;
            if (docNotes >= total) {
              clearInterval(iv);
              resolve({ docNotes, visible });
            }
            if (performance.now() - start > 30_000) {
              clearInterval(iv);
              resolve({ docNotes, visible });
            }
          }, 20);
        });
      },
      { total: PERSIST_TESTED_NOTES },
    );
    const elapsedMs = await page.evaluate(() => performance.now());
    console.log(
      `TC-21: ${open.docNotes} notes in doc, ${open.visible} visible rendered ${Math.round(elapsedMs)}ms after navigation start (budget ${BOARD_LOAD_BUDGET_MS}ms)`,
    );
    expect(open.docNotes).toBe(PERSIST_TESTED_NOTES);
    expect(open.visible).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThanOrEqual(BOARD_LOAD_BUDGET_MS);
    await context.close();
  } finally {
    if (server) {
      await server.stop();
      await removePersistDir(server.persistDir);
    }
  }
});



test('TC-24: broken board — honest failure, edit lock, recovery without reload', async ({ browser }) => {
  let server: WranglerProcess | null = null;
  try {
    server = await startWrangler(PORT);
    const boardId = newBoardId();

    // A 25-note board, compacted into a snapshot, then snapshot-corrupted
    // (the room can no longer read its own board).
    const seed = await openBoard(browser, server.url, boardId);
    await seed.page.evaluate(async ([cols, phrases]) => {
      const api = window.__vidi6!;
      for (let i = 0; i < 25; i++) {
        const id = api.createSticky(80 + (i % 5) * 260, 80 + Math.floor(i / 5) * 240, cols[i % cols.length])!;
        api.setStickyText(id, phrases[i]);
        // Local dev only: pace the seed (hibernation frame drops, see TC-19).
        await new Promise((r) => setTimeout(r, 60));
      }
    }, [COLORS, Array.from({ length: 25 }, (_, i) => phraseFor(i))]);
    await expectNoteCount(seed.page, 25);
    await seed.context.close();

    const compact = await fetch(`${server.url}/_test/${boardId}/compact`, { method: 'POST' });
    expect(((await compact.json()) as { ok: boolean }).ok).toBe(true);
    const corrupt = await fetch(`${server.url}/_test/${boardId}/corrupt-snapshot`, { method: 'POST' });
    expect(((await corrupt.json()) as { ok: boolean }).ok).toBe(true);

    // Fresh context on the broken board: the red badge, and no edits.
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${server.url}/b/${boardId}`);
    await page.waitForFunction(() => typeof window.__vidi6 !== 'undefined');
    const badge = page.locator('[data-testid="connection-status"]');
    await expect(badge).toHaveText("This board couldn't be loaded. Retrying…");

    const button = page.getByRole('button', { name: 'Sticky note' });
    await expect(button).toBeDisabled();
    await page.locator('[data-testid="board-viewport"]').dblclick({ position: { x: 10, y: 10 } });
    await expect.poll(async () => notesOf(page)).toHaveLength(0);

    // Repair the snapshot; the provider's own retry loop reloads the room
    // (no page reload) and the board comes back editable.
    const repair = await fetch(`${server.url}/_test/${boardId}/repair-snapshot`, { method: 'POST' });
    expect(((await repair.json()) as { ok: boolean }).ok).toBe(true);

    await expect
      .poll(async () => page.evaluate(() => window.__vidi6?.connectionState ?? null), { timeout: 60_000 })
      .toBe('connected');
    await expect(badge).toBeHidden();
    await expectNoteCount(page, 25);

    // Editing works again without a reload.
    await expect(button).toBeEnabled();
    await page.locator('[data-testid="board-viewport"]').dblclick({ position: { x: 10, y: 10 } });
    await expect.poll(async () => notesOf(page)).toHaveLength(26);
    await context.close();
  } finally {
    if (server) {
      await server.stop();
      await removePersistDir(server.persistDir);
    }
  }
});
