/**
 * Board generators for the persistence tests.
 *
 * The bytes these produce are the bytes the app produces: every note is made with
 * the real `board-model` functions, and the updates are collected from the document
 * as it changes. So when a storage test appends "a 25-note board" it is storing what
 * a workshop would store, and when a browser test compares a reopened board it is
 * comparing against the same model the app uses.
 *
 * Two boards are generated:
 *
 * - `retroBoard()` — 25 notes with mixed colours, multi-line text and deliberate
 *   overlaps, so a reopened board can be checked on text, colour, position *and*
 *   stacking rather than on a count.
 * - `largeBoard()` — `PERSIST_TESTED_NOTES` notes of realistic English (10–300
 *   characters), laid out in clusters, for "a big board opens quickly".
 *
 * Plus the damage the tests need: an update with its last bytes cut off, and random
 * bytes of the same length. Both are checked to be updates Yjs refuses, so a test
 * that expects quarantine cannot pass on bytes Yjs happens to accept.
 */
import * as Y from 'yjs';

import { newBoardId } from '../../src/shared/board-id';
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

/** A board as the storage sees it: the document, and the updates that built it. */
export interface GeneratedBoard {
  readonly doc: Y.Doc;
  /** One entry per model call, in the order made — what a client would send. */
  readonly updates: Uint8Array[];
  /** The board as the app would draw it, taken when generation finished. */
  readonly notes: readonly StickySnapshot[];
  readonly boardId: string;
}

/** Deterministic RNG, so a failure can be replayed and lengths never wander. */
function createRng(seed: number): () => number {
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
 * Record every update the document produces, as a client would send them.
 *
 * Attach this *before* the first change. An update carries the clock it starts at,
 * so a missing first update leaves a gap that Yjs silently refuses to apply — a board
 * recorded that way replays as an empty board, and every comparison against it passes
 * while meaning nothing.
 */
function record(doc: Y.Doc): Uint8Array[] {
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => {
    updates.push(update.slice());
  });
  return updates;
}

/** The 25 things a team writes on a retro board, some of them in more than one line. */
const RETRO_NOTES: readonly string[] = [
  'Shipped the release on Thursday',
  'Standup ran long again\nThree people were still debugging',
  'Great pairing session on the storage layer',
  'The build takes 14 minutes\nIt used to take four',
  'Nobody owns the runbook',
  'Onboarding docs are out of date',
  'Loved the design review\nShort and kind',
  'Flaky test in the sync suite\nIt fails on Tuesdays',
  'Too many meetings before lunch',
  'The new dashboard is genuinely faster',
  'We still deploy by hand',
  'Ask platform about the quota\nIt bit us twice',
  'Nice rollback drill',
  'Where is the roadmap?',
  'Review comments arrived days late',
  'The error pages finally say something useful',
  'Investigate the memory creep\nOnly on the long-lived boards',
  'Thank you to whoever writes our tests',
  'Incident: two boards looked empty\nTurned out to be a bad deploy',
  'Can we get a lint rule for that?',
  'Silent Friday: best day of the week',
  'The share link expired mid-call',
  'People are screenshotting boards\nThey do not trust saving yet',
  'Doc sprint went well\nTwo pages, both read by someone',
  'Next time: start with the goal, not the tool',
];

const COLOURS = Object.keys(STICKY_COLORS) as StickyColor[];

/**
 * A 25-note retrospective: one note per line of `RETRO_NOTES`, each a different
 * colour in rotation, three of them deliberately on top of an earlier one so the
 * stacking order has to survive.
 */
export function retroBoard(seed = 2024): GeneratedBoard {
  const doc = new Y.Doc();
  const updates = record(doc);
  initDoc(doc);
  const rng = createRng(seed);

  for (const [index, text] of RETRO_NOTES.entries()) {
    const column = index % 5;
    const row = Math.floor(index / 5);
    // Rows 3 and 4 sit further apart, and every seventh note is nudged onto the
    // note before it, so overlapping is part of the board rather than an accident.
    const overlaps = index % 7 === 6;
    const x = column * 400 + (overlaps ? -60 : 0) + Math.round(rng() * 8);
    const y = row * 340 + (overlaps ? 40 : 0);
    const id = createSticky(doc, { x, y }, COLOURS[index % COLOURS.length] ?? 'yellow');
    if (id === '') continue;
    const note = getStickyText(doc, id);
    if (note && text.length > 0) note.insert(0, text);
  }

  return { doc, updates, notes: snapshot(doc), boardId: newBoardId() };
}

