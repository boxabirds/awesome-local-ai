/**
 * Story 4 · board fixtures (design "Fixtures").
 *
 * Generates real `Y.Doc` content using the shared `board-model` functions, so
 * the bytes recorded are genuine Yjs updates. Content is built with a live
 * `doc.on('update')` recorder so each transaction becomes its own update —
 * that lets tests store many rows in the log (this mirrors real incremental
 * use, which is what the room writes).
 */
import * as Y from 'yjs';
import {
  bringToFront,
  createSticky,
  initDoc,
  moveObject,
  setStickyColor,
  snapshot
} from '../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../src/shared/config';

const COLOR_KEYS = Object.keys(STICKY_COLORS) as StickyColor[];

/** A deterministic pseudo-random generator (mulberry32) so fixtures are stable. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RETRO_PHRASES = [
  'Manual deploys kept breaking staging.',
  'Want preview environments per branch.',
  'Standup drifts into debugging.',
  'Pairing on the tricky ones helped.',
  'Docs lag the code by a week.',
  'Flaky tests erode trust.',
  'Nice onboarding doc for new folks.',
];

function setNoteText(doc: Y.Doc, id: string, text: string): void {
  const record = doc.getMap<Y.Map<unknown>>('objects').get(id);
  const ytext = record?.get('text') as Y.Text | undefined;
  if (ytext) doc.transact(() => ytext.insert(0, text));
}

/**
 * A 25-note retro board: mixed colours, multi-line / one-line texts, partly
 * overlapping positions and a stacking shuffle (design "Fixtures").
 */
export function makeRetroDoc(): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const rand = rng(0x1234abcd);
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => {
    updates.push(update.slice());
  });
  initDoc(doc);
  const ids: string[] = [];
  for (let i = 0; i < 25; i += 1) {
    // Overlapping grid: note width is 200, step 160 → neighbours overlap.
    const x = (i % 6) * 160;
    const y = Math.floor(i / 6) * 160;
    const color = COLOR_KEYS[i % COLOR_KEYS.length] as StickyColor;
    const id = createSticky(doc, { x, y }, color);
    ids.push(id);
    const phrase = RETRO_PHRASES[i % RETRO_PHRASES.length] as string;
    setNoteText(doc, id, i % 3 === 0 ? `Sprint ${i + 1}:\n${phrase}` : phrase);
    if (rand() > 0.7) {
      setStickyColor(doc, id, COLOR_KEYS[(i + 2) % COLOR_KEYS.length] as StickyColor);
    }
  }
  // A few stacking shuffles so the fixture has a non-trivial z order.
  for (const id of ids) {
    if (rand() > 0.6) bringToFront(doc, id);
  }
  return { doc, updates };
}

/**
 * A large board with `count` notes (realistic 10–300 character phrases) laid
 * out in 2-column clusters (TC-08 / TC-21).
 */
export function makeLargeDoc(count: number): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const rand = rng(0xdeadbeef);
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => {
    updates.push(update.slice());
  });
  const wordPool =
    'the board shows team progress and we track ideas notes work themes spikes risks blockers decisions actions retro review planning poker sizing estimate velocity cycle lead time throughput flow value outcome impact effort cost risk uncertainty complexity dependency queue batch stream pull push limit kanban scrum safe lean agile devops cloud serverless edge worker storage durable object'
      .split(' ');
  initDoc(doc);
  for (let i = 0; i < count; i += 1) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = col * 1200 + (row % 3) * 260;
    const y = row * 120;
    const color = COLOR_KEYS[Math.floor(rand() * COLOR_KEYS.length)] as StickyColor;
    const id = createSticky(doc, { x, y }, color);
    const phraseLen = 10 + Math.floor(rand() * 290); // 10..299 chars
    let phrase = '';
    while (phrase.length < phraseLen) {
      phrase += `${wordPool[Math.floor(rand() * wordPool.length)]} `;
    }
    setNoteText(doc, id, phrase.slice(0, phraseLen));
  }
  // Move a few notes (extra log rows, exercises snapshot content).
  const ids = snapshot(doc).map((note) => note.id);
  for (let i = 0; i < Math.min(50, ids.length); i += 5) {
    moveObject(doc, ids[i] as string, 60 + i, 90 + i * 2);
  }
  return { doc, updates };
}

/** Full-state update of a doc (single blob) — the "compact snapshot" bytes. */
export function fullSnapshot(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/** A damaged update: the last `cut` bytes of a valid snapshot are removed. */
export function truncatedUpdate(snapshotBytes: Uint8Array, cut = 10): Uint8Array {
  return snapshotBytes.slice(0, Math.max(0, snapshotBytes.byteLength - cut));
}

/** Same-length pseudo-random bytes (deterministic) to stand in as garbage. */
export function randomBytesLike(length: number, seed = 0x5eed): Uint8Array {
  const rand = rng(seed);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(rand() * 256);
  return bytes;
}