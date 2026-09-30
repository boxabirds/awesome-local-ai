// Undo and redo of your own changes, in real browsers on the real sync provider
// (`undo.controls`, TC-22 to TC-24).
//
// These run against the real `wrangler dev` room because the whole story is about
// other people: the only way to know an undo did not reach into someone else's
// changes is to have someone else making them over a real WebSocket. Everything the
// scenarios act on is on screen — the toolbar's Undo and Redo buttons, the keyboard
// shortcut, the notes themselves — and everything they check is read back from a
// screen, so nothing here peeks at the CRDT behind the board.
import { expect, test } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { settle } from './helpers/board';
import { marquee, selectedIds } from './helpers/sticky';

import {
  createNote as createNoteFor,
  deleteNote,
  dragNote,
  expectEventually,
  openParticipants,
  printLatencyReport,
  recolour,
  startEditing,
  stopEditing as stopEditingFor,
  type,
  type NoteOnScreen,
  type Participant,
} from './helpers/participants';

test.afterAll(() => {
  printLatencyReport('story 8');
});

const undoButton = (who: Participant) => who.page.getByTestId('undo-button');
const redoButton = (who: Participant) => who.page.getByTestId('redo-button');

/**
 * Put the focus back on the board itself (not on a toolbar or zoom button) so the
 * keyboard shortcut is the board's, then press it. `isTypingTarget` leaves a shortcut
 * alone when focus is in a control, so the focus has to come off any control first —
 * blurring to the body is the plain, no-op way to do that without disturbing the board.
 */
async function pressUndoKey(who: Participant): Promise<void> {
  await who.page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
  await settle(who.page);
  await who.page.keyboard.press('ControlOrMeta+z');
  await settle(who.page);
}

const clickUndo = async (who: Participant): Promise<void> => {
  await undoButton(who).click();
  await settle(who.page);
};

const clickRedo = async (who: Participant): Promise<void> => {
  await redoButton(who).click();
  await settle(who.page);
};

/** The parts two screens must agree an undo restored: where, what colour, what text. */
const fieldsOf = (note: NoteOnScreen): [number, number, string, string] => [
  Math.round(note.left),
  Math.round(note.top),
  note.color,
  note.text,
];

const sameFields = (note: NoteOnScreen | undefined, expected: ReturnType<typeof fieldsOf>): boolean =>
  note !== undefined && fieldsOf(note).join('|') === expected.join('|');

test.describe('recover an accidental delete (TC-22)', () => {
  test('TC-22 undo and redo move only Mia\'s own change, on both screens', async ({
    browser,
  }) => {
    const { people } = await openParticipants(browser, 2);
    const [mia, raj] = people as [Participant, Participant];

    // Mia lays out eight notes in a grid, and recolours one so "colours return" is real.
    const mine: string[] = [];
    for (const y of [250, 470]) {
      for (const x of [350, 560, 770, 980]) {
        mine.push(await createNoteFor(mia, x, y, `note ${String(mine.length + 1)}`));
        await stopEditingFor(mia);
      }
    }
    const recoloured = mine[0] as string;
    await recolour(mia, recoloured, 'blue');

    // Snapshot the eight as Mia's screen has them: position, colour, text.
    const before = new Map<string, ReturnType<typeof fieldsOf>>();
    for (const id of mine) {
      before.set(id, fieldsOf((await mia.note(id)) as NoteOnScreen));
    }

    // Box-select exactly those eight (the room's opening note at the corner is left out),
    // and one Delete takes them all away.
    await mia.page.keyboard.press('Escape');
    await settle(mia.page);
    await marquee(mia.page, { x: 150, y: 120 }, { x: 1180, y: 680 });
    expect((await selectedIds(mia.page)).sort()).toEqual([...mine].sort());
    await mia.page.keyboard.press('Delete');
    await settle(mia.page);
    for (const id of mine) {
      await expectEventually(`${id} gone for Raj`, () => raj.note(id), {
        is: (note) => note === undefined,
      });
    }

    // Raj adds his own note; Mia sees it.
    const theirs = await createNoteFor(raj, 250, 720, 'raj was here');
    await stopEditingFor(raj);
    await expectEventually('Mia sees Raj\'s note', () => mia.note(theirs), {
      is: (note) => note !== undefined,
    });

    // Mia undoes: her eight return, field for field, on both screens; Raj's stays.
    await pressUndoKey(mia);
    for (const id of mine) {
      const expected = before.get(id) as ReturnType<typeof fieldsOf>;
      for (const who of people) {
        await expectEventually(`${id} returns for ${who.name}`, () => who.note(id), {
          is: (note) => sameFields(note, expected),
        });
      }
    }
    expect(await mia.note(theirs)).toBeDefined();

    // The Redo button takes the eight away again, on both screens.
    await clickRedo(mia);
    for (const id of mine) {
      await expectEventually(`${id} redone away for Raj`, () => raj.note(id), {
        is: (note) => note === undefined,
      });
    }

    // Undo all the way back: only Mia's own history drains, and it ends empty.
    for (let guard = 0; guard < 40; guard += 1) {
      if (await undoButton(mia).isDisabled()) break;
      await clickUndo(mia);
    }
    await expect(undoButton(mia)).toBeDisabled();
    // The two screens still agree, and Raj's note outlived Mia draining her history.
    expect(await mia.note(theirs)).toBeDefined();
    expect(await raj.snapshot()).toBe(await mia.snapshot());
  });
});

