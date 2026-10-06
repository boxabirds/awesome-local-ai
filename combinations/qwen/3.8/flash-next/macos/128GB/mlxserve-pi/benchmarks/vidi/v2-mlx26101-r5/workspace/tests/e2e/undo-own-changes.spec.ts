/**
 * Story 8 in two browsers at once: my undo takes back what I did, and nothing anybody else did.
 *
 * The unit and component tests prove that only this tab's transactions are tracked. Only a real room
 * can prove the rest — that a change which arrives through a socket, from another person's keyboard, is
 * not in my history in any form, and that when I press Ctrl+Z the document that goes back is a document
 * the other person is still looking at. Two browsers, one room, one document each: that is the smallest
 * arrangement in which "undo did not touch anybody else" is a fact rather than a hope.
 *
 * Design matrix: TC-22 (a delete undone and redone, with a colleague's note made in between), TC-23 (the
 * step being undone belongs to an object a colleague has since deleted), TC-24 (every editor at once,
 * each undoing their own work, all boards identical afterwards).
 */
import { expect, test, type Page } from '@playwright/test';

import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  clickNote,
  createNotesAt,
  createNotesOnAGrid,
  doubleClickCreate,
  dragNote,
  expectNoteCount,
  noteStates,
  noteText,
  noteWorld,
  objectWorld,
  selectObjects,
  waitForNoteAtRest,
  type NoteState,
} from './helpers/board';
import {
  closeParticipants,
  expectChangeToArrive,
  expectNoConsoleErrors,
  expectSameBoard,
  newBoard,
  openParticipants,
  resetLatencySamples,
  stopEditing,
  writeLatencyReport,
  type Participant,
} from './helpers/participants';

/** The undo chord, as a keyboard presses it. The board answers both platforms' modifier. */
const undo = (person: Participant): Promise<void> => person.page.keyboard.press('Control+z');
const redo = (person: Participant): Promise<void> =>
  person.page.keyboard.press('Control+Shift+z');

/** Notes by id, so a restored note can be compared with the note it was. */
function byId(states: readonly NoteState[]): Map<string, NoteState> {
  return new Map(states.map((state) => [state.id, state]));
}

/** The first person's browser, for a measurement that any one of them can be asked to make. */
function screenOf(people: readonly Participant[]): Page {
  const person = people[0];
  if (!person) throw new Error('there was nobody to look through');
  return person.page;
}

