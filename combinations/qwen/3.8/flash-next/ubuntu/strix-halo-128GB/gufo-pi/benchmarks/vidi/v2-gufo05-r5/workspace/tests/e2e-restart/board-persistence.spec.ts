/**
 * Story 4's e2e tests: coming back to a board after the process that served it is gone.
 *
 * These run against a `wrangler dev` process the test starts and kills (see
 * `../e2e/helpers/wrangler-process.ts`), over a storage directory of its own, because the claims
 * under test are "the board was on disk, not in memory". The suite's shared server is left alone:
 * these tests never talk to it, and it is never killed.
 *
 * The three workflows are the story's three moments of risk:
 * - **TC-19 "Overnight return"**: a board built by hand in the browser, closed, killed, reopened;
 * - **TC-20 "Leave immediately"**: the tab is closed and the server killed within a second of the
 *   change becoming visible to somebody else - the tightest case the append-before-broadcast
 *   guarantee has to cover;
 * - **TC-21 "Big board open"**: the board the PRD describes opening completely, with the time it
 *   took reported rather than asserted, because the model, the browser and the server are sharing
 *   one machine.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  doubleClickToCreate,
  getNotes,
  noteById,
  stopEditing,
  typeIntoEditor,
} from '../e2e/helpers/notes';
import { setCamera } from '../e2e/helpers/board';
import {
  PARTICIPANT_NAMES,
  boardUrl,
  closeParticipants,
  notesOf,
  waitForBoard,
  type Participant,
} from '../e2e/helpers/participants';
import { WranglerProcess } from '../e2e/helpers/wrangler-process';
import { readBoard, seedBoard } from '../e2e/helpers/seed-board';
import { newBoardId } from '../../src/shared/board-id';
import {
  BOARD_LOAD_BUDGET_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
  type StickyColor,
} from '../../src/shared/config';
import type { StickySnapshot } from '../../src/shared/board-model';

/**
 * Opens one tab on a server this test owns.
 *
 * The suite's `baseURL` is the shared server, so the address here is absolute; everything else is
 * the ordinary participant the rest of the suite uses, including the test-build board hook.
 */
async function openTab(
  browser: Browser,
  server: WranglerProcess,
  boardId: string,
  index = 0,
): Promise<Participant> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const participant: Participant = {
    name: PARTICIPANT_NAMES[index] ?? `Person ${index + 1}`,
    context,
    page,
    consoleErrors: [],
  };
  page.on('console', (message) => {
    if (message.type() === 'error') participant.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => participant.consoleErrors.push(String(error)));
  await page.goto(`${server.baseUrl}${boardUrl(boardId)}`);
  await waitForBoard(participant);
  return participant;
}

const NOTE_TEXTS = [
  'Deploy went smoothly, no rollbacks.',
  'The import tool is slow and everybody notices.',
  'Search would save ten minutes a day.',
  'Nobody knew who moved this note',
  'Board export keeps forgetting the colours.',
];

/**
 * The camera the board is built under: pulled back so that a person's whole board fits on one
 * screen (a sticky is 200 world units, so at 0.42 it is 84 pixels) and, more usefully, so that the
 * same screen cells map to the same world places before and after the restart. The camera itself is
 * nobody else's business - the reopened tab gets the default one and this test sets it again.
 */
const BOARD_CAMERA = { x: 0, y: 0, zoom: 0.42 };
/** Screen cells for the notes: seven columns, one hundred pixels apart, clear of the toolbar. */
const spotFor = (index: number): { x: number; y: number } => ({
  x: 240 + (index % 7) * 100,
  y: 200 + Math.floor(index / 7) * 100,
});
/** Somewhere on the board with nothing on it, before and after the restart. */
const FREE_SPOT = { x: 1080, y: 690 };

/** The ids of the notes on a page, so a new one can be recognised. */
async function noteIds(page: Page): Promise<Set<string>> {
  return new Set((await getNotes(page)).map((note) => note.id));
}

/**
 * Builds a board through the interface a person uses: twenty-five notes with real text in all six
 * colours, several of them dragged to overlap the note behind them, one deleted.
 *
 * It returns once the board is on the page, which - given the story - means it is also in storage.
 * `notes + 1` are made and one is thrown away, so what is left is `notes` notes plus a deletion.
 */
