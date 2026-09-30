// Realistic board fixtures. Every note is built with the real `board-model`
// mutators, so the bytes these produce are exactly the Yjs updates the room
// stores and the client renders - a fixture that invented its own bytes could
// pass a persistence test while real boards did not survive.
//
// Two sizes matter (both are product settings): the 25-note retrospective board
// the "everyone went home and came back" cases use, and `PERSIST_TESTED_NOTES`,
// the board size the "large boards open quickly" requirement is tested at.
//
// The damaged-bytes helpers are the second half of the fixture set: one update
// cut short and one run of random bytes the same length, which is what a partially
// overwritten row looks like to the loader.

import * as Y from 'yjs';
import {
  createSticky,
  bringToFront,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
} from '../../src/shared/board-model';
import {
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
  type StickyColor,
} from '../../src/shared/config';
import { prose, RETRO_ITEM } from './texts';

const COLOR_KEYS = Object.keys(STICKY_COLORS) as StickyColor[];

/** A generated board: the document, and one Yjs update per mutation made. */
export interface BoardFixture {
  doc: Y.Doc;
  /** Every update the board was built from, oldest first (what `append` stores). */
  updates: Uint8Array[];
  /** All of it as one update, for seeding a document or a page in a single write. */
  all: Uint8Array;
}

/** Notes for seeding a board in bulk (the e2e page hook takes this shape). */
export interface SeedNote {
  x: number;
  y: number;
  color: StickyColor;
  text: string;
}

/** mulberry32: deterministic, so a failure can be reproduced from its seed. */
function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 1;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Run `make`, collecting the updates it produces. Each board-model mutation is
 * its own transaction, so one mutation is one update - the same unit the room
 * appends to storage.
 */
function capture(make: (doc: Y.Doc) => void): BoardFixture {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => {
    updates.push(update.slice());
  });
  make(doc);
  return { doc, updates, all: Y.encodeStateAsUpdate(doc) };
}

/** The retrospective board: 25 varied notes, mixed colours, overlaps and stacking. */
export const RETRO_NOTE_COUNT = 25;

/** Prompts the retro notes answer; the text is what a team would actually write. */
const RETRO_PROMPTS: readonly string[] = [
  'What went well',
  'What blocked us',
  'What we will try next',
  'What we need from each other',
];

const RETRO_IDEAS: readonly string[] = [
  'The importer shipped two days early because nobody worked alone on it.',
  'Pairing on the migration plan paid for itself in the first hour.',
  'Docs were written as we went, so the onboarding guide was not a weekend job.',
  'The staging database was restored from a weekend backup on Tuesday morning.',
  'Three of us were waiting on the same review for two days before anyone spoke up.',
  'The mobile layout shipped with the note toolbar behind the zoom control.',
  'Copy was written in a rush and four labels still say "Save" where nothing saves.',
  'Try the twelve-minute daily check-in on the board instead of in chat.',
  'Colour the notes by theme as they land, not after the meeting is over.',
  'Timebox the voting round so the quiet ideas still get read out.',
  'Bring the support questions onto the board so they cannot hide in a thread.',
  'We need a decision about the old importer before anyone starts coding again.',
  'Someone who knows the billing schema, ten minutes a day for a week.',
  'A way to see what changed since yesterday without reading every note.',
  'Fewer boards, not more: four of them are the same meeting in different places.',
  'The prototype felt real enough that people started trusting the numbers.',
  'Loading stopped being a surprise once the state was shown next to the spinner.',
  'Our longest thread was about a comma in a button label.',
  'Two notes say "ask design" and neither says which design question.',
  'The board survived the outage, which is the only thing anyone asked about.',
  'Ship the small fix now and keep the refactor on the parking lot.',
  'Write the migration plan as a checklist a stranger could follow.',
  'Every export request is a board we could not explain to the customer.',
  'One person per board area, so the clusters stop drifting over each other.',
  'Next retro: bring the numbers, not the vibes.',
];

/**
 * The 25-note retrospective board: every colour used, multi-line text on several
 * notes, notes that share a spot (so their stacking order is what decides which
 * one is on top) and a few `bringToFront` reorderings, because a reopened board
 * has to agree on the stacking as well as on the text.
 */
