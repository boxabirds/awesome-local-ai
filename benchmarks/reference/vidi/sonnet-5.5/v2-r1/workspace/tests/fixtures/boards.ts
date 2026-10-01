import * as Y from 'yjs';
import { PERSIST_TESTED_NOTES, STICKY_COLORS } from '../../src/shared/config';
import type { StickyColor } from '../../src/shared/config';
import { bringToFront, createSticky, getStickyText, initDoc, setStickyColor } from '../../src/shared/board-model';
import { seededRandom } from './random-ops';
import { RETRO_TEXT, SHORT_TEXT } from './texts';

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

const PHRASES = [
  'Deploys are too slow',
  'We wait on flaky tests',
  'Pairing on the migration worked really well this sprint',
  'Customers keep asking for a way to export their data, we should look at that before the end of the quarter',
  'Faster onboarding',
  'Who owns the on-call rota when someone is travelling?',
  'Let us parallelise the suite and stop retrying failures blindly',
  'Great demo on Friday',
  'Release notes were missing again; add a checklist item',
  'Support tickets about login doubled after the redesign, which suggests the new flow hides the password reset link',
];

/** Collects the Yjs updates a build function produces, one per transaction, as a real client would send them. */
export function recordUpdates(build: (doc: Y.Doc) => void): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (u: Uint8Array) => updates.push(u));
  initDoc(doc);
  build(doc);
  return { doc, updates };
}

/** 25-note retro board: mixed colours, multi-line text, overlapping stacking (built with real board-model calls). */
export function retroBoard(doc: Y.Doc, count = 25): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = createSticky(doc, { x: (i % 5) * 150, y: Math.floor(i / 5) * 120 }) as string;
    getStickyText(doc, id)?.insert(0, i % 3 === 0 ? RETRO_TEXT : `${SHORT_TEXT} ${i}`);
    setStickyColor(doc, id, COLORS[i % COLORS.length]);
    if (i % 4 === 0 && ids.length > 0) bringToFront(doc, ids[0]);
    ids.push(id);
  }
  return ids;
}

/** `count` notes (default PERSIST_TESTED_NOTES) with realistic phrases, laid out in clusters. */
export function largeBoard(doc: Y.Doc, count = PERSIST_TESTED_NOTES, seed = 4): void {
  const rand = seededRandom(seed);
  doc.transact(() => {
    for (let i = 0; i < count; i++) {
      const cluster = Math.floor(i / 50);
      const cx = (cluster % 8) * 1400;
      const cy = Math.floor(cluster / 8) * 1400;
      const id = createSticky(doc, { x: cx + rand() * 1200, y: cy + rand() * 1200 }, COLORS[i % COLORS.length]) as string;
      let text = PHRASES[Math.floor(rand() * PHRASES.length)];
      while (text.length < 10) text += ' ok';
      getStickyText(doc, id)?.insert(0, text.slice(0, 300));
    }
  });
}

/** The last 10 bytes cut off. */
export const truncated = (bytes: Uint8Array): Uint8Array => bytes.slice(0, Math.max(0, bytes.length - 10));

/** Same-length pseudo-random bytes. */
export function randomBytesLike(bytes: Uint8Array, seed = 9): Uint8Array {
  const rand = seededRandom(seed);
  return Uint8Array.from(bytes, () => Math.floor(rand() * 256));
}
