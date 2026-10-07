import * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../src/shared/board-model';
import { STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from '../../src/shared/config';

/**
 * Seeded random board editing (design "Fixtures"): a reproducible stream of real
 * model operations — 40% typing real words, 30% moves, 10% creates, 10%
 * recolours, 10% deletes — so a merge test can say "these two replicas took the
 * same 200 operations and still look identical". Nothing here invents its own
 * data shape: every operation goes through the same functions the UI calls.
 */

/** Deterministic 32-bit PRNG (mulberry32); the seed is always logged. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Real words, so concurrent typing looks like what a workshop types. */
export const WORDS = [
  'ship',
  'harbour',
  'lantern',
  'compass',
  'drift',
  'signal',
  'anchor',
  'weather',
  'crew',
  'manifest',
] as const;

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** World coordinates stay inside a few screens so moves stay plausible. */
const BOARD_EXTENT = 8 * STICKY_SIZE_WORLD;

export interface OpLog {
  readonly seed: number;
  readonly ops: string[];
}

/**
 * Apply `count` random operations to `doc` and return a human-readable log of
 * them (ids included, so a failure can be replayed by hand).
 */
export function runRandomOps(
  doc: Y.Doc,
  count: number,
  random: () => number,
  seed: number,
): OpLog {
  const ops: string[] = [];
  const noteIds = (): string[] => {
    const ids: string[] = [];
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    for (const [id, value] of objects) {
      if (value instanceof Y.Map && value.get('type') === 'sticky') ids.push(id);
    }
    return ids.sort();
  };
  const pick = <T,>(values: readonly T[]): T => values[Math.floor(random() * values.length)!]!;

  for (let i = 0; i < count; i++) {
    const ids = noteIds();
    // Shares: 40% text, 30% move, 10% create, 10% recolour, 10% delete. Editing
    // an existing note needs one, so a board with no notes always gets a create.
    const roll = random();
    if (ids.length === 0 || roll < 0.1) {
      const at = { x: Math.floor(random() * BOARD_EXTENT), y: Math.floor(random() * BOARD_EXTENT) };
      const id = createSticky(doc, at, pick(COLOR_NAMES));
      ops.push(`create ${id} @${at.x},${at.y}`);
      continue;
    }
    if (roll < 0.4) {
      const id = pick(ids);
      const x = Math.floor(random() * BOARD_EXTENT);
      const y = Math.floor(random() * BOARD_EXTENT);
      moveObject(doc, id, x, y);
      ops.push(`move ${id} ->${x},${y}`);
      continue;
    }
    if (roll < 0.5) {
      const id = pick(ids);
      const color = pick(COLOR_NAMES);
      setStickyColor(doc, id, color);
      ops.push(`recolour ${id} ${color}`);
      continue;
    }
    if (roll < 0.6) {
      const id = pick(ids);
      deleteObject(doc, id);
      ops.push(`delete ${id}`);
      continue;
    }
    const id = pick(ids);
    const text = getStickyText(doc, id);
    if (!text) {
      ops.push(`skip-text ${id}`);
      continue;
    }
    const word = `${pick(WORDS)} `;
    const at = Math.floor(random() * (text.length + 1));
    text.insert(at, word);
    ops.push(`type ${id} @${at} "${word}"`);
  }
  return { seed, ops };
}

/** Every op id touched, in the order generated: handy in a failure message. */
export function formatOps(log: OpLog, limit = 20): string {
  return `seed=${log.seed} ops=${log.ops.length} [${log.ops.slice(0, limit).join(', ')}${
    log.ops.length > limit ? ', …' : ''
  }]`;
}
