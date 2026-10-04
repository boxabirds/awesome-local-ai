/**
 * Board fixtures for the persistence tests (story 4).
 *
 * Boards are generated with the *real* board-model functions, so the bytes they
 * produce are real Yjs updates — exactly what a person editing in a browser
 * would have written. Each model call is one transaction, so the captured
 * `updates` array is one entry per change, which is what the update-log tests
 * count.
 */

import * as Y from 'yjs';

import {
  createSticky,
  getStickyText,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import {
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
  type StickyColor,
} from '../../src/shared/config';

export interface BoardFixture {
  /** The document the updates were made in. */
  doc: Y.Doc;
  /** One Yjs update per change, oldest first (the log, as it would be stored). */
  updates: Uint8Array[];
}

/** Deterministic PRNG (mulberry32), so a failing run can be replayed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Record every update `body` makes to `doc`, oldest first.
 *
 * `body` must include the document's *first* transaction. Yjs updates are diffs:
 * an update whose predecessors are missing is parked by Yjs as `pendingStructs`
 * and never shows up in the document, so a log that starts at clock 1 loads as an
 * empty board. The room stores the update that initialises a board for the same
 * reason, and the fixtures mirror it.
 */
function record(doc: Y.Doc, body: () => void): Uint8Array[] {
  const updates: Uint8Array[] = [];
  const listener = (update: Uint8Array) => updates.push(update.slice());
  doc.on('update', listener);
  try {
    body();
  } finally {
    doc.off('update', listener);
  }
  return updates;
}

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** A retrospective board: mixed colours, multi-line text, overlapping stacking. */
export function retroBoard(count = 25, seed = 2024): BoardFixture {
  const doc = new Y.Doc();
  const random = seededRandom(seed);
  const prompts = [
    'What went well?',
    'What was hard?',
    'Ideas for next time',
    'Shout-outs',
    'Blockers',
  ];
  const lines = [
    'Deploy day was calm',
    'Pairing on the migration helped a lot',
    'Too many meetings on Monday',
    'Autoscaling saved the launch',
    'Docs were out of date',
    'Retry budget made retries safe',
    'Testing in staging caught it',
    'Nobody knew who owns the runbook',
    'Ship small, ship often',
    'The new onboarding page landed',
  ];

  const updates = record(doc, () => {
    initDoc(doc);
    for (let i = 0; i < count; i++) {
      // Notes overlap: a 200-unit note placed every 140 units shares 60 units
      // with its neighbour, so stacking order is visible.
      const x = (i % 5) * 140 - 280;
      const y = Math.floor(i / 5) * 150 - 150;
      const color = COLOR_NAMES[i % COLOR_NAMES.length];
      const id = createSticky(doc, { x, y }, color);
      const text = getStickyText(doc, id);
      const prompt = prompts[i % prompts.length];
      const first = lines[i % lines.length];
      const second = lines[(i * 7 + 3) % lines.length];
      // Multi-line text, sometimes long enough to overflow the note.
      const body =
        i % 4 === 0 ? `${prompt}\n${first}\n${second}` : `${prompt}\n${first.repeat(1 + (i % 3))}`;
      text?.insert(0, body.slice(0, 1 + Math.floor(random() * body.length)));
      // Every third note gets dragged a little, so positions are not a grid.
      if (i % 3 === 0) moveObject(doc, id, x + 37, y - 23);
      // A few notes get recoloured after the fact (one more stored update).
      if (i % 6 === 0) setStickyColor(doc, id, COLOR_NAMES[(i + 2) % COLOR_NAMES.length]);
    }
  });

  return { doc, updates };
}

const WORDS = [
  'the', 'team', 'shipped', 'a', 'retry', 'budget', 'so', 'flaky', 'calls', 'stop', 'cascading',
  'into', 'user', 'visible', 'errors', 'we', 'moved', 'onboarding', 'behind', 'a', 'feature',
  'flag', 'and', 'cut', 'activation', 'drop-off', 'by', 'half', 'after', 'rewriting', 'the',
  'search', 'index', 'queries', 'got', 'faster', 'but', 'cost', 'more', 'money', 'than', 'before',
  'worth', 'it', 'because', 'people', 'stay', 'longer', 'when', 'results', 'arrive', 'quickly',
  'next', 'quarter', 'we', 'should', 'measure', 'time', 'to', 'first', 'value', 'instead', 'of',
  'daily', 'actives', 'notes', 'from', 'workshop', 'please', 'add', 'your', 'own', 'examples',
  'here', 'and', 'keep', 'each', 'card', 'to', 'one', 'idea', 'voting', 'closes', 'on', 'friday',
  'morning', 'reminder', 'that', 'boards', 'are', 'kept', 'automatically', 'nobody', 'has', 'to',
  'press', 'save', 'anymore', 'documentation', 'is', 'part', 'of', 'the', 'definition', 'done',
  'for', 'us', 'incidents', 'reviewed', 'weekly', 'with', 'blameless', 'summaries', 'linked',
  'from', 'the', 'status', 'page', 'so', 'anybody', 'can', 'catch', 'up', 'later', 'in', 'peace',
];

/** A realistic English phrase of `length` characters (10-300 in this story). */
function phrase(random: () => number, length: number): string {
  const parts: string[] = [];
  let size = 0;
  while (size < length) {
    const word = WORDS[Math.floor(random() * WORDS.length)];
    parts.push(word);
    size += word.length + 1;
  }
  const text = parts.join(' ').slice(0, length);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * A big board: `count` notes of realistic text laid out in clusters, the shape a
 * workshop board grows into. Used for the large-board load time.
 */
export function largeBoard(count = PERSIST_TESTED_NOTES, seed = 7): BoardFixture {
  const doc = new Y.Doc();
  const random = seededRandom(seed);
  const clusterGap = 2600;

  const updates = record(doc, () => {
    initDoc(doc);
    for (let i = 0; i < count; i++) {
      const cluster = Math.floor(i / 40);
      const within = i % 40;
      const x = (cluster % 6) * clusterGap + (within % 8) * 230 + Math.floor(random() * 40);
      const y = Math.floor(cluster / 6) * clusterGap + Math.floor(within / 8) * 250;
      const color = COLOR_NAMES[Math.floor(random() * COLOR_NAMES.length)];
      const id = createSticky(doc, { x, y }, color);
      const length = 10 + Math.floor(random() * 291); // 10-300 characters
      getStickyText(doc, id)?.insert(0, phrase(random, length));
    }
  });

  return { doc, updates };
}

/** `length` random bytes (a log row that can never be decoded). */
export function randomBytesOf(length: number, seed = 99): Uint8Array {
  const random = seededRandom(seed);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.floor(random() * 256);
  return out;
}

/**
 * The row a half-finished write leaves: the header is intact and claims more
 * structs than the bytes in front of it can supply.
 *
 * This is the damage shape to test a load with, because it fails the same way for
 * every row. Cutting the end off an update does not: a Yjs decoder reads a string
 * up to wherever the bytes stop, so a shortened row often decodes into a shorter
 * change that applies cleanly, which is a different question.
 */
export function claimsMoreStructs(update: Uint8Array, extra = 64): Uint8Array {
  // Byte 0 counts the client blocks and byte 1 is the first block's struct count.
  // Rows this file produces hold one client and fewer than 64 structs, so both fit
  // in one byte and the claim can be inflated in place.
  if (update[0] !== 1 || (update[1]! & 0x80) !== 0 || update[1]! + extra > 0x7f) {
    throw new Error(
      `fixture row is not a single-block update with a one-byte struct count (got ${update[0]}, ${update[1]})`,
    );
  }
  const bytes = update.slice();
  bytes[1] = update[1]! + extra;
  return bytes;
}

/** A stable, comparable view of a document (sorted by id). */
export function boardKey(doc: Y.Doc): string {
  return JSON.stringify(
    [...snapshot(doc)]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((n) => [n.id, n.x, n.y, n.z, n.color, n.text, n.createdAt]),
  );
}

/** The bytes a fresh document needs to look like `doc` (for seeding clients). */
export function encodeBoard(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}
