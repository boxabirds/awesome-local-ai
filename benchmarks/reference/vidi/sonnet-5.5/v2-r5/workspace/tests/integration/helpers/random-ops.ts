import type * as Y from 'yjs';
import {
  LOCAL_ORIGIN, createSticky, deleteObject, getStickyText, moveObject, setStickyColor, snapshot,
} from '../../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../../src/shared/config';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['pricing', 'roadmap', 'launch', 'risk', 'idea', 'user', 'goal', 'sprint'];
const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

export interface OpLog { created: Set<string>; deleted: Set<string> }

/** One seeded random operation: 40% typing, 30% moves, 10% creates, 10% recolours, 10% deletes. */
export function randomOp(doc: Y.Doc, rnd: () => number, log: OpLog): void {
  const notes = snapshot(doc);
  const pick = () => notes[Math.floor(rnd() * notes.length)];
  const roll = rnd();
  if (notes.length === 0 || (roll >= 0.4 && roll < 0.5)) {
    const id = createSticky(doc, { x: Math.floor(rnd() * 2000), y: Math.floor(rnd() * 2000) });
    if (id) log.created.add(id);
  } else if (roll < 0.4) {
    const text = getStickyText(doc, pick().id);
    if (text) doc.transact(() => text.insert(Math.floor(rnd() * (text.length + 1)), `${WORDS[Math.floor(rnd() * WORDS.length)]} `), LOCAL_ORIGIN);
  } else if (roll < 0.8) {
    moveObject(doc, pick().id, Math.floor(rnd() * 2000), Math.floor(rnd() * 2000));
  } else if (roll < 0.9) {
    setStickyColor(doc, pick().id, COLORS[Math.floor(rnd() * COLORS.length)]);
  } else {
    const id = pick().id;
    if (deleteObject(doc, id)) log.deleted.add(id);
  }
}
