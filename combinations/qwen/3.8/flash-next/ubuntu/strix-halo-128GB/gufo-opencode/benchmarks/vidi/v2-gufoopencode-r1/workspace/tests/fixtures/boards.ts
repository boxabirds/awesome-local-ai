import * as Y from 'yjs';
import { moveObject, setStickyColor, snapshot } from '../../src/shared/board-model';
import { mulberry32, seedBoard } from '../../src/shared/board-seed';
import { PERSIST_TESTED_NOTES } from '../../src/shared/config';

export interface SeededBoard {
  doc: Y.Doc;
  // One entry per transaction in creation order: appending them in order to
  // the BoardStore log reproduces the board exactly.
  updates: Uint8Array[];
  snapshot: string;
}

function collect(doc: Y.Doc): Uint8Array[] {
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => {
    if (update.length > 0) updates.push(update);
  });
  return updates;
}

// A 25-note retro board: mixed colours, multi-line text, overlapping clusters,
// plus a few late moves/recolours appended after the seeded creations.
export function retroBoard(seed = 20_260_104): SeededBoard {
  const doc = new Y.Doc();
  const updates = collect(doc);
  const random = mulberry32(seed);
  const ids = seedBoard(doc, 25, random);
  for (let i = 0; i < ids.length; i += 4) {
    moveObject(doc, ids[i], Number((doc.getMap('objects').get(ids[i]) as Y.Map<unknown>).get('x')) + 40, 0);
    setStickyColor(doc, ids[i], 'violet');
  }
  return { doc, updates, snapshot: JSON.stringify(snapshot(doc)) };
}

// A full PRD-scale board (PERSIST_TESTED_NOTES notes). Updates are batched by
// the caller; this returns the whole-state single update plus the incremental
// per-note log for tests that want rows.
export function largeBoard(seed = 7, count = PERSIST_TESTED_NOTES): SeededBoard {
  const doc = new Y.Doc();
  const updates = collect(doc);
  seedBoard(doc, count, mulberry32(seed));
  return { doc, updates, snapshot: JSON.stringify(snapshot(doc)) };
}

// Damaged variants of a log row: the design's two corruption shapes.
export function damagedVariants(update: Uint8Array): { truncated: Uint8Array; randomSameLength: Uint8Array } {
  const truncated = update.slice(0, Math.max(0, update.length - 10));
  const randomSameLength = new Uint8Array(update.length);
  const random = mulberry32(0xc0ffee ^ update.length);
  for (let i = 0; i < randomSameLength.length; i += 1) {
    randomSameLength[i] = Math.floor(random() * 256);
  }
  return { truncated, randomSameLength };
}

export function snapshotOf(doc: Y.Doc): string {
  return JSON.stringify(snapshot(doc));
}
