/**
 * Undo in a room, where there is somebody else on the other side of the board (TC-22 to TC-24).
 *
 * Everything a component test can ask about one person's history it does ask, standing over one
 * document with the other person simulated. What only a real room can answer is what this story is
 * actually about: two tabs, two undo stacks, one board. Whether my Ctrl+Z reaches only what my own
 * hand did, whether a colleague's work survives my change of mind, and whether five people all
 * changing their minds at the same moment still end up looking at the same board.
 *
 * The assertion that carries all of that is the one the other multiplayer specs use: every page
 * ends up drawing the same board. Undo is local - the stack never travels - and yet what it leaves
 * behind is a board everybody is looking at, so a history that reached across to somebody else's
 * work would show up as two screens disagreeing about a note.
 *
 * The notes stand where a person can reach their own toolbar: it is drawn above the note, and a
 * button drawn above the top of the window is a button no click can land on.
 */

import { expect, test, type Page } from '@playwright/test';
import { settle } from './helpers/board';
import { Cast, boardJson, waitForSameBoard, type Person } from './helpers/participants';
import type { StickyColor } from '../../src/shared/config';
import {
  centreOnScreen,
  createNoteAt,
  createNotesAt,
  pressBoardKey,
  selectAllWithKeyboard,
  waitForBar,
  waitForOutlines,
} from './helpers/selection';
import {
  noteIds,
  setColour,
  stopEditing,
  textById,
  typeInNote,
  waitForNoteCount,
} from './helpers/sticky';

const undoButton = (person: Person) => person.page.getByTestId('undo');
const redoButton = (person: Person) => person.page.getByTestId('redo');

/** The board's undo shortcut, pressed on the board rather than in a field. */
async function pressUndo(person: Person): Promise<void> {
  await person.page.keyboard.press('Control+z');
  await settle(person.page);
}

async function pressRedo(person: Person): Promise<void> {
  await person.page.keyboard.press('Control+Shift+z');
  await settle(person.page);
}

/** Write something into a note that already exists, and leave it. */
async function writeIn(person: Person, id: string, text: string): Promise<void> {
  const at = await centreOnScreen(person.page, id);
  await person.page.mouse.dblclick(at.x, at.y);
  await typeInNote(person.page, text);
  await stopEditing(person.page);
}

/** The colours the five notes are given, none of them the yellow they were made with. */
const COLOURS: StickyColor[] = ['blue', 'green', 'pink', 'orange', 'violet'];

/** The colour each note is drawn in, as one comparable string. */
function coloursOf(board: string): string[] {
  return (JSON.parse(board) as { color: string }[])
    .map((face) => face.color)
    .sort();
}

/** Eight notes in two rows of four, which is a deletion worth undoing. */
const EIGHT: { x: number; y: number }[] = [-300, -110].flatMap((y) =>
  [-450, -190, 70, 330].map((x) => ({ x, y })),
);

/** What a screen holds, as `id: text` pairs, for saying what went back. */
async function boardOf(page: Page): Promise<string> {
  const faces = JSON.parse(await boardJson(page)) as { id: string; text: string }[];
  return faces.map((face) => `${face.id}:${face.text}`).join(',');
}

