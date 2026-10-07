/**
 * Undo and redo in a room with more than one person in it
 * (`tests/e2e/undo.spec.ts`, PRD `undo.own`, `undo.controls`, TC-22 to TC-24).
 *
 * The claim these tests exist for is the one the whole story was written for, and it
 * can only be seen with two real browsers pointing at one real room: **my Undo takes
 * back my work and nothing that anybody else did** - including when the other person is
 * undoing at the same moment as I am, when my own undo was done before the room went
 * away, and when the thing my history points at has already been deleted by someone
 * else.
 *
 * What jsdom cannot fake is the room. In the component tests the other person's work is
 * an update applied under somebody else's origin, which is exactly what the board
 * filters on - so those tests prove the filter and can only *believe* that a second
 * person's keystrokes arrive as that update. Here they do: every participant gets their
 * own browser context, their own cookies and their own WebSocket; a note travels to
 * Durable Object storage and back; and `expectSameBoard` is what says the two documents
 * agree rather than merely looking alike.
 *
 * Every test here counts steps out loud, because an undo is worth exactly one of them
 * and the commonest way to write a wrong test in this file is to make a note, type in
 * it, and expect one keystroke to remove both. Making a note is a step. Typing in it is
 * another - the editor draws a boundary around itself when it opens and when it closes,
 * which is what makes the two come back separately. `makeNote` below is one step;
 * `writeIn` is the second one.
 *
 * The shortcut is sent as Ctrl+Z everywhere, including where the design's prose says
 * Cmd: these pages run on Linux, where Cmd is not a key on the keyboard. That Cmd+Z
 * means the same thing is a matter of which modifier the browser reports, and it is
 * covered key by key in `tests/component/UndoControls.test.tsx`.
 */

import type { Page } from '@playwright/test';

import { clickNote, pressDelete } from './helpers/select.js';
import {
  createNote,
  docNotes,
  escapeEditing,
  noteById,
  openEditor,
  typeIntoOpenEditor,
} from './helpers/sticky.js';
import { waitForRender } from './helpers/board.js';
import { createBoardPath } from './helpers/boards.js';
import {
  badge,
  badgeText,
  boardSnapshot,
  connectionState,
  expectNoteCount,
  expectSameBoard,
  noteCountOf,
  openParticipants,
  person,
} from './helpers/participants.js';
import { test, expect } from './fixtures.js';

/* ------------------------------------------------------------- local helpers */

/**
 * Undo (or redo) in this person's browser, plus the frame in which the board has drawn
 * what it did. One keystroke, one step: which step is what the test says in its calls.
 */
async function pressUndo(page: Page, redo = false): Promise<void> {
  await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
  await waitForRender(page);
}

/** The same keystroke in two browsers at once, as near as two round trips allow. */
async function pressTogether(pages: Page[], redo = false): Promise<void> {
  const key = redo ? 'Control+Shift+z' : 'Control+z';
  await Promise.all(pages.map((page) => page.keyboard.press(key)));
  await Promise.all(pages.map((page) => waitForRender(page)));
}

/** The ids of the notes a page holds, in drawing order. */
const idsOn = async (page: Page): Promise<string[]> =>
  (await docNotes(page)).map((note) => note.id);

/**
 * One step for this person: a note, made through the toolbar and left as it came - empty
 * and selected. Typing into it would be a second step (see `writeIn`), so a test that
 * means "one thing I did, now take it back" uses this.
 *
 * The new note is found by asking what was not there before rather than by taking the
 * last note in the document, because with two people working the one you just made is
 * not necessarily where you expect it.
 */
async function makeNote(page: Page): Promise<string> {
  const before = new Set(await idsOn(page));
  await createNote(page);
  await escapeEditing(page);
  const made = (await docNotes(page)).filter((note) => !before.has(note.id));
  if (made.length !== 1) throw new Error(`expected one new note, saw ${made.length}`);
  return made[0]!.id;
}

/**
 * The second step: words typed into a note that is already there, which the person opens
 * with a click and Enter. This is a step of its own, separate from the note it is typed
 * into, which is what the editor's boundaries - drawn when it opens and when it closes -
 * are for.
 */
