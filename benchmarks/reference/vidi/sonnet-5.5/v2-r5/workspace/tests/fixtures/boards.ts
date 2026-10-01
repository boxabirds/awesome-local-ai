import * as Y from 'yjs';
import {
  LOCAL_ORIGIN, bringToFront, createSticky, getStickyText, initDoc, setStickyColor,
} from '../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../src/shared/config';

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

/** Deterministic PRNG so fixtures are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PHRASES = [
  'Release notes were confusing for customers', 'Pairing sessions worked really well',
  'We should automate the deploy checklist', 'Onboarding docs are out of date',
  'Great collaboration between design and engineering', 'Too many meetings on Wednesdays',
  'Try a weekly demo to stakeholders', 'Flaky tests slowed the team down',
  'Celebrate the launch with a team lunch', 'Customer interviews revealed a new need',
];

function setText(doc: Y.Doc, id: string, text: string): void {
  const ytext = getStickyText(doc, id)!;
  doc.transact(() => ytext.insert(0, text), LOCAL_ORIGIN);
}

/** A 25-note retro board: mixed colours, multi-line text, overlapping notes with distinct stacking. */
export function build25NoteBoard(doc: Y.Doc = new Y.Doc()): Y.Doc {
  initDoc(doc);
  const rand = mulberry32(25);
  for (let i = 0; i < 25; i += 1) {
    const id = createSticky(doc, { x: 100 + (i % 5) * 120, y: 100 + Math.floor(i / 5) * 120 }, COLORS[i % COLORS.length]) as string;
    setText(doc, id, `${PHRASES[i % PHRASES.length]}\nnote ${i}${rand() > 0.5 ? '\nsecond line' : ''}`);
    if (i % 4 === 0) setStickyColor(doc, id, COLORS[(i + 2) % COLORS.length]);
    if (i % 6 === 0 && i > 0) bringToFront(doc, id);
  }
  return doc;
}

/** A board of `count` notes (one transaction, or one update per write with perNote) with realistic English phrases (10–300 chars) laid out in clusters. */
export function buildLargeBoard(count: number, doc: Y.Doc = new Y.Doc(), opts: { perNote?: boolean } = {}): Y.Doc {
  initDoc(doc);
  const rand = mulberry32(count);
  const CLUSTER = 50;
  const work = () => {
    for (let i = 0; i < count; i += 1) {
      const cluster = Math.floor(i / CLUSTER);
      const cx = (cluster % 8) * 1400;
      const cy = Math.floor(cluster / 8) * 1400;
      const id = createSticky(doc, {
        x: cx + (i % 7) * 190, y: cy + Math.floor((i % CLUSTER) / 7) * 190,
      }, COLORS[Math.floor(rand() * COLORS.length)]) as string;
      let text = '';
      const target = 10 + Math.floor(rand() * 290);
      while (text.length < target) text += `${PHRASES[Math.floor(rand() * PHRASES.length)]}. `;
      getStickyText(doc, id)!.insert(0, text.slice(0, target).trim() || 'Idea');
    }
  };
  // perNote: every note and text write is its own update (a realistic, compaction-triggering log).
  if (opts.perNote) work(); else doc.transact(work, LOCAL_ORIGIN);
  return doc;
}

/** Splits a doc into one update per recorded change (so a log of many real rows can be appended). */
export function recordUpdates(build: (doc: Y.Doc) => void): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (u: Uint8Array) => updates.push(u));
  build(doc);
  return { doc, updates };
}

/** Last 10 bytes removed. */
export const truncated = (bytes: Uint8Array): Uint8Array => bytes.slice(0, Math.max(1, bytes.length - 10));

/** Same-length random bytes. */
export function randomBytes(length: number, seed = 7): Uint8Array {
  const rand = mulberry32(seed);
  return Uint8Array.from({ length }, () => Math.floor(rand() * 256));
}