test.describe('one person’s undo, in a room with somebody in it (TC-22, TC-23)', () => {
  test('TC-22 winds back my own deletion of eight notes, and nobody else’s note', async ({
    browser,
  }) => {
    test.slow();
    const cast = await Cast.open(browser, 'Raj', 'Mia');
    try {
      const raj = cast.by('Raj');
      const mia = cast.by('Mia');

      // Raj makes eight notes. Every one of them arrived through the room, so none of them is
      // anything of Mia's - which is the whole test in one sentence: she is about to undo all eight.
      const eight = await createNotesAt(raj.page, EIGHT);
      await waitForSameBoard(cast.people);
      await waitForNoteCount(mia.page, 8);

      // Mia chooses the whole board. She did not make any of it, and the board does not ask her to.
      await selectAllWithKeyboard(mia.page);
      await waitForBar(mia.page, '8 selected');
      await waitForOutlines(mia.page, eight);

      // She deletes them, and Raj watches eight of his notes disappear.
      await pressBoardKey(mia.page, 'Delete');
      await waitForNoteCount(raj.page, 0);
      await waitForSameBoard(cast.people);

      // Raj makes a ninth note, and writes on it, while she is still deciding.
      const ninth = await createNoteAt(raj.page, { x: -560, y: 260 }, 'Raj was here');
      await waitForNoteCount(mia.page, 1);

      // Mia changes her mind.
      await pressUndo(mia);

      // The eight she deleted are back - all eight, in one press, with the ids they had - and
      // Raj's ninth is untouched, because it was never hers to undo.
      await waitForNoteCount(mia.page, 9);
      expect((await noteIds(mia.page)).sort()).toEqual([...eight, ninth].sort());
      await waitForSameBoard(cast.people);

      // The buttons say where she now stands: nothing of hers left below, her deletion above again.
      await expect(undoButton(mia)).toBeDisabled();
      await expect(redoButton(mia)).toBeEnabled();

      // Redo puts her deletion back; her own key does the same as the button does.
      await pressRedo(mia);
      await waitForNoteCount(mia.page, 1);
      await waitForSameBoard(cast.people);

      await pressUndo(mia);
      await waitForNoteCount(mia.page, 9);

      // Raj has never been asked to undo anything, and was not now: his own history is where he
      // left it. His last step was the writing on his ninth note, and that is what goes - the
      // note stays, because making it was a different thing to do.
      await pressUndo(raj);
      await expect(textById(mia.page, ninth)).toHaveText('');
      await waitForNoteCount(mia.page, 9);

      // And the note itself, one press later - both of these seen from Mia's screen, which is the
      // only way to know that undo travels as a board change and not as a private screen.
      await pressUndo(raj);
      await waitForNoteCount(mia.page, 8);
      expect(await noteIds(mia.page)).not.toContain(ninth);
      await waitForSameBoard(cast.people);

      // Undoing what Raj did has not touched what Mia did: her eight-note deletion is still there
      // to be redone, on her side, and the board she is looking at is the board Raj is looking at.
      await expect(redoButton(mia)).toBeEnabled();
    } finally {
      await cast.close();
    }
  });

  test('TC-23 undoes my own creation that a colleague wrote on, without going through their work', async ({
    browser,
  }) => {
    test.slow();
    const cast = await Cast.open(browser, 'Raj', 'Mia');
    try {
      const raj = cast.by('Raj');
      const mia = cast.by('Mia');

      // Two notes from Raj.
      const [first, second] = await createNotesAt(raj.page, [
        { x: -300, y: 0 },
        { x: 0, y: 0 },
      ]);
      await waitForSameBoard(cast.people);

      // Mia adds a note of her own, and then writes on one of Raj's.
      const hers = await createNoteAt(mia.page, { x: 300, y: 0 });
      await writeIn(mia, first!, 'by Mia');
      await waitForSameBoard(cast.people);

      // Raj undoes. His last step was making the second note, and that is the only thing that
      // goes. The note he made earlier keeps the words somebody else wrote on it, which is the
      // case a per-transaction undo gets wrong by rewriting the whole object back to how it looked
      // when he made it - overwriting Mia's typing with Raj's memory of the note.
      await pressUndo(raj);
      await waitForNoteCount(mia.page, 2);
      expect(await noteIds(raj.page)).not.toContain(second!);
      expect(await boardOf(raj.page)).toContain(`${first}:by Mia`);
      await waitForSameBoard(cast.people);

      // Raj undoes again. This time it is the note Mia wrote on that goes back, because *he* made
      // it: undoing one's own creation takes the object with everything since written on it, and
      // every screen says the same thing afterwards.
      await pressUndo(raj);
      await waitForNoteCount(mia.page, 1);
      expect(await noteIds(mia.page)).toEqual([hers]);
      await waitForSameBoard(cast.people);

      // Nothing of Raj's is left to undo, and the board has not twitched since.
      await expect(undoButton(raj)).toBeDisabled();
      await pressUndo(raj);
      await waitForSameBoard(cast.people);
      expect(await noteIds(raj.page)).toEqual([hers]);

      // Mia's turn. Her last step was writing on Raj's note, and that note is no longer here; the
      // step goes back into a document that has nowhere left to put it, which is a nothing rather
      // than a catastrophe. What must not happen - what an undo left to itself does - is for the
      // press to keep going and take her own note with it.
      await pressUndo(mia);
      await waitForSameBoard(cast.people);
      expect(await noteIds(mia.page), 'the press stopped at the step that leads nowhere').toEqual([
        hers,
      ]);

      // Her own note is still hers to undo, in its own turn.
      await pressUndo(mia);
      await waitForNoteCount(raj.page, 0);
      await waitForSameBoard(cast.people);
      expect(await noteIds(raj.page)).toEqual([]);
      await expect(undoButton(mia)).toBeDisabled();
    } finally {
      await cast.close();
    }
  });
});