test('TC-22 eight notes deleted come back on both screens, and the colleague keeps their own note', async ({
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  resetLatencySamples();
  const boardId = newBoard();
  const [mia, raj] = await openParticipants(browser, ['Mia', 'Raj'], boardId);
  if (!mia || !raj) throw new Error('two people were asked for');

  // A dozen notes, made by Mia, each with words on it and a colour of its own — so that "the eight came
  // back" can be checked against more than a count.
  await createNotesOnAGrid(mia.page, 12, ['yellow', 'blue', 'green', 'pink']);
  await expectNoteCount(raj.page, 12);
  await expectSameBoard([mia, raj], 'both screens hold the same dozen notes');

  // Mia picks eight of them and drops them: a selection made by clicking, and one press of Delete.
  const ids = (await noteStates(mia.page)).map((state) => state.id);
  const deleted = ids.slice(0, 8);
  const kept = ids.slice(8);
  await selectObjects(mia.page, deleted);
  const asTheyWere = byId(await noteStates(mia.page));
  await mia.page.keyboard.press('Delete');
  await expectNoteCount(mia.page, 4);

  // Raj sees eight notes go. This is the moment the story turns on: the deletion arrives in his browser
  // and does not become part of his history — and it does not become hers to undo twice, either.
  await expectNoteCount(raj.page, 4);

  // While the eight are gone, Raj puts a note of his own on the board.
  const [rajNote] = await createNotesAt(raj.page, [{ x: 700, y: 660 }]);
  await expectNoteCount(mia.page, 5);

  // Mia takes her delete back. One press, because eight notes went in one press.
  await undo(mia);

  await expectNoteCount(mia.page, 13);
  const restoredOnRaj = await expectNoteCount(raj.page, 13);

  // Every one of the eight, exactly as it was: the same words, the same colour, the same place, the
  // same layer — because what was undone was the delete, and not the dozen things that made them.
  const restored = byId(await noteStates(mia.page));
  for (const id of deleted) {
    expect(restored.get(id), `note ${id} came back as it was`).toEqual(asTheyWere.get(id));
  }
  // Raj's note is there, and the four Mia never deleted are where they were left.
  expect(restoredOnRaj).toContain(rajNote);
  for (const id of kept) expect(restored.get(id)).toEqual(asTheyWere.get(id));

  // Both screens are the same board again, with nothing left half-applied.
  await expectSameBoard([mia, raj], 'thirteen notes on both screens');

  // And the delete is still a delete: Redo puts it back, on both screens, and takes only Mia's eight.
  await redo(mia);
  await expectNoteCount(mia.page, 5);
  const afterRedo = await expectNoteCount(raj.page, 5);
  for (const id of deleted) expect(afterRedo, `note ${id} is gone again`).not.toContain(id);
  expect(afterRedo, "Raj's note survived Mia's undo and her redo both").toContain(rajNote);
  for (const id of kept) expect(afterRedo).toContain(id);

  await expectSameBoard([mia, raj], 'five notes on both screens after the redo');
  expectNoConsoleErrors([mia, raj]);
  await writeLatencyReport(testInfo, 'undo-eight');
  await closeParticipants([mia, raj]);
});

test('TC-23 undoing a move of a note a colleague has deleted does nothing to anybody', async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  resetLatencySamples();
  const boardId = newBoard();
  const [mia, raj] = await openParticipants(browser, ['Mia', 'Raj'], boardId);
  if (!mia || !raj) throw new Error('two people were asked for');

  // Raj lays out six notes. They are his work, not hers: the only thing in Mia's history is the one
  // note she moved, which is what makes the assertion below a statement about one step rather than
  // about however many notes she happened to have made.
  const created = await createNotesAt(raj.page, [
    { x: 200, y: 220 },
    { x: 440, y: 220 },
    { x: 680, y: 220 },
    { x: 200, y: 460 },
    { x: 440, y: 460 },
    { x: 680, y: 460 },
  ]);
  await expectNoteCount(mia.page, 6);

  // Mia moves one of them, and Raj sees the move — which is what makes it a thing in his browser too.
  const moved = created[1] as string;
  const others = created.filter((id) => id !== moved);
  const from = await objectWorld(mia.page, moved);
  await dragNote(mia.page, moved, 160, 90);
  const movedTo = await waitForNoteAtRest(mia.page, moved);
  expect(movedTo.x).toBeCloseTo(from.x + 160, 5);
  await expectChangeToArrive([raj], 'the move arrives', async (person) => {
    const world = await noteWorld(person.page, moved);
    return Math.abs(world.x - (from.x + 160)) < 0.00001;
  });

  // Raj deletes it. There is no race here: it is an ordinary afternoon on a shared board.
  await clickNote(raj.page, moved);
  await raj.page.keyboard.press('Delete');
  await expectNoteCount(mia.page, 5);
  await expectNoteCount(raj.page, 5);
  const untouched = byId(await noteStates(raj.page));

  // Mia undoes her move — of a note that is no longer there. Yjs will not put content into an object
  // somebody else deleted, so the note stays gone on both screens and nothing else on the board moves.
  await undo(mia);

  await expectNoteCount(mia.page, 5);
  await expectNoteCount(raj.page, 5);
  const afterUndo = byId(await noteStates(mia.page));
  expect(afterUndo.has(moved), 'the note a colleague deleted did not come back').toBe(false);
  for (const id of others) {
    expect(afterUndo.get(id), `note ${id} did not move`).toEqual(untouched.get(id));
  }
  await expectSameBoard([mia, raj], 'five notes, and the deleted one is still deleted');

  // She presses it again, and again: no dialog, no half-applied state, no note coming back from a
  // delete she did not make. A history with nothing left in it is a history that says nothing.
  await undo(mia);
  await undo(mia);
  await redo(mia);
  const afterTries = await noteStates(mia.page);
  expect(afterTries).toHaveLength(5);
  expect(afterTries.map((state) => state.id)).not.toContain(moved);
  await expectSameBoard([mia, raj], 'both screens still agree after three more presses');

  // And the board is still a board she can work on: Raj puts a note down and she sees it.
  const [fresh] = await createNotesAt(raj.page, [{ x: 900, y: 620 }]);
  if (!fresh) throw new Error('Raj made no note');
  await expectNoteCount(mia.page, 6);
  expect(await noteText(mia.page, fresh)).toBe('');

  expectNoConsoleErrors([mia, raj]);
  await writeLatencyReport(testInfo, 'undo-deleted');
  await closeParticipants([mia, raj]);
});

