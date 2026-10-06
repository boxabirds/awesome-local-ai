/**
 * Random board editing, for the convergence tests.
 *
 * The generator drives a real `Y.Doc` through the app's own model functions, with a fixed
 * seed, so a failure is reproducible: same seed, same edits (the seed is printed by the
 * test that uses it).
 */
import type * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../src/shared/config';

/** Ordinary words, because typing test notes in real words is what the PRD describes. */
const WORDS = [
  'buy',
  'milk',
  'call',
  'the',
  'vet',
  'ship',
  'demo',
  'plan',
  'blue',
  'note',
  'fix',
  'login',
  'draft',
  'spec',
  'hero',
  'grid',
  'sync',
  'edge',
  'test',
  'wrap',
];

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** Deterministic PRNG (mulberry32): a seeded run always produces the same edits. */
function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface OpCounts {
  created: number;
  deleted: number;
  typed: number;
  moved: number;
  recoloured: number;
  /** The ids this run created, in order. */
  createdIds: string[];
  /** The ids this run deleted, in order (each one succeeded). */
  deletedIds: string[];
}

/**
 * Applies `rounds` edits to `doc`: 40 % typing of real words, 30 % moves, 10 % creating
 * notes, 10 % recolouring, 10 % deleting.
 */
export function runRandomOps(doc: Y.Doc, rounds: number, seed: number): OpCounts {
  const random = randomFrom(seed);
  const counts: OpCounts = {
    created: 0,
    deleted: 0,
    typed: 0,
    moved: 0,
    recoloured: 0,
    createdIds: [],
    deletedIds: [],
  };
  const makeNote = (): void => {
    const color = COLOR_NAMES[Math.floor(random() * COLOR_NAMES.length)] as StickyColor;
    const id = createSticky(
      doc,
      { x: Math.round(random() * 1200), y: Math.round(random() * 800) },
      color,
    );
    if (id) {
      counts.created += 1;
      counts.createdIds.push(id);
    }
  };

  for (let round = 0; round < rounds; round += 1) {
    const notes = snapshot(doc);
    const note = notes[Math.floor(random() * notes.length)];
    const roll = random();
    if (roll < 0.4) {
      // typing, whenever there is a note to type into
      const text = note ? getStickyText(doc, note.id) : undefined;
      if (!text) {
        makeNote();
        continue;
      }
      const word = WORDS[Math.floor(random() * WORDS.length)] as string;
      text.insert(text.length, text.length === 0 ? word : ` ${word}`);
      counts.typed += 1;
    } else if (roll < 0.7) {
      if (!note) {
        makeNote();
        continue;
      }
      if (
        moveObject(doc, note.id, note.x + (random() - 0.5) * 200, note.y + (random() - 0.5) * 200)
      ) {
        counts.moved += 1;
      }
    } else if (roll < 0.8) {
      makeNote();
    } else if (roll < 0.9) {
      const color = COLOR_NAMES[Math.floor(random() * COLOR_NAMES.length)] as StickyColor;
      if (note && setStickyColor(doc, note.id, color)) counts.recoloured += 1;
    } else if (note && deleteObject(doc, note.id)) {
      counts.deleted += 1;
      counts.deletedIds.push(note.id);
    }
  }
  return counts;
}
