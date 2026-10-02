// Story 8, e2e: undo and redo in front of other people working on the same board.
//
// Three things can only be shown in a real browser on a real room: that a change
// of mine comes back on somebody else's screen as well as on mine (undo writes to
// the shared document, so it travels like any other change); that undoing a change
// somebody else made is not available to me at all (their steps never enter my
// history); and that a room full of people undoing at the same moment ends with
// everybody's own work reverted and nobody else's touched.
//
// The notes whose deletion gets undone are put on the board by somebody who then
// leaves. That is not a shortcut around the app: it means those notes are as much
// part of the board as if a colleague had made them an hour ago, so the only thing
// in the history of anybody still on the board is what they themselves did. It is
// what makes "the eight come back" a statement about the undo, and not about who
// happened to type.
//
// Nothing here asserts wall-clock time. A change is waited for up to
// E2E_EVENTUAL_TIMEOUT_MS, and how long it took is printed against the latency
// budget, as in story 3.
import { expect, test, type Page } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS, UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import {
  boardStateOf,
  expectEventually,
  expectNoProblems,
  expectSameBoard,
  joinBoard,
  leaveAll,
  newBoard,
  noteCountOf,
  noteKeyOf,
  reportLatency,
  type BoardState,
  type Person,
} from './helpers/participants';
import {
  clickNote,
  createNoteAt,
  deleteButton,
  dragNote,
  editor,
  expectWorldAt,
  noteColor,
  noteIds,
  noteLocator,
  noteText,
  noteWorldPos,
  rgb,
  swatch,
  waitForNoteCount,
  type ScreenPoint,
} from './helpers/stickies';

const undoButton = (page: Page) => page.getByTestId('undo-button');
const redoButton = (page: Page) => page.getByTestId('redo-button');

/**
 * This person's own undo, done the way they would do it. Ctrl is one of the two
 * keys the board listens for on every platform, so one spelling is right for
 * macOS, Windows and Linux alike.
 */
const pressUndo = (page: Page) => page.keyboard.press('Control+z');
const pressRedo = (page: Page) => page.keyboard.press('Control+Shift+z');

/**
 * Fill the board through the test-build hook, which is the only practical way to
 * put eight notes on a board in a browser test (double-clicking eight times makes
 * the person filling it a writer whose own work a later test would have to reason
 * about). The notes arrive on the board like anybody's work.
 */
async function fillBoard(page: Page, count: number): Promise<string[]> {
  await page.evaluate((n: number) => window.__vidi6!.seedNotes(n), count);
  const ids = await waitForNoteCount(page, count);
  return ids;
}

/** The line of one note — id, x, y, colour, text — out of a whole board state. */
const lineOf = (state: BoardState, id: string): string | undefined =>
  state.notes.find((entry) => entry.startsWith(`${id}|`));

/** The same board state with stacking sorted out, so only the content is compared. */
const sortedLines = (state: BoardState): string[] => state.notes.slice().sort();

/**
 * Longer than a typing burst is allowed to span and still be one step, so that
 * whatever a test does after this is known to be a step of its own.
 */
const longerThanATypingBurst = () =>
  new Promise((resolve) => setTimeout(resolve, UNDO_CAPTURE_TIMEOUT_MS + 300));

test.afterEach(() => {
  reportLatency('undo changes measured in this test');
});

