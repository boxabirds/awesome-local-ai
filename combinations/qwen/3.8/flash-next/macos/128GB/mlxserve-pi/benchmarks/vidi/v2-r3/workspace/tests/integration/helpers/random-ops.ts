// A seeded operation generator for the capacity tests (TC-12, nightly TC-30).
//
// The mix is the design's: 40 % text typing of real words, 30 % moves, 10 %
// creates, 10 % recolours, 10 % deletes. The generator is deterministic from a
// printed seed, so a failure can be replayed exactly: the seed is in the test
// output. `Math.random` is not used anywhere, in the fixture or in the tests.
import type { TestClient } from './ws-client';
import { STICKY_COLORS, type StickyColor } from '../../../src/shared/config';

/** The colour names, in a fixed order so a seed means the same thing twice. */
const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

/** Real words, because typed text should look like typed text. */
const WORDS = [
  'plan',
  'ship',
  'scope',
  'idea',
  'follow up',
  'blocked',
  'owner',
  'question',
  'next week',
  'spike',
  'cut',
  'draft',
  'research',
  'pricing',
  'onboarding',
  'needs a design',
];

/** The five operations, with the design's weights. */
const MIX: readonly ('text' | 'move' | 'create' | 'recolor' | 'delete')[] = [
  'text', 'text', 'text', 'text',
  'move', 'move', 'move',
  'create',
  'recolor',
  'delete',
];

/** A little deterministic generator: multiply-add-rollover, 32 bits. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export interface PlannedOp {
  kind: 'text' | 'move' | 'create' | 'recolor' | 'delete';
  /** Index into the editor's notes at the time the plan was made. */
  target: number;
  word: string;
  /** Offset inside the note's text, in code points. */
  at: number;
  x: number;
  y: number;
  color: StickyColor;
}

/** `count` operations, deterministic from `seed`. */
export function planOps(seed: number, count: number): PlannedOp[] {
  const random = seededRandom(seed);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const ops: PlannedOp[] = [];
  for (let index = 0; index < count; index++) {
    ops.push({
      kind: pick(MIX),
      target: Math.floor(random() * 1000),
      word: `${pick(WORDS)}${index % 7 === 0 ? ' ' : ''}`,
      at: Math.floor(random() * 40),
      x: Math.round(random() * 2000),
      y: Math.round(random() * 1200),
      color: pick(COLORS),
    });
  }
  return ops;
}

export interface OpOutcome {
  /** Every note this editor created, in order. */
  created: string[];
  /** Which of them this editor deleted again. */
  deleted: Set<string>;
}

/**
 * Carry out a plan on one editor. A delete that does not apply (someone else
 * deleted that note first) and a write to a note that is gone are both normal
 * outcomes of two people sharing a board, so they are recorded and ignored —
 * the test then asserts convergence, not who won.
 */
export function runOps(client: TestClient, ops: readonly PlannedOp[]): OpOutcome {
  const created: string[] = [];
  const deleted = new Set<string>();
  for (const op of ops) {
    const ids = client.noteIds();
    if (op.kind === 'create' || ids.length === 0) {
      created.push(client.createNote({ x: op.x, y: op.y }));
      continue;
    }
    const id = ids[op.target % ids.length] as string;
    switch (op.kind) {
      case 'text': {
        const length = Array.from(client.noteText(id)).length;
        client.typeAt(id, Math.min(op.at, length), op.word);
        break;
      }
      case 'move':
        client.moveNote(id, op.x, op.y);
        break;
      case 'recolor':
        client.setColor(id, op.color);
        break;
      case 'delete':
        if (client.deleteNote(id)) deleted.add(id);
        break;
    }
  }
  return { created, deleted };
}

/** Run one plan to completion and report what it made. */
export function logSeed(label: string, seed: number): void {
  console.log(`[seed] ${label}: ${seed} (deterministic; replay with planOps(${seed}, n))`);
}
