/**
 * Putting a board's worth of notes into storage, for the tests that need a big board.
 *
 * An end-to-end test that wants to know how long a board of two thousand notes takes to
 * open has to get those notes there first, and doing it through a browser is the wrong
 * instrument twice over: the test would spend most of its time watching one page make
 * notes rather than measuring the page that opens them, and the number it printed would
 * be about clicking. So the notes are written by the room itself, into the same tables a
 * person's changes go into, one row per note — the shape a board reaches by being used.
 *
 * This is a test fixture, not a feature: it is reachable only through a board room's
 * internal routes (`/x/…`), which nothing outside this Worker can address, and the
 * outside-facing half of them is mounted only when `TEST_HOOKS` is set (see
 * `test-hooks.ts`). What it writes is ordinary model content made with the model's own
 * functions, which is the point: a fixture that invented its own note shape would be
 * measuring the fixture rather than the board.
 *
 * Each note is its own transaction and its own stored row, applied with the same origin a
 * load uses — so the room's own "write what arrives from a socket" rule does not also fire,
 * and what ends up stored is exactly one row per note and not two.
 */
import * as Y from 'yjs';

import { createSticky, getStickyText, NO_ID, setStickyColor } from '../shared/board-model';
import type { StickyColor } from '../shared/config';
import { STICKY_COLORS } from '../shared/config';
import type { BoardStore } from './board-store';
import { LOAD_ORIGIN } from './board-store';

/** How many notes across a seeded board is, and how far apart they are in world units. */
const ACROSS = 50;
const SPACING = 300;

/** The words the seeded notes carry, cycled through so a board is not all one sentence. */
const TEXTS = [
  'A board is only trustworthy if it remembers',
  'Nothing is saved when nobody is watching',
  'The room went away and the notes stayed',
  'Two thousand notes, and not one of them lost',
  'Come back in the morning and it is all here',
];

/** The colours, cycled through so a big board is not one colour. */
const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

/**
 * Write `count` notes into this board's storage and return how many are there.
 *
 * Returns what was actually written rather than what was asked for: a board that could not
 * be read, or that stopped taking notes halfway, should say so to the test rather than have
 * one assert about two thousand notes and find nineteen hundred.
 */
export function seedBoard(doc: Y.Doc, store: BoardStore, count: number): number {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  let seeded = 0;

  for (let index = 0; index < count; index += 1) {
    // The state vector before this note is the way to get the note itself out again: what
    // the document has that it did not have a moment ago is the row to store.
    const before = Y.encodeStateVector(doc);
    let id = NO_ID;
    doc.transact(
      () => {
        id = createSticky(doc, { x: (index % ACROSS) * SPACING, y: Math.floor(index / ACROSS) * SPACING });
        if (id === NO_ID) return;
        getStickyText(doc, id)?.insert(0, TEXTS[index % TEXTS.length] ?? '');
        setStickyColor(doc, id, COLORS[index % COLORS.length] ?? '');
      },
      // Not a socket: this board is being filled in, not edited, and the room's rule is
      // that what arrives from a person is what gets written down.
      LOAD_ORIGIN,
    );
    if (id === NO_ID) break;

    const update = Y.encodeStateAsUpdateV2(doc, before);
    // One row per note, which is also how a board this size gets a snapshot worth having.
    // A storage that says no stops the fixture here, with the count it did manage: a test
    // that asked for two thousand notes and got seventeen should read that number rather
    // than be told the board is short.
    try {
      store.append(update);
    } catch {
      break;
    }
    if (objects.get(id) === undefined) break;
    seeded += 1;
  }

  return seeded;
}
