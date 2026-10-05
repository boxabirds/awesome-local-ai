/**
 * Story 8, in real browsers: undo and redo take back my own work, and nobody else's.
 *
 * Two people in two browser contexts on one board, and a server that is the real one. Everything worth
 * testing about this story lives in the difference between those two contexts: the changes are in the same
 * document, the histories are not, and the only thing that keeps one person's Ctrl+Z off another person's
 * work is the mark each tab puts on its own transactions. A test that pressed undo on a board of one would
 * not be testing that at all, so every test here has at least two people in it and checks the outcome on
 * both screens — including the screens of people who never pressed anything.
 *
 * The names are the story's: Mia is the one who undoes, Raj is the one whose work has to survive it.
 */
import { expect, test } from '@playwright/test';

import { DRAG_DOWN, DRAG_RIGHT, settled } from './helpers/board';
import { createNote, noteCount as pageNoteCount, pasteIntoEditor } from './helpers/sticky';
import {
  badgeText,
  CAPACITY,
  closeParticipants,
  documentOf,
  dragNoteById,
  editNoteById,
  expectConverged,
  expectEventually,
  logLatencies,
  measurements,
  openParticipants,
  selectNoteById,
  type Participant,
} from './helpers/participants';

/** Eight notes in a cluster, which is what the story has Mia delete by accident. */
const CLUSTER: { x: number; y: number }[] = [];
for (const row of [0, 1]) {
  for (const column of [0, 1, 2, 3]) {
    CLUSTER.push({ x: 260 + column * 250, y: 250 + row * 250 });
  }
}

/** Where Raj puts his own note, well clear of the cluster. */
const RAJ_AT = { x: 640, y: 640 };

/** Where Mia's single note goes, where it is dragged to, and where a later one goes. */
const MINE_AT = { x: 400, y: 300 };
const AFTER_AT = { x: 980, y: 300 };

/**
 * The two places one person's notes go in the five-person test: their first note, and their second. The
 * second is the one their own undo takes away, so the pair has to be far enough apart that a double-click on
 * empty board between them cannot land on a note — and far enough from everybody else's as well.
 */
const CROWD_FIRST_AT = (index: number): { x: number; y: number } => ({ x: 180 + index * 210, y: 260 });
const CROWD_SECOND_AT = (index: number): { x: number; y: number } => ({ x: 180 + index * 210, y: 520 });

/** What each of the five writes in their own note, all different, all in the same second. */
const WORDS = ['one', 'two', 'three', 'four', 'five'];

let people: Participant[] = [];

test.beforeEach(() => {
  people = [];
});

test.afterEach(async ({}, testInfo) => {
  await closeParticipants(people);
  people = [];
  if (measurements().length > 0) logLatencies(testInfo.title);
});

// ---------------------------------------------------------------------------
// One person's hands, on their own page
// ---------------------------------------------------------------------------

/**
 * A keystroke on the board itself, with nothing being typed into.
 *
 * `Control` rather than `Meta`, because the board answers both and a test needs one answer: what is under
 * test is that the board takes the chord, which it does on every platform, and not the operating system's
 * own idea of a keyboard.
 */
async function pressOnBoard(
  participant: Participant,
  key: string,
  modifier: 'ctrl' | 'ctrl+shift' | null = null,
): Promise<void> {
  const chord = modifier === null ? key : `${MODIFIERS[modifier]}+${key}`;
  await participant.page.keyboard.press(chord);
  await settled(participant.page);
}

/** How the two chords this story uses are spelled for a browser, which is not how a person says them. */
const MODIFIERS = { ctrl: 'Control', 'ctrl+shift': 'Control+Shift' } as const;

/** Where one note is on one person's screen, in board units; null when that person has no such note. */
async function placeOf(
  participant: Participant,
  id: string,
): Promise<{ x: number; y: number; color: string; text: string } | null> {
  const note = (await documentOf(participant)).find((object) => object.id === id);
  return note ? { x: note.x, y: note.y, color: note.color, text: note.text } : null;
}

/** The ids this page's document holds, sorted, because their order says nothing here. */
async function idsOf(participant: Participant): Promise<string[]> {
  return (await documentOf(participant)).map((object) => object.id).sort();
}

