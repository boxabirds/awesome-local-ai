import * as Y from 'yjs';

import { createSticky, getStickyText, initDoc } from '../../src/shared/board-model';

/**
 * Fixtures for the persistence tests: documents with a known number of notes at
 * known coordinates, and updates that Yjs refuses.
 */

/** Where fixture note `index` sits, so a test can look for a note it placed. */
export function fixturePosition(index: number): { x: number; y: number } {
  return { x: 40 + index * 90, y: 60 + (index % 7) * 120 };
}

/**
 * A document holding `stickyCount` notes at {@link fixturePosition} coordinates.
 * One note per transaction, as dragging a note out of the tray is, and every
 * update is handed to `onUpdate` as it happens — the storage tests count rows,
 * and a listener attached after the fact would see none of them.
 */
export function seededDoc(
  stickyCount: number,
  onUpdate?: (update: Uint8Array) => void,
): Y.Doc {
  const doc = new Y.Doc();
  if (onUpdate !== undefined) doc.on('update', onUpdate);
  initDoc(doc);
  for (let index = 0; index < stickyCount; index++) {
    createSticky(doc, fixturePosition(index));
  }
  return doc;
}

/** Deterministic byte source, so a fixture that damages a board fails the same way twice. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * An update Yjs rejects: 64 pseudorandom bytes from a fixed seed. Yjs throws on
 * this every time (verified), which is what a half-written log row or a
 * corrupted snapshot chunk looks like from the document's side.
 */
export function damagedUpdate(): Uint8Array {
  const random = mulberry32(0x5eed);
  return Uint8Array.from({ length: 64 }, () => Math.floor(random() * 256));
}

/** A valid update with its tail cut off — the other way a write can be half-done. */
export function truncatedUpdate(update: Uint8Array, cut = 10): Uint8Array {
  return update.slice(0, Math.max(0, update.byteLength - cut));
}

/**
 * A document whose encoded state reaches at least `minBytes`, built from real
 * sticky notes with long text. For compaction tests that need a state several
 * snapshots' worth of chunks large.
 */
export function bulkyDoc(minBytes: number): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  const paragraph = `${'filler text for a sticky note '}${'x'.repeat(1023)}`;
  const body = paragraph.repeat(64); // ~64 KiB per note
  for (let index = 0; ; index++) {
    const id = createSticky(doc, fixturePosition(index));
    const text = getStickyText(doc, id);
    if (text !== undefined) text.insert(0, body);
    if (Y.encodeStateAsUpdate(doc).byteLength >= minBytes) return doc;
    if (index > 2000) throw new Error('bulkyDoc: could not reach the requested size');
  }
}

/**
 * Whether two documents hold the same content. Compares the state vectors (every
 * client ID and clock, which is what "same content" means in a CRDT) rather than
 * encoded bytes, whose layout Yjs does not guarantee.
 */
export function docsEqual(a: Y.Doc, b: Y.Doc): boolean {
  const va = Y.encodeStateVector(a);
  const vb = Y.encodeStateVector(b);
  if (va.byteLength !== vb.byteLength) return false;
  for (let index = 0; index < va.byteLength; index++) {
    if (va[index] !== vb[index]) return false;
  }
  return true;
}
