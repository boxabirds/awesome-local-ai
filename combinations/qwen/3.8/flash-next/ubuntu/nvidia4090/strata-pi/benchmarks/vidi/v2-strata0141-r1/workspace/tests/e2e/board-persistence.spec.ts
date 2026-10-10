import { test, expect } from '@playwright/test';
import {
  BOARD_LOAD_BUDGET_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  PERSIST_TESTED_NOTES,
  STICKY_COLOR_NAMES,
  type StickyColor,
} from '../../src/shared/config';
import type { StickySnapshot } from '../../src/shared/board-model';
import { openBoard } from './helpers/board';
import { waitForBoardConnection } from './helpers/live';
import { getNotes } from './helpers/sticky';
import { WranglerProcess, callHook } from './helpers/wrangler-process';

/**
 * Story 4 end-to-end: a board survives the process forgetting it (task: E2E
 * persistence).
 *
 * Each of these tests runs its own `wrangler dev` with `--persist-to`, so the
 * board's storage is a real directory and the restart is a real restart. These
 * are the only e2e tests that do, because everything else can share one long-
 * lived Worker.
 *
 * They run in Chromium only: what they prove is server-side durability, and a
 * restart cycle costs more than a browser round-trip, so repeating it per engine
 * would triple the wall clock for no extra coverage. Timings are printed; only
 * the functional outcome is asserted.
 */

const NOTE_COUNT = 25;

/** A board compared as it would be seen: text, colour, position, stacking. */
function visibleBoard(notes: readonly StickySnapshot[]): unknown[] {
  return notes.map((note) => ({
    text: note.text,
    color: note.color,
    x: note.x,
    y: note.y,
    z: note.z,
  }));
}

async function renderedNoteCount(page: Parameters<typeof getNotes>[0]): Promise<number> {
  return page.locator('[data-testid^="sticky-note-"]').count();
}

async function waitForRenderedNotes(page: Parameters<typeof getNotes>[0], count: number): Promise<void> {
  await expect
    .poll(async () => await renderedNoteCount(page), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      message: `the board never rendered ${count} notes`,
    })
    .toBe(count);
}

const PHRASES = [
  'Skip the standup on Mondays',
  'Ship the invite link',
  'Too many tabs in the editor',
  'Loved the pairing session',
  'Rename "inbox" to "inbox (2026)"',
];

function phraseFor(index: number): string {
  const base = PHRASES[index % PHRASES.length] ?? 'Untitled';
  return index % 3 === 2 ? `${base} #${index}\nsecond line` : `${base} #${index}`;
}

/** 25 notes on a 5x5 grid, cycling colours, each with its own text. */
async function fillBoard(page: Parameters<typeof getNotes>[0]): Promise<void> {
  await page.evaluate(
    ({ count, colors, phrases }) => {
      const api = (window as unknown as {
        __vidi6?: {
          createNote(params: {
            at: { x: number; y: number };
            color: string;
            text: string;
          }): string;
        }
      }).__vidi6;
      if (!api) {
        throw new Error('test hooks are not installed');
      }
      const columns = 5;
      for (let index = 0; index < count; index += 1) {
        api.createNote({
          at: {
            x: (index % columns) * 150 - 300,
            y: Math.floor(index / columns) * 150 - 300,
          },
          color: colors[index % colors.length] as string,
          text: phrases[index] as string,
        });
      }
    },
    {
      count: NOTE_COUNT,
      colors: STICKY_COLOR_NAMES as string[],
      phrases: Array.from({ length: NOTE_COUNT }, (_, index) => phraseFor(index)),
    },
  );
}

