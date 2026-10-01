import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  getStickyText,
  bringToFront,
} from '../../src/shared/board-model';
import { PERSIST_TESTED_NOTES, type StickyColor } from '../../src/shared/config';

const COLORS: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

/** Deterministic PRNG (mulberry32) so generated boards are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  'the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog', 'idea', 'note',
  'team', 'workshop', 'plan', 'goal', 'draft', 'review', 'ship', 'launch', 'user',
  'flow', 'design', 'system', 'data', 'model', 'state', 'value', 'change', 'save',
  'board', 'canvas', 'sticky', 'colour', 'position', 'stack', 'order', 'layer',
  'morning', 'afternoon', 'evening', 'meeting', 'follow', 'up', 'next', 'week',
  'sprint', 'backlog', 'priority', 'focus', 'scope', 'risk', 'blocker', 'owner',
  'action', 'item', 'task', 'story', 'feature', 'bug', 'fix', 'test', 'cover',
];

function pickPhrase(rand: () => number): string {
  const words: string[] = [];
  const target = 10 + Math.floor(rand() * 291); // 10..300 chars
  let len = 0;
  while (len < target && words.length < 80) {
    const w = WORDS[Math.floor(rand() * WORDS.length)];
    words.push(w);
    len += w.length + 1;
  }
  return words.join(' ');
}

/**
 * A 25-note "retro" board: mixed colours, multi-line texts, and overlapping stacking
 * (some notes brought to the front). Generated with real board-model calls so the
 * resulting bytes are real Yjs updates.
 */
export function create25NoteBoard(doc: Y.Doc): void {
  initDoc(doc);
  const rand = mulberry32(42);
  for (let i = 0; i < 25; i++) {
    const x = Math.floor(rand() * 2400) - 600;
    const y = Math.floor(rand() * 1600) - 400;
    const id = createSticky(doc, { x, y }, COLORS[i % COLORS.length]);
    const text = getStickyText(doc, id);
    if (text) {
      const lines = 1 + Math.floor(rand() * 3);
      const content = Array.from({ length: lines }, () => pickPhrase(rand)).join('\n');
      text.insert(0, content);
    }
    if (i % 3 === 0) bringToFront(doc, id);
  }
}

/**
 * A board of `count` notes (default `PERSIST_TESTED_NOTES`) with realistic 10–300 char
 * phrases laid out in clusters.
 */
export function createLargeBoard(doc: Y.Doc, count: number = PERSIST_TESTED_NOTES): void {
  initDoc(doc);
  const rand = mulberry32(1234);
  const clusters = 8;
  for (let i = 0; i < count; i++) {
    const cluster = i % clusters;
    const row = Math.floor(i / clusters);
    const x = cluster * 600 + (rand() - 0.5) * 320;
    const y = row * 260 + (rand() - 0.5) * 220;
    const id = createSticky(doc, { x, y }, COLORS[Math.floor(rand() * COLORS.length)]);
    const text = getStickyText(doc, id);
    if (text) text.insert(0, pickPhrase(rand));
  }
}

/** A damaged update: the last 10 bytes removed. */
export function truncatedUpdate(bytes: Uint8Array): Uint8Array {
  const cut = Math.min(10, bytes.length);
  return bytes.slice(0, bytes.length - cut);
}

/** Random bytes of the same length as `bytes`. */
export function randomBytesOfLength(length: number): Uint8Array {
  const out = new Uint8Array(length);
  const rand = mulberry32(987654321);
  for (let i = 0; i < length; i++) out[i] = Math.floor(rand() * 256);
  return out;
}