async function writeIn(page: Page, id: string, text: string): Promise<void> {
  await clickNote(page, id);
  await page.keyboard.press('Enter');
  await expect(openEditor(page)).toBeFocused();
  await typeIntoOpenEditor(page, text);
  await escapeEditing(page);
}

/** The one note on the board, or the note this test is following, as text. */
const textOf = async (page: Page, id: string): Promise<string> => (await noteById(page, id)).text;

/* --------- TC-23: what somebody else deleted is not mine to undo --------- */

test('a note the other person deleted is not mine to undo (TC-23)', async ({ browser }) => {
  const people = await openParticipants(browser, ['Alex', 'Sam']);
  const alex = person(people, 'Alex');
  const sam = person(people, 'Sam');

  // Alex makes a note. Sam selects it and deletes it, and Alex watches that happen.
  const id = await makeNote(alex.page);
  await expectSameBoard(people);
  await clickNote(sam.page, id);
  await pressDelete(sam.page);
  await expectNoteCount(alex.page, 0);
  await expectNoteCount(sam.page, 0);

  // Alex presses Undo. Sam's deletion does not come back: nothing Alex did would put
  // the note there, and his own board does not move at all.
  const alexBoard = await boardSnapshot(alex.page);
  const samBoard = await boardSnapshot(sam.page);
  await pressUndo(alex.page);
  expect(await boardSnapshot(alex.page), 'Alex’s board did not move').toBe(alexBoard);
  await expectNoteCount(alex.page, 0);
  // Nor does Sam's board move because of what Alex did (PRD `undo.own`).
  await expect
    .poll(() => boardSnapshot(sam.page), { message: 'Sam’s board moved when Alex undid' })
    .toBe(samBoard);
  await expectSameBoard(people);

  // What Undo is for, on the other hand: a step Alex did himself, after all that. One
  // keystroke, one step - his own note, and nothing of Sam's anywhere near it.
  const mine = await makeNote(alex.page);
  await expectSameBoard(people);
  await pressUndo(alex.page);
  await expectNoteCount(alex.page, 0);
  await expectNoteCount(sam.page, 0);
  expect(await idsOn(alex.page), `${mine} is gone`).not.toContain(mine);
  await expectSameBoard(people);
});

test('a note that arrives already deleted leaves nothing for me to undo (TC-23)', async ({
  browser,
}) => {
  // The same thing at speed: the note goes away while Alex is still working on it, so
  // his history ends up holding a step whose object no longer exists - which is the
  // case an undo has to survive without throwing and without inventing a ghost.
  const people = await openParticipants(browser, ['Alex', 'Sam']);
  const alex = person(people, 'Alex');
  const sam = person(people, 'Sam');

  // A note with a word in it: two steps of Alex's, and both boards hold it.
  const id = await makeNote(alex.page);
  await writeIn(alex.page, id, 'short');
  await expectSameBoard(people);

  // Alex goes back into the note to write more, and Sam deletes it from under him.
  await clickNote(alex.page, id);
  await alex.page.keyboard.press('Enter');
  await expect(openEditor(alex.page)).toBeFocused();
  await alex.page.waitForTimeout(50);
  await clickNote(sam.page, id);
  await pressDelete(sam.page);
  await expectNoteCount(alex.page, 0);

  // Alex keeps typing, then undoes twice: once for the typing he was doing when the
  // note went, once for the note that is already gone. No throw, no ghost note, and
  // the two boards still say the same thing.
  await alex.page.keyboard.type(' still here?');
  await waitForRender(alex.page);
  await pressUndo(alex.page);
  await pressUndo(alex.page);
  await expect(alex.consoleErrors, alex.consoleErrors.join('\n')).toEqual([]);
  await expectSameBoard(people);
  await expectNoteCount(alex.page, 0);

  // None of that left the board unworkable: a note made afterwards syncs to Sam the
  // way any other does.
  await makeNote(alex.page);
  await expectNoteCount(sam.page, 1);
  await expectSameBoard(people);
});

/* ---------------- TC-24: two people undoing at the same moment ---------------- */

