import * as Y from 'yjs';
import {
  createSticky,
  moveObject,
  setStickyColor,
  deleteObject,
  getStickyText,
  snapshot,
  LOCAL_ORIGIN,
  type StickySnapshot,
} from '@/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '@/shared/config';

/** Small deterministic word pool for "typing" ops. */
const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet'];
const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

/** Deterministic PRNG (mulberry32). Same seed -> same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface OpStats {
  created: number;
  moved: number;
  recoloured: number;
  typed: number;
  deleted: number;
  skipped: number;
}

/**
 * Runs `count` seeded random board operations on `doc`, touching ONLY the
 * notes this client created (so each participant writes different notes).
 * Distribution: 40% type, 30% move, 10% create, 10% recolour, 10% delete.
 * Uses the real board-model functions. Returns the local surviving note ids.
 */
export function runRandomOps(doc: Y.Doc, count: number, seed: number): { surviving: string[]; stats: OpStats } {
  const rnd = mulberry32(seed);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
  const stats: OpStats = { created: 0, moved: 0, recoloured: 0, typed: 0, deleted: 0, skipped: 0 };
  const myNotes: string[] = [];

  for (let i = 0; i < count; i++) {
    const r = rnd();
    if (r < 0.1) {
      const id = createSticky(doc, { x: Math.floor(rnd() * 2000), y: Math.floor(rnd() * 2000) }, pick(COLORS));
      if (id) {
        myNotes.push(id);
        stats.created++;
      } else stats.skipped++;
    } else if (r < 0.4) {
      if (myNotes.length) {
        moveObject(doc, pick(myNotes), Math.floor(rnd() * 2000), Math.floor(rnd() * 2000));
        stats.moved++;
      } else stats.skipped++;
    } else if (r < 0.5) {
      if (myNotes.length) {
        setStickyColor(doc, pick(myNotes), pick(COLORS));
        stats.recoloured++;
      } else stats.skipped++;
    } else if (r < 0.9) {
      if (myNotes.length) {
        const t = getStickyText(doc, pick(myNotes));
        if (t) {
          doc.transact(() => t.insert(t.length, pick(WORDS) + ' '), LOCAL_ORIGIN);
          stats.typed++;
        } else stats.skipped++;
      } else stats.skipped++;
    } else {
      if (myNotes.length) {
        const id = pick(myNotes);
        deleteObject(doc, id);
        const idx = myNotes.indexOf(id);
        if (idx >= 0) myNotes.splice(idx, 1);
        stats.deleted++;
      } else stats.skipped++;
    }
  }
  return { surviving: myNotes, stats };
}

/** Canonical JSON of a snapshot keyed by note id (order-independent). */
export function snapshotKey(notes: readonly StickySnapshot[]): string {
  const map: Record<string, unknown> = {};
  for (const n of notes) {
    map[n.id] = { x: n.x, y: n.y, color: n.color, text: n.text, z: n.z, createdAt: n.createdAt };
  }
  return JSON.stringify(map, Object.keys(map).sort());
}

export function snapshotsEqual(a: readonly StickySnapshot[], b: readonly StickySnapshot[]): boolean {
  if (a.length !== b.length) return false;
  return snapshotKey(a) === snapshotKey(b);
}

export { snapshot };
