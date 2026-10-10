/**
 * Board fixtures (story 4).
 *
 * Boards are generated with the real `board-model` functions, so every byte the
 * storage tests append is a real Yjs update produced by the same code path the
 * browser uses. Each mutation is its own transaction, which is also how a
 * person editing a board produces the update log.
 */

import * as Y from 'yjs';
import {
  createSticky,
  getStickyText,
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { PERSIST_TESTED_NOTES, STICKY_COLORS, STICKY_COLOR_NAMES, type StickyColor } from '../../src/shared/config';

export interface BoardFixture {
  readonly doc: Y.Doc;
  /** One Yjs update per board-model mutation, in the order it happened. */
  readonly updates: readonly Uint8Array[];
  /** The board as the model sees it, for comparing a reload against it. */
  readonly notes: readonly StickySnapshot[];
}

/** Run `change` on `doc`, recording every Yjs update it produces. */
function record(doc: Y.Doc, change: () => void, sink: Uint8Array[]): void {
  const collected: Uint8Array[] = [];
  const observer = (update: Uint8Array): void => {
    collected.push(update);
  };
  doc.on('update', observer);
  try {
    change();
  } finally {
    doc.off('update', observer);
  }
  for (const update of collected) {
    sink.push(update);
  }
}

/* ---------------------------------------------------------------------------
 * 25-note retrospective board: mixed colours, multi-line text, overlaps.
 * ------------------------------------------------------------------------- */

/** Words per note, so the log holds exactly 25 * (1 + WORDS_PER_NOTE) rows. */
export const RETRO_WORDS_PER_NOTE = 19;
/** Notes on the board: 5 columns x 5 rows. */
export const RETRO_NOTE_COUNT = 25;

const RETRO_PHRASES: readonly string[] = [
  'pairing rotated across the whole team and nobody stayed stuck for long',
  'the new starter fixed a bug on their first day with help from two notes',
  'daily demo made the work visible without anybody writing a status report',
  'our deploy step still needs a human and everybody knows which human',
  'colour coding the notes turned twelve complaints into four clear themes',
  'notes that overlapped were harder to read than notes that were moved apart',
  'the timer on each round kept the conversation concrete and short',
  'nobody could find the board again the next week until the address was pinned',
  'printing the board for the standup wasted paper and lost the links',
  'one note per idea worked, mixed ideas on one note worked less well',
  'the long notes became unreadable from across the room and had to be split',
  'action items got owners written straight on the note itself',
  'the follow up review started from exactly this board and exactly these colours',
  'grouping by theme before voting stopped the loudest voice winning',
  'a blank note on the board kept a promise visible instead of buried in chat',
  'the board kept growing sideways and the pan never ran out of room',
  'two people editing the same note at once kept both sentences',
  'the offline person could not add anything and that gap showed up later',
  'screenshots of the board went stale within an hour and nobody trusted them',
  'the export we do not have yet is the thing people asked for most',
  'every theme ended with one owner and one next step written down',
  'notes left uncoloured looked like leftovers and got ignored in the review',
  'the board was reopened the next morning exactly as the session left it',
  'search would have found the three notes about deploys without scrolling',
  'the retro worked because the board was still there on friday',
];

const RETRO_FILLER: readonly string[] = [
  'for', 'the', 'next', 'session', 'notes', 'owner', 'action', 'step', 'again',
];

/**
 * The words of a note, padded or merged to exactly `words` non-empty pieces:
 * each piece is one insert transaction, so the log length is a known number
 * rather than a property of the wording.
 */
function splitWords(text: string, words: number): string[] {
  const out = text.split(/\s+/u).filter((word) => word.length > 0);
  for (let index = 0; out.length < words; index += 1) {
    out.push(RETRO_FILLER[index % RETRO_FILLER.length]!);
  }
  while (out.length > words) {
    const last = out.pop()!;
    const before = out.pop()!;
    out.push(`${before} ${last}`);
  }
  return out;
};

/**
 * A 25-note retrospective board, laid out in five columns, with the occasional
 * note overlapping its neighbour and the occasional note written on several
 * lines. Text is typed word by word, so the update log is the same shape a real
 * session produces.
 *
 * `updates` is the whole write log in order, starting with the transaction that
 * writes `schemaVersion`. Yjs transaction updates are contiguous per writer: a
 * log that starts after the writer's first item leaves a gap in that writer's
 * clock, and everything that writer did after the gap stops being resolvable.
 * A board's log therefore begins with the writer's first transaction.
 */
export function retroBoard(): BoardFixture {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  record(doc, () => initDoc(doc), updates);

  const colours = STICKY_COLOR_NAMES;
  for (let index = 0; index < RETRO_NOTE_COUNT; index += 1) {
    const column = index % 5;
    const row = Math.floor(index / 5);
    // Every third note is nudged into its neighbour, so stacking order matters.
    const overlap = index % 3 === 0 ? 60 : 0;
    const x = column * 240 + overlap;
    const y = row * 230 + (index % 4 === 0 ? 90 : 0);
    const color: StickyColor = colours[index % colours.length]!;
    const text = RETRO_PHRASES[index]!;

    let id = '';
    record(doc, () => {
      id = createSticky(doc, { x, y }, color);
    }, updates);

    const pieces = splitWords(text, RETRO_WORDS_PER_NOTE);
    for (let piece = 0; piece < pieces.length; piece += 1) {
      const ytext = getStickyText(doc, id);
      if (ytext === undefined) {
        continue;
      }
      // Every fourth word break becomes a line break: multi-line notes.
      const separator = piece === 0 ? '' : piece % 4 === 0 ? '\n' : ' ';
      const word = pieces[piece]!;
      record(doc, () => ytext.insert(ytext.length, `${separator}${word}`), updates);
    }
  }

  return { doc, updates, notes: snapshot(doc) };
}

/* ---------------------------------------------------------------------------
 * Large board: `PERSIST_TESTED_NOTES` notes of realistic prose, in clusters.
 * ------------------------------------------------------------------------- */

const LARGE_PHRASES: readonly string[] = [
  'The board survived the weekend and opened on monday exactly as it was left.',
  'Two people typed in the same note at the same time and both sentences stayed.',
  'Notes about deploys gathered in the top left corner without anybody deciding that.',
  'A theme only became clear once the notes were moved next to each other.',
  'Colour meant sprint blocker, and nobody had to explain that twice.',
  'The longest notes were split into three shorter ones during the review.',
  'Ownership was written on the note instead of promised in the chat thread.',
  'Somebody added a note while the rest of the team was already offline.',
  'Reading the board aloud took eleven minutes and produced four action items.',
  'The board was panned far to the right to make room for the next exercise.',
  'A note left empty was a reminder that an answer was still owed.',
  'Stacking mattered where notes overlapped, and the top note won the argument.',
  'The facilitator kept one column for things that went well and one for problems.',
  'Nobody pressed save, because there was nothing to press.',
  'The follow up session started from this same address and the same clusters.',
  'Long prose was shortened so it could still be read from the back of the room.',
  'The cluster about onboarding grew fastest because new people joined daily.',
  'Every note that came back the next morning was where it had been left.',
  'Voting happened by moving notes into a row, not by counting on fingers.',
  'A note that was moved twice ended up where the quietest person had put it.',
  'Some notes carried two lines: the observation and the thing to do about it.',
  'The retro closed with three owners, four notes and one board nobody deleted.',
];

/** Deterministic pseudo-random words, so the fixture is the same every run. */
const EXTRA_WORDS: readonly string[] = [
  'notes', 'board', 'theme', 'owner', 'action', 'review', 'followup', 'cluster',
  'colour', 'sticky', 'session', 'team', 'next', 'step', 'again', 'morning',
];

/** Realistic note text between 10 and 300 characters, deterministic per index. */
function largeText(index: number): string {
  const target = 120 + ((index * 37) % 181); // 120..300 characters
  let text = LARGE_PHRASES[index % LARGE_PHRASES.length]!;
  let word = 0;
  while (text.length < target) {
    text += ` ${EXTRA_WORDS[(index + word) % EXTRA_WORDS.length]}`;
    word += 1;
  }
  return text.length > target ? text.slice(0, target - 1) + '.' : text;
}

/**
 * A board of `count` notes with realistic prose, laid out in clusters: eight
 * clusters of 250 notes, each cluster packed into its own area of the board so
 * some notes overlap.
 */
export function largeBoard(count: number = PERSIST_TESTED_NOTES): BoardFixture {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  record(doc, () => initDoc(doc), updates);
  const colours = STICKY_COLOR_NAMES;

  for (let index = 0; index < count; index += 1) {
    const cluster = index % 8;
    const inCluster = Math.floor(index / 8);
    const column = inCluster % 10;
    const row = Math.floor(inCluster / 10) % 25;
    const x = cluster * 2_600 + column * 210 + (index % 5) * 25;
    const y = row * 200 + (index % 7) * 20;
    const color = colours[index % colours.length]!;

    let id = '';
    record(doc, () => {
      id = createSticky(doc, { x, y }, color);
    }, updates);

    const ytext = getStickyText(doc, id);
    if (ytext !== undefined) {
      record(doc, () => ytext.insert(0, largeText(index)), updates);
    }
  }

  return { doc, updates, notes: snapshot(doc) };
}

/* ---------------------------------------------------------------------------
 * Log shapes
 * ------------------------------------------------------------------------- */

/**
 * The fixture's updates merged into `groups` log rows: what a client that sent
 * several transactions in one message produces. Used where a test needs a
 * specific number of rows rather than a specific number of transactions.
 */
export function batchUpdates(updates: readonly Uint8Array[], groups: number): Uint8Array[] {
  const batches: Uint8Array[] = [];
  const per = Math.ceil(updates.length / groups);
  for (let offset = 0; offset < updates.length; offset += per) {
    batches.push(Y.mergeUpdates(updates.slice(offset, offset + per)));
  }
  return batches;
}

/* ---------------------------------------------------------------------------
 * Damage fixtures
 * ------------------------------------------------------------------------- */

/** A log row with its last 10 bytes cut off: bytes Yjs cannot read. */
export function truncatedUpdate(update: Uint8Array): Uint8Array {
  return update.slice(0, Math.max(0, update.byteLength - 10));
}

/** Same-length pseudo-random bytes: bytes that are not an update at all. */
export function randomBytesLike(update: Uint8Array, seed = 99): Uint8Array {
  const bytes = new Uint8Array(update.byteLength);
  let state = seed;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    bytes[index] = state % 256;
  }
  return bytes;
}

/** The colour a fixture used, for DOM comparisons. */
export const fixtureColorHex = (color: StickyColor): string => STICKY_COLORS[color];

/** A canonical comparison string for two boards. */
export const boardKey = (notes: readonly StickySnapshot[]): string =>
  notes
    .map((note) => `${note.id}|${note.text}|${note.x}|${note.y}|${note.color}|${note.z}|${note.createdAt}`)
    .sort()
    .join('\n');