test.describe('return to a board', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'restart tests are server-side durability; run once, in Chromium',
  );
  test.describe.configure({ mode: 'serial' });

  let server: WranglerProcess;

  test.beforeAll(async () => {
    server = await WranglerProcess.start({ label: 'persist', testHooks: true });
  });

  test.afterAll(async () => {
    await server?.stop();
  });

  test('TC-19: overnight return - 25 notes survive a restart identical', async ({ browser }) => {
    test.setTimeout(180_000);

    const opening = await browser.newContext();
    const page = await opening.newPage();
    const board = await openBoard(page, { origin: server.url });
    await waitForBoardConnection(page);
    await fillBoard(page);
    await expect
      .poll(async () => (await getNotes(page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(NOTE_COUNT);
    // Stored, not just rendered: the room has taken all 25 updates.
    await expect
      .poll(
        async () => {
          const answer = await callHook(server, board, 'stats', 'GET');
          return Number((answer.stats as { updateRows?: number }).updateRows ?? 0);
        },
        { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: 'the room never stored the notes' },
      )
      .toBeGreaterThanOrEqual(NOTE_COUNT);
    const before = visibleBoard(await getNotes(page));

    // Everyone leaves, and the process goes away.
    await opening.close();
    await server.restart();

    const returning = await browser.newContext();
    const page2 = await returning.newPage();
    await openBoard(page2, { boardId: board, origin: server.url });
    await waitForRenderedNotes(page2, NOTE_COUNT);
    const after = visibleBoard(await getNotes(page2));

    expect(after).toEqual(before);

    // Colours, positions and stacking are what the test compared; say it loudly
    // for the reader of the log.
    const colors = new Set(after.map((note) => (note as { color: StickyColor }).color));
    expect(colors.size).toBeGreaterThan(1);

    await returning.close();
  });

  test('TC-20: leave immediately - a note written a moment ago is still there', async ({ browser }) => {
    test.setTimeout(180_000);

    const alexContext = await browser.newContext();
    const alex = await alexContext.newPage();
    const board = await openBoard(alex, { origin: server.url });

    const samContext = await browser.newContext();
    const sam = await samContext.newPage();
    await openBoard(sam, { boardId: board, origin: server.url });

    await alex.evaluate(() => {
      const api = (window as unknown as {
        __vidi6?: { createNote(params: { at: { x: number; y: number }; text: string }): string };
      }).__vidi6;
      api?.createNote({ at: { x: 0, y: 0 }, text: 'written seconds before the crash' });
    });

    // The note is visible to Sam: it has already been stored and broadcast.
    await expect
      .poll(async () => (await getNotes(sam)).map((note) => note.text), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      })
      .toEqual(['written seconds before the crash']);
    const seenAt = Date.now();

    // No goodbye, no graceful shutdown: both pages close and the process is
    // killed with SIGKILL, so nothing can flush on the way out.
    await Promise.all([alexContext.close(), samContext.close()]);
    await server.restart({ hard: true });
    const killedAt = Date.now();

    const latecomer = await browser.newContext();
    const page = await latecomer.newPage();
    await openBoard(page, { boardId: board, origin: server.url });
    await waitForRenderedNotes(page, 1);

    expect((await getNotes(page)).map((note) => note.text)).toEqual([
      'written seconds before the crash',
    ]);

    console.log(
      `TC-20 window from "visible to Sam" to "process killed": ${killedAt - seenAt} ms ` +
        '(logged; the guarantee is that the note survived, not how short the window was)',
    );

    await latecomer.close();
  });

  test('TC-21: big board open - a stored board loads in one go', async ({ browser }) => {
    test.setTimeout(300_000);

    const seeding = await browser.newContext();
    const page = await seeding.newPage();
    const board = await openBoard(page, { origin: server.url });

    const seeded = await page.evaluate((count) => {
      const api = (window as unknown as {
        __vidi6?: {
          createNotes(params: {
            count: number;
            area: { x: number; y: number; width: number; height: number };
          }): number;
        }
      }).__vidi6;
      if (!api) {
        throw new Error('test hooks are not installed');
      }
      return api.createNotes({
        count,
        area: { x: -1500, y: -1200, width: 3000, height: 2400 },
      });
    }, PERSIST_TESTED_NOTES);
    expect(seeded).toBe(PERSIST_TESTED_NOTES);
    await waitForRenderedNotes(page, PERSIST_TESTED_NOTES);

    // Stored before anything is measured: the room has taken the whole board.
    await expect
      .poll(
        async () => {
          const stats = (await callHook(server, board, 'stats', 'GET')).stats as {
            updateBytes?: number;
            snapshotBytes?: number;
          };
          return (stats.updateBytes ?? 0) + (stats.snapshotBytes ?? 0);
        },
        { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: 'the room never stored the big board' },
      )
      .toBeGreaterThan(100_000);

    // Put the board in a snapshot before the restart, so the load path being
    // timed is the snapshot path a big board normally takes.
    const compacted = await callHook(server, board, 'compact');
    expect(compacted.ok).toBe(true);
    const stored = (await callHook(server, board, 'stats', 'GET')).stats as {
      snapshotBytes?: number;
      updateRows?: number;
    };
    expect(Number(stored.snapshotBytes ?? 0)).toBeGreaterThan(100_000);
    expect(Number(stored.updateRows ?? 1)).toBe(0);

    await seeding.close();
    await server.restart();

    const opening = await browser.newContext();
    const page2 = await opening.newPage();
    const startedAt = Date.now();
    await openBoard(page2, { boardId: board, origin: server.url });
    await waitForRenderedNotes(page2, PERSIST_TESTED_NOTES);
    const elapsedMs = Date.now() - startedAt;

    expect(await renderedNoteCount(page2)).toBe(PERSIST_TESTED_NOTES);
    expect((await getNotes(page2)).length).toBe(PERSIST_TESTED_NOTES);

    console.log(
      `TC-21 board open: ${elapsedMs} ms for ${PERSIST_TESTED_NOTES} notes ` +
        `(BOARD_LOAD_BUDGET_MS = ${BOARD_LOAD_BUDGET_MS} ms, reported not asserted: ` +
        `model, browser and server share this machine)`,
    );

    await opening.close();
  });

  test('guard: a board nobody edited is still empty after a restart', async ({ browser }) => {
    test.setTimeout(180_000);

    const opening = await browser.newContext();
    const page = await opening.newPage();
    const board = await openBoard(page, { origin: server.url });
    await waitForRenderedNotes(page, 0);
    await opening.close();
    await server.restart();

    const returning = await browser.newContext();
    const page2 = await returning.newPage();
    await openBoard(page2, { boardId: board, origin: server.url });
    expect(await renderedNoteCount(page2)).toBe(0);
    await returning.close();
  });
});
