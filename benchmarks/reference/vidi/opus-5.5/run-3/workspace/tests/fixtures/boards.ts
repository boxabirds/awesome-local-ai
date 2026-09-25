// Realistic boards built with the real board-model functions, so their bytes are real Yjs updates.
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  bringToFront,
  createSticky,
  getStickyText,
  initDoc,
  moveObject,
} from '../../src/shared/board-model';
import { PERSIST_TESTED_NOTES, STICKY_COLORS, type StickyColor } from '../../src/shared/config';
import { seededRandom } from './random-ops';

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

export interface RecordedBoard {
  doc: Y.Doc;
  /** Every update the board's edits produced, in order (one per model call). */
  updates: Uint8Array[];
}

/** Runs `build` on a fresh (initialised) doc and records every update it emits. */
export function recordBoard(build: (doc: Y.Doc) => void, doc: Y.Doc = new Y.Doc()): RecordedBoard {
  const updates: Uint8Array[] = [];
  const onUpdate = (u: Uint8Array) => updates.push(u);
  doc.on('update', onUpdate);
  initDoc(doc);
  build(doc);
  doc.off('update', onUpdate);
  return { doc, updates };
}

export function setText(doc: Y.Doc, id: string, text: string): void {
  const t = getStickyText(doc, id)!;
  doc.transact(() => {
    t.delete(0, t.length);
    t.insert(0, text);
  }, LOCAL_ORIGIN);
}

const RETRO_TEXTS = [
  'Went well: pairing on the release checklist',
  'Could improve:\nflaky login tests slowed us down',
  'Action: Sam to split the test suite by Friday',
  'Standups ran long — try a 10 minute timer',
  'Great support from the design team 🎉',
  'Release notes were late again',
  'Customers love the new onboarding flow',
  'Too many meetings on Wednesdays',
  'Question: who owns the staging environment?',
  'Idea: rotate the on-call buddy weekly',
  'Docs for the API are out of date\n- auth section\n- rate limits',
  'Shipped dark mode 🌙',
  'Code reviews took > 2 days on average',
  'Keep: Friday demos',
  'Stop: merging without a green build',
  'Start: writing ADRs for big decisions',
  'Kudos to Priya for the migration script',
  'The build is 40% faster after caching',
  'We need clearer acceptance criteria',
  'Support tickets about login dropped',
  'Hiring: two open roles, pipeline slow',
  'Try pairing on bug triage',
  'Retro format felt fresh — keep it',
  'Mobile layout bugs keep coming back',
  'Celebrate the launch next week!',
];

/**
 * A 25-note retro board: mixed colours, multi-line and emoji texts, notes in overlapping clusters, and a few
 * notes brought to the front so the stacking order is not just creation order.
 */
export function retroBoard(doc?: Y.Doc): RecordedBoard {
  return recordBoard((d) => {
    const ids: string[] = [];
    RETRO_TEXTS.forEach((text, i) => {
      const column = i % 5;
      const row = Math.floor(i / 5);
      // Columns 150 world units apart with 200-unit notes: neighbours overlap.
      const id = createSticky(d, { x: column * 150 - 300, y: row * 170 - 340 }, COLORS[i % COLORS.length]);
      setText(d, id, text);
      ids.push(id);
    });
    moveObject(d, ids[3], 1000, -200);
    for (const i of [0, 7, 12]) bringToFront(d, ids[i]);
  }, doc);
}

const WORDS = (
  'customer onboarding release plan pricing survey feedback roadmap metric churn retention design review ' +
  'sprint backlog bug support ticket latency dashboard experiment launch partner hiring budget mobile ' +
  'checkout search invoice export import sync offline accessibility contrast keyboard navigation workshop ' +
  'interview persona journey pain point opportunity risk dependency milestone deadline owner action idea'
).split(' ');

