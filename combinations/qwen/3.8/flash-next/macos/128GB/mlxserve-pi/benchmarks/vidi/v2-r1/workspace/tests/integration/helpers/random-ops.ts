/**
 * The seeded operation generator the design asks for (Fixtures: "Seeded random
 * operation generator producing realistic mixes ... seeds logged for replay").
 * Only the board-model functions a person's edits use, so what comes out is a
 * document any client could have produced by hand.
 */
import * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../../src/shared/config';

/** The words the generator types: real words, so text merges read sensibly. */
export const WORDS = [
  'idea',
  'flow',
  'vote',
  'scope',
  'team',
  'loop',
  'draft',
  'user',
  'sync',
  'note',
  'plan',
  'risk',
  'spike',
  'demo',
  'goal',
  'zone',
];

/** The mix, as the design's fixtures section names it. */
const CREATE_SHARE = 0.1;
const TYPE_SHARE = 0.4;
const MOVE_SHARE = 0.3;
const RECOLOUR_SHARE = 0.1;

/** A reproducible generator (mulberry32): same seed, same board. */
export const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export interface OperationReport {
  /** Ids this client created, in creation order. */
  readonly created: string[];
  /** Ids this client deleted; always a subset of `created`. */
  readonly deleted: string[];
}

/**
 * Perform `count` operations on `doc` as one person: 40% typing a word into a
 * note, 30% moving one, 10% creating one, 10% recolouring one, 10% deleting
 * one. The person can only work on notes they made themselves — their view of
 * other people's notes arrives later, with the sync — which is what makes the
 * outcome predictable without knowing what anyone else did: at the end, every
 * id in `created` is on the board unless it is also in `deleted`.
 */
export function applyRandomOperations(
  doc: Y.Doc,
  random: () => number,
  count: number,
): OperationReport {
  const created: string[] = [];
  const deleted: string[] = [];
  const mine: string[] = [];
  const colors = Object.keys(STICKY_COLORS) as StickyColor[];
  const pick = <T>(list: readonly T[]): T =>
    list[Math.floor(random() * list.length)] as T;

  for (let index = 0; index < count; index++) {
    const roll = random();
    if (mine.length === 0 || roll < CREATE_SHARE) {
      const id = createSticky(doc, {
        x: Math.round(random() * 2000),
        y: Math.round(random() * 2000),
      });
      if (id === '') continue;
      created.push(id);
      mine.push(id);
      continue;
    }
    const id = pick(mine) as string;
    if (roll < CREATE_SHARE + TYPE_SHARE) {
      const text = getStickyText(doc, id);
      if (!text) continue;
      const current = text.toString();
      const at = Math.floor(random() * (current.length + 1));
      text.insert(at, current.length === 0 ? pick(WORDS) : ` ${pick(WORDS)}`);
    } else if (roll < CREATE_SHARE + TYPE_SHARE + MOVE_SHARE) {
      moveObject(doc, id, Math.round(random() * 2000), Math.round(random() * 2000));
    } else if (roll < CREATE_SHARE + TYPE_SHARE + MOVE_SHARE + RECOLOUR_SHARE) {
      setStickyColor(doc, id, pick(colors));
    } else {
      if (deleteObject(doc, id)) {
        mine.splice(mine.indexOf(id), 1);
        deleted.push(id);
      }
    }
  }

  return { created, deleted };
}