function noteCountOn(participant: Participant): Promise<number> {
  return pageNoteCount(participant.page);
}

/** The board's own two buttons, as this person sees them. */
function undoButtonOf(participant: Participant) {
  return participant.page.getByTestId('undo');
}

function redoButtonOf(participant: Participant) {
  return participant.page.getByTestId('redo');
}

/** That a button is saying there is nothing for it to do — in both of the ways it says it. */
async function expectOff(button: ReturnType<typeof undoButtonOf>): Promise<void> {
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('aria-disabled', 'true');
}

async function expectOn(button: ReturnType<typeof undoButtonOf>): Promise<void> {
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute('aria-disabled', 'false');
}

/** Nothing at all in this person's console, which is as close to "nothing went wrong" as a browser gets. */
function expectQuiet(...participants: Participant[]): void {
  for (const participant of participants) {
    expect(participant.errors, `${participant.name} logged console errors`).toEqual([]);
  }
}

// ---------------------------------------------------------------------------
// TC-22: an accidental delete, recovered while a colleague works
// ---------------------------------------------------------------------------

test('TC-22: Mia deletes eight notes by mistake and gets them back without touching what Raj made', async ({
  browser,
}) => {
  const [mia, raj] = await openParticipants(browser, 2);
  people = [mia, raj];

  // Eight notes, made one after another. Each is its own step, and that has to be true for the rest of this
  // test to mean anything: a history that folded eight creations together would give an undo that took
  // notes back in batches, and the count of presses further down would be a number nobody could predict.
  const eight: string[] = [];
  for (const at of CLUSTER) eight.push(await createNote(mia.page, at));
  expect(eight).toHaveLength(8);
  for (const participant of [mia, raj]) {
    await expectEventually(`${participant.name} sees the eight notes`, () => noteCountOn(participant)).toBe(8);
  }

  // Select all, delete: the eight go in one keystroke, which makes them one thing that happened, and that
  // is the only reason a single undo press below brings all eight back rather than one. The story reaches
  // this by box-selecting; every note on the board is one of the eight, so the keyboard gets to the same
  // selection and the same single delete transaction, and what is under test here is the history.
  const where = new Map<string, { x: number; y: number; color: string; text: string }>();
  for (const id of eight) where.set(id, (await placeOf(mia, id))!);
  await pressOnBoard(mia, 'a', 'ctrl');
  await pressOnBoard(mia, 'Delete');
  await expectEventually('the cluster is gone from both screens', async () => {
    return (await noteCountOn(mia)) === 0 && (await noteCountOn(raj)) === 0;
  }).toBe(true);

  // Raj, who was not watching, makes a note of his own. It arrives on Mia's board, and it is the thing her
  // undo has to leave alone: his change never entered her history, so there is nothing in her history for it
  // to be taken out of.
  const his = await createNote(raj.page, RAJ_AT, 'raj');
  await expectConverged('both screens show nine notes, one of them made by Raj', [mia, raj], {
    timeoutMs: 20_000,
  });

  // The undo. Eight notes come back, at the places they were in, and Raj's note does not move, does not
  // change and does not go away.
  await pressOnBoard(mia, 'z', 'ctrl');
  for (const id of eight) {
    await expectEventually(
      `${id} is back on Raj's screen, where Mia's undo put it`,
      () => placeOf(raj, id),
    ).toEqual(where.get(id)!);
  }
  expect(await idsOf(mia)).toEqual([...eight, his].sort());
  expect(await idsOf(raj)).toEqual([...eight, his].sort());

  // Raj's own screen still holds what he typed, which is the same claim from the end that matters most: the
  // person who made the change never had it taken away, not for a moment.
  expect((await placeOf(raj, his))!.text).toBe('raj');

  // And the redo removes the eight again, on both screens, which is the other half of the promise: a change
  // this person chose to put back is theirs to take away again, and putting it back disturbed Raj no more
  // than taking it away did. The Redo button rather than the chord, because the button is what the story
  // names, and a keyboard is not the only way to a history.
  await expectOn(undoButtonOf(mia));
  await expectOn(redoButtonOf(mia));
  await redoButtonOf(mia).click();
  await settled(mia.page);
  await expectEventually('the eight are gone again on the screen Raj is looking at', () =>
    noteCountOn(raj),
  ).toBe(1);
  expect(await idsOf(raj)).toEqual([his]);
  expect(await idsOf(mia)).toEqual([his]);
  await expectOff(redoButtonOf(mia));
  await expectOn(undoButtonOf(mia));

  // Nine things Mia did — eight notes and one delete — take nine presses to come back, and the number of
  // notes on her screen says so one at a time: the first press puts the delete right, restoring eight, and
  // then every press takes one note away, down to the one note on this board she did not make. A history
  // that had folded two of her actions together would run out of presses before the last note went, and
  // this says it is not such a history.
  const remaining: number[] = [];
  for (let press = 0; press < 9; press += 1) {
    await expectOn(undoButtonOf(mia));
    await pressOnBoard(mia, 'z', 'ctrl');
    remaining.push((await documentOf(mia)).length);
  }
  expect(remaining).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);

  // The history is out, the button is dark, and what is left on both screens is Raj's note with his word in
  // it. His work was never in her history, so it was never within reach of these two buttons.
  await expectOff(undoButtonOf(mia));
  await expectOn(redoButtonOf(mia));
  expect(await idsOf(mia)).toEqual([his]);
  expect((await placeOf(raj, his))!.text).toBe('raj');
  await expectConverged('both screens hold the one note Raj made', [mia, raj]);

  // And the tenth press is refused rather than reaching into his work: the button says there is nothing left
  // to do, and the board agrees with it.
  await pressOnBoard(mia, 'z', 'ctrl');
  expect(await idsOf(raj)).toEqual([his]);
  expectQuiet(mia, raj);
});

