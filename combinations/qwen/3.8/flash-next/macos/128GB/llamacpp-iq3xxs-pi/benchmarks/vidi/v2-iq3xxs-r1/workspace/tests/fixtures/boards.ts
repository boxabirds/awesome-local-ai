import * as Y from 'yjs';
import {
  createSticky,
  getStickyText,
  initDoc,
  moveObject,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import {
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config';

/**
 * Realistic board fixtures (design "Fixtures").
 *
 * Every board is built through the real `board-model` functions, so the update
 * bytes it yields are exactly what the room would store from a person working in
 * the UI — the fixture is never a hand-written blob. A board is returned as the
 * ordered list of Yjs updates that produced it (so a test can append them one by
 * one and exercise the log), plus the reference `snapshot` they reconstruct.
 */

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** A note as a caller would ask the model to build it. */
export interface NotePlan {
  x: number;
  y: number;
  color: StickyColor;
  text: string;
}

/** A built board: the update log that produces it and the notes it reconstructs. */
export interface GeneratedBoard {
  readonly updates: readonly Uint8Array[];
  readonly notes: readonly StickySnapshot[];
  /** Note ids in the order they were created, i.e. one per log row after the meta row. */
  readonly createdIds: readonly string[];
}

/** Deterministic 32-bit PRNG (mulberry32), so a generated board is reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROSE =
  'the board stays exactly as the team left it · notes keep their colour and place overnight · ' +
  'a workshop that ends at midnight is still there at breakfast · asynchronous edits converge cleanly · ' +
  'nobody presses save because there is nothing to save · large boards open fast and stay legible · ';

/** Realistic English text of `length` characters (10–300), never repeated single chars. */
function realisticText(length: number, rng: () => number): string {
  const min = 10;
  const target = Math.max(min, Math.round(length));
  let out = '';
  while (out.length < target) {
    const sliceStart = Math.floor(rng() * PROSE.length);
    out += PROSE.slice(sliceStart, sliceStart + 40) + ' ';
  }
  // Keep whole words at the cut so wrapping (and the fixture) reads as English.
  let cut = Math.min(target, out.length);
  const space = out.lastIndexOf(' ', cut);
  if (space > min) cut = space;
  return out.slice(0, cut);
}

/**
 * Build a board through the model and capture its update log verbatim.
 *
 * Each note is authored in its own scratch document, so it carries its own client
 * id — exactly like notes added by different people in a shared session. That makes
 * every note an independent Yjs update: losing any single one loses *only* that
 * note, which is the property the damaged-log-row test (TC-09) needs.
 */
export function buildBoard(plan: readonly NotePlan[]): GeneratedBoard {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  // The meta row is authored by the board's own client. Capture just that update
  // (then detach), so merging each note below never re-records into the log.
  let metaUpdate: Uint8Array | undefined;
  const captureMeta = (update: Uint8Array): void => {
    metaUpdate = update.slice();
  };
  doc.on('update', captureMeta);
  initDoc(doc);
  doc.off('update', captureMeta);
  if (metaUpdate) updates.push(metaUpdate);
  const createdIds: string[] = [];
  for (const note of plan) {
    const scratch = new Y.Doc();
    let noteId = '';
    scratch.transact(() => {
      noteId = createSticky(scratch, { x: note.x, y: note.y }, note.color);
      if (note.text) getStickyText(scratch, noteId)?.insert(0, note.text);
    });
    createdIds.push(noteId);
    const update = Y.encodeStateAsUpdate(scratch);
    updates.push(update);
    Y.applyUpdate(doc, update); // merge into the reference board (no listener attached)
  }
  return { updates, notes: snapshot(doc), createdIds };
}

/**
 * 25-note retrospective board: mixed colours, multi-line texts and deliberate
 * overlaps so stacking order is part of what must survive (PRD persist.reopen).
 */
export const RETRO_NOTES = 25;

const RETRO_LINES = [
  ['What went well', 'the board needs no backend', 'and the demo never stuttered'],
  ['What to improve', 'font fit on tiny notes', 'was missed until a long paste'],
  ['Action items', 'add autosave with no button', 'reopen after everyone leaves'],
  ['Retro', 'shipping without a save prompt', 'felt risky until it just worked'],
];

export function retroNotePlan(count = RETRO_NOTES): NotePlan[] {
  const rng = seededRandom(2024_0401);
  const plan: NotePlan[] = [];
  for (let i = 0; i < count; i++) {
    const group = RETRO_LINES[i % RETRO_LINES.length]!;
    const row = Math.floor(i / 5);
    const col = i % 5;
    // A step smaller than a note (160 < 200) makes neighbours overlap.
    const x = col * (STICKY_SIZE_WORLD * 0.8);
    const y = row * (STICKY_SIZE_WORLD * 0.8) + 40 * rng();
    const color = COLOR_NAMES[i % COLOR_NAMES.length]!;
    const text = `${group[0]}\n${group[1 + (i % 2)]}\n${String(i + 1).padStart(2, '0')} of ${count}`;
    plan.push({ x, y, color, text });
  }
  return plan;
}

export function retroBoard(): GeneratedBoard {
  return buildBoard(retroNotePlan());
}

/**
 * A board whose update log is exactly `count` Yjs updates (>= 2): one meta row,
 * one sticky, and `count - 2` single-field moves. Used to hit a compaction
 * threshold on the row *count* while keeping the content small (TC-06, TC-07).
 */
export function buildUpdateLog(count: number): GeneratedBoard {
  if (count < 2) throw new RangeError('need at least 2 updates');
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => updates.push(update.slice()));
  initDoc(doc); // update 1
  const id = createSticky(doc, { x: 10, y: 10 }); // update 2
  for (let i = 0; i < count - 2; i++) moveObject(doc, id, 10 + i, 12 + i);
  return { updates: updates.slice(0, count), notes: snapshot(doc), createdIds: [id] };
}

/**
 * A board of `count` notes (default `PERSIST_TESTED_NOTES`, PRD persist.large_board)
 * with realistic 10–300-character English texts laid out in loose clusters, big
 * enough that its encoded snapshot spans more than one stored chunk.
 */
export function largeNotePlan(count = PERSIST_TESTED_NOTES): NotePlan[] {
  const rng = seededRandom(31337);
  const clusters = 8;
  const perCluster = Math.ceil(count / clusters);
  const plan: NotePlan[] = [];
  for (let i = 0; i < count; i++) {
    const cluster = Math.floor(i / perCluster);
    const inCluster = i % perCluster;
    const colsPerCluster = 10;
    const cx = cluster % 4;
    const cy = Math.floor(cluster / 4);
    const x =
      cx * 4000 + (inCluster % colsPerCluster) * (STICKY_SIZE_WORLD * 1.1) + rng() * 40;
    const y =
      cy * 4000 + Math.floor(inCluster / colsPerCluster) * (STICKY_SIZE_WORLD * 1.1) + rng() * 40;
    const length = 10 + Math.floor(rng() * 291); // 10..300 characters
    plan.push({ x, y, color: COLOR_NAMES[i % COLOR_NAMES.length]!, text: realisticText(length, rng) });
  }
  return plan;
}

export function largeBoard(count = PERSIST_TESTED_NOTES): GeneratedBoard {
  return buildBoard(largeNotePlan(count));
}

// ------------------------------------------------------------------ damaged data

/** A valid update with its last `drop` bytes removed (a torn write on disk). */
export function truncateUpdate(bytes: Uint8Array, drop = 10): Uint8Array {
  return bytes.slice(0, Math.max(0, bytes.byteLength - drop));
}

/** Random bytes of the same length as `bytes` (garbage of a plausible size). */
export function randomBytesLike(bytes: Uint8Array, seed = 4242): Uint8Array {
  const rng = seededRandom(seed);
  const out = new Uint8Array(bytes.byteLength);
  for (let i = 0; i < out.length; i++) out[i] = Math.floor(rng() * 256);
  return out;
}