test('a person with nothing to undo takes nothing away (TC-24)', async ({ browser }) => {
  const people = await openParticipants(browser, ['Alex', 'Sam', 'Riley']);
  const alex = person(people, 'Alex');
  const sam = person(people, 'Sam');
  const riley = person(people, 'Riley');

  // Alex makes the only note on the board. Sam has done nothing at all, and Riley has
  // watched the whole thing without touching anything.
  const id = await makeNote(alex.page);
  await expectSameBoard(people);

  // Sam and Alex press Ctrl+Z at the same moment. Only one of them has a history, and
  // the keystroke that finds nothing must not reach over into Alex's work and delete
  // his note (PRD `undo.own`: "one person's undo must never consume another's work").
  await pressTogether([sam.page, alex.page]);
  await expectSameBoard(people);
  await expectNoteCount(alex.page, 0);
  await expectNoteCount(sam.page, 0);
  await expectNoteCount(riley.page, 0);

  // Both redo at once: what comes back is Alex's note - once, for everybody, and the
  // same object rather than a copy made on the way back.
  await pressTogether([sam.page, alex.page], true);
  await expectSameBoard(people);
  await expectNoteCount(alex.page, 1);
  expect(await idsOn(alex.page)).toEqual([id]);
  expect(await idsOn(sam.page)).toEqual([id]);
  expect(await idsOn(riley.page)).toEqual([id]);
  // Nobody's board is holding an error, either: the keystroke that found nothing is
  // not allowed to be the one that broke something.
  for (const who of [alex, sam, riley]) {
    expect(who.consoleErrors, `${who.name} logged: ${who.consoleErrors.join('\n')}`).toEqual([]);
  }
});

test('two people undoing at once take back their own work and nothing else (TC-24)', async ({
  browser,
}) => {
  const people = await openParticipants(browser, ['Alex', 'Sam', 'Riley']);
  const alex = person(people, 'Alex');
  const sam = person(people, 'Sam');
  const riley = person(people, 'Riley');

  const alexsNote = await makeNote(alex.page);
  const samsNote = await makeNote(sam.page);
  await expectSameBoard(people);
  await expectNoteCount(riley.page, 2);

  // Both press Undo at the same moment. Each takes back the note they made and leaves
  // the other's where it is - and since the two undos travel to each other as remote
  // changes, whichever order the room sends them in, both boards must land on the same
  // answer.
  await pressTogether([alex.page, sam.page]);
  await expectSameBoard(people);
  await expectNoteCount(alex.page, 0);
  await expectNoteCount(riley.page, 0);

  // Both press Redo at the same moment, and both notes come back to everybody.
  await pressTogether([alex.page, sam.page], true);
  await expectSameBoard(people);
  await expectNoteCount(alex.page, 2);
  expect(await idsOn(alex.page)).toEqual([alexsNote, samsNote]);

  // And undoing singly still picks the right one out of the two: Alex's next keystroke
  // takes his note back, and Sam's is untouched on Sam's own board.
  await pressUndo(alex.page);
  await expectNoteCount(sam.page, 1);
  expect(await idsOn(sam.page)).toEqual([samsNote]);
  await expectSameBoard(people);
});

/* ------------------ TC-22: undo and redo across a reconnect ------------------ */

