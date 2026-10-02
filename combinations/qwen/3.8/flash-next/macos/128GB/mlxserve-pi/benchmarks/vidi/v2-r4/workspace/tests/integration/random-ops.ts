/**
 * A seeded stream of edits that look like somebody working on a board: typing
 * real words, dragging notes about, adding notes, trying the colours, and
 * clearing them away. Used by the convergence tests (TC-12, TC-30), which need a
 * lot of simultaneous editing and need to be able to replay an exact failure.
 *
 * Only the board model's own functions are used, so the mix of updates this
 * produces is the mix a person produces.
 */
import type * as Y from 'yjs';

import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { STICKY_TEXT_MAX_CHARS, type StickyColor } from '../../src/shared/config';

/** The share of each kind of edit, in the order they are drawn. */
const MIX = [
  { name: 'type', share: 0.4 },
  { name: 'move', share: 0.3 },
  { name: 'create', share: 0.1 },
  { name: 'recolour', share: 0.1 },
  { name: 'delete', share: 0.1 },
] as const;

export type OpName = (typeof MIX)[number]['name'];

/** Words people actually put on notes, so merging is tested with real text. */
const WORDS = [
  'design',
  'ship',
  'idea',
  'flow',
  'plan',
  'sync',
  'test',
  'board',
  'note',
  'sketch',
  'review',
  'demo',
  'draft',
  'focus',
  'story',
];

const COLORS: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

/** How far a created or moved note lands from the origin, in board units. */
const SPAN_WORLD = 2000;

/** What a run did, per kind of edit, and which notes it made and removed. */
export interface OpRecord {
  readonly counts: Record<OpName, number>;
  /** Every note this client created, in the order it made them. */
  readonly created: string[];
  /** Every note this client removed, whether or not it made them itself. */
  readonly deleted: string[];
}

/**
 * The generator behind the runs: small, fast and repeatable, so a test that fails
 * can be replayed from the seed it logged.
 */
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

/** A seed to log before a run, so the run can be repeated exactly. */
export function newSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

/** The kind of edit this draw asks for, in the 40/30/10/10/10 mix. */
export function pickOp(random: () => number): OpName {
  const draw = random();
  let from = 0;
  for (const op of MIX) {
    from += op.share;
    if (draw < from) return op.name;
  }
  return 'type';
}

/**
 * Performs `count` edits on `doc`, one per turn of the event loop, so several
 * clients can run at the same time and their edits genuinely overlap on the board.
 *
 * Each edit picks a note that exists on *this* screen at that moment; the point is
 * not that the clients do the same things, but that however their edits interleave
 * they end up showing one board.
 */
export async function runRandomOps(
  doc: Y.Doc,
  seed: number,
  count: number,
  onGap: () => Promise<unknown> = () => new Promise((resolve) => setTimeout(resolve, 0)),
): Promise<OpRecord> {
  const random = seededRandom(seed);
  const counts: Record<OpName, number> = { type: 0, move: 0, create: 0, recolour: 0, delete: 0 };
  const created: string[] = [];
  const deleted: string[] = [];

  const whole = (max: number): number => Math.floor(random() * max);
  const noteAt = (notes: readonly StickySnapshot[]): StickySnapshot | undefined =>
    notes.length === 0 ? undefined : notes[whole(notes.length)];

  for (let i = 0; i < count; i++) {
    const op = pickOp(random);
    // Read fresh each time: the board is being changed by other people too.
    const notes = snapshot(doc);

    if (op === 'create') {
      created.push(createSticky(doc, { x: whole(SPAN_WORLD), y: whole(SPAN_WORLD) }));
      counts.create += 1;
    } else if (op === 'delete') {
      const note = noteAt(notes);
      if (note !== undefined && deleteObject(doc, note.id)) deleted.push(note.id);
      counts.delete += 1;
    } else if (op === 'move') {
      const note = noteAt(notes);
      if (note !== undefined && moveObject(doc, note.id, whole(SPAN_WORLD), whole(SPAN_WORLD))) {
        counts.move += 1;
      }
    } else if (op === 'recolour') {
      const note = noteAt(notes);
      const color = COLORS[whole(COLORS.length)]!;
      if (note !== undefined && setStickyColor(doc, note.id, color)) counts.recolour += 1;
    } else {
      const note = noteAt(notes);
      const text = note === undefined ? undefined : getStickyText(doc, note.id);
      if (text !== undefined && text.length < STICKY_TEXT_MAX_CHARS) {
        const word = `${WORDS[whole(WORDS.length)]!} `;
        text.insert(whole(text.length + 1), word);
        counts.type += 1;
      }
    }

    // One turn of the event loop between edits: this is what lets other clients'
    // updates arrive in the middle of this client's work.
    await onGap();
  }

  return { counts, created, deleted };
}