// ---------------------------------------------------------------------------
// TC-23: undoing a move of a note that a colleague has since deleted
// ---------------------------------------------------------------------------

test('TC-23: Mia undoes a move of a note Raj has already deleted, and the board says nothing about it', async ({
  browser,
}) => {
  const [mia, raj] = await openParticipants(browser, 2);
  people = [mia, raj];

  const note = await createNote(mia.page, MINE_AT);
  await expectEventually('both screens have the note', async () => {
    return (await noteCountOn(mia)) === 1 && (await noteCountOn(raj)) === 1;
  }).toBe(true);

  // Mia moves it. One step, on her screen, of hers alone.
  await dragNoteById(mia, note, DRAG_RIGHT, DRAG_DOWN);
  await expectEventually('the move arrives on the screen Raj is looking at', () => placeOf(raj, note)).toEqual(
    (await placeOf(mia, note))!,
  );

  // Raj deletes it. That is his change, with his mark on it, and it is not in Mia's history either.
  await selectNoteById(raj, note);
  await pressOnBoard(raj, 'Delete');
  await expectConverged('the note is gone from both screens', [mia, raj]);

  // Mia presses Ctrl+Z. Her inverse points at a note that is no longer there: nothing is recreated, nothing
  // is thrown, no badge goes up, and nothing reaches her console. The board does not tell her about a
  // problem, because there is no problem: the change she was asking about stopped existing, and the one
  // thing a history can say about that is nothing.
  await pressOnBoard(mia, 'z', 'ctrl');
  await expectEventually('the note stays away on the screen Mia is looking at', () => noteCountOn(mia)).toBe(0);
  expect(await noteCountOn(raj)).toBe(0);
  await expectConverged('both screens still agree, with nothing on them', [mia, raj]);
  await expect(undoButtonOf(mia)).toBeVisible();
  expect(await badgeText(mia), 'the board raised a badge at her').toBeNull();
  expect(await badgeText(raj), 'the board raised a badge at him').toBeNull();
  expectQuiet(mia, raj);

  // The history is not broken by having met a hole in it. A note made after this is made, moved, and undone
  // as usual — which is the only way to tell a keystroke that was correctly skipped from a controller that
  // has stopped working.
  const fresh = await createNote(mia.page, AFTER_AT);
  await expectEventually('the new note reaches Raj', () => noteCountOn(raj)).toBe(1);
  const before = await placeOf(mia, fresh);
  await dragNoteById(mia, fresh, DRAG_RIGHT, 0);
  await expectEventually('the new move arrives, and it is a move', async () => {
    const now = await placeOf(raj, fresh);
    return now !== null && now.x !== before!.x;
  }).toBe(true);

  await pressOnBoard(mia, 'z', 'ctrl');
  await expectEventually('and it is undone the way it always was', () => placeOf(raj, fresh)).toEqual(before!);
  expectQuiet(mia, raj);
});

