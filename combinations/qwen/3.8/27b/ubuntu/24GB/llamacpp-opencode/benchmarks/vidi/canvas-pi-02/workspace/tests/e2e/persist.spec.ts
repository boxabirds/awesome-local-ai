import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  BOARD_LOAD_BUDGET_MS,
  PERSIST_TESTED_NOTES,
} from '../../src/shared/config';
import { COMPACTION_UPDATE_COUNT } from '../../src/shared/config';
import { getNotes, setCamera, type NoteInfo } from './helpers/board';
import { expectLoadFailed, expectNoteCountWithin, freshBoardId, join } from './helpers/participants';
import { WranglerProcess, PERSIST_URL } from './helpers/wrangler-process';
import { seedBoard, seedBoardWithCompaction } from './helpers/seed-board';

/** The red badge text (ConnectionStatus, persist.client_status). */
const LOAD_FAILED_TEXT = 'This board couldn’t be loaded. Retrying…';

/** POST a test hook and fail the test if the worker rejected it. */
async function hook(path: string): Promise<void> {
  const res = await fetch(`${PERSIST_URL}/__test/boards/${path}`, { method: 'POST' });
  if (res.status !== 204) {
    throw new Error(`hook ${path} returned ${res.status}: ${await res.text()}`);
  }
}

/**
 * Story 4 e2e: persistence across REAL process restarts (TC-19..TC-21).
 *
 * Each test owns a `wrangler dev --persist-to <tmp dir>` process
 * (helpers/wrangler-process.ts): create data, SIGKILL the process (no
 * graceful shutdown — memory is gone, the SQLite files remain), restart it
 * on the same directory, and prove the data is back. This config has no
 * shared webServer for exactly this reason.
 *
 * The camera is HOME_CAMERA for every participant (helpers/participants.ts):
 * screen = world - (-640, -400) at zoom 1, so world (wx, wy) renders at
 * screen (640 + wx, 400 + wy).
 */

/** The overnight-return promise: text, colour, position and stacking. */
type NoteSignature = { x: number; y: number; text: string; color: string; z: number };

const signature = (notes: NoteInfo[]): NoteSignature[] =>
  notes.map((n) => ({ x: n.x, y: n.y, text: n.text, color: n.color, z: n.z }));

const TA = (page: Page) => page.getByRole('textbox', { name: 'Sticky note text' });

/** 25 varied notes in a 5x5 grid that fits the 1280x800 viewport. */
const NOTE_COUNT = 25;
const COLORS = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'] as const;
const TEXTS = [
  'ship it',
  'call the team',
  'why does this break?',
  'buy coffee',
  'ask Sam for the key',
  'refactor the loader',
  'it works on my machine',
  'do not merge yet',
  'write the tests first',
  'check the budget',
  'rename this thing',
  'parking spot free?',
  'follow up Monday',
  'the cache is cold',
  'who owns this board?',
  'measure, do not guess',
  'delete the dead code',
  'lunch at two',
  'the snapshot grew',
  'one more regression',
  'ship the hotfix',
  'write it down',
  'tell the on-call',
  'reproduce it locally',
  'done for today',
];

/** Create one note (double-click), type its text, set its colour. */
async function createVariedNote(
  page: Page,
  sx: number,
  sy: number,
  text: string,
  color: string,
): Promise<void> {
  await page.mouse.dblclick(sx, sy);
  await expect(TA(page)).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  // Select (idempotent) so the toolbar is up, then pick the swatch.
  await page.mouse.click(sx, sy);
  const cap = color[0]!.toUpperCase() + color.slice(1);
  await page.getByRole('button', { name: `${cap} colour` }).click();
  await page.keyboard.press('Escape');
}