test.describe('undoing my own work while other people are working', () => {
  test('TC-22: my undone delete comes back on every screen, and only what I deleted comes back', async ({
    browser,
    request,
  }) => {
    const boardId = await newBoard(request);

    // Somebody who then leaves fills the board, and recolours one of the notes, so
    // that "the eight came back" is a check on more than their simply reappearing.
    const gardener = await joinBoard(browser, 'Gardener', boardId);
    const eight = await fillBoard(gardener.page, 8);
    await clickNote(gardener.page, eight[0]!);
    await swatch(gardener.page, 'pink').click();
    await expectEventually(
      'the recolour is on the board',
      () => noteColor(gardener.page, eight[0]!),
      rgb('pink'),
    );
    // Their work is finished and they go. What they made stays on the board.
    await gardener.context.close();

    const mia = await joinBoard(browser, 'Mia', boardId);
    const raj = await joinBoard(browser, 'Raj', boardId);
    await waitForNoteCount(mia.page, 8);
    await waitForNoteCount(raj.page, 8);
    await expectSameBoard([mia, raj], 'the eight notes, on both screens');
    const before = await boardStateOf(mia.page);

    // Mia selects the whole board — every one of the eight, including the notes
    // that hang off the bottom of the window — and throws it away.
    await mia.page.keyboard.press('Control+a');
    await expect(mia.page.getByTestId('selection-count')).toHaveText('8 selected');
    await mia.page.keyboard.press('Delete');
    await expectEventually('the board is empty on Mia’s screen', () => noteCountOf(mia.page), 0);
    await expectEventually('the board is empty on Raj’s screen', () => noteCountOf(raj.page), 0);

    // Raj puts a note of his own on the empty board.
    const rajNote = await createNoteAt(raj.page, { x: 200, y: 620 }, 'raj was here');
    await expectEventually('Mia sees the note Raj made', () => noteCountOf(mia.page), 1);

    // Mia changes her mind.
    await pressUndo(mia.page);
    await expectEventually('the eight are back on Mia’s screen', () => noteCountOf(mia.page), 9);
    await expectEventually('the eight are back on Raj’s screen too', () => noteCountOf(raj.page), 9);

    // Every one of them is the note it was: same place, same colour, same words.
    const restored = await boardStateOf(mia.page);
    for (const id of eight) {
      expect(lineOf(restored, id)).toBe(lineOf(before, id));
    }
    // And Raj's own note is untouched by any of it, on both screens.
    expect(await noteText(mia.page, rajNote)).toBe('raj was here');
    expect(await noteText(raj.page, rajNote)).toBe('raj was here');

    // There was nothing else in Mia's history, so Undo says it is empty, while
    // what she just undid is there to be put back.
    await expect(undoButton(mia.page)).toBeDisabled();
    await expect(redoButton(mia.page)).toBeEnabled();

    // She puts the delete back with the Redo button, and the board empties again
    // everywhere but for what Raj made.
    await redoButton(mia.page).click();
    await expectEventually('the eight are gone again on Mia’s screen', () => noteCountOf(mia.page), 1);
    await expectEventually('the eight are gone again on Raj’s screen', () => noteCountOf(raj.page), 1);
    expect(await noteIds(raj.page)).toEqual([rajNote]);
    await expect(undoButton(mia.page)).toBeEnabled();
    await expect(redoButton(mia.page)).toBeDisabled();

    // None of this was ever in Raj's history to begin with: his Undo holds his own
    // note and nothing Mia did. Pressing it takes back what he did, in his own
    // steps — first his words, then his note. It never brings back a note Mia
    // deleted, and it never deletes a note Mia brought back.
    await expect(undoButton(raj.page)).toBeEnabled();
    await pressUndo(raj.page);
    await expectEventually('Raj’s own words are gone from his note', () => noteText(mia.page, rajNote), '');
    // The eight are as Mia left them: deleted again by her own Redo, and no
    // undo of Raj's reaches into that.
    expect(await noteCountOf(mia.page)).toBe(1);
    await pressUndo(raj.page);
    await expectEventually('and then Raj’s own note is gone from both screens', () => noteCountOf(mia.page), 0);
    await expectEventually('leaving nothing at all on Raj’s screen', () => noteCountOf(raj.page), 0);
    // His history is now empty of its own accord: those two steps were all it had.
    await expect(undoButton(raj.page)).toBeDisabled();
    await expect(redoButton(raj.page)).toBeEnabled();

    await expectNoProblems([mia, raj]);
    await leaveAll([mia, raj]);
  });

  test('TC-23: undoing my move of a note a colleague has since deleted is not an error', async ({
    browser,
    request,
  }) => {
    const boardId = await newBoard(request);
    const gardener = await joinBoard(browser, 'Gardener', boardId);
    const moved = await createNoteAt(gardener.page, { x: 420, y: 300 }, 'the one to move');
    const other = await createNoteAt(gardener.page, { x: 940, y: 300 }, 'the other one');
    await gardener.context.close();

    const mia = await joinBoard(browser, 'Mia', boardId);
    const raj = await joinBoard(browser, 'Raj', boardId);
    await waitForNoteCount(mia.page, 2);
    await waitForNoteCount(raj.page, 2);

    // Mia moves a note she did not make. Raj sees it where she put it.
    await dragNote(mia.page, moved, 150, 60);
    const whereShePutIt = await noteKeyOf(mia.page, moved);
    await expectEventually('the move is on Raj’s screen', () => noteKeyOf(raj.page, moved), whereShePutIt);

    // While she is not looking, Raj deletes that very note.
    await clickNote(raj.page, moved);
    await deleteButton(raj.page).click();
    await expectEventually('the note is gone for Raj', () => noteCountOf(raj.page), 1);
    await expectEventually('the note is gone for Mia too', () => noteCountOf(mia.page), 1);

    // Mia presses Ctrl+Z. The last thing she did was move a note that is no longer
    // on the board, so there is nothing to put back. The board must not throw, must
    // not complain, and must not invent a note she never deleted.
    await pressUndo(mia.page);
    await expectEventually('nothing appeared on Mia’s screen', () => noteCountOf(mia.page), 1);
    expect(await noteLocator(mia.page, moved).count()).toBe(0);
    expect(await noteLocator(raj.page, moved).count()).toBe(0);
    await expectSameBoard([mia, raj], 'the board after an undo with nothing to undo');

    // Her history still works. A change of hers that can be undone is undone
    // normally, and comes back where it was on Raj's screen like anything else.
    const was = await noteWorldPos(mia.page, other);
    await dragNote(mia.page, other, -80, 40);
    const secondMove = await noteWorldPos(mia.page, other);
    await expectEventually('her next move is on Raj’s screen', () => noteWorldPos(raj.page, other), secondMove);
    await pressUndo(mia.page);
    await expectWorldAt(mia.page, other, was.x, was.y);
    await expectEventually('and back where it was on Raj’s screen', () => noteWorldPos(raj.page, other), was);
    // What Raj deleted stayed deleted: her undo never reached into his work.
    expect(await noteLocator(mia.page, moved).count()).toBe(0);
    await expectNoProblems([mia, raj]);
    await leaveAll([mia, raj]);
  });

  test('TC-24: everybody on the board undoes their own work and nobody else’s', async ({
    browser,
    request,
  }) => {
    const boardId = await newBoard(request);

    // One note per person, far enough apart that one person's drag and another
    // person's typing never land on the same note by accident.
    const places: ScreenPoint[] = [
      { x: 200, y: 180 },
      { x: 500, y: 180 },
      { x: 800, y: 180 },
      { x: 1080, y: 180 },
      { x: 350, y: 580 },
    ].slice(0, MAX_CONCURRENT_EDITORS);

    const gardener = await joinBoard(browser, 'Gardener', boardId);
    const ids: string[] = [];
    for (const [index, place] of places.entries()) {
      ids.push(await createNoteAt(gardener.page, place, `note ${index}`));
    }
    await gardener.context.close();

    const people: Person[] = [];
    for (let index = 0; index < MAX_CONCURRENT_EDITORS; index++) {
      people.push(await joinBoard(browser, `Person${index}`, boardId));
    }
    for (const person of people) await waitForNoteCount(person.page, MAX_CONCURRENT_EDITORS);
    await expectSameBoard(people, 'the board, on every screen');
    const start = await boardStateOf(people[0]!.page);

    // Everyone moves their own note, at the same time.
    await Promise.all(
      people.map(async (person, index) => {
        await dragNote(person.page, ids[index]!, 40 + 20 * index, 30 + 10 * index);
      }),
    );
    await expectSameBoard(people, 'every move, on every screen');
    const moved = await boardStateOf(people[0]!.page);

    // Everyone types into somebody else's note, at the same time, so that each
    // note holds one person's words and another person's move.
    await Promise.all(
      people.map(async (person, index) => {
        const target = ids[(index + 1) % MAX_CONCURRENT_EDITORS]!;
        await clickNote(person.page, target);
        await person.page.keyboard.press('Enter');
        await expect(editor(person.page)).toBeVisible();
        await person.page.keyboard.type(` p${index}`);
        await person.page.keyboard.press('Escape');
      }),
    );
    await expectSameBoard(people, 'every edit of every note, on every screen');
    // Past the window in which typing is one step, so that the undo below is
    // certainly undoing a whole finished step rather than a burst still open.
    await longerThanATypingBurst();

    // Everyone undoes, at the same moment. What each of them loses is their own
    // typing; every move stands, including the move of the note they typed in.
    await Promise.all(people.map((person) => pressUndo(person.page)));
    await expectSameBoard(people, 'the boards agree again after everyone undid their typing');
    for (const [index, person] of people.entries()) {
      const mine = ids[index]!;
      const typedIn = ids[(index + 1) % MAX_CONCURRENT_EDITORS]!;
      expect(await noteWorldPos(person.page, mine)).toEqual(await noteWorldPos(people[0]!.page, mine));
      // Their own typing is gone, and the board's own words are what is left.
      expect(await noteText(person.page, typedIn)).toBe(`note ${(index + 1) % MAX_CONCURRENT_EDITORS}`);
    }
    // Nobody's move was undone by anybody's typing-undo: every note is still where
    // its mover put it.
    for (const id of ids) {
      expect(lineOf(await boardStateOf(people[0]!.page), id)).toBe(lineOf(moved, id));
    }

    // Everyone undoes again. Now their own move goes as well, and every board is
    // back to the state the person who laid it out left it in, note for note.
    await Promise.all(people.map((person) => pressUndo(person.page)));
    await expectSameBoard(people, 'the boards agree again after everyone undid their moves');
    expect(sortedLines(await boardStateOf(people[0]!.page))).toEqual(sortedLines(start));

    // And each of them can put their own work back without putting anybody else's
    // back a second time: after one Redo each, every note is where its mover put
    // it and holds none of the words anybody typed.
    await Promise.all(people.map((person) => pressRedo(person.page)));
    await expectSameBoard(people, 'the boards agree again after everyone redid their moves');
    const redone = await boardStateOf(people[0]!.page);
    for (const [index, id] of ids.entries()) {
      const now = lineOf(redone, id)!;
      const asItStarted = lineOf(start, id)!;
      expect(now.split('|').slice(3)).toEqual(asItStarted.split('|').slice(3)); // colour and words, untouched
      expect(now).not.toBe(asItStarted); // and it is the moved note, not the note it was
      expect(lineOf(redone, id)).toBe(lineOf(moved, id));
    }

    await expectNoProblems(people);
    await leaveAll(people);
  });
});
