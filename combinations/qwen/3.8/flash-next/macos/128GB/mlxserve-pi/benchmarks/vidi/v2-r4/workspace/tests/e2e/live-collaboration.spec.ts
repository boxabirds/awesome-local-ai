/**
 * Story 3, the PRD's verification steps 2, 3, 4, 5, 7, 8 and 9: several people on
 * one board URL, each in a browser of their own, seeing what the others do.
 *
 * Everything is measured the way a person would notice it — in the other person's
 * browser, in the DOM — and never from the room's point of view. How long a change
 * took to appear is logged (see `LatencyLog` in helpers/participants) and never
 * asserted, per the PRD ("latency is reported").
 */
import { expect, test, type Page } from '@playwright/test';

import { CATCH_UP_TEST_OUTAGE_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  createNote,
  dragNote,
  editor,
  noteById,
  noteCentreOnScreen,
  notes,
  readNotes,
  typeIntoNote,
  type NoteState,
} from './helpers/notes';
import { setCamera, worldToScreen, type Point } from './helpers/board';
import { BoardSession, connectionStatus, expectEventually } from './helpers/participants';
import { browserAvailable } from './helpers/browserAvailability';

/** The note's own toolbar: its colour swatches and its bin. */
const clickSwatch = (page: Page, colour: string, index = 0) =>
  page.getByTestId(`swatch-${colour}`).nth(index).click();

const clickBin = (page: Page, index = 0) => page.getByTestId('delete-note').nth(index).click();

/**
 * The board the current test opened, closed after it whatever the test did next —
 * a test that fails in the middle still takes its browsers with it.
 */
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

/**
 * Put this note on screen and start typing in it, the way a person does: click it,
 * press Enter.
 */
async function openForEditing(page: Page, note: NoteState): Promise<void> {
  const centre = await noteCentreOnScreen(page, note);
  await page.mouse.click(centre.x, centre.y);
  await page.keyboard.press('Enter');
  await expect(editor(page)).toBeFocused();
}

/** The middle of where a note is painted, which is where a hand would grab it. */
const grabPoint = (page: Page, note: NoteState): Promise<Point> => noteCentreOnScreen(page, note);

/** Every letter of a text, in order, so two texts can be compared letter by letter. */
const lettersOf = (text: string): string => [...text].sort().join('');

/** An id is long; a failure message only needs enough of it to tell notes apart. */
const short = (id: string): string => id.slice(0, 8);

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