/* The words the big board is written from. */
const ADJECTIVES = [
  'quick', 'shared', 'durable', 'quiet', 'visible', 'unfinished', 'careful', 'loud',
  'weekly', 'handwritten', 'external', 'internal', 'unfinished', 'surprising',
];
const NOUNS = [
  'retrospective', 'deploy', 'runbook', 'dashboard', 'onboarding', 'roadmap', 'incident',
  'handover', 'design review', 'test suite', 'note', 'board', 'workshop', 'archive',
];
const VERBS = [
  'blocked', 'shipped', 'reviewed', 'moved', 'renamed', 'archived', 'replaced',
  'celebrated', 'deferred', 'simplified', 'documented', 'forgotten',
];

function sentence(rng: () => number): string {
  const adjective = ADJECTIVES[Math.floor(rng() * ADJECTIVES.length)] ?? 'quiet';
  const noun = NOUNS[Math.floor(rng() * NOUNS.length)] ?? 'board';
  const verb = VERBS[Math.floor(rng() * VERBS.length)] ?? 'shipped';
  const who = ['Priya', 'Sam', 'Alex', 'Jo', 'the whole team', 'nobody'][Math.floor(rng() * 6)] ?? 'Sam';
  const when = ['on Tuesday', 'before the demo', 'after lunch', 'last Thursday', 'in the end', 'again'][
    Math.floor(rng() * 6)
  ];
  const capital = noun.charAt(0).toUpperCase() + noun.slice(1);
  return `${capital} ${verb} by ${who} ${when}, which was ${adjective} at the time`;
}

/** Realistic English between 10 and 300 characters, built from whole sentences. */
function realisticText(rng: () => number): string {
  const target = 10 + Math.floor(rng() * 290);
  let text = '';
  while (text.length < Math.min(target, 40)) {
    text = text.length === 0 ? sentence(rng) : `${text}. ${sentence(rng)}`;
  }
  while (text.length < target) {
    const next = sentence(rng);
    if (text.length + next.length + 2 > 300) break;
    text = `${text}. ${next}`;
  }
  const trimmed = text.slice(0, 300);
  return trimmed.length < 10 ? `${trimmed} (short note)` : trimmed;
}

/** A board two clients wrote, and who wrote which note. */
export interface SharedBoard extends GeneratedBoard {
  readonly firstClientNoteIds: readonly string[];
  readonly secondClientNoteIds: readonly string[];
}

/** Marks the transactions that only copy the other document's work across. */
const RELAY = Symbol('vidi6.relay');

/**
 * The 25-note retro again, this time written by two clients that are connected the way
 * clients in a workshop are: every update goes to the other document *and* into
 * `updates`, in the order a server would have received them.
 *
 * Two clients matter because a damaged update costs a reader the later updates from
 * *that* client — Yjs has nowhere to put a hole in a document clock. So one author's
 * stroke can be lost while the other's keep arriving, which is exactly what
 * "the rest of the board still loads" has to mean.
 */
