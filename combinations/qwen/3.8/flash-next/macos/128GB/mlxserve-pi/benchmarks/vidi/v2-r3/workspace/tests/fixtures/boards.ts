// Boards built with the real document model, for the persistence tests.
//
// These are not toy documents: every note here is made by the same
// `createSticky`, `setStickyColor` and `Y.Text` the app uses, so a board that
// loads correctly from storage is the same board the app would have drawn. A
// fixture that faked the format would test the fixture, not the store.
import * as Y from 'yjs';
import { PERSIST_TESTED_NOTES, STICKY_COLORS, type StickyColor } from '../../src/shared/config';
import {
  createSticky,
  getStickyText,
  initDoc,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';

/** The colours, in a stable order (Object.keys of the palette map). */
const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

/** mulberry32: a small deterministic PRNG, so a fixture reproduces byte-for-byte. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RETRO_WORDS = [
  'Went well',
  'To improve',
  'Action item',
  'Blocked on deploy',
  'Loved the pairing session',
  'Need a spike on storage',
  'Release train slipped',
  'On-call rotation unclear',
  'Great retro facilitation',
  'Too many meetings today',
];

const RETRO_LINES = ['Shipping was smooth.', 'But the migration was scary.', 'Do it again next sprint.'];

function phrase(rand: () => number, minChars: number, maxChars: number): string {
  const target = minChars + Math.floor(rand() * (maxChars - minChars + 1));
  let text = '';
  while (text.length < target) {
    text += (text.length === 0 ? '' : ' ') + RETRO_WORDS[Math.floor(rand() * RETRO_WORDS.length)]!;
  }
  return text.slice(0, Math.max(minChars, Math.min(maxChars, target)));
}

/**
 * Write `count` notes into `doc` with the real model: mixed colours, multi-line
 * text, positions clustered so some overlap (the shape a real retro board takes).
 * Returns the ids in creation order.
 */
export function seedNotes(
  doc: Y.Doc,
  count: number,
  options: { seed?: number; multiLine?: boolean; cluster?: number } = {},
): string[] {
  initDoc(doc);
  const rand = rng(options.seed ?? 0x1a2b3c);
  const cluster = options.cluster ?? 640;
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * cluster);
    const y = Math.floor(rand() * cluster);
    const color = COLORS[i % COLORS.length]!;
    const id = createSticky(doc, { x, y }, color);
    const ytext = getStickyText(doc, id);
    if (ytext !== undefined) {
      const line = RETRO_WORDS[Math.floor(rand() * RETRO_WORDS.length)]!;
      ytext.insert(0, line);
      if (options.multiLine === true && i % 3 === 0) {
        const extra = RETRO_LINES[i % RETRO_LINES.length]!;
        ytext.insert(ytext.length, '\n' + extra);
      }
    }
    ids.push(id);
  }
  return ids;
}

/** The retro board the small persistence tests use: 25 varied, overlapping notes. */
export function retroBoard(doc: Y.Doc): string[] {
  return seedNotes(doc, 25, { seed: 20260714, multiLine: true });
}

/** The large board TC-21 and the compaction integration tests use. */
export function largeBoard(doc: Y.Doc): string[] {
  initDoc(doc);
  const rand = rng(0xfeedface);
  const ids: string[] = [];
  for (let i = 0; i < PERSIST_TESTED_NOTES; i++) {
    const x = Math.floor(rand() * 800);
    const y = Math.floor(rand() * 800);
    const color = COLORS[i % COLORS.length]!;
    const id = createSticky(doc, { x, y }, color);
    const ytext = getStickyText(doc, id);
    if (ytext !== undefined) ytext.insert(0, phrase(rand, 10, 300));
    ids.push(id);
  }
  return ids;
}

/** The whole board as one encoded update, e.g. to seed a store directly. */
export function encodeBoard(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/**
 * Build a `count`-note board and return it as a replayable update log: the
 * board after note 1, after note 2, … — each a self-contained `encodeStateAsUpdate`,
 * which is exactly the kind of update the room stores. Applying them in order
 * to a fresh document rebuilds the board; that is the store's whole job, so the
 * fixture must hand it rows that behave like the room's do.
 *
 * (A note-by-note capture of `doc.on('update')` would be more literal, but in
 * this yjs version an incremental update created after a sibling map already
 * exists does not replay on its own — a fixture built that way would test the
 * quirk, not the store. The room never stores such a row: it stores what it
 * applied, which always replays.)
 */
export function progressiveLog(
  count: number,
  options: { seed?: number; multiLine?: boolean } = {},
): { notes: readonly StickySnapshot[]; rows: Uint8Array[] } {
  const doc = new Y.Doc();
  seedNotes(doc, count, options);
  const rows: Uint8Array[] = [];
  const all = snapshot(doc);
  for (let keep = 1; keep <= count; keep++) {
    // the board limited to its first `keep` notes, encoded as one update
    const step = new Y.Doc();
    initDoc(step);
    const objects = step.getMap<Y.Map<unknown>>('objects');
    for (let i = 0; i < keep; i++) {
      const note = all[i]!;
      const map = new Y.Map<unknown>();
      map.set('type', 'sticky');
      map.set('x', note.x);
      map.set('y', note.y);
      map.set('color', note.color);
      map.set('z', note.z);
      map.set('createdAt', note.createdAt);
      map.set('text', new Y.Text(note.text));
      objects.set(note.id, map);
    }
    rows.push(Y.encodeStateAsUpdate(step));
  }
  return { notes: snapshot(doc), rows };
}

/**
 * Two snapshots are the same board when every note carries the same position,
 * colour, text and stacking — `createdAt` included, because it is stored and so
 * must come back unchanged (a store that dropped it would fail here).
 */
export function boardsEqual(a: readonly StickySnapshot[], b: readonly StickySnapshot[]): boolean {
  const norm = (list: readonly StickySnapshot[]) =>
    JSON.stringify(
      [...list]
        .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
        .map((note) => ({ ...note, id: note.id })),
    );
  return norm(a) === norm(b);
}

// --- damaged bytes (the store's error paths) ---------------------------------

/** Cut the last `n` bytes off an update: an update that stops mid-field. */
export function truncateBytes(update: Uint8Array, n = 10): Uint8Array {
  return update.slice(0, Math.max(1, update.length - n));
}

/** Same length as `update`, no relation to a Yjs update. */
export function randomBytesLike(update: Uint8Array, seed = 7): Uint8Array {
  const rand = rng(seed);
  const out = new Uint8Array(update.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.floor(rand() * 256);
  return out;
}