export function retroBoard(seed = 0x51ce7a): BoardFixture {
  const rng = rngFrom(seed);
  return capture((doc) => {
    initDoc(doc);
    const ids: string[] = [];
    for (let i = 0; i < RETRO_NOTE_COUNT; i++) {
      // three clusters of notes, plus deliberate overlaps on every third note
      const cluster = i % 3;
      const x = cluster * 460 + (i % 5) * 230 + (i % 3 === 0 ? 40 : 0);
      const y = Math.floor(i / 5) * 250 + (i % 3 === 0 ? 30 : 0);
      const color = COLOR_KEYS[i % COLOR_KEYS.length]!;
      const id = createSticky(doc, { x, y }, color);
      ids.push(id);
      const text = getStickyText(doc, id);
      if (text === undefined) throw new Error(`fixture note ${id} has no text`);
      // every fourth note answers a prompt over three lines, the rest one idea
      const body = i % 4 === 0 ? `${RETRO_PROMPTS[i % RETRO_PROMPTS.length]}:\n${RETRO_ITEM}` : RETRO_IDEAS[i]!;
      text.insert(0, body);
      if (i % 7 === 0) {
        // a second line of its own, so multi-line layout is part of the fixture
        text.insert(text.length, `\n${Math.round(rng() * 100)}% agree`);
      }
    }
    // move a few notes onto each other and shuffle the stacking a few times
    moveObject(doc, ids[3]!, 460 + 40, 250 + 30);
    moveObject(doc, ids[11]!, 460 + 80, 250 + 60);
    moveObject(doc, ids[19]!, 920, 500);
    // recolour two notes after the fact, because that is how a board gets its
    // mixed colours, and the stored log then carries both versions
    if (!setStickyColor(doc, ids[5]!, 'orange')) throw new Error('fixture recolour rejected');
    if (!setStickyColor(doc, ids[13]!, 'green')) throw new Error('fixture recolour rejected');
    bringToFront(doc, ids[6]!);
    bringToFront(doc, ids[17]!);
    bringToFront(doc, ids[2]!);
  });
}

/**
 * The large board: `count` notes of realistic English prose (10-300 characters)
 * laid out in clusters, the way a long-lived wall of notes actually looks. Used
 * by the "large boards open quickly" cases.
 */
export function largeBoard(count = PERSIST_TESTED_NOTES, seed = 0x1a2b3c): BoardFixture {
  const rng = rngFrom(seed);
  return capture((doc) => {
    initDoc(doc);
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const clusterX = (i % 8) * 900;
      const clusterY = Math.floor(i / 8) * 900;
      const x = clusterX + Math.floor(rng() * 640);
      const y = clusterY + Math.floor(rng() * 640);
      const id = createSticky(doc, { x, y }, COLOR_KEYS[Math.floor(rng() * COLOR_KEYS.length)]!);
      ids.push(id);
      const length = 10 + Math.floor(rng() * 291);
      getStickyText(doc, id)?.insert(0, prose(length));
    }
    // a scatter of reorderings, so the stored board carries real stacking too
    for (let i = 0; i < Math.min(20, count); i++) {
      bringToFront(doc, ids[Math.floor(rng() * ids.length)]!);
    }
  });
}

/** The notes as plain data, for seeding a board in bulk. */
export function seedNotes(fixture: BoardFixture): SeedNote[] {
  const notes: SeedNote[] = [];
  const objects = fixture.doc.getMap<Y.Map<unknown>>('objects');
  for (const object of objects.values()) {
    const text = object.get('text');
    notes.push({
      x: Number(object.get('x')),
      y: Number(object.get('y')),
      color: String(object.get('color')) as StickyColor,
      text: text instanceof Y.Text ? text.toString() : '',
    });
  }
  return notes;
}

// --------------------------------------------------------------------------------
// Padding
// --------------------------------------------------------------------------------

/**
 * Grow a fixture to `count` stored updates by moving notes around with the real
 * mutators, so a test can reach COMPACTION_UPDATE_COUNT with real rows instead of
 * invented bytes. Each move moves a note to a position it has not had, so every
 * call produces an update. Mutates the fixture's document (and its `updates`); the
 * returned array is a copy, so a later call does not grow an earlier result.
 */
export function padUpdates(fixture: BoardFixture, count: number): Uint8Array[] {
  const objects = fixture.doc.getMap<Y.Map<unknown>>('objects');
  const ids = [...objects.keys()];
  if (ids.length === 0) throw new Error('cannot pad a board with no notes');
  let n = 0;
  while (fixture.updates.length < count) {
    const before = fixture.updates.length;
    moveObject(fixture.doc, ids[n % ids.length]!, 5000 + fixture.updates.length, 5000 + n);
    if (fixture.updates.length === before) throw new Error('padding produced no update');
    n++;
  }
  fixture.all = Y.encodeStateAsUpdate(fixture.doc);
  return [...fixture.updates];
}

// --------------------------------------------------------------------------------
// Damaged bytes
// --------------------------------------------------------------------------------

/** The last 10 bytes cut off: the classic half-written row. */
export function truncatedUpdate(update: Uint8Array): Uint8Array {
  return update.slice(0, Math.max(0, update.length - 10));
}

/** Random bytes of the same length, seeded so a failure reproduces. */
export function randomBytesLike(update: Uint8Array, seed = 0xdeadbe): Uint8Array {
  const rng = rngFrom(seed);
  const out = new Uint8Array(update.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.floor(rng() * 256);
  return out;
}

/** A damaged copy of `bytes` that Yjs refuses to apply (asserted by the tests). */
export function unreadableBytes(bytes: Uint8Array): Uint8Array {
  return Math.random() < 0.5 ? truncatedUpdate(bytes) : randomBytesLike(bytes);
}
