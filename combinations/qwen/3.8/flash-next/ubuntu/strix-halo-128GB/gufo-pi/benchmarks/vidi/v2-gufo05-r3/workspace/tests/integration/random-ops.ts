/**
 * Seeded random board edits (task 6 fixture, reused by the nightly soak).
 *
 * Distribution from the design: 40 % typing real words, 30 % moves, 10 %
 * creates, 10 % recolours, 10 % deletes — always through the real board-model
 * functions, so the merge test exercises the same code the UI does.
 */
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../src/shared/config';

/** Seed logged in the test output so a failure can be replayed. */
export const RANDOM_OPS_SEED = 20260721;

const WORDS = ['idea', 'plan', 'ship', 'sync', 'note', 'merge', 'flow', 'board', 'test', 'loop'];
/** The six presets, taken from the shared config rather than restated. */
const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

export type OpKind = 'type' | 'move' | 'create' | 'recolour' | 'delete';

export interface RandomOpsResult {
  /** Ids this editor created and has not deleted. */
  readonly live: string[];
  readonly counts: Record<OpKind, number>;
}

/** Deterministic PRNG (mulberry32): same seed, same edits. */
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
 * Perform `count` random edits on `doc`. `random` is shared between editors
 * when the whole session should be reproducible as one sequence.
 */
export function applyRandomOps(
  doc: import('yjs').Doc,
  count: number,
  random: () => number,
  seedOffset = 0,
): RandomOpsResult {
  const live: string[] = [];
  const counts: Record<OpKind, number> = { type: 0, move: 0, create: 0, recolour: 0, delete: 0 };
  const pick = <T,>(list: T[]): T => list[Math.floor(random() * list.length)] as T;

  for (let i = 0; i < count; i++) {
    const roll = random();
    // Nothing to edit yet: creating is the only meaningful op.
    const kind: OpKind =
      live.length === 0
        ? 'create'
        : roll < 0.4
          ? 'type'
          : roll < 0.7
            ? 'move'
            : roll < 0.8
              ? 'create'
              : roll < 0.9
                ? 'recolour'
                : 'delete';
    counts[kind]++;

    switch (kind) {
      case 'create': {
        const id = createSticky(
          doc,
          { x: Math.floor(random() * 2000) - 1000 + seedOffset, y: Math.floor(random() * 2000) - 1000 },
          pick(COLORS),
        );
        if (id) live.push(id);
        break;
      }
      case 'type': {
        const text = getStickyText(doc, pick(live));
        if (!text) break;
        const word = `${pick(WORDS)}${random() < 0.4 ? '!' : ''}`;
        text.insert(Math.floor(random() * (text.length + 1)), word);
        break;
      }
      case 'move': {
        moveObject(
          doc,
          pick(live),
          Math.floor(random() * 2000) - 1000,
          Math.floor(random() * 2000) - 1000,
        );
        break;
      }
      case 'recolour': {
        setStickyColor(doc, pick(live), pick(COLORS));
        break;
      }
      case 'delete': {
        const index = Math.floor(random() * live.length);
        if (deleteObject(doc, live[index])) live.splice(index, 1);
        break;
      }
    }
  }
  return { live, counts };
}
