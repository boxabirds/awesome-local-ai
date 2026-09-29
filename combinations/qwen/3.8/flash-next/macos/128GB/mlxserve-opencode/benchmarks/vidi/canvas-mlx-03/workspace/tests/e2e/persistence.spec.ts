// Story 4, task 6 — persist.room proven end to end against a real `wrangler dev`
// process. Each test owns its dev server (`--persist-to <tmp dir>`) and kills it,
// so the only way the assertions can pass is if the board really came back out of
// Durable Object SQLite storage after the process forgot its memory.

import { test, expect, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { startDevServer, persistBoardId, type DevServer } from './helpers/wrangler-process.ts';
import { RawClient } from './helpers/rawClient.ts';
import {
  createSticky,
  waitForConnection,
  noteTexts,
  simulateDrop,
  restoreConnection,
} from './helpers/board.ts';
import { retroBoard, retroBoardWithEdits, largeBoardSpecs } from '../fixtures/boards.ts';
import {
  LOAD_RETRY_MIN_INTERVAL_MS,
  COMPACTION_UPDATE_COUNT,
  BOARD_LOAD_BUDGET_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
  type StickyColor,
} from '../../src/shared/config.ts';

const LOAD_FAILED_MESSAGE = "This board couldn't be loaded. Retrying…";

interface DomSpec {
  text: string;
  color: string; // computed backgroundColor
  x: number; // world left (inline style)
  y: number;
  z: number; // stacking
}

/** Every sticky's text, colour, world position and stacking, read from the DOM. */
async function boardSpecs(page: Page): Promise<DomSpec[]> {
  return page.evaluate(() => {
    const els = Array.from(
      document.querySelectorAll('[role="group"][aria-label="Sticky note"]'),
    ) as HTMLElement[];
    return els.map((el) => ({
      text: (el.querySelector('[data-testid="sticky-text"]')?.textContent ?? '').trim(),
      color: getComputedStyle(el).backgroundColor,
      x: parseFloat(el.style.left),
      y: parseFloat(el.style.top),
      z: parseFloat(el.style.zIndex),
    }));
  });
}

function byPosition(a: DomSpec, b: DomSpec): number {
  return a.x - b.x || a.y - b.y || a.z - b.z || a.text.localeCompare(b.text);
}

async function openBoardAt(page: Page, url: string, boardId: string): Promise<void> {
  await page.goto(`${url}/b/${boardId}`);
  await expect(page.getByTestId('viewport')).toBeVisible();
  await waitForConnection(page);
}

const oneline = (s: string): string => s.replace(/\s+/g, ' ').trim();

test.describe('story 4 persistence (real wrangler dev process)', () => {
  let server: DevServer | null = null;

  test.afterEach(async () => {
    if (server) {
      const s = server;
      server = null;
      await s.dispose();
    }
  });

  test('TC-19 overnight return: 25 notes survive a process that forgets memory', async ({ browser }) => {
    test.setTimeout(300_000);
    server = await startDevServer();
    const boardId = persistBoardId();

    const context = await browser.newContext();
    const page = await context.newPage();
    await openBoardAt(page, server.url, boardId);

    // Build a 25-note retro board through the real UI: varied single-line text,
    // varied colours, a grid layout plus deliberate overlaps.
    const fixture = retroBoard().expected;
    expect(fixture).toHaveLength(25);
    const palette: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
    for (let i = 0; i < fixture.length; i++) {
      const col = i % 5;
      const row = Math.floor(i / 5);
      const x = 140 + col * 210 + (row % 2) * 30; // stagger so some notes overlap
      const y = 130 + row * 140;
      const text = oneline(fixture[i]!.text).slice(0, 60);
      await createSticky(page, x, y, text);
      const color = palette[i % palette.length]!;
      if (color !== 'yellow') {
        await page.getByRole('button', { name: `${capitalize(color)} colour` }).click();
        await page.waitForTimeout(50);
      }
    }
    await page.waitForTimeout(300);

    const before = (await boardSpecs(page)).sort(byPosition);
    expect(before).toHaveLength(25);
    expect(new Set(before.map((s) => s.color)).size).toBeGreaterThan(1);
    expect(new Set(before.map((s) => s.z)).size).toBe(25); // distinct stacking order

    // "Close the browser, kill the process, restart, come back."
    await context.close();
    await server.stop();
    const restarted = await server.restart();
    server = restarted;

    const back = await browser.newContext();
    const page2 = await back.newPage();
    await openBoardAt(page2, restarted.url, boardId);
    await expect
      .poll(async () => (await boardSpecs(page2)).length, { timeout: 30_000 })
      .toBe(25);

    const after = (await boardSpecs(page2)).sort(byPosition);
    expect(after).toEqual(before); // text, colour, position, stacking — identical
    await back.close();
  });

  test('TC-20 leave immediately: a change seen by another person is already durable', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    server = await startDevServer();
    const boardId = persistBoardId();

    const alexCtx = await browser.newContext();
    const samCtx = await browser.newContext();
    const alex = await alexCtx.newPage();
    const sam = await samCtx.newPage();
    await openBoardAt(alex, server.url, boardId);
    await openBoardAt(sam, server.url, boardId);

    const text = 'Demo on Friday';
    const seenStart = Date.now();
    await createSticky(alex, 420, 300, text);
    await expect
      .poll(async () => (await noteTexts(sam)).includes(text), {
        timeout: LIVE_UPDATE_LATENCY_BUDGET_MS,
      })
      .toBe(true);
    const seenAt = Date.now();
    console.log(`[TC-20] note visible to Sam ${(seenAt - seenStart) / 1000} s after Alex typed it`);

    // Within 1 s of it becoming visible to Sam, both people leave and the
    // process dies. Nothing is flushed on close: the row was written before the
    // update was ever broadcast.
    await Promise.all([alexCtx.close(), samCtx.close()]);
    const signalAt = Date.now();
    expect(signalAt - seenAt).toBeLessThanOrEqual(1000);
    await server.stop();
    const restarted = await server.restart();
    server = restarted;

    const back = await browser.newContext();
    const page = await back.newPage();
    await openBoardAt(page, restarted.url, boardId);
    await expect
      .poll(async () => (await noteTexts(page)).includes(text), { timeout: 30_000 })
      .toBe(true);
    expect(await boardSpecs(page)).toHaveLength(1);
    await back.close();
  });

  test(`TC-21 big board open: ${PERSIST_TESTED_NOTES} notes within budget`, async ({ browser }) => {
    test.setTimeout(420_000);
    server = await startDevServer();
    const boardId = persistBoardId();

    const specs = largeBoardSpecs(PERSIST_TESTED_NOTES);
    expect(specs).toHaveLength(PERSIST_TESTED_NOTES);

    // Seed the board as a collaborator: one Yjs update per note, so the room
    // really does hit its compaction thresholds on the way.
    const seedStart = Date.now();
    const seeder = new RawClient(boardId);
    await seeder.connect();
    for (const spec of specs) {
      seeder.addSticky({ text: spec.text, x: spec.x, y: spec.y, color: spec.color });
    }
    // An observer proves the room received (and therefore stored — the row is
    // written before the update is broadcast) every one of the notes.
    const observer = new RawClient(boardId);
    await observer.connect();
    await observer.waitFor(() => observer.noteCount() === PERSIST_TESTED_NOTES, 120_000);
    const seededMs = Date.now() - seedStart;
    seeder.close();
    observer.close();
    await new Promise((r) => setTimeout(r, 500));

    // Restart so the browser must load the board out of SQLite, not memory.
    await server.stop();
    const restarted = await server.restart();
    server = restarted;

    const context = await browser.newContext();
    const page = await context.newPage();
    const loadStart = Date.now();
    await page.goto(`${restarted.url}/b/${boardId}`);
    await page.waitForFunction(
      (want) => document.querySelectorAll('[role="group"][aria-label="Sticky note"]').length === want,
      PERSIST_TESTED_NOTES,
      { timeout: 60_000 },
    );
    const loadMs = Date.now() - loadStart;
    await waitForConnection(page);

    console.log(
      `[TC-21] seed ${PERSIST_TESTED_NOTES} notes: ${seededMs} ms; ` +
        `open board after process restart: ${loadMs} ms (budget ${BOARD_LOAD_BUDGET_MS} ms)`,
    );
    expect(loadMs).toBeLessThanOrEqual(BOARD_LOAD_BUDGET_MS);
    expect(await noteTexts(page)).toHaveLength(PERSIST_TESTED_NOTES);
    await context.close();
  });

  test('TC-24 broken board: told, locked, and recovered without a reload', async ({ browser }) => {
    test.setTimeout(300_000);
    server = await startDevServer();
    const boardId = persistBoardId();

    // Seed a 25-note board and push it past the compaction threshold, so the board
    // really is in the Snapshotted dimension (design D1) before it breaks.
    const fixture = retroBoardWithEdits(COMPACTION_UPDATE_COUNT);
    const seeder = new RawClient(boardId);
    await seeder.connect();
    for (const update of fixture.updates) Y.applyUpdate(seeder.doc, update);
    const observer = new RawClient(boardId);
    await observer.connect();
    const expectedTexts = fixture.expected.map((n) => n.text).sort();
    await observer.expectTexts(expectedTexts, 60_000);
    await observer.waitFor(() => observer.noteCount() === 25, 60_000);
    seeder.close();
    observer.close();
    await new Promise((r) => setTimeout(r, 400));

    // The test-only storage damage endpoint is a door only the e2E harness can
    // open: a GET (or any deployment without the flag) is a 404.
    const hook = (action: string) =>
      fetch(`${server!.url}/__test/boards/${boardId}/${action}`, { method: 'POST' });
    expect((await fetch(`${server!.url}/__test/boards/${boardId}/corrupt-snapshot`)).status).toBe(
      404,
    );
    const damaged = await hook('corrupt-snapshot');
    expect(damaged.status).toBe(200);
    expect((await damaged.json()).ok).toBe(true);

    // Open the board: the room reads damaged storage, so the user is told rather
    // than shown an empty board, and cannot write into it.
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${server!.url}/b/${boardId}`);
    const badge = page.getByTestId('connection-status');
    await expect(badge).toHaveText(LOAD_FAILED_MESSAGE);
    await expect(badge).toHaveAttribute('data-status', 'load_failed');
    expect(await noteTexts(page)).toEqual([]); // an unloadable board is never shown as empty

    await expect(page.getByTestId('sticky-note-tool')).toBeDisabled();
    await page.mouse.dblclick(600, 400);
    await page.keyboard.type('written into the void');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    expect(await noteTexts(page)).toEqual([]);
    await expect(badge).toHaveText(LOAD_FAILED_MESSAGE);

    // Repair the storage. The client has been retrying on its own backoff; force
    // the next attempt so the test does not depend on how long that backoff is.
    await page.evaluate(() => {
      (window as unknown as { __pageWasNotReloaded?: string }).__pageWasNotReloaded = 'alive';
    });
    const repaired = await hook('repair');
    expect(repaired.status).toBe(200);
    await page.waitForTimeout(LOAD_RETRY_MIN_INTERVAL_MS + 1000);
    await simulateDrop(page);
    await restoreConnection(page);

    await expect
      .poll(async () => (await noteTexts(page)).length, { timeout: 60_000 })
      .toBe(25);
    expect(await noteTexts(page)).toEqual(expectedTexts); // the snapshot's own notes
    await expect(badge).toBeHidden(); // editing is back, without a confirmation banner
    expect(
      await page.evaluate(
        () => (window as unknown as { __pageWasNotReloaded?: string }).__pageWasNotReloaded,
      ),
    ).toBe('alive');

    // And the board is editable again.
    await createSticky(page, 900, 700, 'added after repair');
    await expect
      .poll(async () => (await noteTexts(page)).includes('added after repair'), { timeout: 20_000 })
      .toBe(true);
    await context.close();
  });
});

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Referenced so the colour table stays in sync with what the test asserts.
void STICKY_COLORS;
