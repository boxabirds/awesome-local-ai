/**
 * Seeded board edits for the convergence tests.
 *
 * A test that says "everyone ends up with the same board" is only worth something if
 * the edits are the messy kind a real meeting makes — typing into notes, dragging them
 * about, recolouring, deleting — and if the same mess can be made again after a
 * failure. So the sequence is generated from a seed that the test logs, and every edit
 * goes through the same board model functions the browser's own code calls.
 *
 * The numbers are drawn up front; only *which note* an edit lands on is decided when it
 * runs, from whatever the document holds at that moment. That is deliberate: clients
 * that are mid-sync hold slightly different views, and a test that pretended otherwise
 * would be testing the generator rather than the merge.
 */
import * as Y from 'yjs';

import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../../src/shared/config';

/** Words people actually type, so the text merges look like the real thing. */
export const WORDS: readonly string[] = [
  'roadmap',
  'meeting',
  'together',
  'please',
  'later',
  'ship',
  'week',
  'ideas',
  'notes',
  'red',
  'blue',
  'green',
  'unknown',
  'question',
  'follow',
  'up',
];

/** One edit, and the words to name it in a failure. */
export interface RandomOp {
  readonly label: string;
  apply(doc: Y.Doc): void;
}

/** How an edit is chosen: typing is what people mostly do on a sticky note. */
const WEIGHTS: readonly { kind: Kind; weight: number }[] = [
  { kind: 'type', weight: 0.4 },
  { kind: 'move', weight: 0.3 },
  { kind: 'create', weight: 0.1 },
  { kind: 'recolour', weight: 0.1 },
  { kind: 'delete', weight: 0.1 },
];

type Kind = 'type' | 'move' | 'create' | 'recolour' | 'delete';

/**
 * `count` edits, decided from `seed`. The returned edits are independent of each
 * other's order between clients; what they share is the same numbers, so the same
 * shape of board comes out every run.
 */
export function randomOps(seed: number, count: number): RandomOp[] {
  const next = multiplier(seed);
  const ops: RandomOp[] = [];
  for (let index = 0; index < count; index += 1) {
    ops.push(pickKind(next) === 'create' ? create(next) : editExisting(index, next));
  }
  return ops;
}

/** A line to log so a failure can be reproduced: the seed is the whole test input. */
export function describeSeed(seed: number, count: number): string {
  return `seed ${seed} (${count} edits)`;
}

function pickKind(next: () => number): Kind {
  const roll = next();
  let edge = 0;
  for (const { kind, weight } of WEIGHTS) {
    edge += weight;
    if (roll < edge) return kind;
  }
  return 'type';
}

function create(next: () => number): RandomOp {
  const x = position(next);
  const y = position(next);
  const color = colour(next);
  return {
    label: `create a ${color} note at ${x},${y}`,
    apply(doc) {
      createSticky(doc, { x, y }, color);
    },
  };
}

/**
 * An edit aimed at whichever note the document holds when it runs. A note may have been
 * deleted on another screen in the meantime; the model says so by returning false, and
 * the edit is simply not made, which is the same thing a person's screen does when the
 * note they were dragging has vanished.
 */
function editExisting(index: number, next: () => number): RandomOp {
  const kind = pickKind(next);
  const which = Math.floor(next() * 1000);
  const x = position(next);
  const y = position(next);
  const color = colour(next);
  const word = WORDS[Math.floor(next() * WORDS.length)];
  const where = Math.floor(next() * 40);

  return {
    label: `${kind} #${which} (attempt ${index})`,
    apply(doc) {
      const notes = snapshot(doc);
      if (notes.length === 0) return;
      const note = notes[which % notes.length];
      switch (kind) {
        case 'type': {
          const text = getStickyText(doc, note.id);
          if (!text) return;
          text.insert(Math.min(where, text.length), `${word} `);
          break;
        }
        case 'move':
          moveObject(doc, note.id, x, y);
          break;
        case 'recolour':
          setStickyColor(doc, note.id, color);
          break;
        case 'delete':
          deleteObject(doc, note.id);
          break;
        case 'create':
          createSticky(doc, { x, y }, color);
          break;
      }
    },
  };
}

/** A world position on a board, in the range a note can really sit at. */
function position(next: () => number): number {
  return Math.round(next() * 2000) - 500;
}

function colour(next: () => number): StickyColor {
  const names = Object.keys(STICKY_COLORS) as StickyColor[];
  return names[Math.floor(next() * names.length)];
}

/**
 * A small deterministic generator: enough for a test that wants the same board twice,
 * and cheap enough to run a thousand times. `Math.random` would make every convergence
 * failure a mystery.
 */
function multiplier(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}
