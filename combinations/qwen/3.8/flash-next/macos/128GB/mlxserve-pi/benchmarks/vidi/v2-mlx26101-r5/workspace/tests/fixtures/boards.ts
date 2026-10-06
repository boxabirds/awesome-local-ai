/**
 * Boards for the persistence tests, built with the real board-model calls.
 *
 * These are not hand-written objects: every note here is created by `createSticky`,
 * `getStickyText` and friends, so the bytes a test stores are the bytes a person would have
 * made. That matters because the thing under test is whether a board survives being written
 * down and read back — a fixture that merely *looked* like a board would prove nothing about
 * Yjs updates, chunking or merging.
 *
 * Each generator returns `updates` as well: the board as one client sent it, one update per
 * transaction, oldest first. Seeding a room with those is how a test gets a board into
 * storage the way a board really gets there, which is what makes the reload it then asserts
 * on a reload rather than a copy.
 */

import * as Y from 'yjs';

import {
  createSticky,
  getStickyText,
  initDoc,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { PERSIST_TESTED_NOTES, STICKY_COLORS, type StickyColor } from '../../src/shared/config';
import { RETRO_ITEM } from './texts';

/** Notes on the retrospective board: enough to be a board, small enough to assert on. */
export const RETRO_BOARD_NOTES = 25;

/** The colours the fixture hands out, in order. */
/** The six colours, as the names the model stores — not the hex values they render to. */
const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

/** Note size, as laid out by the fixture, so notes end up overlapping one another. */
const NOTE_SIZE = 200;

/** The sentences the long boards are written out of: real English, realistic lengths. */
const SENTENCES = [
  'The onboarding walkthrough skipped the part where a new person has to choose a workspace.',
  'Deployments took forty minutes on Tuesday and nobody could tell which step was the slow one.',
  'Everyone agreed the search box should remember what was typed into it last time.',
  'The empty board should show one obvious thing to click rather than three competing hints.',
  'Two people edited the same note during the call and neither of them lost their text.',
  'The export came out at the wrong scale because page size and zoom were treated as one setting.',
  'Invitations should go to a board rather than to an account, so a visitor is not added twice.',
  'The board we plan with is the one nobody can find on Monday morning, which is the whole dashboard story in one sentence.',
  'Comments on a note should stay attached to it when it moves, including when somebody drags it across the board mid-conversation.',
  'We keep a list of the shortcuts we actually use, and it is short: enter to edit, delete to remove, and the one that takes back what was just done by accident.',
];

/** A board: the document, the notes as the client would render them, and the update stream. */
export interface SeededBoard {
  /** The document holding the board, so a test can compare a reload against it. */
  doc: Y.Doc;
  /** The notes, sorted the way the client sorts them. */
  notes: readonly StickySnapshot[];
  /** How the board got there: one update per transaction, oldest first. */
  updates: Uint8Array[];
}

/**
 * A phrase for note `index`: 10 to 300 characters of English, deterministic so a failure can
 * be reproduced by naming the note. Every fifth one is three lines, because text that only
 * ever occupies one line exercises nothing.
 */
export function phraseAt(index: number): string {
  const first = (SENTENCES[index % SENTENCES.length] as string).trim();
  const second = (SENTENCES[(index * 3 + 1) % SENTENCES.length] as string).trim();
  const third = (SENTENCES[(index * 7 + 5) % SENTENCES.length] as string).trim();
  const phrase =
    index % 5 === 0
      ? `${first}\n${second}\n${third}`
      : index % 3 === 0
        ? `${first} ${second}`
        : first;
  const clipped = phrase.length <= 300 ? phrase : `${phrase.slice(0, 296)}...`;
  return clipped.length >= 10 ? clipped : `${clipped} note`.slice(0, 30);
}

/** Where note `index` goes: clusters of notes, deliberately overlapping. */
export function positionOf(index: number): { x: number; y: number } {
  const perCluster = 12;
  const cluster = Math.floor(index / perCluster);
  const within = index % perCluster;
  const clusterX = (cluster % 8) * NOTE_SIZE * 3;
  const clusterY = Math.floor(cluster / 8) * NOTE_SIZE * 3;
  // Two thirds of a note apart, so notes in a cluster overlap on both axes.
  return {
    x: clusterX + (within % 4) * NOTE_SIZE * 0.66,
    y: clusterY + Math.floor(within / 4) * NOTE_SIZE * 0.66,
  };
}

/** The note's colour: mixed on purpose, so a reload has colours to get right. */
export function colorOf(index: number): StickyColor {
  return (COLORS[index % COLORS.length] ?? 'yellow') as StickyColor;
}

/**
 * Builds a board note by note, collecting the updates as a client would have sent them.
 *
 * `initDoc` runs first, as it does in the client, and the state it produces is the first
 * entry — so a board seeded from these updates carries `meta.schemaVersion` the way a real
 * board does, and the room is never asked to invent one.
 */
function build(noteCount: number, textOf: (index: number) => string): SeededBoard {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  const origin = Symbol('fixture');
  const collect = (update: Uint8Array, transactionOrigin: unknown): void => {
    if (transactionOrigin === origin) updates.push(Uint8Array.from(update));
  };
  doc.on('update', collect);
  try {
    initDoc(doc);
    updates.push(Y.encodeStateAsUpdate(doc));
    for (let index = 0; index < noteCount; index++) {
      const text = textOf(index);
      const color = colorOf(index);
      const at = positionOf(index);
      doc.transact(() => {
        const created = createSticky(doc, at, color);
        if (created === false) throw new Error('the fixture made a point that was not a coordinate');
        if (text !== '') getStickyText(doc, created)?.insert(0, text);
      }, origin);
    }
  } finally {
    doc.off('update', collect);
  }
  // One update per note, plus the one that set the schema version. A number that does not
  // add up means the fixture and the model have drifted apart.
  if (updates.length !== noteCount + 1) {
    throw new Error(`expected ${String(noteCount + 1)} updates, got ${String(updates.length)}`);
  }
  return { doc, notes: snapshot(doc), updates };
}

/** The retrospective board: 25 notes, mixed colours, multi-line text, overlapping. */
export function retroBoard(): SeededBoard {
  return build(RETRO_BOARD_NOTES, (index) => (index % 4 === 3 ? RETRO_ITEM : phraseAt(index)));
}

/** The big board: `PERSIST_TESTED_NOTES` notes of realistic text, laid out in clusters. */
export function largeBoard(noteCount: number = PERSIST_TESTED_NOTES): SeededBoard {
  return build(noteCount, phraseAt);
}

/** The whole board as a single update, for a test that wants to send it in one frame. */
export function boardUpdate(board: SeededBoard): Uint8Array {
  return Y.encodeStateAsUpdate(board.doc);
}

/**
 * The board's notes, recoloured one by one: a way to make changes after a board has been
 * written down. The notes are read from the document as it is now rather than from the list the
 * board was built with, and the colour is the first of the six that the note is not already, so
 * calling this twice still makes two changes rather than the second one being a no-op that
 * Yjs would not report.
 */
export function recolourUpdates(board: SeededBoard, count: number): Uint8Array[] {
  const updates: Uint8Array[] = [];
  const origin = Symbol('fixture-recolour');
  const collect = (update: Uint8Array, transactionOrigin: unknown): void => {
    if (transactionOrigin === origin) updates.push(Uint8Array.from(update));
  };
  const notes = snapshot(board.doc);
  if (notes.length === 0) throw new Error('the fixture ran out of notes');
  board.doc.on('update', collect);
  try {
    for (let index = 0; index < count; index++) {
      const note = notes[index % notes.length] as (typeof notes)[number];
      const next = (COLORS.find((color) => color !== note.color) ?? 'yellow') as StickyColor;
      board.doc.transact(() => {
        if (!setStickyColor(board.doc, note.id, next)) {
          throw new Error(`the fixture could not recolour ${note.id} to ${next}`);
        }
      }, origin);
    }
  } finally {
    board.doc.off('update', collect);
  }
  if (updates.length !== count) {
    throw new Error(`expected ${String(count)} updates, got ${String(updates.length)}`);
  }
  return updates;
}

/**
 * An update with its last `bytes` cut off: a message that stopped arriving. Yjs throws on
 * this, which is what a damaged row in the log looks like from the inside.
 */
export function truncatedUpdate(update: Uint8Array, bytes = 10): Uint8Array {
  if (bytes >= update.length) {
    throw new Error(`cannot truncate ${String(update.length)} bytes by ${String(bytes)}`);
  }
  return Uint8Array.from(update.subarray(0, update.length - bytes));
}

/**
 * An update of the same length with different bytes in it: the same shape, unreadable
 * content. Deterministic for a given seed, so a failure can be run again.
 */
export function scrambledUpdate(update: Uint8Array, seed = 1): Uint8Array {
  let state = (seed >>> 0) || 1;
  const damaged = new Uint8Array(update.length);
  for (let index = 0; index < update.length; index++) {
    // xorshift32: no dependency, no clock, the same bytes every run.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    damaged[index] = (state >>> 0) & 0xff;
  }
  if (sameBytes(update, damaged)) return scrambledUpdate(update, seed + 1);
  return damaged;
}

/** True when two byte strings are equal, length included. */
export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/**
 * The notes without their ids: an id is a thing a document has, not a thing a reload can
 * change, so tests that ask "is this the same board?" compare these.
 */
export function comparable(
  notes: readonly StickySnapshot[],
): readonly Omit<StickySnapshot, 'id'>[] {
  return notes.map(({ id: _id, ...rest }) => rest);
}

/**
 * The board as cumulative updates: the whole state after the first note, after the second, and
 * so on. Each of these is self-contained, so applying any one of them gives a complete board and
 * dropping one drops nothing — which is the other half of what a log is for, and worth having on
 * record next to the incremental ones a client actually sends.
 */
export function cumulativeUpdates(board: SeededBoard): Uint8Array[] {
  const growing = new Y.Doc();
  const first = board.updates[0];
  if (!first) throw new Error('the fixture produced no updates');
  Y.applyUpdate(growing, first);
  const updates = [Y.encodeStateAsUpdate(growing)];
  for (const update of board.updates.slice(1)) {
    Y.applyUpdate(growing, update);
    updates.push(Y.encodeStateAsUpdate(growing));
  }
  return updates;
}
