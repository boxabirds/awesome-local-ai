/**
 * Undo and redo while somebody else is working on the same board (story 8).
 *
 * The unit and component tests can say that a history holds only this tab's writes; only
 * a browser run says it across a real socket, where the other person's changes arrive as
 * remote updates and this person's Ctrl+Z has to leave them standing. What is asserted
 * here is what each of the five screens shows, read out of the DOM, and that they agree.
 *
 * A note this person moved but somebody else deleted is the interesting failure: undo must
 * do nothing rather than reach the note back, because the deletion was not this person's
 * to reverse. That, plus the ordinary case of an eight-note delete taken back whole while
 * a colleague's own note is added in between, plus five people undoing at once.
 *
 * TC-22 an accidental delete comes back; the colleague's note is untouched
 * TC-23 undo a move of a note somebody else deleted: no error, history still usable
 * TC-24 the design capacity of people, each undoing only their own work
 */
import { expect, test, type Browser } from '@playwright/test';

import { DEFAULT_STICKY_COLOR, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

import {
  noteWorld,
  openBoard,
  placeNote,
  waitForChange,
  waitForIdenticalBoards,
  type BoardNote,
  type BoardSession,
  type Participant,
} from './helpers/participants';
import {
  deleteSelectionFromBar,
  dragMarquee,
  expectSelectedCount,
  placeNotes,
} from './helpers/selection';

/** The shortcuts, as the board reads them. Ctrl works on every engine tested here. */
const UNDO = 'Control+z';
const REDO = 'Control+Shift+z';

/** Hand a board to the test and close every context whatever the test did. */
async function withBoard(
  browser: Browser,
  count: number,
  run: (session: BoardSession) => Promise<void>,
): Promise<void> {
  const session = await openBoard(browser, count);
  try {
    await run(session);
  } finally {
    await session.close();
  }
}

const undoButton = (person: Participant) => person.page.getByTestId('undo-button');
const redoButton = (person: Participant) => person.page.getByTestId('redo-button');

async function pressUndo(person: Participant): Promise<void> {
  await person.page.keyboard.press(UNDO);
}

async function pressRedo(person: Participant): Promise<void> {
  await person.page.keyboard.press(REDO);
}

/** The notes with these ids, as one string, in the order the ids are given. */
function portrait(notes: readonly BoardNote[], ids: readonly string[]): string {
  return ids
    .map((id) => {
      const note = notes.find((candidate) => candidate.id === id);
      return note ? `${note.id} ${note.x},${note.y} ${note.color} "${note.text}"` : `${id} absent`;
    })
    .join('\n');
}

/** Eight notes in two rows, all of them inside one marquee. */
const CLUSTER = [
  { x: 250, y: 250 },
  { x: 490, y: 250 },
  { x: 730, y: 250 },
  { x: 970, y: 250 },
  { x: 250, y: 520 },
  { x: 490, y: 520 },
  { x: 730, y: 520 },
  { x: 970, y: 520 },
];

/** Empty board on all sides of `CLUSTER`: the marquee starts outside it and ends beyond. */
const OVER_ALL = { from: { x: 100, y: 100 }, to: { x: 1120, y: 690 } };

test.describe('undo in front of other people', () => {
  test('TC-22 an accidental delete comes back, and the colleague keeps their own note', async ({
    browser,
  }) => {
    await withBoard(browser, 2, async (session) => {
      const mia = session.byName('Alex');
      const raj = session.byName('Sam');

      // Mia's eight, two of them carrying something worth getting back.
      const ids = await placeNotes(mia.page, CLUSTER);
      await mia.editNote(ids[0]!, 'retro');
      await mia.stopEditing();
      await mia.selectNote(ids[1]!);
      await mia.recolour('Green');
      await mia.page.keyboard.press('Escape');
      await waitForIdenticalBoards('TC-22: eight notes on both screens', [mia, raj]);

      // Raj puts his own note well below hers, and writes in it.
      const rajNote = await placeNote(raj, noteWorld(3, 0));
      await raj.editNote(rajNote, 'raj keeps this');
      await raj.stopEditing();
      await waitForIdenticalBoards('TC-22: Raj’s note reaches Mia', [mia, raj]);

      // The state the undo has to return to, position and colour and word included.
      const before = portrait(await mia.board(), ids);

      // The mistake: one marquee over all eight, and the bar's delete.
      await dragMarquee(mia.page, OVER_ALL.from, OVER_ALL.to);
      await expectSelectedCount(mia.page, 8);
      await deleteSelectionFromBar(mia.page);
      await waitForChange('TC-22: the delete reaches Raj', async () =>
        (await raj.noteIds()).every((id) => id === rajNote),
      );
      expect(await mia.noteIds()).toEqual([rajNote]);

      // Ctrl+Z. The eight are back on her screen, exactly as they were.
      await pressUndo(mia);
      expect(portrait(await mia.board(), ids), 'the notes came back as they were').toBe(before);

      // They are back on his screen too, and his own note is where he left it.
      await waitForIdenticalBoards('TC-22: the undo reaches Raj', [mia, raj]);
      expect((await raj.note(rajNote))?.text).toBe('raj keeps this');
      expect((await raj.note(ids[0]!))?.text).toBe('retro');
      expect((await raj.note(ids[1]!))?.color).toBe('green');
      expect((await mia.board()).length).toBe(9);

      // Redo takes the eight away again — and still leaves Raj's note standing.
      await pressRedo(mia);
      await waitForChange('TC-22: the redo reaches Raj', async () =>
        (await raj.noteIds()).every((id) => id === rajNote),
      );
      expect(await mia.noteIds()).toEqual([rajNote]);

      // The history is one step deep again: Undo offered, Redo not.
      await expect(undoButton(mia)).toBeEnabled();
      await expect(redoButton(mia)).toBeDisabled();

      // And on to the bottom of it. Everything she did on this board goes, one step at a
      // time, and the button gives up when there is nothing of hers left — while Raj's
      // note, which was never in her history, is the one note still standing.
      let presses = 0;
      while (!(await undoButton(mia).isDisabled()) && presses < 40) {
        await undoButton(mia).click();
        presses += 1;
      }
      // Eight creations, one word, one colour, one delete — and nothing of Raj's in there.
      expect(presses, 'her own steps, and nothing invented').toBe(11);
      await waitForChange('TC-22: the unwound board reaches Raj', async () =>
        (await raj.noteIds()).every((id) => id === rajNote),
      );
      expect(await mia.noteIds(), 'only Raj’s note outlives her whole history').toEqual([rajNote]);
      await expect(undoButton(mia)).toBeDisabled();
      await expect(redoButton(mia)).toBeEnabled();

      // Every one of those steps is hers to put back, and replaying the lot ends where
      // her history ends: her eight notes deleted again, and Raj's still standing.
      for (let index = 0; index < presses; index += 1) await pressRedo(mia);
      await waitForIdenticalBoards('TC-22: the replayed history agrees on both screens', [mia, raj]);
      expect(await mia.noteIds(), 'the whole history replays to its own end').toEqual([rajNote]);
      await expect(undoButton(mia)).toBeEnabled();
      await expect(redoButton(mia)).toBeDisabled();

      // One undo back off the end, and the eight are standing again, as they were.
      await pressUndo(mia);
      await waitForIdenticalBoards('TC-22: the eight return once more', [mia, raj]);
      expect(portrait(await mia.board(), ids), 'the eight came back as they were').toBe(before);

      expect([...mia.errors(), ...raj.errors()], 'nothing went wrong on either screen').toEqual([]);
    });
  });

  test('TC-23 undoing a move of a note somebody else deleted does nothing, and the history keeps working', async ({
    browser,
  }) => {
    await withBoard(browser, 2, async (session) => {
      const mia = session.byName('Alex');
      const raj = session.byName('Sam');

      // Two notes of Mia's, one of which she is about to lose. Every step from here is hers
      // except the deletion, so her history is: create, create, move.
      const moved = await placeNote(mia, noteWorld(0, 0));
      const kept = await placeNote(mia, noteWorld(0, 1));
      await waitForIdenticalBoards('TC-23: both notes reach Raj', [mia, raj]);

      const was = await mia.note(moved);
      if (!was) throw new Error('Mia has no note to move');
      await mia.dragNote(moved, { x: 180, y: 60 });
      await waitForChange('TC-23: the move reaches Raj', async () => {
        const now = await raj.note(moved);
        return now !== undefined && Math.abs(now.x - (was.x + 180)) < 2;
      });

      // Raj deletes the note from his own screen.
      await raj.selectNote(moved);
      await raj.deleteSelectedNote();
      await waitForChange('TC-23: the delete reaches Mia', async () =>
        (await mia.note(moved)) === undefined,
      );

      // Mia undoes her move. The note stays gone: she moved it, Raj deleted it, and
      // reaching it back would undo him. Nothing is thrown and nothing is announced.
      await pressUndo(mia);
      await mia.page.waitForTimeout(250);
      expect(await mia.note(moved), 'the note she did not delete stays deleted').toBeUndefined();
      expect(await raj.note(moved)).toBeUndefined();

      // And the history is still usable: her next undo takes her own other note away, on
      // both screens.
      await pressUndo(mia);
      await waitForChange('TC-23: her next undo works', async () =>
        (await mia.note(kept)) === undefined,
      );
      expect(await raj.note(kept)).toBeUndefined();

      expect([...mia.errors(), ...raj.errors()], 'no error was shown or logged').toEqual([]);
    });
  });

  test('TC-24 everyone at the design capacity undoes their own work and only theirs', async ({
    browser,
  }) => {
    await withBoard(browser, MAX_CONCURRENT_EDITORS, async (session) => {
      const people = session.participants;

      // One note each, one row each, so no undo here can be confused with anybody else's.
      const owned: { person: Participant; id: string; word: string; place: BoardNote }[] = [];
      for (const [index, person] of people.entries()) {
        const id = await placeNote(person, noteWorld(index, 0));
        const place = await person.note(id);
        if (!place) throw new Error(`${person.name} has no note`);
        owned.push({ person, id, place, word: `only-${person.name.toLowerCase()}` });
      }
      await waitForIdenticalBoards('TC-24: one note each', people);
      expect((await people[0]!.board()).length).toBe(MAX_CONCURRENT_EDITORS);

      // Two steps apiece: a drag of their own note, then a word in it.
      const made = new Map<string, { x: number; y: number }>();
      for (const one of owned) made.set(one.id, { x: one.place.x, y: one.place.y });
      for (const one of owned) await one.person.dragNote(one.id, { x: 60, y: 40 });
      await waitForIdenticalBoards('TC-24: the moves reach everyone', people);
      for (const one of owned) {
        await one.person.editNote(one.id, one.word);
        await one.person.stopEditing();
      }
      await waitForIdenticalBoards('TC-24: two changes each', people);
      for (const one of owned) {
        const note = await people[0]!.note(one.id);
        expect(note?.text, `${one.id} took its word`).toBe(one.word);
        expect(note?.x, `${one.id} took its move`).toBeCloseTo(one.place.x + 60, 1);
      }

      // Now everyone presses Ctrl+Z, twice, interleaved: the word first, then the move.
      for (const one of owned) await pressUndo(one.person);
      await waitForIdenticalBoards('TC-24: the words are gone everywhere', people);
      for (const one of owned) await pressUndo(one.person);
      await waitForIdenticalBoards('TC-24: the moves are gone everywhere', people);

      // Every note is still on the board — nobody undid somebody else's creation — back
      // where it was made, with nothing written in it.
      const board = await people[0]!.board();
      expect(board.length, 'all five notes are still there').toBe(MAX_CONCURRENT_EDITORS);
      for (const one of owned) {
        const note = await one.person.note(one.id);
        expect(note?.text, `${one.id} kept its word`).toBe('');
        expect(note?.x, `${one.id} kept its place`).toBeCloseTo(made.get(one.id)!.x, 1);
        expect(note?.y, `${one.id} kept its place`).toBeCloseTo(made.get(one.id)!.y, 1);
        expect(note?.color, `${one.id} is a note still`).toBe(DEFAULT_STICKY_COLOR);
      }

      // Each screen still has its own two steps waiting to be redone.
      for (const one of owned) {
        await expect(redoButton(one.person), `${one.person.name} can redo twice`).toBeEnabled();
      }
      expect(
        people.flatMap((person) => person.errors()),
        'nothing went wrong on any screen',
      ).toEqual([]);
    });
  });

  test('TC-22b the toolbar buttons do what the shortcuts do', async ({ browser }) => {
    await withBoard(browser, 2, async (session) => {
      const mia = session.byName('Alex');
      const raj = session.byName('Sam');
      const id = await placeNote(mia, noteWorld(0, 0));
      await waitForIdenticalBoards('TC-22b: the note reaches Raj', [mia, raj]);

      // Both buttons say what they are, and what key does the same thing.
      await expect(undoButton(mia)).toHaveAttribute('title', 'Undo (Ctrl/Cmd+Z)');
      await expect(redoButton(mia)).toHaveAttribute('title', 'Redo (Ctrl/Cmd+Shift+Z)');

      // One step so far, and it is her own: the note's creation.
      await expect(undoButton(mia)).toBeEnabled();

      const started = await mia.note(id);
      if (!started) throw new Error('Mia has no note to move');
      await mia.dragNote(id, { x: -140, y: 90 });
      await waitForIdenticalBoards('TC-22b: the move reaches Raj', [mia, raj]);
      const moved = await mia.note(id);
      expect(moved?.x).toBeLessThan(started.x);

      // The button, not the key: the note goes back where it was made, on both screens.
      await undoButton(mia).click();
      await waitForIdenticalBoards('TC-22b: the undo reaches Raj', [mia, raj]);
      expect((await mia.note(id))?.x).toBe(started.x);

      // Redo, also by button, and it is a move again.
      await expect(redoButton(mia)).toBeEnabled();
      await redoButton(mia).click();
      await waitForIdenticalBoards('TC-22b: the redo reaches Raj', [mia, raj]);
      expect((await mia.note(id))?.x).toBe(moved?.x);

      // Nothing is left undone, so Redo is out while Undo still offers the creation.
      await expect(redoButton(mia)).toBeDisabled();
      await expect(undoButton(mia)).toBeEnabled();
      expect([...mia.errors(), ...raj.errors()]).toEqual([]);
    });
  });
});