/** A realistic English phrase of 10–300 characters. */
export function phrase(rand: () => number): string {
  const target = 10 + Math.floor(rand() * rand() * 290); // skewed towards short notes, like real boards
  let s = '';
  while (s.length < target) {
    const w = WORDS[Math.floor(rand() * WORDS.length)];
    s += s.length === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : (rand() < 0.1 ? '. ' : ' ') + w;
  }
  return s.slice(0, 300).trimEnd().padEnd(10, '.');
}

/** A board of `count` notes with realistic phrases, laid out in clusters of 20 (each a 5×4 grid). */
export function largeBoard(count: number = PERSIST_TESTED_NOTES, seed = 42): RecordedBoard {
  const rand = seededRandom(seed);
  return recordBoard((d) => {
    for (let i = 0; i < count; i++) {
      const cluster = Math.floor(i / 20);
      const cx = (cluster % 10) * 1400;
      const cy = Math.floor(cluster / 10) * 1100;
      const k = i % 20;
      const id = createSticky(
        d,
        { x: cx + (k % 5) * 220, y: cy + Math.floor(k / 5) * 220 },
        COLORS[Math.floor(rand() * COLORS.length)],
      );
      setText(d, id, phrase(rand));
    }
  });
}

/** The same update with its last 10 bytes cut off. */
export function truncatedBytes(update: Uint8Array): Uint8Array {
  return update.slice(0, Math.max(0, update.length - 10));
}

/** Random bytes of the same length as `update` (seeded). */
export function randomBytesLike(update: Uint8Array, seed = 7): Uint8Array {
  const rand = seededRandom(seed);
  const out = new Uint8Array(update.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.floor(rand() * 256);
  return out;
}

const CLUSTER_TEXTS = [
  'Went well: the demo landed with the client',
  'Onboarding checklist finally written down',
  'Pairing on the flaky tests helped a lot',
  'Friday releases felt calm this time',
  'Design and dev synced early 🎉',
  'Too many context switches mid-sprint',
  'Estimates were off for the search work',
  'Staging was down for two days',
  'Late feedback on the pricing page',
  'Standups keep running over 15 minutes',
  'Action: add a smoke test to the pipeline',
  'Action: book a design review every Tuesday',
  'Action: Priya to document the release steps',
  'Idea: rotate the demo presenter',
  'Idea: a shared glossary for the domain',
  'Question: who owns the analytics events?',
  'Question: do we still need the nightly job?',
  'Try: no-meeting Wednesday afternoons',
  'Try: smaller pull requests (< 300 lines)',
  'Keep: celebrating the small wins',
];

/** World top-left of each note in `clusterBoard` (world units). */
export const CLUSTER_A = { x: 0, y: 0, step: 220 };
export const CLUSTER_B = { x: 0, y: 700, step: 190 };

/**
 * The story 7 retro board: 20 notes in two clusters of 5 columns × 2 rows. Cluster A (ids 0-9) is a tidy grid
 * with 20-unit gaps; cluster B (ids 10-19) is 700 units below, its notes overlapping their neighbours by 10 units,
 * with a few brought to the front so stacking is not creation order. `ids[c + 5 * r]` is column c, row r of A;
 * `ids[10 + c + 5 * r]` the same in B.
 */
export function clusterBoard(): RecordedBoard & { ids: string[] } {
  const ids: string[] = [];
  const recorded = recordBoard((d) => {
    CLUSTER_TEXTS.forEach((text, i) => {
      const cluster = i < 10 ? CLUSTER_A : CLUSTER_B;
      const k = i % 10;
      const x = cluster.x + (k % 5) * cluster.step;
      const y = cluster.y + Math.floor(k / 5) * cluster.step;
      const id = createSticky(d, { x: x + 100, y: y + 100 }, COLORS[i % COLORS.length]);
      setText(d, id, text);
      ids.push(id);
    });
    for (const i of [11, 17, 13]) bringToFront(d, ids[i]);
  });
  return { ...recorded, ids };
}