test.describe('persist.e2e', () => {
  test('TC-19 overnight return: a board of 25 notes survives a process kill', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const boardId = freshBoardId();
    const wp = new WranglerProcess();
    let t0 = Date.now();
    await wp.start();
    console.log(`TC-19: wrangler ready in ${Date.now() - t0}ms`);
    try {
      // Phase 1 — a day of work: 25 varied notes in a 5x5 world grid
      // (wider than the viewport — the camera is panned to each one).
      const alex = await join(browser, boardId);
      for (let i = 0; i < NOTE_COUNT; i += 1) {
        const col = i % 5;
        const row = Math.floor(i / 5);
        const wx = col * 240 - 480;
        const wy = row * 220 - 440;
        // Frame the target point at the screen centre so the note AND its
        // toolbar (which floats above the note) are always in view.
        await setCamera(alex.page, { x: wx - 640, y: wy - 400, zoom: 1 });
        await createVariedNote(alex.page, 640, 400, TEXTS[i]!, COLORS[i % COLORS.length]!);
      }
      // A second client proves the room itself holds every update (the
      // room only broadcasts what it has already stored), so the kill
      // below cannot lose anything Sam sees.
      const sam = await join(browser, boardId);
      await expect
        .poll(async () => (await getNotes(sam.page)).length, {
          timeout: 30_000,
          intervals: [50],
          message: 'room (as seen by sam) holds all 25 notes',
        })
        .toBe(NOTE_COUNT);
      const before = signature(await getNotes(sam.page));
      await Promise.all([alex.close(), sam.close()]); // close the browser

      // Phase 2 — the machine goes down: SIGKILL, no graceful shutdown.
      await wp.kill();

      // Phase 3 — return: the same persistence directory, a fresh process.
      t0 = Date.now();
      await wp.start();
      console.log(`TC-19: wrangler restarted in ${Date.now() - t0}ms`);
      const returned = await join(browser, boardId);
      const after = signature(await getNotes(returned.page));
      expect(after).toEqual(before);
      await returned.close();
    } finally {
      await wp.dispose();
    }
  });

  test('TC-20 leave immediately: a just-seen note survives a 1-second exit', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const boardId = freshBoardId();
    const wp = new WranglerProcess();
    await wp.start();
    try {
      const alex = await join(browser, boardId);
      const sam = await join(browser, boardId);
      await alex.page.mouse.dblclick(640, 400);
      await expect(TA(alex.page)).toBeFocused();
      await alex.page.keyboard.type('leave immediately');
      await alex.page.keyboard.press('Escape');
      // Poll until the note is fully visible to Sam. Write-before-broadcast
      // means every update Sam can see was already appended (durable), so
      // once Sam sees the full text, the kill below cannot lose it.
      await expect
        .poll(
          async () =>
            (await getNotes(sam.page)).find((n) => n.text === 'leave immediately') !== undefined,
          { timeout: 15_000, intervals: [50] },
        )
        .toBe(true);

      // Within 1 s: close both contexts and kill the process.
      const t0 = Date.now();
      await Promise.all([alex.close(), sam.close()]);
      await wp.kill();
      const exitMs = Date.now() - t0;
      console.log(`TC-20: both contexts closed and process killed in ${exitMs}ms`);
      expect(exitMs).toBeLessThan(1_000);

      // Restart and reopen: the note is there.
      await wp.start();
      const reopened = await join(browser, boardId);
      await expectNoteCountWithin(reopened, 1);
      const note = (await getNotes(reopened.page))[0];
      expect(note?.text).toBe('leave immediately');
      await reopened.close();
    } finally {
      await wp.dispose();
    }
  });

  test('TC-21 big board open: 2000 notes render within the load budget', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const boardId = freshBoardId();
    const wp = new WranglerProcess();
    let t0 = Date.now();
    await wp.start();
    console.log(`TC-21: wrangler ready in ${Date.now() - t0}ms`);
    try {
      t0 = Date.now();
      await seedBoard(boardId, PERSIST_TESTED_NOTES);
      console.log(`TC-21: seeded ${PERSIST_TESTED_NOTES} notes in ${Date.now() - t0}ms`);
      // A margin for the room's append to be durable before the browser
      // measures its load (the seed connection has already closed).
      await new Promise((r) => setTimeout(r, 1_000));

      // Fresh context: navigation start → all note elements rendered.
      // (Design TC-21: "seed board, open fresh context, measure navigation
      // start → all note elements rendered".) The font fit settles a frame or
      // two later (persist.large_board), which is exactly why the criterion
      // is the rendered note elements, not the fitted font.
      const context = await browser.newContext();
      const page = await context.newPage();
      t0 = performance.now();
      await page.goto(`/b/${boardId}`);
      await expect
        .poll(async () => page.locator('.vidi6-sticky').count(), {
          timeout: 60_000,
          intervals: [50],
          message: 'all note elements rendered',
        })
        .toBe(PERSIST_TESTED_NOTES);
      const loadMs = performance.now() - t0;
      console.log(
        `TC-21: ${PERSIST_TESTED_NOTES} notes rendered ${Math.round(loadMs)}ms after navigation start ` +
          `(budget ${BOARD_LOAD_BUDGET_MS}ms)`,
      );
      expect(loadMs).toBeLessThanOrEqual(BOARD_LOAD_BUDGET_MS);
      await context.close();
    } finally {
      await wp.dispose();
    }
  });

  test('TC-24 broken board: an unreadable snapshot locks the board until repaired', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const boardId = freshBoardId();
    const wp = new WranglerProcess({ testHooks: true });
    await wp.start();
    try {
      // Phase 1 — a day of work pushed past the compaction threshold, so the
      // board's state lives in a chunked snapshot (not just the update log):
      // 25 varied notes (one update each) plus filler toggles up to exactly
      // COMPACTION_UPDATE_COUNT appends — the last one compacts the log.
      await seedBoardWithCompaction(boardId, NOTE_COUNT, COMPACTION_UPDATE_COUNT, (i) => ({
        x: (i % 5) * 240 - 480,
        y: Math.floor(i / 5) * 220 - 440,
        text: TEXTS[i]!,
        color: COLORS[i % COLORS.length]!,
      }));

      // Precondition: the board loads with all 25 notes (snapshot intact).
      const alex = await join(browser, boardId);
      await expectNoteCountWithin(alex, NOTE_COUNT);
      const before = signature(await getNotes(alex.page));
      await alex.close();

      // Phase 2 — the snapshot becomes unreadable (a torn write / flipped
      // chunk — the failure mode the red badge exists for). The room may
      // still hold a live in-memory doc (workerd keeps idle instances), so
      // the hibernate hook discards it: the next connection MUST load from
      // the now-corrupted storage, exactly as a platform-reconstructed
      // object would.
      await hook(boardId + '/corrupt-snapshot');
      await hook(boardId + '/hibernate');

      // Phase 3 — a fresh visitor: red badge, empty (locked) board.
      const sam = await join(browser, boardId, { expectState: 'load_failed' });
      const badge = sam.page.getByText(LOAD_FAILED_TEXT);
      await expect(badge).toBeVisible();
      // Locked: board dblclick and the Sticky note button create nothing.
      await sam.page.mouse.dblclick(640, 400);
      expect((await getNotes(sam.page)).length).toBe(0);
      const createButton = sam.page.getByRole('button', { name: 'Sticky note' });
      await expect(createButton).toBeDisabled();

      // Phase 4 — storage heals; the client's own retry recovers (no reload).
      await hook(boardId + '/repair');
      await expect(badge).toBeHidden({ timeout: 30_000 });
      await expectNoteCountWithin(sam, NOTE_COUNT);
      expect(signature(await getNotes(sam.page))).toEqual(before);

      // Editing works again: a double-click creates a 26th note. Pan to an
      // empty area first — the 5x5 grid covers the home-camera centre.
      await setCamera(sam.page, { x: -640 - 800, y: -400 - 700, zoom: 1 });
      await sam.page.mouse.dblclick(640, 400);
      const created = sam.page.getByRole('textbox', { name: 'Sticky note text' });
      await expect(created).toBeFocused();
      await sam.page.keyboard.press('Escape');
      expect((await getNotes(sam.page)).length).toBe(NOTE_COUNT + 1);
      await sam.close();
    } finally {
      await wp.dispose();
    }
  });
});