async function buildBoardByHand(page: Page, notes: number): Promise<void> {
  const colors = Object.keys(STICKY_COLORS) as StickyColor[];
  await setCamera(page, BOARD_CAMERA);
  for (let index = 0; index <= notes; index += 1) {
    const spot = spotFor(index);
    const before = await noteIds(page);
    await doubleClickToCreate(page, spot);
    await typeIntoEditor(page, NOTE_TEXTS[index % NOTE_TEXTS.length] ?? '');
    if (index % 9 === 4) {
      // and one of them has a second line, which only a real Enter key produces
      await page.keyboard.press('Enter');
      await page.keyboard.type('a second line, typed the way a person types it');
    }
    await stopEditing(page);

    const created = (await getNotes(page)).find((note) => !before.has(note.id));
    if (!created) throw new Error(`note ${index + 1} never appeared on the board`);

    if (index % 2 === 1) {
      // the note is still selected after editing, so the swatch recolours exactly that note
      const color = colors[Math.floor(index / 2) % colors.length] as StickyColor;
      await page.getByLabel(`${color[0]?.toUpperCase()}${color.slice(1)} colour`).click();
    }
    if (index % 3 === 2) {
      // dragging drops it over its neighbour and raises it: stacking is part of the board
      const box = await noteById(page, created.id).boundingBox();
      if (!box) throw new Error('the note this test just made is not on the screen');
      const from = { x: box.x + box.width / 2, y: box.y + 8 };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 50, from.y + 40, { steps: 6 });
      await page.mouse.up();
    }
  }
  // and one of them is thrown away, so "everything came back" includes the deletion
  const last = (await getNotes(page)).at(-1);
  if (!last) throw new Error('the board has no notes to delete');
  await noteById(page, last.id).click();
  await page.keyboard.press('Delete');
}

/** The notes, in a form whose failure message a person can read. */
function describe(notes: readonly StickySnapshot[]): string {
  return notes
    .map((note) => `${note.id.slice(0, 6)}:${note.text.slice(0, 18)}@${note.x},${note.y}#${note.z}`)
    .join('\n');
}

test.describe('overnight return (TC-19)', () => {
  test('TC-19 a board left yesterday is the board you open today', async ({ browser }) => {
    test.setTimeout(300_000);
    const server = new WranglerProcess(test.info().workerIndex);
    await server.start();
    const boardId = newBoardId();
    try {
      const alex = await openTab(browser, server, boardId);
      await buildBoardByHand(alex.page, 25);

      const left = await notesOf(alex);
      expect(left).toHaveLength(25);
      // the board this test is about is not a trivial one: colours, text and stacking order
      expect(new Set(left.map((note) => note.color)).size).toBeGreaterThan(3);
      expect(left.some((note) => note.text.includes('\n'))).toBe(true);
      expect(new Set(left.map((note) => note.z)).size).toBe(left.length);

      await closeParticipants([alex]);
      await server.restart();

      const back = await openTab(browser, server, boardId);
      await expect
        .poll(() => notesOf(back).then((notes) => notes.length), {
          message: 'the board did not come back',
          timeout: E2E_EVENTUAL_TIMEOUT_MS,
        })
        .toBe(25);

      const returned = await notesOf(back);
      expect(returned.map((note) => [note.id, note.x, note.y, note.color, note.text, note.z])).toEqual(
        left.map((note) => [note.id, note.x, note.y, note.color, note.text, note.z]),
      );
      expect(describe(returned)).toBe(describe(left));
      expect(back.consoleErrors).toEqual([]);

      // and it is still a board a person can work on, not a museum piece
      await setCamera(back.page, BOARD_CAMERA);
      await doubleClickToCreate(back.page, FREE_SPOT);
      await typeIntoEditor(back.page, 'back again today');
      await stopEditing(back.page);
      await expect
        .poll(() => notesOf(back).then((notes) => notes.length), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(26);

      await closeParticipants([back]);
    } finally {
      await server.dispose();
    }
  });
});

test.describe('leaving immediately (TC-20)', () => {
  test('TC-20 a note the other person can already see survives being switched off', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const server = new WranglerProcess(test.info().workerIndex);
    await server.start();
    const boardId = newBoardId();
    try {
      const alex = await openTab(browser, server, boardId, 0);
      const sam = await openTab(browser, server, boardId, 1);

      const text = 'written down and the lid closed straight away';
      await doubleClickToCreate(alex.page, { x: 420, y: 320 });
      await typeIntoEditor(alex.page, text);
      await stopEditing(alex.page);

      await expect
        .poll(() => notesOf(sam).then((notes) => notes.at(0)?.text ?? ''), {
          message: 'Sam never saw the note',
          timeout: E2E_EVENTUAL_TIMEOUT_MS,
        })
        .toBe(text);

      // the story's tightest moment: from "Sam can see it" to "the process is dead" is under a
      // second, with the tabs closed first, so nothing but what the server wrote can survive
      const seen = Date.now();
      await closeParticipants([alex, sam]);
      await server.stop();
      const gap = Date.now() - seen;
      expect(gap).toBeLessThan(1000);

      await server.start();
      const back = await openTab(browser, server, boardId);
      await expect
        .poll(() => notesOf(back).then((notes) => notes.length), {
          message: `the note was visible to Sam for ${gap}ms and then lost`,
          timeout: E2E_EVENTUAL_TIMEOUT_MS,
        })
        .toBe(1);
      expect((await notesOf(back)).at(0)?.text).toBe(text);

      await closeParticipants([back]);
    } finally {
      await server.dispose();
    }
  });
});

