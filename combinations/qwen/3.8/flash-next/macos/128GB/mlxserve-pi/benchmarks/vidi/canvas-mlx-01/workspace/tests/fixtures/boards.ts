/**
 * Board fixtures for the persistence tests.
 *
 * Every board here is built with the REAL `board-model` mutation functions, so the bytes
 * are genuine Yjs updates (the same ones the client and the Durable Object produce), and
 * each emitted update is captured in order so a test can replay them through `BoardStore`
 * exactly as the room would. All randomness is seeded so the boards are reproducible.
 */
import * as Y from 'yjs';
import {
  createSticky,
  moveObject,
  getStickyText,
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model.js';
import {
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config.js';

/** A deterministic 32-bit PRNG (mulberry32) so fixtures are reproducible. */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const COLOR_KEYS = Object.keys(STICKY_COLORS) as StickyColor[];

/** Realistic short English phrases (retro / workshop items) used to seed note text. */
const REALISTIC_PHRASES: string[] = [
  'Keep the daily demo short.',
  'Rotate who drives the board.',
  'Write one action per note.',
  'Faster onboarding for new teammates.',
  'Ship the fix before the weekend.',
  'Who owns the release checklist this week?',
  'The empty state confuses first-time users the most.',
  'Too many notifications, and none of them actionable or grouped.',
  'Add a keyboard shortcut for creating a note so power users never reach for the mouse.',
  'We should measure how long a board stays open and whether people ever come back to close them.',
  'The colour legend should be visible without scrolling, ideally pinned to the top-right of the canvas.',
  'Consider that a shared board used across time zones is written by people who never see each other edit; the design must feel alive without requiring anyone to be present, which mostly means saving everything continuously and honestly reporting when a load fails rather than showing an empty board.',
];

const pickPhrase = (rand: () => number): string =>
  REALISTIC_PHRASES[Math.floor(rand() * REALISTIC_PHRASES.length) % REALISTIC_PHRASES.length] ??
  REALISTIC_PHRASES[0]!;

export interface GeneratedBoard {
  /** The document the updates were applied to (the source of truth). */
  doc: Y.Doc;
  /** Every Yjs update the build emitted, in order (one per board-model transaction). */
  updates: Uint8Array[];
  /** The note ids in creation order. */
  ids: string[];
}

/**
 * Run `ops` against a fresh document and capture every emitted Yjs update in order.
 * `ops` receives a `captured()` that reports how many updates have been captured so far,
 * so a builder can pad to an exact row count. The returned `updates` are exactly the bytes
 * the room would `BoardStore.append`.
 */
export function buildBoard(
  ops: (doc: Y.Doc, captured: () => number) => void,
): GeneratedBoard {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => {
    updates.push(update.slice());
  });
  initDoc(doc);
  ops(doc, () => updates.length);
  return { doc, updates, ids: snapshot(doc).map((n: StickySnapshot) => n.id) };
}

/** Build the base 25-note retro layout on `doc` (mixed colours, multi-line, overlapping). */
const retroLayout = (doc: Y.Doc, rand: () => number): string[] => {
  const ids: string[] = [];
  for (let i = 0; i < 25; i++) {
    const color = COLOR_KEYS[i % COLOR_KEYS.length]!;
    // Notes drift into overlapping clusters (150 px apart, 200 px wide) so stacking (z) matters.
    const x = (i % 5) * 150 + Math.floor(rand() * 20);
    const y = Math.floor(i / 5) * 150 + Math.floor(rand() * 20);
    const id = createSticky(
      doc,
      { x: x + STICKY_SIZE_WORLD / 2, y: y + STICKY_SIZE_WORLD / 2 },
      color,
    );
    ids.push(id);
    const text = getStickyText(doc, id);
    if (text) {
      const line = pickPhrase(rand);
      doc.transact(() => text.insert(0, `${line}\nmore detail here`));
    }
  }
  return ids;
};

/**
 * A 25-note retro board: mixed colours, multi-line texts and deliberate overlaps so the
 * stacking order (z) is exercised. Each create / text step emits its own update.
 */
export function retro25Board(seed = 1): GeneratedBoard {
  const rand = mulberry32(seed);
  return buildBoard((doc) => {
    retroLayout(doc, rand);
  });
}

/**
 * The retro layout padded with real `moveObject` transactions so the captured update count
 * reaches EXACTLY `targetUpdates`. `moveObject` always creates a new CRDT item, so each
 * move emits exactly one update (used to land precisely on the compaction thresholds).
 */
export function retro25BoardWithRows(targetUpdates: number, seed = 2): GeneratedBoard {
  const board = buildBoard((doc, captured) => {
    const rand = mulberry32(seed);
    const ids = retroLayout(doc, rand);
    let n = 0;
    while (captured() < targetUpdates && n < 100_000) {
      const id = ids[n % ids.length]!;
      moveObject(doc, id, n % 50, (n * 7) % 50);
      n++;
    }
  });
  board.updates = board.updates.slice(0, targetUpdates);
  return board;
}

/**
 * A board of `PERSIST_TESTED_NOTES` notes with realistic phrases (10–300 chars), laid out
 * in clusters. Used by TC-08 (compaction chunking) and TC-21 (large-board open budget).
 */
export function largeBoard(seed = 7, count: number = PERSIST_TESTED_NOTES): GeneratedBoard {
  const rand = mulberry32(seed);
  return buildBoard((doc) => {
    for (let i = 0; i < count; i++) {
      const color = COLOR_KEYS[Math.floor(rand() * COLOR_KEYS.length) % COLOR_KEYS.length]!;
      // Cluster notes in a 40-wide grid with a small jitter (a realistic scattered board).
      const x = (i % 40) * 240 + Math.floor(rand() * 120);
      const y = Math.floor(i / 40) * 240 + Math.floor(rand() * 120);
      const id = createSticky(doc, { x, y }, color);
      const text = getStickyText(doc, id);
      if (text) {
        const phrase = pickPhrase(rand);
        doc.transact(() => text.insert(0, phrase));
      }
    }
  });
}

/**
 * The damaged-update fixtures (TC-09, TC-10). Both are known to make `Y.applyUpdate` throw
 * (asserted in `tests/unit/damaged-fixtures.test.ts`):
 *  - `truncated`: the update with its last 10 bytes removed (fails on "unexpected end").
 *  - `random`: random bytes of the SAME length as the truncated update (fails to parse).
 * `corrupt` flips every byte of an update; used to damage a specific log row in place so
 * the row's own (not-already-applied) bytes are what fails to apply.
 */
export const damagedFixtures = (
  update: Uint8Array,
): { truncated: Uint8Array; random: Uint8Array } => {
  const truncated = update.subarray(0, Math.max(0, update.byteLength - 10));
  const random = new Uint8Array(truncated.byteLength);
  const rand = mulberry32(1234);
  for (let i = 0; i < random.byteLength; i++) random[i] = Math.floor(rand() * 256);
  return { truncated, random };
};

/** Flip every byte of `update`, guaranteeing an undecodable row of the same length. */
export const corruptBytes = (update: Uint8Array): Uint8Array =>
  update.map((byte) => byte ^ 0xff);

/** A snapshot of every note in a generated board, for equality assertions. */
export const boardSnapshot = (board: GeneratedBoard): readonly StickySnapshot[] =>
  snapshot(board.doc);