test.describe('five people, five histories, one board (TC-24)', () => {
  test('TC-24 everybody undoes their own last change, and the board stays one board', async ({
    browser,
  }) => {
    // Five people, five pages, five histories: five times the round trips of every other test
    // here, which is what the extra time is for, not for the undo itself.
    test.slow();
    const cast = await Cast.open(browser, 'Ana', 'Bo', 'Cy', 'Dee', 'Eli');
    try {
      // Each in their own corner of the world, so nobody's mouse is ever over anybody else's note:
      // this test is about whose history is whose, not about two people after the same pixel. Low
      // enough down that every note's own toolbar is inside the window - a colour swatch that is
      // drawn above the top of the screen is a thing no click can reach.
      const corners = [
        { x: -450, y: -200 },
        { x: 250, y: -200 },
        { x: -450, y: 100 },
        { x: 250, y: 100 },
        { x: -100, y: -50 },
      ];
      const mine: string[] = [];
      for (const [index, person] of cast.people.entries()) {
        mine.push(await createNoteAt(person.page, corners[index]!, person.name));
      }
      await waitForSameBoard(cast.people);
      await waitForNoteCount(cast.people[0]!.page, 5);

      // Everybody recolours their own note, from the toolbar that is still open on it: the note is
      // the last thing each of them made, and making a note leaves it in front of you. Colours
      // travel; undo does not.
      for (const [index, person] of cast.people.entries()) {
        await setColour(person.page, mine[index]!, COLOURS[index]!);
      }
      const recoloured = await waitForSameBoard(cast.people);
      // Five different colours on five notes, which is what makes what follows mean something: an
      // undo that reached across would leave somebody's colour standing on somebody else's note.
      expect(new Set(coloursOf(recoloured)).size).toBe(5);

      // All five press their own undo at the same moment. Each press goes back into a different
      // person's history and finds their own colour change there, and nothing of anybody else's:
      // five undos, five notes still standing.
      await Promise.all(cast.people.map((person) => person.page.keyboard.press('Control+z')));
      const after = await waitForSameBoard(cast.people);
      await waitForNoteCount(cast.people[0]!.page, 5);

      // And what they agree on now is what they agreed on before the colours: five undos
      // cancelling five colour changes, note by note, each one by the hand that did it.
      expect(after).not.toBe(recoloured);
      expect(coloursOf(after)).toEqual(new Array(5).fill('yellow'));

      // Now each person walks the rest of their own history back, press by press, however many
      // steps their visit to the board came to - making a note, writing their name on it, bringing
      // it forward and colouring it, which the board may have taken for two things or for one.
      // Nothing here asks anybody else to give anything back, and when all five have finished there
      // is nothing left on the board: everything that was on it was done by one of them.
      for (const person of cast.people) {
        for (let presses = 0; presses < 6; presses += 1) {
          await person.page.keyboard.press('Control+z');
        }
      }
      await waitForSameBoard(cast.people);
      await waitForNoteCount(cast.people[0]!.page, 0);

      // Nobody has anything left to undo, on any of the five screens - which is the same fact the
      // board states, since there is nothing here that any of them made and has not taken back.
      for (const person of cast.people) {
        await expect(undoButton(person)).toBeDisabled();
      }

      // And redo, the other half of the pair, is per-person in the same way. Each person walks
      // their own history forward again, press by press, and what comes back is their own note,
      // their own writing on it and their own colour on it - and nobody else's, four times over:
      // five people's work restored by five people, with no undo of anybody else's anywhere in it.
      for (const person of cast.people) {
        for (let presses = 0; presses < 6; presses += 1) {
          await person.page.keyboard.press('Control+Shift+z');
        }
      }
      await waitForSameBoard(cast.people);
      await waitForNoteCount(cast.people[0]!.page, 5);

      // Every note is back as its own author left it, which is the assertion that says whose work
      // came back: this person's colour and this person's words, on this person's note.
      type Face = { id: string; color: string; text: string };
      const restored = (JSON.parse(await boardJson(cast.people[0]!.page)) as Face[]).map((face) => [
        face.id,
        face.color,
        face.text,
      ]);
      expect(restored).toEqual(
        cast.people
          .map((person, index) => [mine[index]!, COLOURS[index]!, person.name] as const)
          .sort((left, right) => (left[0]! < right[0]! ? -1 : 1))
          .map(([id, color, name]) => [id, color, name]),
      );

      // Nothing is left to redo now, and undo is available again on all five screens: each person
      // is standing at the end of their own history, which is where they were before they started
      // changing their minds.
      for (const person of cast.people) {
        await expect(redoButton(person)).toBeDisabled();
      }

      // One of them keeps pressing, past the end of what they did: the same board, still.
      await pressRedo(cast.by('Ana'));
      await pressRedo(cast.by('Ana'));
      await waitForSameBoard(cast.people);
      await waitForNoteCount(cast.people[0]!.page, 5);
    } finally {
      await cast.close();
    }
  });
});
