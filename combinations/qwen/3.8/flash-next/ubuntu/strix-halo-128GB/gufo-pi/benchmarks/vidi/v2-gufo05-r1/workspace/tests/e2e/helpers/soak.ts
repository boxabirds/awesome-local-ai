/**
 * The board a soak run edits: notes that belong to a person, and one seeded edit of
 * them driven through that person's own browser.
 *
 * The edit mix is the one `tests/integration/fixtures/random-ops.ts` uses — the mix
 * the design asks for — because the two soaks should differ in one thing only: that
 * one edits a document directly, this one edits a screen. The document version proves
 * the merge converges; this one proves a person's click, drag and keystroke reach it.
 *
 * Two rules keep a long run honest. A person only ever acts on notes they made, and
 * every note has a grid point of its own (`noteWorld`) that a move returns it to:
 * notes 200 units across on a 260 grid never overlap, so a click is always a click on
 * the note it names, hours into a run.
 */
import { STICKY_COLORS, STICKY_SIZE_WORLD } from '../../../src/shared/config';

import { WORDS } from '../../integration/fixtures/random-ops';
import { focusWorld, noteWorld, placeNote, type Participant } from './participants';

/** A note this person made, and the grid point it belongs to. */
export interface OwnedNote {
  id: string;
  home: { x: number; y: number };
}

/** The notes one person made, and the next grid point that is definitely free. */
export interface OwnedNotes {
  notes: OwnedNote[];
  nextSlot: number;
}

/** How many notes each person starts with, so there is something to edit. */
export const NOTES_EACH = 2;

/** The seed is fixed so a run can be replayed; the run prints it when it starts. */
export const SEED = 20_260_803;

/**
 * The accessible name of a swatch is "<Label> colour", the label being the palette
 * key with a capital first letter. Named from the palette rather than from a list
 * here, so renaming a colour is a loud failure instead of a click that waits for a
 * button that no longer exists.
 */
/**
 * Grid spacing for a soak. A note is 200 units across and its toolbar floats about 34
 * units above it, so rows 260 apart let a neighbour's body sit over a selected note's
 * swatches — a real thing a board can do, and not what this run is there to test.
 * 400 keeps the toolbar in the clear.
 */
export const SOAK_SPACING = 400;

const COLOUR_NAMES = (Object.keys(STICKY_COLORS) as (keyof typeof STICKY_COLORS)[]).map(
  (key) => `${key[0]!.toUpperCase()}${key.slice(1)}`,
);

/** One of the five edit kinds, in the mix the design asks for. */
export function kindOf(roll: number): 'type' | 'move' | 'create' | 'recolour' | 'delete' {
  if (roll < 0.4) return 'type';
  if (roll < 0.7) return 'move';
  if (roll < 0.8) return 'create';
  if (roll < 0.9) return 'recolour';
  return 'delete';
}

function pick<T>(items: readonly T[], rng: () => number): T {
  const index = Math.min(items.length - 1, Math.floor(rng() * items.length));
  return items[index] as T;
}

/**
 * One edit, chosen at random from the ones a person makes, driven through this
 * person's own browser. Returns what happened, for the failure message.
 */
export async function applyRandomOp(
  person: Participant,
  owned: OwnedNotes,
  rng: () => number,
  gridIndex: number,
): Promise<string> {
  const make = async (): Promise<string> => {
    // A grid point nobody has used yet, so the click that makes it can only be a
    // click on this note.
    const home = noteWorld(gridIndex, owned.nextSlot, SOAK_SPACING);
    owned.nextSlot += 1;
    const id = await placeNote(person, home);
    owned.notes.push({ id, home });
    return 'created a note';
  };

  const kind = owned.notes.length === 0 ? 'create' : kindOf(rng());
  if (kind === 'create') return make();

  const index = Math.min(owned.notes.length - 1, Math.floor(rng() * owned.notes.length));
  const target = owned.notes[index] as OwnedNote;
  const note = await person.note(target.id);
  if (!note) {
    // It should be there: this person is the only one who touches their own notes.
    // If it is not, forget it and make another, rather than fail a soak on one hole.
    owned.notes.splice(index, 1);
    return make();
  }

  // Look at it first: the board is bigger than a window, and every action below is
  // a click, so the note has to be on screen.
  await focusWorld(person.page, {
    x: target.home.x + STICKY_SIZE_WORLD / 2,
    y: target.home.y + STICKY_SIZE_WORLD / 2,
  });

  switch (kind) {
    case 'type': {
      const word = pick(WORDS, rng);
      await person.editNote(target.id, ` ${word}`);
      await person.stopEditing();
      return `typed "${word}"`;
    }
    case 'move': {
      // Back towards where the note belongs, by no more than a fraction of the gap
      // between grid points: a random walk would let notes overlap and make every
      // later click a guess.
      const dx = target.home.x - note.x + Math.round((rng() - 0.5) * 30);
      const dy = target.home.y - note.y + Math.round((rng() - 0.5) * 30);
      await person.dragNote(target.id, { x: dx, y: dy });
      return 'moved a note';
    }
    case 'recolour': {
      const colour = pick(COLOUR_NAMES, rng);
      await person.selectNote(target.id);
      await person.recolour(colour);
      return `recoloured a note ${colour}`;
    }
    case 'delete': {
      await person.selectNote(target.id);
      await person.deleteSelectedNote();
      owned.notes.splice(index, 1);
      return 'deleted a note';
    }
    default:
      return make();
  }
}

/** Every board, as one comparable string: what a screen holds, not what it shows. */
export async function shapeOf(people: readonly Participant[]): Promise<string[]> {
  return Promise.all(
    people.map(async (person) =>
      JSON.stringify(
        (await person.board()).map((note) => [
          note.id,
          note.x,
          note.y,
          note.z,
          note.color,
          note.text.length,
        ]),
      ),
    ),
  );
}
