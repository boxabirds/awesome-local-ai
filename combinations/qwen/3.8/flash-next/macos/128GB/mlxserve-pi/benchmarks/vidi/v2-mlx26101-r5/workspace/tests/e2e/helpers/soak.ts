/**
 * Random work for a browser, done the way a person does it: with the mouse and the keyboard.
 *
 * The nightly soak (TC-30) wants a board that is busy for a minute with as many people on it
 * as it is designed for, because that is when a sync layer drops things. Randomness is seeded
 * and printed, so a run that goes wrong can be made to happen again.
 */

import { STICKY_COLORS } from '../../../src/shared/config';
import { clickNote, doubleClickCreate, dragNote, noteIds } from './board';
import { stopEditing, type Participant } from './participants';

/** Where the soak starts unless the environment says otherwise. */
export const DEFAULT_SOAK_SEED = 0x5eed1234;

/** The seed this run should use: `VIDI6_SEED=12345` repeats a run exactly. */
export function soakSeed(fallback = DEFAULT_SOAK_SEED): number {
  const fromEnvironment = Number(process.env['VIDI6_SEED']);
  return Number.isInteger(fromEnvironment) && fromEnvironment > 0 ? fromEnvironment : fallback;
}

/** A random number in [0, 1) that comes out the same way every time for a given seed. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One of these, chosen by that random number. */
export function pick<T>(random: () => number, values: readonly T[]): T {
  const value = values[Math.floor(random() * values.length) % values.length] as T;
  return value;
}

/** Short words to type: the soak is about changes arriving, not about essays. */
export const WORDS = ['note', 'move', 'here', 'dot', 'left', 'top', 'yes', 'fizz', 'buzz', 'quux'] as const;

const COLOURS = Object.keys(STICKY_COLORS) as readonly (keyof typeof STICKY_COLORS)[];

/** What the soak got up to, so the report can say what was done, not only that it passed. */
export interface SoakCounts {
  created: number;
  moved: number;
  typed: number;
  recoloured: number;
  deleted: number;
  /** Things that could not be done because the note was gone by the time the mouse got there. */
  abandoned: number;
}

/** A tally with nothing in it. */
export function soakCounts(): SoakCounts {
  return { created: 0, moved: 0, typed: 0, recoloured: 0, deleted: 0, abandoned: 0 };
}

/** The sentence that says what a soak did. */
export function describeSoak(counts: SoakCounts): string {
  return (
    `${counts.created} created, ${counts.moved} moved, ${counts.typed} typed into, ` +
    `${counts.recoloured} recoloured, ${counts.deleted} deleted` +
    (counts.abandoned === 0 ? '' : `, ${counts.abandoned} abandoned`)
  );
}

/** Somewhere on the board to put a note, on a grid so notes do not all land on each other. */
function spot(random: () => number, viewport: { width: number; height: number }): { x: number; y: number } {
  const columns = 5;
  const rows = 3;
  const column = Math.floor(random() * columns);
  const row = Math.floor(random() * rows);
  return {
    x: Math.round((viewport.width / (columns + 1)) * (column + 1)),
    y: Math.round((viewport.height / (rows + 1)) * (row + 1)),
  };
}

/**
 * Does `count` random things in one person's browser, and returns the ids of the notes they
 * made along the way.
 *
 * Nothing here waits for the change to reach anybody else — five people doing that at once is
 * the point — the caller measures arrival afterwards. An action that cannot be carried out
 * because the note it was aimed at has been deleted by somebody else is not a bug and not a
 * failure; it is the soak deleting things too, so it is counted and moved on from. What is
 * left is that the browser never ends up in a weird state: the escape key at the end of every
 * attempt closes whatever is open.
 */
export async function soakOps(
  person: Participant,
  count: number,
  random: () => number,
  totals: SoakCounts,
): Promise<string[]> {
  const made: string[] = [];
  const viewport = person.page.viewportSize() ?? { width: 1280, height: 800 };
  for (let step = 0; step < count; step++) {
    const notes = await noteIds(person.page);
    const target = notes.length === 0 ? undefined : pick(random, notes);
    // Notes are what there is to do things to, so making one is the most likely thing to do
    // when there are few of them about.
    const kind =
      target === undefined
        ? 'create'
        : pick(random, ['create', 'create', 'move', 'move', 'move', 'type', 'type', 'recolour', 'delete'] as const);
    try {
      if (kind === 'create') {
        const id = await doubleClickCreate(person.page, spot(random, viewport).x, spot(random, viewport).y);
        await person.page.keyboard.type(` ${pick(random, WORDS)}`);
        await stopEditing(person.page);
        made.push(id);
        totals.created += 1;
      } else if (kind === 'move' && target !== undefined) {
        await dragNote(person.page, target, Math.round((random() - 0.5) * 200), Math.round((random() - 0.5) * 140));
        totals.moved += 1;
      } else if (kind === 'type' && target !== undefined) {
        await clickNote(person.page, target);
        await person.page.keyboard.press('Enter');
        await person.page.keyboard.type(pick(random, WORDS));
        await stopEditing(person.page);
        totals.typed += 1;
      } else if (kind === 'recolour' && target !== undefined) {
        await clickNote(person.page, target);
        await person.page.getByTestId(`color-${pick(random, COLOURS)}`).click();
        totals.recoloured += 1;
      } else if (target !== undefined) {
        await clickNote(person.page, target);
        await person.page.keyboard.press('Delete');
        totals.deleted += 1;
      }
    } catch {
      // The note was deleted under this person by somebody else, which the soak itself causes.
      totals.abandoned += 1;
      await person.page.keyboard.press('Escape').catch(() => undefined);
      await person.page.mouse.up().catch(() => undefined);
    }
  }
  return made;
}

/** A note that a soak made, and who made it — so its journey can be timed. */
export interface Probe {
  id: string;
  maker: Participant;
}
