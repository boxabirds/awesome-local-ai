/**
 * Board fixtures used by the persistence tests.
 * Boards are built with the real board-model functions, so persistence is
 * exercised with exactly the shapes the client writes.
 */
import * as Y from 'yjs';
import {
  createSticky,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD, type StickyColor } from '../../src/shared/config';

/** Note texts that need the font shrink, including non-ASCII and newlines. */
const SHRINK_TEXTS = [
  'The quick brown fox jumps over the lazy dog and then keeps running for a while longer',
  'Roadmap Q3: ship persistence, then compaction, then the export path everyone asks for',
  'Résumé review — café, Zürich, jalapeño, naïve; unicode must survive the round trip',
  'Emoji and accents: 🎨 ✏️ 🗂️ über Größe, señor, l’œuvre — „Anführungszeichen“',
  'Line one\nline two\nline three\nline four\nline five\nline six\nline seven\nline eight',
];

/** Short texts that stay at the maximum font size. */
const SHORT_TEXTS = ['Idea', 'Ship it', 'TODO', 'Check', 'Draft', 'Note', 'Spike', 'Spec'];

const COLORS: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

export type FixtureKind = 'mixed' | 'all-long' | 'all-short';

/** Deterministic pseudo-random generator so a board is reproducible from its seed. */
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    // xorshift32
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

export function textForKind(kind: FixtureKind, index: number, random: () => number): string {
  if (kind === 'all-short') return SHORT_TEXTS[index % SHORT_TEXTS.length];
  if (kind === 'all-long') return SHRINK_TEXTS[index % SHRINK_TEXTS.length];
  const pool = index % 3 === 0 ? SHORT_TEXTS : SHRINK_TEXTS;
  return pool[Math.floor(random() * pool.length)];
}

/**
 * Create a board with `count` sticky notes: created with `createSticky`, filled
 * with `getStickyText`, then `moveObject`/`setStickyColor` applied to a subset.
 * Note ids and `createdAt` timestamps are random per call, so compare one
 * fixture instance against itself, never two instances.
 */
export function createTestBoard(
  count: number,
  seed = 1234,
  kind: FixtureKind = 'mixed',
): Y.Doc {
  const doc = new Y.Doc();
  const random = makeRandom(seed);
  const perRow = 10;
  for (let i = 0; i < count; i++) {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const centerX = Math.round((col * 1.4 + random() * 8) * STICKY_SIZE_WORLD);
    const centerY = Math.round((row * 1.4 + random() * 8) * STICKY_SIZE_WORLD);
    const id = createSticky(doc, { x: centerX, y: centerY }, COLORS[Math.floor(random() * COLORS.length)]);
    const text = getStickyText(doc, id);
    text?.insert(0, textForKind(kind, i, random));
    // Some notes get moved and recoloured after creation, like a real board.
    if (i % 5 === 0) {
      moveObject(doc, id, centerX + Math.round(random() * 40), centerY - Math.round(random() * 40));
    }
    if (i % 7 === 0) {
      setStickyColor(doc, id, COLORS[Math.floor(random() * COLORS.length)]);
    }
  }
  return doc;
}

/** Snapshot of every sticky note on the board. */
export function boardSnapshot(doc: Y.Doc): readonly StickySnapshot[] {
  return snapshot(doc);
}

/** Number of sticky notes currently on the board. */
export function stickyCount(doc: Y.Doc): number {
  return snapshot(doc).length;
}

/**
 * Damage a valid update so that `Y.applyUpdate` rejects it: dropping the tail
 * leaves a plausible payload that stops decoding part-way through.
 */
export function truncateUpdate(update: Uint8Array, drop = 12): Uint8Array {
  return update.slice(0, Math.max(1, update.length - drop));
}

/** Deterministic noise of a given length; never a decodable Yjs update. */
export function undecodableBytes(length: number, seed = 7): Uint8Array {
  const random = makeRandom(seed);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.floor(random() * 256);
  return out;
}
