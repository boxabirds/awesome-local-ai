/**
 * Saved-board fixtures (story 4 design Fixtures). Boards are built through the real
 * board-model functions, so their bytes are real Yjs updates:
 * - a 25-note retro board: mixed colours, multi-line texts, overlapping notes restacked;
 * - a PERSIST_TESTED_NOTES-note board: realistic English phrases (10–300 chars) in clusters;
 * - damaged update bytes: truncated (last 10 bytes cut) and same-length random bytes.
 */
import type * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  bringToFront,
  createSticky,
  getStickyText,
  moveObject,
} from '../../src/shared/board-model';
import { PERSIST_TESTED_NOTES, STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from '../../src/shared/config';
import { seededRandom } from './random-ops';
import { RETRO_ITEM, proseOfLength } from './texts';

const COLOURS = Object.keys(STICKY_COLORS) as StickyColor[];
export const RETRO_NOTES = 25;
const RETRO_COLUMNS = 5;
/** Retro notes overlap their neighbours by a third of a note. */
const RETRO_PITCH = (STICKY_SIZE_WORLD * 2) / 3;
const RETRO_TEXTS = [
  'Went well: release on time',
  RETRO_ITEM,
  'Improve:\nflaky checkout tests',
  'Action: pair on the billing refactor',
  'Customers love the new search 🎉',
];

function typeInto(doc: Y.Doc, id: string, text: string): void {
  doc.transact(() => getStickyText(doc, id)?.insert(0, text), LOCAL_ORIGIN);
}

/** 25 varied, overlapping notes; every third one is brought to the front afterwards. */
export function buildRetroBoard(doc: Y.Doc): string[] {
  const ids: string[] = [];
  for (let i = 0; i < RETRO_NOTES; i++) {
    const col = i % RETRO_COLUMNS;
    const row = Math.floor(i / RETRO_COLUMNS);
    const id = createSticky(doc, { x: col * RETRO_PITCH, y: row * RETRO_PITCH }, COLOURS[i % COLOURS.length]);
    typeInto(doc, id, `${i + 1}. ${RETRO_TEXTS[i % RETRO_TEXTS.length]}`);
    ids.push(id);
  }
  ids.forEach((id, i) => {
    if (i % 3 === 0) bringToFront(doc, id);
  });
  // A couple of moves so positions are not all on the creation grid.
  moveObject(doc, ids[4]!, 1234.5, -321.25);
  moveObject(doc, ids[12]!, -600, 480);
  return ids;
}

const MIN_PHRASE = 10;
const MAX_PHRASE = 300;
const CLUSTER_SIZE = 100;
const CLUSTER_COLUMNS = 10;
const CLUSTERS_PER_ROW = 5;
const NOTE_GAP = 20;
const CLUSTER_GAP = 600;

/** A phrase of 10–300 characters cut from real English prose at a word boundary. */
function phrase(rand: () => number): string {
  const length = MIN_PHRASE + Math.floor(rand() * (MAX_PHRASE - MIN_PHRASE + 1));
  const start = Math.floor(rand() * 400);
  const text = proseOfLength(start + length + 40).slice(start);
  const firstSpace = text.indexOf(' ');
  const trimmed = text.slice(firstSpace + 1, firstSpace + 1 + length).trim();
  return trimmed.length >= MIN_PHRASE ? trimmed : text.slice(0, length);
}

/** `count` notes (default PERSIST_TESTED_NOTES) in clusters of 100, deterministic for a seed. */
export function buildLargeBoard(doc: Y.Doc, count: number = PERSIST_TESTED_NOTES, seed = 4): string[] {
  const rand = seededRandom(seed);
  const pitch = STICKY_SIZE_WORLD + NOTE_GAP;
  const clusterSpan = CLUSTER_COLUMNS * pitch + CLUSTER_GAP;
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const cluster = Math.floor(i / CLUSTER_SIZE);
    const inCluster = i % CLUSTER_SIZE;
    const x = (cluster % CLUSTERS_PER_ROW) * clusterSpan + (inCluster % CLUSTER_COLUMNS) * pitch;
    const y = Math.floor(cluster / CLUSTERS_PER_ROW) * clusterSpan + Math.floor(inCluster / CLUSTER_COLUMNS) * pitch;
    const id = createSticky(doc, { x, y }, COLOURS[cluster % COLOURS.length]);
    typeInto(doc, id, phrase(rand));
    ids.push(id);
  }
  return ids;
}

/** Runs `build` and returns every update it produced, in order (one log row each). */
export function recordUpdates(doc: Y.Doc, build: () => void): Uint8Array[] {
  const updates: Uint8Array[] = [];
  const onUpdate = (u: Uint8Array) => updates.push(u);
  doc.on('update', onUpdate);
  try {
    build();
  } finally {
    doc.off('update', onUpdate);
  }
  return updates;
}

const TRUNCATE_BYTES = 10;

/** The update with its last 10 bytes removed. */
export function truncatedUpdate(update: Uint8Array): Uint8Array {
  return update.slice(0, Math.max(0, update.length - TRUNCATE_BYTES));
}

/** Seeded random bytes of the same length as `update`. */
export function randomBytesLike(update: Uint8Array, seed = 7): Uint8Array {
  const rand = seededRandom(seed);
  return Uint8Array.from(update, () => Math.floor(rand() * 256));
}

/** Top-left corners (world units) of the story 7 20-note board, by group. */
export const SELECTION_BOARD = {
  /** 3 × 2 grid, 50 apart: rows y = 0 and y = 250. */
  grid: [0, 250].flatMap((y) => [0, 250, 500].map((x) => ({ x, y }))),
  /** 4 overlapping notes in a row (each above the previous one). */
  row: [0, 150, 300, 450].map((x) => ({ x, y: 600 })),
  /** Second cluster: 5 × 2, overlapping by 20 on both axes; rows y = 0 and y = 180. */
  right: [0, 180].flatMap((y) => [0, 1, 2, 3, 4].map((i) => ({ x: 1400 + i * 180, y }))),
};

/**
 * Story 7 fixture: a 20-note retro board in two clusters with realistic texts and
 * overlapping stacking. Returns the ids by group, in the order of SELECTION_BOARD.
 */
export function buildSelectionBoard(doc: Y.Doc): { grid: string[]; row: string[]; right: string[] } {
  let n = 0;
  const make = (p: { x: number; y: number }) => {
    const id = createSticky(
      doc,
      { x: p.x + STICKY_SIZE_WORLD / 2, y: p.y + STICKY_SIZE_WORLD / 2 },
      COLOURS[n % COLOURS.length],
    );
    typeInto(doc, id, `${n + 1}. ${RETRO_TEXTS[n % RETRO_TEXTS.length]}`);
    n += 1;
    return id;
  };
  return {
    grid: SELECTION_BOARD.grid.map(make),
    row: SELECTION_BOARD.row.map(make),
    right: SELECTION_BOARD.right.map(make),
  };
}