test.describe('live collaboration', () => {
  test('TC-22 one person creates, types, moves, recolours and deletes, and each change shows up for the other', async ({
    browser,
  }) => {
    const session = await openSession(browser, ['Alex', 'Sam']);
    const alex = session.named('Alex').page;

    // Create.
    const idea = await createNote(alex, { x: 400, y: 300 });
    await session.changeReachesEverybody('Alex', `Alex created a note (${short(idea.id)})`, (board) =>
      board.some((note) => note.id === idea.id),
    );

    // Type.
    await typeIntoNote(alex, 'write this');
    await session.changeReachesEverybody('Alex', 'Alex typed words into it', (board) =>
      board.some((note) => note.id === idea.id && note.text === 'write this'),
    );

    // Move.
    await alex.keyboard.press('Escape');
    const note = await noteById(alex, idea.id);
    await dragNote(alex, await grabPoint(alex, note), { x: 120, y: 60 });
    const moved = await noteById(alex, idea.id);
    await session.changeReachesEverybody('Alex', 'Alex moved it', (board) =>
      board.some((entry) => entry.id === idea.id && entry.x === moved.x && entry.y === moved.y),
    );

    // Recolour.
    await clickSwatch(alex, 'blue');
    await session.changeReachesEverybody('Alex', 'Alex recoloured it', (board) =>
      board.some((note) => note.id === idea.id && note.color === 'blue'),
    );

    // Delete.
    await clickBin(alex);
    await session.changeReachesEverybody('Alex', 'Alex deleted it', (board) =>
      board.every((note) => note.id !== idea.id),
    );

    // And nobody is left looking at something the other cannot see.
    expect(await session.everybodySeesTheSameBoard('both screens are back to an empty board')).toEqual([]);
    session.log.report('TC-22 one person, five kinds of change');
  });

  test('TC-23 both type into one note at the same time and both pages end up with the same text', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const session = await openSession(browser, ['Alex', 'Sam']);
    const alex = session.named('Alex').page;
    const sam = session.named('Sam').page;

    const idea = await createNote(alex, { x: 400, y: 300 });
    await session.changeReachesEverybody('Alex', 'the note both are about to type into', (board) =>
      board.some((note) => note.id === idea.id),
    );

    // Both in the same note at the same moment: each opens it and types, word by
    // word, so the two edits genuinely overlap in time.
    await openForEditing(sam, await noteById(sam, idea.id));
    const alexWords = ['alex ', 'was ', 'here '];
    const samWords = ['sam ', 'was ', 'too '];
    for (let word = 0; word < alexWords.length; word++) {
      await Promise.all([
        alex.keyboard.insertText(alexWords[word]),
        sam.keyboard.insertText(samWords[word]),
      ]);
    }

    // Nothing either of them typed is lost, and both pages show the same text.
    // The words arrive interleaved — that is what overlapping edits do — so what
    // is compared is the whole of the text and every one of its letters.
    const both = await session.everybodySeesTheSameBoard('the note reads the same on both screens');
    const text = both[0]?.text ?? '';
    expect(lettersOf(text)).toBe(lettersOf(alexWords.join('') + samWords.join('')));
    session.log.report('TC-23 overlapping typing');
  });

  test('TC-24 both drag the same note at once and it settles in one place for everybody', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const session = await openSession(browser, ['Alex', 'Sam']);
    const alex = session.named('Alex').page;
    const sam = session.named('Sam').page;

    const idea = await createNote(alex, { x: 400, y: 300 });
    await alex.keyboard.press('Escape');
    await session.changeReachesEverybody('Alex', 'the note both are about to drag', (board) =>
      board.some((note) => note.id === idea.id),
    );

    // Two hands on one note at the same time: Alex pulls right, Sam pulls down.
    // One of them winning is normal; what has to happen is that both screens end
    // up showing the same place.
    await Promise.all([
      dragNote(alex, await grabPoint(alex, await noteById(alex, idea.id)), { x: 150, y: 0 }),
      dragNote(sam, await grabPoint(sam, await noteById(sam, idea.id)), { x: 0, y: 150 }),
    ]);

    const settled = await session.everybodySeesTheSameBoard(
      'the dragged note is in the same place on both screens',
    );
    expect(settled).toHaveLength(1);
    expect(settled[0]?.id).toBe(idea.id);
    session.log.report('TC-24 competing drags');
  });

  test('TC-25 a note deleted while somebody is typing in it goes away on their screen, editor and all', async ({
    browser,
  }) => {
    const session = await openSession(browser, ['Alex', 'Sam']);
    const alex = session.named('Alex').page;
    const sam = session.named('Sam').page;

    const idea = await createNote(alex, { x: 400, y: 300 });
    await typeIntoNote(alex, 'a bad idea');
    await alex.keyboard.press('Escape');
    await session.changeReachesEverybody('Alex', 'the note Sam is about to type in', (board) =>
      board.some((note) => note.id === idea.id),
    );

    // Sam is typing in it when Alex deletes it.
    await openForEditing(sam, await noteById(sam, idea.id));
    await sam.keyboard.insertText('but ');

    await clickBin(alex);

    // The note is gone from Sam's screen.
    await expectEventually(
      'the delete reaches Sam',
      async () => {
        expect(await readNotes(sam)).toHaveLength(0);
      },
      session.log,
    );
    // The editor has gone with it: there is nothing left to type in.
    expect(await editor(sam).count()).toBe(0);
    // Nothing on Sam's screen complains about it: no error dialog of any kind.
    expect(await sam.locator('[role="alert"]').count()).toBe(0);
    expect(session.named('Sam').consoleErrors).toEqual([]);

    await session.everybodySeesTheSameBoard('the board is empty on both screens');
    session.log.report('TC-25 deleted while typing');
  });

  test('TC-26 a full board of editors: every change each one makes shows on everybody else\'s screen', async ({
    browser,
  }) => {
    test.setTimeout(400_000);
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, index) => `Editor ${index + 1}`);
    const session = await openSession(browser, names);

    // Everyone works on the same stretch of board, from the same view, each in a
    // row of their own so nobody is ever pointing at somebody else's note. The
    // notes are far enough apart, and the shove small enough, that a note that has
    // been moved still touches nothing: on a shared board a test must never be
    // aiming at the wrong note.
    const VIEW = { x: -100, y: -100, zoom: 0.25 };
    const CELL = 400; // world units between the centres of two neighbouring notes
    const NOTES_EACH = 5;
    const shove = { x: 25, y: 25 }; // screen pixels; a quarter of a cell, at this zoom
    /** Where a note of this person's is put, in world units. */
    const spot = (row: number, column: number): Point => ({
      x: 400 + column * CELL,
      y: 400 + row * CELL,
    });
    /** The middle of that note, on the screen. */
    const onScreen = (row: number, column: number): Point => worldToScreen(VIEW, spot(row, column));
    for (const participant of session.participants) {
      await setCamera(participant.page, VIEW);
    }

    for (const [row, name] of names.entries()) {
      const page = session.named(name).page;
      const created: NoteState[] = [];
      for (let column = 0; column < NOTES_EACH; column++) {
        const note = await createNote(page, onScreen(row, column));
        created.push(note);
        await session.changeReachesEverybody(name, `${name} created a note`, (board) =>
          board.some((entry) => entry.id === created[column]?.id),
        );
      }
      for (const [column, note] of created.entries()) {
        if (note === undefined) continue;
        const before = await noteById(page, note.id);
        await dragNote(page, await grabPoint(page, before), shove);
        const after = await noteById(page, note.id);
        expect(after.x).not.toBe(before.x); // the drag really did move it
        await session.changeReachesEverybody(name, `${name} moved a note`, (board) =>
          board.some((entry) => entry.id === note.id && entry.x === after.x && entry.y === after.y),
        );
        expect(onScreen(row, column).x).toBeLessThan(after.x); // and it went right
      }
    }

    const boards = await session.everybodySeesTheSameBoard(
      `every screen shows all ${MAX_CONCURRENT_EDITORS * NOTES_EACH} notes`,
    );
    expect(boards).toHaveLength(MAX_CONCURRENT_EDITORS * NOTES_EACH);
    // The screens themselves, not only the values behind them: the same notes in
    // the same places, in the same stacking, saying the same things.
    const painted = await session.expectSamePaintedBoard('every screen paints the same board');
    expect(painted.split('\n')).toHaveLength(MAX_CONCURRENT_EDITORS * NOTES_EACH);
    session.log.report(
      `TC-26 ${names.length} editors, ${boards.length} notes, ${names.length * NOTES_EACH * 2} changes`,
    );
  });

  test('TC-27 a person away for CATCH_UP_TEST_OUTAGE_MS comes back with everything that happened', async ({
    browser,
  }) => {
    test.setTimeout(CATCH_UP_TEST_OUTAGE_MS * 2 + 200_000);
    const session = await openSession(browser, ['Alex', 'Sam']);
    const alex = session.named('Alex').page;
    const sam = session.named('Sam').page;

    // They start together, on an empty board. Alex then drops off the network.
    const away = Date.now();
    // Alex is told about it. The notice is not instant, and that is the product's
    // behaviour rather than the test's convenience: a line that has gone quiet is
    // only known to be dead once nothing has come over it for long enough, which
    // is how long the connection gives up too. It must come inside the absence.
    await session.setOffline('Alex', true);
    await expectEventually(
      "Alex is shown 'Reconnecting…'",
      async () => {
        expect(await session.statusText('Alex')).toBe('Reconnecting…');
      },
      session.log,
      CATCH_UP_TEST_OUTAGE_MS + 15_000,
    );

    // Alex keeps working, three notes nobody else can see.
    for (let index = 0; index < 3; index++) {
      await createNote(alex, { x: 180 + index * 240, y: 250 });
    }
    await session.expectNoteCount('Alex', 3);

    // Sam makes three of their own, none of which can reach Alex while the line
    // is down — Sam's own screen is the one that has to show them.
    for (let index = 0; index < 3; index++) {
      await createNote(sam, { x: 180 + index * 240, y: 620 });
    }
    await session.expectNoteCount('Sam', 3);
    expect(await session.board('Sam')).not.toEqual(await session.board('Alex'));

    // The rest of the absence, so it is a real absence and not a blip.
    const rest = CATCH_UP_TEST_OUTAGE_MS - (Date.now() - away);
    if (rest > 0) await sam.waitForTimeout(rest);

    // Alex comes back, and is told so.
    await session.setOffline('Alex', false);
    await expectEventually(
      "Alex is shown 'Connected'",
      async () => {
        expect(await session.statusText('Alex')).toBe('Connected');
      },
      session.log,
    );

    // Everything from both sides is there, on both screens: the six notes, with
    // nothing quietly dropped. The first change after a return has to travel over
    // a connection that is only just established, so this waits longer than a
    // change between two people who were never away.
    await session.everybodySeesTheSameBoard('both screens show all six notes', session.log, 30_000);
    expect(await session.board('Alex')).toHaveLength(6);
    expect(session.named('Alex').consoleErrors.filter((line) => !line.startsWith('console:'))).toEqual([]);
    session.log.report('TC-27 catching up after an absence');
  });

  test('TC-28 what one person has selected and is typing in is theirs alone', async ({
    browser,
  }) => {
    const session = await openSession(browser, ['Alex', 'Sam']);
    const alex = session.named('Alex').page;
    const sam = session.named('Sam').page;

    // Alex opens a note and is typing in it: selected, editor open.
    const idea = await createNote(alex, { x: 400, y: 300 });
    await typeIntoNote(alex, 'thinking out loud');
    expect((await noteById(alex, idea.id)).selected).toBe(true);
    await expect(editor(alex)).toBeFocused();

    // Sam sees the note and its words…
    await session.changeReachesEverybody('Alex', 'the note and the words in it', (board) =>
      board.some((note) => note.id === idea.id && note.text === 'thinking out loud'),
    );
    // …but not which note Alex has in hand, and not Alex's editor.
    const onSam = (await session.notesOf('Sam')).find((note) => note.id === idea.id);
    expect(onSam?.selected).toBe(false);
    expect(await editor(sam).count()).toBe(0);
    expect(await notes(sam).first().getAttribute('data-selected')).toBe('false');
    // Nothing Sam does to their own view changes what Alex sees.
    await setCamera(sam, { x: 0, y: 0, zoom: 2 });
    expect((await noteById(alex, idea.id)).selected).toBe(true);
    await expect(editor(alex)).toBeFocused();
    expect(await connectionStatus(alex).count()).toBe(0);
    session.log.report('TC-28 local state stays local');
  });
});