test.describe('a big board opening (TC-21)', () => {
  test('TC-21 the biggest board this product is tested with opens completely', async ({
    browser,
  }) => {
    test.setTimeout(900_000);
    const server = new WranglerProcess(test.info().workerIndex);
    await server.start();
    const boardId = newBoardId();
    try {
      const seeding = Date.now();
      const seeded = await seedBoard(server.wsUrl, boardId, PERSIST_TESTED_NOTES).catch(
        (error: unknown) => {
          throw new Error(`${String(error)}\nthe server said:\n${server.log}`);
        },
      );
      console.log(
        `TC-21 seeding ${PERSIST_TESTED_NOTES} notes took ${Date.now() - seeding}ms ` +
          `(server storage: ${server.persistDir})`,
      );
      expect(seeded).toHaveLength(PERSIST_TESTED_NOTES);

      // the process that received all of that is killed; the one that serves the browser has
      // only what is in the database
      await server.restart();

      // read back without a browser first: a cheap confirmation that the board is in storage, and
      // a load measurement with no rendering in it at all
      const reading = Date.now();
      const stored = await readBoard(server.wsUrl, boardId, PERSIST_TESTED_NOTES);
      const readBack = Date.now() - reading;
      expect(stored).toHaveLength(PERSIST_TESTED_NOTES);
      console.log(`TC-21 first load after the restart, no browser: ${readBack}ms`);

      // killed once more, because what the browser is meant to measure is a cold load and not the
      // room that check has just woken up
      await server.restart();

      const openedAt = Date.now();
      const tab = await openTab(browser, server, boardId);
      const noteElements = tab.page.locator('[data-note-id]');
      await expect
        .poll(() => noteElements.count(), {
          message: `the board did not render ${PERSIST_TESTED_NOTES} notes`,
          timeout: E2E_EVENTUAL_TIMEOUT_MS,
          intervals: [100],
        })
        .toBe(PERSIST_TESTED_NOTES);
      const rendered = Date.now() - openedAt;

      const notes = await notesOf(tab);
      expect(notes).toHaveLength(PERSIST_TESTED_NOTES);
      expect(JSON.stringify(notes)).toBe(JSON.stringify(seeded));
      expect(tab.consoleErrors).toEqual([]);

      const verdict = rendered > BOARD_LOAD_BUDGET_MS ? 'over' : 'within';
      console.log(
        `TC-21 board open: ${rendered}ms from navigation to ${PERSIST_TESTED_NOTES} notes rendered ` +
          `(budget ${BOARD_LOAD_BUDGET_MS}ms: ${verdict}) - reported, not asserted, because the ` +
          `model, the browser and the server share this machine. The same board read over a ` +
          `WebSocket with no rendering at all took ${readBack}ms, so the difference is loading the ` +
          `app and putting ${PERSIST_TESTED_NOTES} elements on screen, not reading it from storage.`,
      );

      await closeParticipants([tab]);
    } finally {
      await server.dispose();
    }
  });
});
