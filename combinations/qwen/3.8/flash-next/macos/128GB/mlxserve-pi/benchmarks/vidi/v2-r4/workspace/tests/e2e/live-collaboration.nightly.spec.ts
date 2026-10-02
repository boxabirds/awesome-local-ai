/**
 * Story 3, the PRD's verification step 10: the two long checks.
 *
 * A board that works while people are typing and falls apart when they stop is
 * not a working board — 45 seconds of quiet is where a connection that cannot
 * keep itself alive dies, and an hour of other people's traffic is where a room
 * that forgets, or a client that is dropped for being quiet, shows up. Neither
 * fits in `npm run test:e2e`, so they are their own project:
 *
 *   npm run test:e2e:nightly
 *
 * They are still real tests with real assertions, run against the same build and
 * the same room as everything else; they simply take minutes rather than seconds.
 */
import { expect, test, type Page } from '@playwright/test';

import { IDLE_CAP_SOAK_MS, IDLE_STABILITY_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  createNote,
  dragNote,
  noteById,
  noteCentreOnScreen,
  noteEditor,
  notes,
  readNotes,
  typeIntoNote,
  type NoteState,
} from './helpers/notes';
import { setCamera, worldToScreen, type Point } from './helpers/board';
import { BoardSession } from './helpers/participants';
import { browserAvailable } from './helpers/browserAvailability';

/** The board the current test opened, closed after it whatever the test did next. */
let session: BoardSession | undefined;

async function openSession(
  browser: import('@playwright/test').Browser,
  names: readonly string[],
): Promise<BoardSession> {
  session = await BoardSession.open(browser, names);
  return session;
}

test.afterEach(async () => {
  const opened = session;
  session = undefined;
  await opened?.close();
});

/** The words the soak types, cycled through so every note fills up a little. */
const WORDS = ['idea', 'note', 'draft', 'check', 'again', 'more', 'later', 'done'];

/** Close a note that is open for typing, so every screen paints the same thing. */
async function stopTyping(page: Page, id: string): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(noteEditor(page, id)).toHaveCount(0);
}

/** A word nobody has typed into this note yet. */
const wordFor = (round: number): string => WORDS[round % WORDS.length] ?? 'word';

/** Move a note by a screen delta, and come back with where it ended up. */
async function moveNote(page: Page, note: NoteState, delta: Point): Promise<NoteState> {
  await dragNote(page, await noteCentreOnScreen(page, note), delta);
  return noteById(page, note.id);
}

/** Put this note on screen and open it for typing. */
async function openForTyping(page: Page, note: NoteState): Promise<void> {
  const centre = await noteCentreOnScreen(page, note);
  await page.mouse.click(centre.x, centre.y);
  await page.keyboard.press('Enter');
  await expect(noteEditor(page, note.id)).toBeFocused();
}

/**
 * A browser that cannot be launched in this environment (probed once by
 * playwright.config.ts) skips these tests rather than failing them.
 */
test.beforeEach(async ({}, testInfo) => {
  const name = testInfo.project.name;
  test.skip(
    !browserAvailable(name),
    `${name} cannot be launched in this environment (probed by playwright.config.ts)`,
  );
});

