/**
 * tests/fixtures/boards.ts
 *
 * Real boards, built with the real `board-model` calls so the bytes they
 * produce are the bytes the room stores and the client renders (design
 * "Fixtures"). Nothing here hand-rolls Yjs updates: a fixture that does not go
 * through `createSticky`/`moveObject`/`setStickyColor` would test the storage
 * layer against a document the product cannot make.
 *
 * Everything is driven by a seeded generator, so a board that fails a test can
 * be rebuilt exactly: the seed and the note count describe it completely.
 */
import * as Y from 'yjs';

import {
  bringToFront,
  createSticky,
  getStickyText,
  initDoc,
  moveObject,
} from '../../src/shared/board-model';
import { PERSIST_TESTED_NOTES, STICKY_COLORS, type StickyColor } from '../../src/shared/config';

/** The six preset colours, in a stable order. */
export const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/**
 * mulberry32: small, fast, deterministic, and good enough for board layouts.
 * Chosen so fixtures reproduce on every platform and in every runtime (Node for
 * the browser seeding client, workerd for the integration tests).
 */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Retrospective-board sentences: what a team would actually write down. */
const RETRO_LINES = [
  'Deploy took 40 minutes',
  'Standup ran long again\nThree people needed to talk',
  'Loved the pairing session on the storage layer',
  'Bug triage had no owner',
  'CI flaked twice on the same test',
  'Great write-up in the doc',
  'Too many meetings before lunch',
  'Nice: the error message finally names the file',
  'Ask product about the retry rule',
  'Blocked on the API token',
  'The migration ran clean\nWorth repeating',
  'Someone should own the dashboard',
];

/** Words for the long boards' realistic prose. */
const WORDS =
  'team board note idea sprint release feedback customer design review scope testing deploy metrics backlog owner roadmap queue handoff summary draft prototype copy anchor budget timeline research pilot followup retro agenda notes action items blocker decision question learning impact effort risk value'.split(
    ' ',
  );

function sentence(random: () => number): string {
  const words = 4 + Math.floor(random() * 9);
  const parts: string[] = [];
  for (let i = 0; i < words; i++) parts.push(WORDS[Math.floor(random() * WORDS.length)] as string);
  const first = parts[0] as string;
  return (first[0] as string).toUpperCase() + first.slice(1) + parts.slice(1).join(' ') + '.';
}

/** Realistic English text between `min` and `max` characters. */
export function realisticText(random: () => number, min: number, max: number): string {
  let text = '';
  while (text.length < min) text += (text === '' ? '' : ' ') + sentence(random);
  if (text.length <= max) return text;
  // Cut at a word boundary so the fixture never ends mid-word.
  const cut = text.lastIndexOf(' ', max);
  return cut >= min ? text.slice(0, cut) : text.slice(0, max);
}

export interface PlacedNote {
  readonly id: string;
  readonly text: string;
  readonly color: StickyColor;
  readonly x: number;
  readonly y: number;
}

/**
 * A 25-note retrospective board: mixed colours, multi-line text, and a stacking
 * order that has been shuffled by bringing notes to the front, so "identical
 * stacking" is an assertion about something other than creation order.
 */
export function retroBoard(doc: Y.Doc, count = 25, seed = 20_240_104): PlacedNote[] {
  initDoc(doc);
  const random = seeded(seed);
  const placed: PlacedNote[] = [];
  for (let i = 0; i < count; i++) {
    const color = COLOR_NAMES[i % COLOR_NAMES.length] as StickyColor;
    const baseX = 40 + (i % 5) * 260;
    const baseY = 40 + Math.floor(i / 5) * 260;
    const id = createSticky(doc, { x: baseX, y: baseY }, color);
    const text = RETRO_LINES[i % RETRO_LINES.length] as string;
    getStickyText(doc, id)?.insert(0, text);
    // A slight offset per note, so positions differ between neighbours.
    const x = baseX + Math.floor(random() * 17);
    const y = baseY + Math.floor(random() * 13);
    moveObject(doc, id, x, y);
    placed.push({ id, text, color, x, y });
  }
  // Overlap the stacking: the first three notes are dragged forward out of order.
  for (const note of placed.slice(0, 3).reverse()) bringToFront(doc, note.id);
  return placed;
}

/**
 * A board of `PERSIST_TESTED_NOTES` notes with realistic text, laid out in
 * clusters the way a large workshop ends up looking (design "Fixtures").
 * Returns the note ids in creation order.
 */
export function largeBoard(doc: Y.Doc, count = PERSIST_TESTED_NOTES, seed = 9_973): PlacedNote[] {
  initDoc(doc);
  const random = seeded(seed);
  const clusters = 12;
  const placed: PlacedNote[] = [];
  for (let i = 0; i < count; i++) {
    const color = COLOR_NAMES[Math.floor(random() * COLOR_NAMES.length)] as StickyColor;
    const x = (i % clusters) * 3_000 + Math.floor(random() * 1_200);
    const y = Math.floor(i / clusters) * 2_400 + Math.floor(random() * 1_200);
    const id = createSticky(doc, { x, y }, color);
    // A workshop board has a long tail of explanation: three notes in four carry
    // a paragraph, the rest a line. The mix matters — it is what makes the
    // encoded snapshot of a `PERSIST_TESTED_NOTES` board larger than one chunk,
    // which is what the story's guarantee about chunked snapshots is about.
    const long = random() < 0.75;
    const text = realisticText(random, long ? 200 : 10, long ? 300 : 120);
    getStickyText(doc, id)?.insert(0, text);
    placed.push({ id, text, color, x, y });
  }
  return placed;
}

/**
 * A damaged update: the same bytes with their tail removed. Yjs refuses to read
 * it (design "Fixtures": "truncated update (last 10 bytes removed)").
 */
export function truncatedUpdate(bytes: Uint8Array, removedBytes = 10): Uint8Array {
  const keep = Math.max(1, bytes.byteLength - removedBytes);
  return bytes.slice(0, keep);
}

/**
 * A row that is not an update at all: `length` bytes of 0xFF, which is what a
 * torn write or a bit-rot region looks like to a decoder.
 *
 * Chosen over random bytes deliberately: random bytes of some lengths happen to
 * parse as a legal (empty) update, which makes a test built on them depend on a
 * seed. Every length of this is refused by the Yjs update parser — the varuint
 * header either runs off the end or leaves an integer out of range.
 */
export function unreadableBytes(length: number): Uint8Array {
  return new Uint8Array(Math.max(1, length)).fill(0xff);
}

/**
 * A snapshot chunk damaged in place, of the same length: bytes that parse as
 * nothing at all.
 */
export function corruptedChunk(bytes: Uint8Array): Uint8Array {
  return unreadableBytes(bytes.byteLength);
}
