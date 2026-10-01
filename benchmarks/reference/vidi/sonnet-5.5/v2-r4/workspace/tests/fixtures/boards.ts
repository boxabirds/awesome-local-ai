import * as Y from 'yjs';
import { bringToFront, createSticky, getStickyText, initDoc, moveObject, setStickyColor, snapshot } from '../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../src/shared/config';

export interface BuiltBoard {
  doc: Y.Doc;
  /** Every Yjs update the doc emitted while it was built, in order (what a room would store). */
  updates: Uint8Array[];
}

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

const PHRASES = [
  'Went well: the release was calm',
  'Needs work: handovers between teams are slow',
  'Try next: a shared checklist for launches',
  'Customers keep asking for a way to share a read-only link with their managers',
  'Pairing on the flaky test saved a whole afternoon',
  'We should write down how we decide what to cut when the deadline moves',
  'Retro idea: rotate the facilitator every sprint so everyone owns the format',
  'Onboarding docs were out of date again; who owns them?',
  'Ship smaller changes more often',
  'The new dashboard is great but the loading state feels abrupt and confusing to people on slower networks',
];

/** Deterministic pseudo-random generator so fixtures are identical between runs. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function record(doc: Y.Doc): Uint8Array[] {
  const updates: Uint8Array[] = [];
  doc.on('update', (u: Uint8Array) => updates.push(u));
  return updates;
}

/** 25-note retro board: mixed colours, multi-line text, overlapping notes, some re-stacked and recoloured. */
export function retroBoard25(): BuiltBoard {
  const doc = new Y.Doc();
  const updates = record(doc);
  initDoc(doc);
  const ids: string[] = [];
  for (let i = 0; i < 25; i++) {
    const col = i % 5;
    const row = Math.floor(i / 5);
    // Every third note overlaps its neighbour.
    const id = createSticky(doc, { x: col * (i % 3 === 0 ? 120 : 260), y: row * 240 }, COLORS[i % COLORS.length]);
    const text = i % 4 === 0 ? `${PHRASES[i % PHRASES.length]}\n${PHRASES[(i + 3) % PHRASES.length]}` : PHRASES[i % PHRASES.length];
    getStickyText(doc, id)!.insert(0, text);
    ids.push(id);
  }
  moveObject(doc, ids[3], 777, -321);
  setStickyColor(doc, ids[4], 'violet');
  bringToFront(doc, ids[0]);
  return { doc, updates };
}

/** A board with `count` notes with realistic 10–300 char phrases laid out in clusters. */
export function largeBoard(count: number): BuiltBoard {
  const doc = new Y.Doc();
  const updates = record(doc);
  initDoc(doc);
  const rnd = lcg(42);
  const CLUSTER = 20;
  doc.transact(() => {
    for (let i = 0; i < count; i++) {
      const cluster = Math.floor(i / CLUSTER);
      const cx = (cluster % 10) * 1400;
      const cy = Math.floor(cluster / 10) * 1200;
      const k = i % CLUSTER;
      const id = createSticky(
        doc,
        { x: cx + (k % 5) * 230 + rnd() * 20, y: cy + Math.floor(k / 5) * 230 + rnd() * 20 },
        COLORS[Math.floor(rnd() * COLORS.length)],
      );
      let text = '';
      const target = 10 + Math.floor(rnd() * 290);
      while (text.length < target) text += `${text ? ' ' : ''}${PHRASES[Math.floor(rnd() * PHRASES.length)]}.`;
      getStickyText(doc, id)!.insert(0, text.slice(0, target));
    }
  });
  return { doc, updates };
}

/** Last 10 bytes removed (a truncated write). */
export function truncated(data: Uint8Array): Uint8Array {
  return data.slice(0, Math.max(1, data.length - 10));
}

/** Random bytes of the same length (deterministic). */
export function randomBytes(length: number, seed = 7): Uint8Array {
  const rnd = lcg(seed);
  return Uint8Array.from({ length }, () => Math.floor(rnd() * 256));
}

/** Canonical JSON of the board content (notes sorted by id) for equality checks. */
export function boardJson(doc: Y.Doc): string {
  return JSON.stringify([...snapshot(doc)].sort((a, b) => (a.id < b.id ? -1 : 1)));
}