test.describe('live collaboration, at length', () => {
  test('TC-29 a board left alone for IDLE_STABILITY_MS stays connected, and the others let go of a browser that closes', async ({
    browser,
  }) => {
    test.setTimeout(IDLE_STABILITY_MS + 120_000);
    const session = await openSession(browser, ['Alex', 'Sam']);
    const alex = session.named('Alex').page;

    // One change before the quiet, so there is something for the two boards to be
    // in sync about, and something left on the screen afterwards.
    const note = await createNote(alex, { x: 400, y: 300 });
    await typeIntoNote(alex, 'left here overnight');
    await session.changeReachesEverybody('Alex', 'the note made before the quiet', (board) =>
      board.some((entry) => entry.id === note.id && entry.text === 'left here overnight'),
    );
    await stopTyping(alex, note.id);

    // The quiet: three quarters of a minute with nothing but the connection's own
    // keeping-itself-alive. No test input at all.
    await session.waitIdle(IDLE_STABILITY_MS);

    // Neither of them was dropped, and neither had to make a second connection.
    for (const name of ['Alex', 'Sam']) {
      expect(await session.connectionState(name)).toBe('connected');
      expect(await session.statusText(name)).toBeNull();
      expect(await session.socketsOpened(name)).toBe(1);
      expect(await session.socketsClosed(name)).toBe(0);
      expect(await session.consoleErrors(name)).toEqual([]);
    }
    expect(await session.everybodySeesTheSameBoard('both screens still show the same board')).toHaveLength(
      1,
    );

    // And the quiet board still works: a change made now arrives at once.
    const moved = await moveNote(alex, note, { x: 60, y: 0 });
    expect(moved.x).not.toBe(note.x);
    await session.changeReachesEverybody('Alex', 'a change made after the quiet', (board) =>
      board.some((entry) => entry.id === note.id && entry.x === moved.x),
    );

    // One browser closes. The other lets go of it: still connected on its own,
    // with the note still on the screen, and no attempt to chase the person who
    // went away.
    await session.leave('Sam');
    await alex.waitForTimeout(3_000);
    expect(await session.connectionState('Alex')).toBe('connected');
    expect(await session.socketsOpened('Alex')).toBe(1);
    expect(await session.socketsClosed('Alex')).toBe(0);
    expect(await session.notesOf('Alex')).toHaveLength(1);
    expect((await session.notesOf('Alex'))[0]?.text).toBe('left here overnight');
    expect(session.named('Alex').consoleErrors).toEqual([]);
    session.log.report('TC-29 a board left alone');
  });

  test('TC-30 five people editing for IDLE_CAP_SOAK_MS: every change arrives, and nobody ever had to reconnect', async ({
    browser,
  }) => {
    test.setTimeout(IDLE_CAP_SOAK_MS + 240_000);
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, index) => `Editor ${index + 1}`);
    const session = await openSession(browser, names);

    // The board's full capacity, all editing at once, all on one stretch of board.
    // Each person has a row of their own and room enough that a note being moved
    // never lands on top of a note somebody else is about to point at.
    const VIEW = { x: -100, y: -100, zoom: 0.25 };
    const CELL = 400;
    const NOTES_EACH = 3;
    const spot = (row: number, column: number): Point => ({
      x: 400 + column * CELL,
      y: 400 + row * CELL,
    });
    const onScreen = (row: number, column: number): Point => worldToScreen(VIEW, spot(row, column));
    for (const participant of session.participants) {
      await setCamera(participant.page, VIEW);
    }

    const owned = new Map<string, NoteState[]>();
    for (const [row, name] of names.entries()) {
      const page = session.named(name).page;
      const mine: NoteState[] = [];
      for (let column = 0; column < NOTES_EACH; column++) {
        mine.push(await createNote(page, onScreen(row, column)));
      }
      await stopTyping(page, mine[mine.length - 1]?.id ?? '');
      owned.set(name, mine);
    }
    await session.everybodySeesTheSameBoard('everyone starts with the same full board');

    // Soak: for the whole window, everybody moves a note and types a word, and
    // every one of those changes has to show up on the other four screens.
    const started = Date.now();
    let round = 0;
    let changes = 0;
    while (Date.now() - started < IDLE_CAP_SOAK_MS) {
      // Alternating directions, so a note goes back where it came from and the
      // rows never close up on each other.
      const shove = { x: round % 2 === 0 ? 25 : -25, y: 0 };
      for (const [row, participant] of session.participants.entries()) {
        const page = participant.page;
        const mine = owned.get(participant.name) ?? [];
        const note = mine[round % NOTES_EACH];
        if (note === undefined) continue;
        const moved = await moveNote(page, note, shove);
        changes += 1;
        await session.changeReachesEverybody(
          participant.name,
          `${participant.name} moved a note in round ${round}`,
          (board) => board.some((entry) => entry.id === note.id && entry.x === moved.x),
        );
        const target = await noteById(page, note.id);
        await openForTyping(page, target);
        await typeIntoNote(page, `${wordFor(round + row)} `);
        changes += 1;
        const text = (await noteById(page, note.id)).text;
        await session.changeReachesEverybody(
          participant.name,
          `${participant.name} typed in round ${round}`,
          (board) => board.some((entry) => entry.id === note.id && entry.text === text),
        );
        await stopTyping(page, note.id);
        owned.set(participant.name, mine.map((entry) => (entry.id === note.id ? moved : entry)));
      }
      round += 1;
      console.log(
        `[soak] round ${round}: ${changes} changes, ${Date.now() - started}ms of ${IDLE_CAP_SOAK_MS}ms`,
      );
    }

    // Nothing was dropped on the way: one connection per browser, none closed,
    // nothing in any console, and every screen painting the same board.
    const painted = await session.expectSamePaintedBoard(
      `every screen paints the same board after ${round} rounds`,
    );
    expect(painted.split('\n')).toHaveLength(names.length * NOTES_EACH);
    for (const participant of session.participants) {
      expect(await session.socketsOpened(participant.name)).toBe(1);
      expect(await session.socketsClosed(participant.name)).toBe(0);
      expect(await session.connectionState(participant.name)).toBe('connected');
      expect(await session.consoleErrors(participant.name)).toEqual([]);
    }
    expect(await readNotes(session.participants[0].page)).toHaveLength(names.length * NOTES_EACH);
    expect(await notes(session.participants[0].page).count()).toBe(names.length * NOTES_EACH);
    session.log.report(
      `TC-30 ${names.length} editors, ${round} rounds, ${changes} changes over ${IDLE_CAP_SOAK_MS}ms`,
    );
  });
});