test('TC-24 every editor at once undoes their own change and nobody else’s', async ({
  browser,
}, testInfo) => {
  test.setTimeout(420_000);
  resetLatencySamples();
  const boardId = newBoard();

  // As many people as the product is designed to have on one board at a time, every one of them with
  // something of their own to undo.
  const names = ['Alex', 'Beth', 'Cy', 'Devi', 'Eli'] as const;
  expect(MAX_CONCURRENT_EDITORS).toBe(names.length);
  const people = await openParticipants(browser, names, boardId);

  // Each person puts a note on the board in a place of their own, writes their own name on it, and
  // closes it — notes on one row, far enough apart that a press on one is a press on one.
  const placed: { person: Participant; id: string; x: number; y: number }[] = [];
  for (const [index, person] of people.entries()) {
    const name = names[index] as string;
    const id = await doubleClickCreate(person.page, 140 + index * 210, 320);
    await person.page.keyboard.type(name);
    await stopEditing(person.page);
    const world = await objectWorld(person.page, id);
    placed.push({ person, id, x: world.x, y: world.y });
  }
  await expectNoteCount(screenOf(people), MAX_CONCURRENT_EDITORS);
  await expectSameBoard(people, 'everyone holds everyone else’s notes');
  const written = byId(await noteStates(screenOf(people)));
  for (const [index, note] of placed.entries()) {
    expect(written.get(note.id)?.text).toBe(names[index]);
  }

  // Then everyone moves their own note, at the same time, by their own amount — the case the PRD is
  // about: five people writing one document, nobody waiting for anybody.
  const movedBy = names.map((_, index) => 40 + index * 15);
  await Promise.all(
    placed.map((note, index) => dragNote(note.person.page, note.id, movedBy[index] ?? 40, 60)),
  );
  for (const note of placed) await waitForNoteAtRest(note.person.page, note.id);
  await expectSameBoard(people, 'five notes, five people, all moving at once');
  const dragged = byId(await noteStates(screenOf(people)));
  for (const [index, note] of placed.entries()) {
    expect(dragged.get(note.id)?.x).toBeCloseTo(note.x + (movedBy[index] ?? 0), 5);
    expect(dragged.get(note.id)?.y).toBeCloseTo(note.y + 60, 5);
  }

  // And everyone presses undo, at the same time, without arranging it with each other.
  await Promise.all(people.map((person) => undo(person)));

  // What comes back is each person's own move and nothing more: every note is back where its owner put
  // it down, still wearing the name its owner typed. Each owner sees their own undo first, and then
  // everybody agrees — and agreement is the proof that all five undos have reached all five screens,
  // because a person's own screen always holds their own undo.
  for (const note of placed) {
    await expect
      .poll(
        async () => {
          const mine = byId(await noteStates(note.person.page)).get(note.id);
          return mine !== undefined && Math.abs(mine.x - note.x) < 0.00001;
        },
        { message: `waiting for ${note.person.name}'s own move to come back` },
      )
      .toBe(true);
  }
  await expectSameBoard(people, 'five screens, one board, after five undos');
  const afterUndo = byId(await noteStates(screenOf(people)));
  for (const [index, note] of placed.entries()) {
    const state = afterUndo.get(note.id);
    expect(state, `${names[index]}'s note is still on the board`).toBeDefined();
    expect(state?.text, `${names[index]}'s words were not undone by anybody else`).toBe(names[index]);
    expect(state?.x, `${names[index]}'s note is back where it was left`).toBeCloseTo(note.x, 5);
    expect(state?.y, `${names[index]}'s note is back where it was left`).toBeCloseTo(note.y, 5);
  }

  // Undo again, and this time it is each person's own typing that goes: the notes stay, the names go,
  // and the five screens are identical for the second time.
  await Promise.all(people.map((person) => undo(person)));
  await expect
    .poll(
      async () => (await noteStates(screenOf(people))).every((state) => state.text === ''),
      { message: 'waiting for five names to be erased by five owners' },
    )
    .toBe(true);
  await expectSameBoard(people, 'five blank notes on five screens');
  const afterSecondUndo = await noteStates(screenOf(people));
  expect(afterSecondUndo).toHaveLength(MAX_CONCURRENT_EDITORS);
  const stillPlaced = byId(afterSecondUndo);
  for (const note of placed) {
    expect(stillPlaced.get(note.id)?.x, 'no note moved on anybody else’s undo').toBeCloseTo(note.x, 5);
  }

  expectNoConsoleErrors(people);
  await writeLatencyReport(testInfo, 'undo-five-editors');
  await closeParticipants(people);
});