// ---------------------------------------------------------------------------
// TC-24: everyone on the board undoing at the same time
// ---------------------------------------------------------------------------

test('TC-24: five people undo at once and every screen ends up holding the same board', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const crowd = await openParticipants(browser, CAPACITY);
  people = crowd;

  // The notes are all made by one pair of hands, one after another, so that the board starts as one board
  // rather than as five races to create; five people making changes at the same moment is tested below,
  // where that is the thing under test. Each person is given two notes of their own to work on.
  const places: { x: number; y: number }[] = [];
  for (let index = 0; index < CAPACITY; index += 1) {
    places.push(CROWD_FIRST_AT(index), CROWD_SECOND_AT(index));
  }
  const ids: string[] = [];
  for (const at of places) ids.push(await createNote(crowd[0]!.page, at));
  const startedAt = await expectConverged(`everybody has the same ${ids.length} notes to start with`, crowd, {
    timeoutMs: 60_000,
  });
  const start = new Map(
    (await documentOf(crowd[0]!)).map((note) => [
      note.id,
      { x: note.x, y: note.y, color: note.color, text: note.text },
    ]),
  );

  // Each person moves their own first note and puts a different word in their own second note, all five at
  // once and none of them waiting for anybody else. The distances differ and the words differ, so a change
  // that ended up attributed to the wrong person could not hide behind two people having written the same
  // numbers.
  const mine = crowd.map((_unused, index) => ids[index * 2]!);
  const typed = crowd.map((_unused, index) => ids[index * 2 + 1]!);
  const movedBy = crowd.map((_unused, index) => ({ x: 40 * (index + 1), y: 20 * (index + 1) }));
  const started = Date.now();
  await Promise.all(
    crowd.map(async (person, index) => {
      await dragNoteById(person, mine[index]!, movedBy[index]!.x, movedBy[index]!.y);
      await editNoteById(person, typed[index]!);
      await pasteIntoEditor(person.page, WORDS[index]!);
      await person.page.keyboard.press('Escape');
      await settled(person.page);
    }),
  );
  const worked = await expectConverged('the five agree on the board they have just been working on', crowd, {
    since: started,
    timeoutMs: 60_000,
  });
  expect(worked).not.toBe(startedAt);

  // Every one of those changes is on every screen before anybody undoes anything. This is not politeness:
  // a board that agreed because a change never arrived would agree just as loudly after five people spent
  // their undo presses on nothing.
  for (const [index, id] of mine.entries()) {
    for (const person of crowd) {
      expect((await placeOf(person, id))!.x, `${person.name} never saw a move`).toBeCloseTo(
        start.get(id)!.x + movedBy[index]!.x,
        1,
      );
    }
  }
  for (const [index, id] of typed.entries()) {
    for (const person of crowd) {
      expect((await placeOf(person, id))!.text, `${person.name} never saw a word`).toBe(WORDS[index]);
    }
  }

  // Everyone presses Ctrl+Z, and then presses it again: five histories being walked backwards at once.
  await Promise.all(crowd.map((person) => pressOnBoard(person, 'z', 'ctrl')));
  await Promise.all(crowd.map((person) => pressOnBoard(person, 'z', 'ctrl')));

  // Five pairs of hands, five separate stacks, one document — and one board at the end of it: each person's
  // own word is gone from their own note and their own note is back where it started, on every screen,
  // including on the four screens that had nothing to do with those changes. The key the five agree on is
  // the key they agreed on before the work began, which is the same claim made about every field of every
  // note at once rather than about the two fields that moved.
  const undone = await expectConverged('every screen holds the same board after five people undid twice', crowd, {
    since: started,
    timeoutMs: 60_000,
  });
  expect(undone).toBe(startedAt);
  for (const id of mine) {
    for (const person of crowd) {
      expect(await placeOf(person, id), `${person.name} is holding somebody else's move`).toEqual(
        start.get(id),
      );
    }
  }
  for (const id of typed) {
    for (const person of crowd) {
      expect(await placeOf(person, id), `${person.name} is holding somebody else's word`).toEqual(
        start.get(id),
      );
    }
  }

  // And the same in reverse: everyone redoes twice, the board comes back to where the work had left it, and
  // every screen comes with it. A redo puts back what the same tab took away, which is why five of them can
  // be issued in any order and still land on one board.
  await Promise.all(crowd.map((person) => pressOnBoard(person, 'Z', 'ctrl+shift')));
  await Promise.all(crowd.map((person) => pressOnBoard(person, 'Z', 'ctrl+shift')));
  const redone = await expectConverged('every screen holds the same board after five people redid twice', crowd, {
    since: started,
    timeoutMs: 60_000,
  });
  expect(redone).toBe(worked);
  expectQuiet(...crowd);
});