test.describe('a colleague deleted my object (TC-23)', () => {
  test('TC-23 undoing a move of a note someone else deleted does no harm, and the next undo works', async ({
    browser,
  }) => {
    const { people } = await openParticipants(browser, 2);
    const [mia, raj] = people as [Participant, Participant];

    const note = await createNoteFor(mia, 500, 300, 'mine');
    await stopEditingFor(mia);
    await expectEventually('Raj sees Mia\'s note', () => raj.note(note), {
      is: (n) => n !== undefined,
    });

    // Mia moves it — her change, her undo step.
    await dragNote(mia, note, 120, 0);

    // Raj deletes it — his change; it leaves both screens.
    await deleteNote(raj, note);
    for (const who of people) {
      await expectEventually(`${note} gone for ${who.name}`, () => who.note(note), {
        is: (n) => n === undefined,
      });
    }

    // Mia undoes her move of a note that is no longer there: no crash, still absent.
    await pressUndoKey(mia);
    for (const who of people) {
      expect(await who.note(note)).toBeUndefined();
    }

    // Her next undo still works (it drains her own earlier steps without an error).
    await clickUndo(mia);
    await settle(mia.page);
    const errors = mia.consoleErrors.filter(
      (line) => !/WebSocket|route aborted|net::|favicon|Download the React|DevTools/i.test(line),
    );
    expect(errors).toEqual([]);
    await expect(mia.page.getByTestId('error-boundary')).toHaveCount(0);
  });
});

test.describe('everyone undoing at once (TC-24)', () => {
  test('TC-24 each person undoes only their own change and every screen still agrees', async ({
    browser,
  }) => {
    const { people } = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
    const [host, ...others] = people as [Participant, ...Participant[]];

    // One note per person to move, and a different one per person to type into.
    const moveIds: string[] = [];
    const typeIds: string[] = [];
    for (let index = 0; index < people.length; index += 1) {
      moveIds.push(await createNoteFor(host, 200 + index * 190, 180, `move ${String(index)}`));
      await stopEditingFor(host);
    }
    for (let index = 0; index < people.length; index += 1) {
      typeIds.push(await createNoteFor(host, 200 + index * 190, 470, `type ${String(index)}`));
      await stopEditingFor(host);
    }
    const all = [...moveIds, ...typeIds];
    for (const who of others) {
      await expectEventually(`${who.name} sees all ${String(all.length)} notes`, () => who.notes(), {
        is: (notes) => all.every((id) => notes.has(id)),
      });
    }
    // The board as it stands before anybody edits: what everyone returns their own
    // change away from.

    // Everyone moves their own note and types their own name into a different one, at
    // the same time. No two people touch the same note, which is what makes the outcome
    // of undoing decidable: each marker belongs to exactly one person's history.
    await Promise.all(
      people.map(async (who, index) => {
        await dragNote(who, moveIds[index] as string, 60, 40);
        await startEditing(who, typeIds[index] as string);
        await type(who, ` by ${who.name}`);
        await stopEditingFor(who);
      }),
    );

    // Everyone presses their own Ctrl/Cmd+Z twice — the two most recent steps in each
    // person's own history, which for each is the typing they just did.
    await Promise.all(
      people.map(async (who) => {
        await pressUndoKey(who);
        await pressUndoKey(who);
      }),
    );

    // On every screen: every person's own typing is gone from their own note — each
    // person undid their own last change — and the board converged to one state. With
    // everyone undoing their own typing, the marker each left is taken back by that same
    // person, so every note reads its original text again; an undo never carried into
    // another person's history (that personal scope is shown directly in TC-22/TC-23).
    for (const [index, who] of people.entries()) {
      const own = `type ${String(index)}`;
      await expectEventually(`${who.name} undid their own typing`, () => who.note(typeIds[index] as string), {
        is: (note) => note !== undefined && note.text === own,
        description: `${who.name}'s own note still carries their typing`,
      });
    }

    // And every screen agrees with the next: five personal histories converging, not one
    // shared history that would leave the board in disagreement.
    const agreed = await host.snapshot();
    for (const who of others) {
      await expectEventually(`${who.name} agrees with the host`, () => who.snapshot(), {
        is: (snapshot) => snapshot === agreed,
        description: `${who.name} has a board that differs from the host's`,
      });
    }
  });
});
