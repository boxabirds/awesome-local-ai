// Realistic boards built with the real board-model functions, so their bytes are
// real Yjs updates (story 4 persistence tests).
import * as Y from 'yjs';
import { bringToFront, createSticky, getStickyText, initDoc, moveObject } from '../../src/shared/board-model';
import { PERSIST_TESTED_NOTES, STICKY_COLORS, type StickyColor } from '../../src/shared/config';

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

const RETRO_TEXTS = [
  'Went well:\nshipping on Friday',
  'Standups ran long',
  'Pairing on the parser\nhelped a lot',
  'Too many meetings',
  'Try: async demo videos',
  'Flaky CI 😬',
  'Great onboarding docs',
  'Unclear ownership of billing',
  'More customer calls',
  '',
  'Celebrate the launch!',
  'Release checklist\n- tests\n- changelog\n- tag',
  'Design review earlier',
  'Hard to find the staging URL',
  'Kudos to Sam',
  'Retro action items were forgotten',
  'Limit WIP to 3',
  'Deploys are fast now',
  'Monitoring gaps at night',
  'Keep Friday demos',
  'Document the on-call rota',
  'Café-style planning worked',
  'Scope creep in sprint 2',
  'Fewer Slack pings',
  'Start: weekly tech talk',
];

/** A 25-note retro board: mixed colours, multi-line texts and overlapping notes with explicit stacking. */
export function retroBoard(doc: Y.Doc = new Y.Doc()): Y.Doc {
  initDoc(doc);
  const ids: string[] = [];
  RETRO_TEXTS.forEach((text, i) => {
    const col = i % 5;
    const row = Math.floor(i / 5);
    const id = createSticky(doc, { x: col * 230 - 460, y: row * 230 - 460 }, COLORS[i % COLORS.length]);
    if (text) getStickyText(doc, id)!.insert(0, text);
    ids.push(id);
  });
  // Overlaps: pull a few notes onto their neighbours and restack them.
  moveObject(doc, ids[1], -300, -520);
  moveObject(doc, ids[7], -120, -200);
  bringToFront(doc, ids[0]);
  bringToFront(doc, ids[6]);
  return doc;
}

const WORDS = (
  'we should try customer interview roadmap pricing feedback onboarding team launch quarter goal metric ' +
  'retention churn design review sprint backlog story bug release support ticket growth idea question risk ' +
  'dependency api mobile web search dashboard export report budget hiring meeting workshop decision'
).split(' ');

/** Deterministic pseudo-random generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An English-looking phrase of 10–300 characters. */
function phrase(rand: () => number): string {
  const target = 10 + Math.floor(rand() * 291);
  let s = '';
  while (s.length < target) {
    const w = WORDS[Math.floor(rand() * WORDS.length)];
    s += s ? ` ${w}` : w[0].toUpperCase() + w.slice(1);
    if (rand() < 0.08) s += '.';
  }
  return s.slice(0, target);
}

/** A board with `count` notes of realistic text laid out in clusters. */
export function largeBoard(count: number = PERSIST_TESTED_NOTES, seed = 42, doc: Y.Doc = new Y.Doc()): Y.Doc {
  initDoc(doc);
  const rand = rng(seed);
  const CLUSTER = 50;
  const PER_ROW = 8;
  doc.transact(() => {
    for (let i = 0; i < count; i++) {
      const cluster = Math.floor(i / CLUSTER);
      const cx = (cluster % 8) * 2400;
      const cy = Math.floor(cluster / 8) * 1800;
      const k = i % CLUSTER;
      const at = { x: cx + (k % PER_ROW) * 210 + rand() * 20, y: cy + Math.floor(k / PER_ROW) * 210 + rand() * 20 };
      const id = createSticky(doc, at, COLORS[Math.floor(rand() * COLORS.length)]);
      getStickyText(doc, id)!.insert(0, phrase(rand));
    }
  });
  return doc;
}

/** Every update `build` makes to a fresh doc, one entry per transaction. */
export function recordUpdates(build: (doc: Y.Doc) => void): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (u: Uint8Array) => updates.push(u));
  build(doc);
  return { doc, updates };
}

/** Damaged-data fixtures: the last 10 bytes removed. */
export function truncated(bytes: Uint8Array): Uint8Array {
  return bytes.slice(0, Math.max(0, bytes.length - 10));
}

/** Damaged-data fixtures: deterministic random bytes of the same length. */
export function randomBytesLike(bytes: Uint8Array, seed = 7): Uint8Array {
  const rand = rng(seed);
  return Uint8Array.from(bytes, () => Math.floor(rand() * 256));
}