// ---------------------------------------------------------------------------
// The two buttons, on a board with two people on it
// ---------------------------------------------------------------------------

test('a board one person has only ever watched has nothing in either of its buttons', async ({
  browser,
}) => {
  const [watcher, author] = await openParticipants(browser, 2);
  people = [watcher, author];

  // Everything on this board was made by the other person, and it all arrives.
  await createNote(author.page, MINE_AT, 'theirs');
  await createNote(author.page, RAJ_AT, 'also theirs');
  await expectEventually('the watcher sees both notes', () => noteCountOn(watcher)).toBe(2);

  // And still both of the watcher's buttons are off, which is the whole of this story told in two buttons:
  // the board is not empty, and there is nothing for these two to do.
  await expectOff(undoButtonOf(watcher));
  await expectOff(redoButtonOf(watcher));

  // The author, who made both changes, has a light button on the very same board.
  await expectOn(undoButtonOf(author));

  // The watcher's undo is not merely greyed out: pressing it does nothing at all, and the keystroke is
  // refused the same way, so a keyboard shortcut is not a way past a button.
  await pressOnBoard(watcher, 'z', 'ctrl');
  expect(await idsOf(watcher)).toEqual(await idsOf(author));
  expect(await noteCountOn(watcher)).toBe(2);
  expectQuiet(watcher, author);
});

test('two presses take back two of my own steps, and never one of yours', async ({ browser }) => {
  const [mia, raj] = await openParticipants(browser, 2);
  people = [mia, raj];

  // A note, and a word typed into it: two things Mia did, so two steps on her side of the board.
  await createNote(mia.page, MINE_AT, 'mine');
  await expectEventually('Raj sees the note', () => noteCountOn(raj)).toBe(1);

  // Raj has nothing of his own in this board's history, whatever it holds.
  await expectOff(undoButtonOf(raj));
  await expectOff(redoButtonOf(raj));

  // Three presses on Mia's side: the word, then the note, and a third with nothing left to do.
  await pressOnBoard(mia, 'z', 'ctrl');
  await expectEventually('the word is gone from the screen Raj is looking at', async () => {
    const note = (await documentOf(raj))[0];
    return note ? note.text : null;
  }).toBe('');
  await pressOnBoard(mia, 'z', 'ctrl');
  await expectEventually('the note is gone from that screen too', () => noteCountOn(raj)).toBe(0);
  await expectOff(undoButtonOf(mia));
  await expectOn(redoButtonOf(mia));
  await pressOnBoard(mia, 'z', 'ctrl');
  expect(await noteCountOn(raj)).toBe(0);

  // Raj never had a step of his own and never took one back: his screen changed twice, both times because
  // Mia said so, and his buttons read the same as they did before any of it.
  await expectOff(undoButtonOf(raj));
  await expectOff(redoButtonOf(raj));
  await expectConverged('both screens agree on an empty board', [mia, raj]);
  expectQuiet(mia, raj);
});
