/**
 * Persistence in the browser, across a server that is really restarted (TC-19 to TC-21).
 *
 * These three tests do not use the suite's shared dev server: each one starts its own
 * `wrangler dev` on its own port, over its own storage directory, kills it with a signal,
 * and starts another one over the same directory. That is the only honest way to ask
 * "did the board survive a process that forgot everything" - the shared server has to stay
 * up for the rest of the suite, and a board that survives only because the same process
 * remembered it is not the thing this story promises.
 *
 * Chromium only, like the capacity soak: these own a server process each, and running that
 * four times over for four browser configurations would be the same test four times.
 */

import { expect } from '@playwright/test';

import { test } from './fixtures.js';
import { openParticipants, closeParticipants, type Participant } from './helpers/participants.js';
import {
  boardIdOf,
  docNotes,
  notes,
  stickyToolbarButton,
  typeIntoOpenEditor,
  waitForNoteCount,
} from './helpers/sticky.js';
import {
  drawnNotes,
  expectVariedBoard,
  fillBoard,
  noteBoxes,
  noteIds,
} from './helpers/board-content.js';
import { startWrangler, type WranglerProcess } from './helpers/wrangler-process.js';
import { describeDifference, phrase } from '../fixtures/boards.js';
import { STICKY_COLOR_NAMES, PERSIST_TESTED_NOTES, BOARD_LOAD_BUDGET_MS } from '../../src/shared/config.js';

/*
 * The port these tests restart a server on: 24214, two past the suite's own dev server at
 * 24212 (see NOTES.md for the port map). `wrangler-process.ts` moves to the next pair if
 * that one is already held, and says so in the log.
 */
const PORT = Number(process.env.E2E_PERSIST_PORT ?? 24214);

// These tests start and kill a server of their own. Running that once per browser
// configuration would be the same persistence test four times, and the persistence
// of a SQLite file does not depend on which browser asked for it.
test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'these tests start and kill a server of their own; once is enough (chromium)',
  );
});

test('TC-19 comes back to a board the next day and finds all 25 notes as they were left', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const server: WranglerProcess = await startWrangler({ port: PORT });
  try {
    const path = await server.newBoardPath();
    const alex = await openParticipants(browser, ['Alex'], server.urlFor(path));
    const page = alex[0]!.page;

    const left = await fillBoard(page, 25);
    const drawn = await noteBoxes(page);
    const ids = await noteIds(page);
    // The board that was left is a board with variety in it, or this test would be
    // proving that 25 identical notes round-trip.
    await expectVariedBoard(page, 25);

    // The browser goes away. Nothing is asked of the server first: no flush, no
    // "save" - the changes were written when they happened.
    await closeParticipants(alex);

    // The process is killed and another one starts over the same directory. Everything
    // it knew about this board is gone; the SQLite file is all that is left.
    await server.restart();

    const back = await openParticipants(browser, ['Alex'], server.urlFor(path));
    const page2 = back[0]!.page;
    await waitForNoteCount(page2, 25);
    const returned = await drawnNotes(page2);

    // Text, colour, position and stacking, note by note, and the ids too: this is the
    // same board, not a board that looks like it.
    expect(describeDifference(returned, left)).toBe('');
    // And it is drawn the same way: the same notes, in the same drawing order, in the
    // same boxes.
    expect(await noteIds(page2)).toEqual(ids);
    expect(await noteBoxes(page2)).toEqual(drawn);

    await closeParticipants(back);
  } finally {
    await server.dispose();
  }
});

test('TC-20 a note that the other person already saw is there after the server dies one second later', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const server = await startWrangler({ port: PORT });
  try {
    const path = await server.newBoardPath();
    const people = await openParticipants(browser, ['Alex', 'Sam'], server.urlFor(path));
    const [alex, sam] = people as [Participant, Participant];

    await stickyToolbarButton(alex.page).click();
    const text = 'written a second before the server died';
    await typeIntoOpenEditor(alex.page, text);

    // The point of the test: Sam can see it. The room writes a change before it tells
    // anyone, so at the moment it becomes visible the row exists - and "the row exists"
    // is asked of the server from outside it, because a board that is only in this
    // process's memory also looks saved.
    await expect
      .poll(async () => (await docNotes(sam.page)).some((note) => note.text === text), {
        message: 'Sam never saw the note',
      })
      .toBe(true);
    const stored = await server.hook(await boardIdOf(sam.page), 'state');
    expect(stored.json).toMatchObject({ ok: true });
    expect(Number(stored.json['updateRows']) + Number(stored.json['chunkRows'])).toBeGreaterThan(0);

    // And now everybody leaves and the process dies, promptly: there is no graceful
    // shutdown here to wait for, and the less time between the change and the kill the
    // stronger the claim. If closing ever costs a second, this test stops meaning what
    // it says, so it says so.
    const startedClosing = Date.now();
    await closeParticipants(people);
    await server.stop();
    const closedAfter = Date.now() - startedClosing;
    console.log(`[e2e] TC-20 the server was killed ${closedAfter} ms after the change was seen`);
    expect(closedAfter).toBeLessThan(1_000);

    await server.start();
    const back = await openParticipants(browser, ['Alex'], server.urlFor(path));
    await waitForNoteCount(back[0]!.page, 1);
    const notes2 = await drawnNotes(back[0]!.page);
    expect(notes2.map((note) => note.text)).toEqual([text]);
    await closeParticipants(back);
  } finally {
    await server.dispose();
  }
});

