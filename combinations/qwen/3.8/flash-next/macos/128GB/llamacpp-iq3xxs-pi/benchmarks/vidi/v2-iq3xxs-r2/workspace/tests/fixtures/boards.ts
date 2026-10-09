import * as Y from 'yjs';
import {
  createSticky,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import {
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
  type StickyColor,
} from '../../src/shared/config';

/**
 * Realistic boards for the persistence tests, built with the real `board-model`
 * calls (`createSticky`, `setStickyColor`, `moveObject`) rather than hand-written
 * maps, so the fixtures exercise the same document shape a person produces
 * (`persist.log`, `persist.large_board`).
 */

/** Every change `doc` makes, newest last, as individually storable updates. */
export function collectUpdates(doc: Y.Doc): Uint8Array[] {
  const updates: Uint8Array[] = [];
  // `slice` because Yjs reuses its scratch buffer between transactions.
  doc.on('update', (update: Uint8Array) => updates.push(update.slice()));
  return updates;
}

/** The board's notes, for comparing a loaded document against its source (TC-05). */
export function notesOf(doc: Y.Doc): readonly StickySnapshot[] {
  return snapshot(doc);
}

/** A small deterministic generator, so fixture boards are reproducible. */
function rand(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return (state >>> 8) / 8_388_608;
  };
}

const COLOR_KEYS = Object.keys(STICKY_COLORS) as StickyColor[];

const RETRO_NOTES = [
  'Ship the storage slice',
  'Board reloads lost my notes',
  'Compaction feels like magic',
  'Loved the sticky colours',
  'Where did my cursor go?',
  'Restore from the snapshot',
  'One damaged change, one cost',
  'The log is the truth',
  'Hibernation what?',
  'Test the failure, not the demo',
  'Big transactions bite back',
  'Chunk the snapshot',
  'Never serve an empty board',
  'Quarantine, do not delete',
  'Autosave you never notice',
  'A board is a name and a room',
  'Write first, broadcast after',
  'Load budget: three seconds',
  'Schemas need versions too',
  'Who moved my sticky',
  'Snapshot plus log, always',
  'Retrying is a feature',
  'The log stays bounded',
  'SQLite in a room? OK',
  'Bring it all back next time',
];

/**
 * The "25-note board" (`TC-05` onward): a retro board with mixed colours, multi-line
 * text, overlapping clusters, recolours and moves — the shape of a real working board.
 *
 * Returns the document and every update it produced, oldest first; the update list is
 * what a room would have appended, row by row.
 */
export function retroBoard(): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const updates = collectUpdates(doc);
  initDoc(doc);
  const random = rand(20260811);
  RETRO_NOTES.forEach((headline, index) => {
    const color = COLOR_KEYS[index % COLOR_KEYS.length];
    // Clusters of notes around anchor points, overlapping inside the cluster: real
    // boards are islands of content, not grids.
    const cluster = index % 5;
    const x = 120 + cluster * 420 + (index >= 15 ? 60 : 0) + Math.floor(random() * 40);
    const y = 120 + Math.floor(index / 5) * 300 + Math.floor(random() * 40);
    const id = createSticky(doc, { x, y }, color);
    if (id === false) throw new Error('fixture point/colour rejected');
    const text =
      index % 3 === 0
        ? `${headline}\nsecond line\nthird line, a little longer`
        : headline;
    getStickyText(doc, id)?.insert(0, text);
    if (index % 7 === 3) {
      // Some notes get recoloured and nudged: more rows in the log, like real editing.
      setStickyColor(doc, id, COLOR_KEYS[(index + 2) % COLOR_KEYS.length]);
      moveObject(doc, id, x + 12, y + 8);
    }
  });
  return { doc, updates };
}

/**
 * A realistic English sticky of `length` characters (the large-board fixture asks
 * for 10-300): prose fragments joined until the length lands in range.
 */
function proseLength(random: () => number, length: number): string {
  const words = [
    'the', 'board', 'reloads', 'exactly', 'as', 'left', 'with', 'every', 'sticky',
    'note', 'in', 'place', 'colour', 'and', 'text', 'included', 'because', 'log',
    'snapshot', 'storage', 'room', 'wakes', 'before', 'first', 'message', 'arrives',
    'quarantining', 'damage', 'instead', 'of', 'losing', 'everything', 'silently',
    'compaction', 'keeps', 'it', 'bounded', 'loading', 'within', 'budget', 'even',
    'when', 'large', 'boards', 'come', 'back', 'after', 'idle', 'weeks', 'and',
    'nobody', 'remembers', 'closing', 'them', 'a', 'name', 'is', 'a', 'durable',
    'object', 'that', 'refuses', 'to', 'serve', 'an', 'empty', 'view', 'of', 'a',
    'full', 'history', 'which', 'is', 'the', 'whole', 'point', 'of', 'storage',
  ];
  const out: string[] = [];
  let chars = 0;
  while (chars < length - 1) {
    const word = words[Math.floor(random() * words.length)];
    if (chars + word.length + 1 > length) break;
    out.push(word);
    chars += word.length + 1;
  }
  let text = out.join(' ');
  if (text.length < length) text += '…'.repeat(length - text.length);
  return text.slice(0, length);
}

/**
 * `persist.large_board`'s board: `noteCount` notes of realistic sizes (10-300
 * characters) in clusters spread over a large area, built through the real model.
 * The default is the design's `PERSIST_TESTED_NOTES`.
 */
export function largeBoard(
  noteCount: number = PERSIST_TESTED_NOTES,
  seed = 42,
): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const updates = collectUpdates(doc);
  initDoc(doc);
  const random = rand(seed);
  for (let index = 0; index < noteCount; index += 1) {
    const length = 10 + Math.floor(random() * 291); // 10..300 characters
    const clusterX = index % 12;
    const clusterY = Math.floor(index / 12) % 12;
    const x = 120 + clusterX * 420 + Math.floor(random() * 120);
    const y = 120 + clusterY * 360 + Math.floor(random() * 120);
    const id = createSticky(doc, { x, y }, COLOR_KEYS[index % COLOR_KEYS.length]);
    if (id === false) throw new Error('fixture point/colour rejected');
    getStickyText(doc, id)?.insert(0, proseLength(random, length));
  }
  return { doc, updates };
}

/**
 * Bytes shaped like a Yjs update that the decoder refuses: a real update with its
 * tail missing (the design's "a truncated update").
 */
export function truncatedCopy(update: Uint8Array, cut = 10): Uint8Array {
  if (update.length <= cut) {
    throw new Error(`fixture update too short to truncate by ${cut}: ${update.length}`);
  }
  return update.slice(0, update.length - cut);
}

/** Random bytes of `length` (the design's other damaged-bytes form). */
export function randomBytes(length: number, seed = Date.now() % 100_000): Uint8Array {
  const random = rand(seed);
  const out = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) out[index] = Math.floor(random() * 256);
  return out;
}