test('an undone change and a redone one survive the room being rebuilt (TC-22)', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const people = await openParticipants(browser, ['Alex', 'Sam']);
  const alex = person(people, 'Alex');
  const sam = person(people, 'Sam');

  // A note, and a word typed into it: two steps of Alex's. Then one undo, which takes
  // back the typing and leaves the note - the split the editor's boundaries are for.
  const id = await makeNote(alex.page);
  await writeIn(alex.page, id, 'undo me');
  await expectSameBoard(people);
  await pressUndo(alex.page);
  expect(await textOf(alex.page, id)).toBe('');
  await expect.poll(() => textOf(sam.page, id)).toBe('');

  // The room goes away while the board is holding something Alex has undone. The
  // browser is told the network is down too, so the provider's retries really do fail
  // while the outage lasts; the drop of the open socket is asked for through the
  // test-only connection hook, which is the only way to interrupt one that is up.
  await alex.context.setOffline(true);
  await alex.page.evaluate(() => window.__vidi6Connection?.dropConnection());
  await expect
    .poll(() => badgeText(alex.page), { message: 'Alex was never told the room was gone' })
    .toBe('Reconnecting…');
  expect(await connectionState(alex.page)).toBe('reconnecting');

  // Sam carries on working while Alex is out: his own note, on a board that also holds
  // Alex's empty one.
  const samsNote = await makeNote(sam.page);
  await expectNoteCount(sam.page, 2);
  expect(await noteCountOf(alex)).toBe(1);

  // Back, and the room rebuilt. The board now holds Sam's note as well as Alex's, and
  // Alex's history is still his own, undisturbed by everything he missed.
  await alex.context.setOffline(false);
  await alex.page.evaluate(() => window.__vidi6Connection?.restoreConnection());
  await expect
    .poll(() => connectionState(alex.page), { message: 'Alex never reached the room again' })
    .toBe('connected');
  await expect(badge(alex.page)).toHaveCount(0);
  await expectSameBoard(people);
  await expectNoteCount(alex.page, 2);

  // The redo was still there after the reconnect: the word goes back into the note that
  // was emptied before the drop, and Sam sees it happen like any other change.
  await pressUndo(alex.page, true);
  expect(await textOf(alex.page, id)).toBe('undo me');
  await expect.poll(() => textOf(sam.page, id)).toBe('undo me');
  await expectSameBoard(people);

  // And the two undos that were still in the history, once the room is new, take the
  // typing and then the note back - leaving Sam's note, which was never in either.
  await pressUndo(alex.page);
  await expectNoteCount(alex.page, 2);
  expect(await textOf(alex.page, id)).toBe('');
  await pressUndo(alex.page);
  await expectNoteCount(alex.page, 1);
  expect(await idsOn(alex.page)).toEqual([samsNote]);
  await expectSameBoard(people);
});

/* ------------- undo in one tab, the other tab of the same person ------------- */

/**
 * Two tabs of one board in one browser: one person, two windows, two histories. The
 * design calls this the cheap case that catches a real mistake - a history kept on the
 * `window`, in shared storage, or in the document instead of in the controller this tab
 * built - because a shared history would let the second tab undo what the first one
 * just did, and nothing on screen would explain it.
 */
test('undo in one tab does not undo what the other tab did', async ({ browser }) => {
  const context = await browser.newContext();
  const boardPath = await createBoardPath(context.request);

  // Both tabs are watched for errors before either is opened, so a tab that threw while
  // undoing cannot be missed by a test that only looks at the board.
  const errors: string[] = [];
  const openTab = async (): Promise<Page> => {
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(boardPath);
    await waitForRender(page);
    await expect
      .poll(() => connectionState(page), { message: 'a tab never reached the room' })
      .toBe('connected');
    return page;
  };

  const first = await openTab();
  const second = await openTab();

  // The first tab makes a note; the second watches it arrive. Both hold one board.
  const id = await makeNote(first);
  await expectNoteCount(second, 1);
  expect(await boardSnapshot(second)).toBe(await boardSnapshot(first));

  // The second tab undoes. It has nothing of its own to undo, and what the other tab
  // made is not its work: the note stays, in both.
  await pressUndo(second);
  await expectNoteCount(second, 1);
  await expectNoteCount(first, 1);

  // The first tab undoes its own work, and both tabs go empty - because the history
  // that held it is the one this tab built.
  await pressUndo(first);
  await expectNoteCount(first, 0);
  await expectNoteCount(second, 0);

  // A redo where there is nothing to redo still changes nothing, and the redo in the
  // tab that did the work puts the note back in both.
  await pressUndo(second, true);
  await expectNoteCount(second, 0);
  await pressUndo(first, true);
  await expectNoteCount(first, 1);
  await expectNoteCount(second, 1);
  expect(await idsOn(second)).toEqual([id]);

  expect(errors, `the tabs logged errors: ${errors.join('\n')}`).toEqual([]);
  await context.close();
});