test('TC-21 opens a board of every note the design had us test with, and reports how long it took', async ({
  browser,
}) => {
  test.setTimeout(600_000);
  const server = await startWrangler({ port: PORT });
  try {
    const path = await server.newBoardPath();
    // Somebody has to be on the board for the room to be holding it, and the notes have
    // to come in through the room's own update path - the seed route writes with the
    // model functions and the same storage call a client's change goes through.
    const holder = await openParticipants(browser, ['Alex'], server.urlFor(path));
    const boardId = await boardIdOf(holder[0]!.page);

    // Realistic text: the words the board's own test vocabulary is made of, one phrase
    // per note, so that what comes back can be checked note by note rather than by
    // counting notes that all say the same thing.
    const texts = Array.from({ length: PERSIST_TESTED_NOTES }, (_unused, index) => phrase(index + 1));
    const seeded = await server.hook(boardId, 'seed', { notes: PERSIST_TESTED_NOTES, texts });
    expect(seeded.status).toBe(200);
    expect(seeded.json).toMatchObject({ ok: true, added: PERSIST_TESTED_NOTES });

    // What the board looks like now that it is full: the room folded its own log on the
    // way in - 4,000 changes pass the compaction threshold many times over - so this is a
    // board that opens from a snapshot plus a short log, which is what a board that has
    // had a busy day is. Nothing here asks for the fold: a board that only reaches a
    // snapshot because a test asked for one is not the board the PRD is about.
    const full = await server.hook(boardId, 'state');
    expect(full.json).toMatchObject({ ok: true });
    const chunkRows = Number(full.json['chunkRows']);
    const logRows = Number(full.json['updateRows']);
    expect(chunkRows).toBeGreaterThan(0);
    expect(logRows).toBeLessThan(PERSIST_TESTED_NOTES);
    console.log(
      `[e2e] TC-21 ${PERSIST_TESTED_NOTES} notes in ${chunkRows} snapshot chunk(s) plus ` +
        `${logRows} log row(s), folded by the room itself as it went`,
    );

    // The person holding the board leaves, and the server is restarted: the board the
    // next page opens has to come out of the file.
    await closeParticipants(holder);
    await server.restart();

    const opener = await openParticipants(browser, ['Alex'], server.urlFor(path));
    const page = opener[0]!.page;

    // Time from this page's own navigation start to the moment every note is in the
    // document *and* drawn. `performance.now()` runs from navigation start, so the number
    // covers fetching the page, booting, connecting, the board arriving and the notes
    // being put on screen - the thing the PRD's three seconds is about. It is sampled from
    // the page, not from the test, because the test's own polls are not part of the page's
    // life. Notes outside the viewport are in the document and drawn too: the PRD's
    // "visible after zooming out" is this DOM, at a zoom that would show the whole board.
    const handle = await page.waitForFunction(
      (count: number) => {
        const hooks = window.__vidi6Board;
        if (!hooks || hooks.getNotes().length !== count) return false;
        return document.querySelectorAll('[data-testid="sticky-note"]').length === count
          ? performance.now()
          : false;
      },
      PERSIST_TESTED_NOTES,
      { timeout: 180_000 },
    );
    const openMs = Number(await handle.jsonValue());

    // The budget is reported, not asserted: the model, the browser, the room and its
    // SQLite are all on this one machine, sharing its CPU with the test runner (design
    // "Not covered"). A number that is asserted on a machine like this is a number that
    // gets lowered until it means nothing.
    console.log(
      `[e2e] TC-21 opened ${PERSIST_TESTED_NOTES} notes ${
        openMs <= BOARD_LOAD_BUDGET_MS ? 'inside' : 'OVER'
      } budget: ${Math.round(openMs)} ms from navigation start to the last note drawn ` +
        `(budget ${BOARD_LOAD_BUDGET_MS} ms; reported, not asserted)`,
    );

    const back = await drawnNotes(page);
    expect(back).toHaveLength(PERSIST_TESTED_NOTES);
    await expect(notes(page)).toHaveCount(PERSIST_TESTED_NOTES);
    // Not "2,000 notes came back": the same 2,000 notes, each with its own text, colour,
    // place and stacking.
    expect(back.map((note) => note.text).sort()).toEqual([...texts].sort());
    expect(new Set(back.map((note) => note.color))).toEqual(new Set(STICKY_COLOR_NAMES));
    expect(new Set(back.map((note) => `${note.x},${note.y}`)).size).toBe(PERSIST_TESTED_NOTES);
    expect(new Set(back.map((note) => note.z)).size).toBe(PERSIST_TESTED_NOTES);
    // Reading a board is not writing one: all this page did was arrive and be given the
    // board, so the only thing in the log is its own arrival. Had the load been written
    // back, the log would hold the board again - thousands of rows - and a room that
    // stores what it loads grows every time anybody looks at it.
    const openRows = await server.hook(boardId, 'state');
    expect(openRows.json).toMatchObject({ ok: true });
    const rowsThisPageMade = Number(openRows.json['updateRows']);
    console.log(
      `[e2e] TC-21 the page that opened this board wrote ${rowsThisPageMade} log row(s) ` +
        `(its own arrival; the board it was handed is not written back)`,
    );
    expect(rowsThisPageMade).toBeLessThanOrEqual(4);
    // And folding it a second time leaves the snapshot as it was: one generation, not two.
    const refolded = await server.hook(boardId, 'compact');
    expect(refolded.json).toMatchObject({ ok: true, updateRows: 0 });
    expect(Number(refolded.json['chunkRows'])).toBe(chunkRows);
    expect(await drawnNotes(page)).toHaveLength(PERSIST_TESTED_NOTES);

    await closeParticipants(opener);
    expect(opener[0]!.consoleErrors).toEqual([]);
  } finally {
    await server.dispose();
  }
});