export function sharedRetroBoard(seed = 2024): SharedBoard {
  const first = new Y.Doc();
  const second = new Y.Doc();
  const updates: Uint8Array[] = [];
  first.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === RELAY) return;
    updates.push(update.slice());
    Y.applyUpdate(second, update, RELAY);
  });
  second.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === RELAY) return;
    updates.push(update.slice());
    Y.applyUpdate(first, update, RELAY);
  });
  initDoc(first);

  const rng = createRng(seed);
  const firstClientNoteIds: string[] = [];
  const secondClientNoteIds: string[] = [];

  for (const [index, text] of RETRO_NOTES.entries()) {
    const author = index % 2 === 0 ? first : second;
    const ids = index % 2 === 0 ? firstClientNoteIds : secondClientNoteIds;
    const column = index % 5;
    const row = Math.floor(index / 5);
    const x = column * 400 + Math.round(rng() * 8);
    const y = row * 340 + (index % 3 === 2 ? 40 : 0);
    const id = createSticky(author, { x, y }, COLOURS[index % COLOURS.length] ?? 'yellow');
    if (id === '') continue;
    ids.push(id);
    getStickyText(author, id)?.insert(0, text);
  }

  return {
    doc: second,
    updates,
    notes: snapshot(second),
    boardId: newBoardId(),
    firstClientNoteIds,
    secondClientNoteIds,
  };
}

/**
 * A board of `count` notes laid out in clusters of nine, which is how a real board
 * of that size looks: dense inside a cluster, empty between them.
 *
 * One model call is one update, so `updates.length` is also the number of rows a
 * board this size puts in the log before its first compaction.
 */
export function largeBoard(count = PERSIST_TESTED_NOTES, seed = 7): GeneratedBoard {
  const doc = new Y.Doc();
  const updates = record(doc);
  initDoc(doc);
  const rng = createRng(seed);

  for (let index = 0; index < count; index += 1) {
    const cluster = Math.floor(index / 9);
    const within = index % 9;
    const clusterColumn = cluster % 12;
    const clusterRow = Math.floor(cluster / 12);
    const x =
      clusterColumn * (3 * (STICKY_SIZE_WORLD + 40)) + (within % 3) * (STICKY_SIZE_WORLD + 20);
    const y =
      clusterRow * (3 * (STICKY_SIZE_WORLD + 40)) + Math.floor(within / 3) * (STICKY_SIZE_WORLD + 20);
    const id = createSticky(doc, { x, y }, COLOURS[index % COLOURS.length] ?? 'yellow');
    if (id === '') continue;
    getStickyText(doc, id)?.insert(0, realisticText(rng));
  }

  return { doc, updates, notes: snapshot(doc), boardId: newBoardId() };
}

/**
 * Keep a generated board editing: `times` more moves, each one a change (a move to
 * where the note already is would write nothing, and a test that waits for an update
 * would wait forever).
 *
 * This is how a test produces "the same board, three changes later" and "a log that
 * reached the compaction threshold" without inventing bytes: the updates are the ones
 * the app would have sent.
 *
 * Returns the updates produced, which is also `board.updates` from here on.
 */
export function editBoard(board: GeneratedBoard, times: number): Uint8Array[] {
  const before = board.updates.length;
  for (let round = 0; round < times; round += 1) {
    const notes = snapshot(board.doc);
    if (notes.length === 0) break;
    const note = notes[round % notes.length];
    if (!note) break;
    // Always a different top-left, so Yjs has something to write.
    moveObject(board.doc, note.id, note.x + 11 * (round + 1), note.y - 7 * round);
  }
  return board.updates.slice(before);
}

/** An update with its last ten bytes removed: Yjs cannot read the rest. */
export function truncatedUpdate(update: Uint8Array): Uint8Array {
  return update.slice(0, Math.max(1, update.byteLength - 10));
}

/** Random bytes of the same length as `update`. */
export function randomBytesLike(update: Uint8Array, seed = 11): Uint8Array {
  const rng = createRng(seed);
  const bytes = new Uint8Array(update.byteLength);
  for (let index = 0; index < bytes.byteLength; index += 1) bytes[index] = Math.floor(rng() * 256);
  return bytes;
}

/** Bytes that are certainly not a Yjs update: a run of `0xff`, which is never a legal varUInt. */
export function unreadableBytes(length = 64): Uint8Array {
  return new Uint8Array(length).fill(0xff);
}

/** Whether Yjs refuses these bytes. A damage fixture that applies is not damage. */
export function isRefusedByYjs(bytes: Uint8Array): boolean {
  const probe = new Y.Doc();
  try {
    Y.applyUpdate(probe, bytes);
    return false;
  } catch {
    return true;
  } finally {
    probe.destroy();
  }
}
