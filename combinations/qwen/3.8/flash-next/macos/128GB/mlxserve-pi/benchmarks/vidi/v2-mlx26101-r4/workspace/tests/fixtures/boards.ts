/**
 * Boards for tests, made the way a board is really made.
 *
 * Every note here is created through the real `board-model` functions, and the updates are
 * whatever Yjs emitted while they were created — so what a test writes into storage is the
 * same sequence of bytes a person's editing would have written. That matters more than it
 * sounds: a fixture assembled by hand is a fixture that can be quietly unparseable, and the
 * tests in this story are about what happens when the bytes in the tables are not a board.
 *
 * Sizes are the ones the PRD names: 25 notes, which is a board a person would call a board,
 * and `PERSIST_TESTED_NOTES`, which is a board nobody can hold in their head.
 */
import * as Y from 'yjs';

import {
  STICKY_COLORS,
  PERSIST_TESTED_NOTES,
  type StickyColor,
} from '../../src/shared/config';
import {
  bringToFront,
  createSticky,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';

/** A board, the updates that build it, and what it is supposed to look like afterwards. */
export interface SeededBoard {
  /** The document the updates were made in. Compare against `expected`, never against this. */
  doc: Y.Doc;
  /**
   * Every Yjs update the board went through, in the order it happened, `initDoc` first.
   *
   * `initDoc` is in the list because the room receives it too: the very first update a board
   * sends is the one that sets the document up, and a fixture that left it out produced updates
   * which Yjs quietly refused to apply to any other document — they refer to a document that
   * was never set up, and Yjs parks that in a pending queue rather than complaining.
   */
  updates: Uint8Array[];
  /** What `snapshot(doc)` said when the board was finished. */
  expected: readonly StickySnapshot[];
  /** The ids of the notes, in creation order. */
  ids: string[];
}

/** The colours, in a stable order — `Object.keys` on an object literal, but explicit. */
const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

/**
 * A generator that gives the same board to the same seed on every machine.
 *
 * Tests compare a loaded board against the board that was written, byte for byte in the
 * fields that matter, and a fixture that changed between runs would make that comparison
 * meaningless.
 */
function randomFor(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Words that read like a retro board, because a board of "aaa" tells you nothing. */
const PHRASES = [
  'Skip the daily when nobody has anything to say',
  'The import wizard times out on files over 20 MB',
  'Documentation is out of date after the schema change',
  'Pair on the migration script before Friday',
  'Too many handoffs between design and implementation',
  'The staging seed takes forty minutes and nobody knows why',
  'Keep the changelog to one line per change',
  'Investigate the flaky upload test that only fails on CI',
  'Write the runbook for the rollback while it is fresh',
  'Rotation of on-call is too short to learn anything',
  'The empty state has no way to create the first project',
  'Two sources of truth for the feature flags',
  'Session expiry is shorter than a working day',
  'The export loses formatting on multi-line notes',
  'Ask the support team what they are asked most',
  'Bring real numbers to the planning meeting',
  'Notes should survive a page reload',
  'Nobody owns the alert routing anymore',
  'The board is slow when there are hundreds of notes on it',
  'Agree what done means before the demo, not during it',
  'The colour picker has more colours than anybody can read',
  'We still demo the tool, not the thing the tool produced',
  'Every meeting needs one person who is paid to say no',
  'Cut the report nobody opens and see who complains',
  'The onboarding path takes nine screens for one action',
];

/** A note's text: between a few words and a paragraph, the way people actually write. */
function textFor(random: () => number): string {
  const sentences = 1 + Math.floor(random() * 3);
  const parts: string[] = [];
  for (let index = 0; index < sentences; index += 1) {
    const phrase = PHRASES[Math.floor(random() * PHRASES.length)];
    parts.push(phrase.charAt(0).toUpperCase() + phrase.slice(1));
  }
  const text = parts.join('. ') + '.';
  // A paragraph or two, for the board that is meant to be too big to look at: the note that
  // is only a headline says nothing about how a 2,000-note board encodes or renders.
  return text.length > 200 || random() < 0.15 ? text.repeat(1 + Math.floor(random() * 2)).slice(0, 300) : text;
}

/**
 * Build a board: `count` notes laid out in clusters, with text and colours, and the updates
 * that made them.
 *
 * Each note is made in a document of its own, and the board receives those updates the way a
 * room receives them. The fuss is the point. Built any simpler — one document, everything in it
 * — the whole board comes from a single Yjs client, and Yjs integrates one client's changes in
 * order: damage to row 7 of such a log does not cost one note, it silently costs every note
 * after it. A board written by several people is what a room actually stores, and in it a bad row
 * costs the note it belongs to, which is the behaviour TC-09 is written to hold.
 *
 * Notes are placed in a grid with jitter, and some are raised above the rest in the board's own
 * document, because stacking order is one of the things a board has to come back identical on —
 * and a board whose notes are all at `(0, 0)` in the same layer would not notice if it did not.
 */
export function seededBoard(count: number, seed = 0x5eed): SeededBoard {
  const board = new Y.Doc();
  const random = randomFor(seed);
  const updates: Uint8Array[] = [];
  const ids: string[] = [];
  initDoc(board);
  updates.push(encode(board));

  for (let index = 0; index < count; index += 1) {
    // One author per note: its own document, its own Yjs client id, its own run of changes.
    const author = new Y.Doc();
    const changes: Uint8Array[] = [];
    author.on('update', (update: Uint8Array) => changes.push(new Uint8Array(update)));
    initDoc(author);

    const column = index % 8;
    const row = Math.floor(index / 8);
    // Notes are 200 units wide in world space; 260 apart leaves a gap to see.
    const x = column * 260 + Math.round(random() * 40);
    const y = row * 240 + Math.round(random() * 40);
    const id = createSticky(author, { x, y }, COLORS[index % COLORS.length]);
    if (id === '') continue;
    ids.push(id);
    getStickyText(author, id)?.insert(0, textFor(random));
    // Some notes are moved, and a few recoloured, after they were written, so a note is usually
    // more than one row and a load has something to replay rather than something to copy.
    if (random() < 0.34) moveObject(author, id, x + 30, y + 30);
    if (random() < 0.2) setStickyColor(author, id, COLORS[(index + 1) % COLORS.length]);

    for (const change of changes) {
      Y.applyUpdate(board, change);
      updates.push(new Uint8Array(change));
    }
    author.destroy();

    // Stacking is settled in the board's own document, because that is where the notes are
    // beside each other: raising a note above the others is a change to their order, made by the
    // board rather than by the person who wrote the note. Only what changed since the note landed
    // is kept, which is what a row in a log is — the rest of the board is already in the rows
    // above it, and a log of whole-board copies is not a log.
    if (random() < 0.25) {
      const seen = Y.encodeStateVector(board);
      if (bringToFront(board, id)) {
        const delta = Y.encodeStateAsUpdate(board, seen);
        if (delta.byteLength > 2) updates.push(delta);
      }
    }
  }

  return { doc: board, updates, expected: snapshot(board), ids };
}

/** Everything the document holds, as one update. */
function encode(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/** The 25-note retro board most of this story's tests are written against. */
export function retroBoard(seed = 0x5eed): SeededBoard {
  return seededBoard(25, seed);
}

/** A board of `PERSIST_TESTED_NOTES` notes: what "come back within budget" is measured on. */
export function largeBoard(count: number = PERSIST_TESTED_NOTES): SeededBoard {
  return seededBoard(count, 0xc0ffee);
}

/** The bytes of the whole board as one update, which is what a snapshot is stored as. */
export function boardUpdate(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/**
 * The damaged fixtures.
 *
 * Both are the size and shape of a real update and both are refused by Yjs: dropping the tail
 * of a valid update is the damage that actually happens in practice (a write that stopped
 * early), and random bytes of the right length is the damage a test invents.
 */
export const damage = {
  /** An update with its last 10 bytes gone — still a length, no longer an update. */
  truncated(update: Uint8Array): Uint8Array {
    return update.slice(0, Math.max(1, update.byteLength - 10));
  },
  /** `length` bytes that are not an update. */
  random(length: number, seed = 0xbad): Uint8Array {
    const random = randomFor(seed);
    const bytes = new Uint8Array(Math.max(1, length));
    for (let index = 0; index < bytes.byteLength; index += 1) bytes[index] = Math.floor(random() * 256);
    return bytes;
  },
  /** Bytes that cannot begin an update, whatever follows them. */
  nonsense(): Uint8Array {
    return new Uint8Array([0, 255, 7, 255, 0, 255, 255, 0]);
  },
};
