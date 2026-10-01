import * as Y from 'yjs';
import {
  bringToFront, createSticky, getStickyText, initDoc, moveObject, setStickyColor,
} from '../../src/shared/board-model';
import { PERSIST_TESTED_NOTES, STICKY_COLORS, type StickyColor } from '../../src/shared/config';
import { LONG_TEXT, RETRO_TEXT } from './texts';

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

/** Records every update the doc emits, as the room would append them to its log. */
export function recordUpdates(doc: Y.Doc): Uint8Array[] {
  const updates: Uint8Array[] = [];
  doc.on('update', (u: Uint8Array) => updates.push(u));
  return updates;
}

const PHRASES = LONG_TEXT.split('. ').map((s) => s.trim()).filter(Boolean);

/** Deterministic realistic text of 10-300 characters. */
export function realisticText(i: number): string {
  let text = PHRASES[i % PHRASES.length];
  for (let k = 1; text.length < 10 + ((i * 37) % 290); k++) text += `. ${PHRASES[(i + k) % PHRASES.length]}`;
  return text.slice(0, 300);
}

/** 25-note retro board: mixed colours, multi-line text, overlapping and re-stacked notes. */
export function retroBoard(doc: Y.Doc = new Y.Doc()): Y.Doc {
  initDoc(doc);
  const ids: string[] = [];
  for (let i = 0; i < 25; i++) {
    // Columns overlap by design (spacing below the 200 note size).
    const id = createSticky(doc, { x: (i % 5) * 150, y: Math.floor(i / 5) * 150 });
    ids.push(id);
    const text = i % 3 === 0 ? RETRO_TEXT : i % 3 === 1 ? realisticText(i) : '';
    if (text) getStickyText(doc, id)!.insert(0, text);
    setStickyColor(doc, id, COLORS[i % COLORS.length]);
  }
  moveObject(doc, ids[3], 1234.5, -987.25);
  bringToFront(doc, ids[0]);
  bringToFront(doc, ids[10]);
  return doc;
}

/** PERSIST_TESTED_NOTES notes of realistic text laid out in clusters. */
export function largeBoard(count: number = PERSIST_TESTED_NOTES, doc: Y.Doc = new Y.Doc()): Y.Doc {
  initDoc(doc);
  doc.transact(() => {
    for (let i = 0; i < count; i++) {
      const cluster = Math.floor(i / 25);
      const cx = (cluster % 10) * 1400;
      const cy = Math.floor(cluster / 10) * 1400;
      const id = createSticky(doc, { x: cx + (i % 5) * 220, y: cy + (Math.floor(i / 5) % 5) * 220 }, COLORS[i % COLORS.length]);
      getStickyText(doc, id)!.insert(0, realisticText(i));
    }
  });
  return doc;
}

/** Last 10 bytes cut off. */
export function truncatedUpdate(update: Uint8Array): Uint8Array {
  return update.slice(0, Math.max(0, update.length - 10));
}

/** Pseudo-random bytes of the same length (deterministic). */
export function randomBytesLike(update: Uint8Array): Uint8Array {
  const out = new Uint8Array(update.length);
  let s = 0x2545f491;
  for (let i = 0; i < out.length; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}
