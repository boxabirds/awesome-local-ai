/**
 * Shared board fixtures for story 4 (design Fixtures).
 *
 * Boards are built through the real `board-model` functions, so the encoded
 * updates are real Yjs bytes. Two shapes:
 *
 * - `buildRetroBoard`: 25 notes, mixed colours, multi-line texts, three
 *   notes stacked on one spot (overlapping stacking, TC-05/06/07/09/10/13).
 * - `buildLargeBoard`: PERSIST_TESTED_NOTES (2000) notes with realistic
 *   phrases (10–300 chars) in dense clusters (TC-08, TC-21).
 *
 * Plus the damaged-data fixtures: a truncated update (last 10 bytes removed)
 * and same-length scrambled bytes (TC-09/TC-10).
 *
 * The fixtures are framework-free and deterministic (no Math.random), so
 * integration (workerd) and e2e (Node wrangler process) tests build the same
 * boards.
 */

import type { Doc } from 'yjs';
import {
  bringToFront,
  createSticky,
  getStickyText,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import {
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
  type StickyColor,
} from '../../src/shared/config';

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** One note as created by a client (position is the createSticky centre). */
export interface NoteSpec {
  x: number;
  y: number;
  text: string;
  color: StickyColor;
}

/**
 * Deterministic realistic phrases, 10–300 chars. The retro board and the
 * large board cycle through these (with a revision suffix once the list is
 * exhausted) so every note has distinct, human-readable content.
 */
const PHRASES: readonly string[] = [
  'Shipped the onboarding flow',
  'Pair debugging saved us hours',
  'The API docs were actually useful',
  'Release went out without a single rollback',
  'We fixed the flaky CI pipeline',
  'Customer feedback loop finally closed',
  'The new caching layer cut p95 latency in half',
  'On-call handoffs felt smooth this cycle',
  'The design review process is much faster now',
  'We paid down a meaningful chunk of tech debt',
  'Hiring loop improvements are landing',
  'The dashboard rewrite paid for itself',
  'Cross-team dependency tracking worked',
  'The migration ran with zero downtime',
  'Test coverage on billing is finally green',
  'The status page rollout was painless',
  'Search relevance improved measurably',
  'The mobile app crash rate dropped 40%',
  'We automated the release checklist',
  'The new editor keyboard shortcuts stuck',
  'Partner integration tests run in CI now',
  'The data export feature got great reviews',
  'We consolidated three logins into one',
  'The feature-flag rollout was boring, in a good way',
  'Sprint planning estimates got more honest',
  'The deploy pipeline blocked twice this week',
  'We lost a day to a mystery memory leak',
  'Two tickets sat in review for over a week',
  'The staging environment was unstable mid-sprint',
  'Alert noise made it hard to find real fires',
  'The analytics dashboard was off by a week',
  'We underestimated the effort of the CSV import',
  'Code review bottlenecks crept back in',
  'The new build cache made local builds slower',
  'Two incidents were under-documented',
  'The onboarding docs contradict the UI',
  'We still have no plan for the legacy webhook',
  'Error budgets got burned by one noisy service',
  'The feature flag cleanup keeps slipping',
  'Test flakes in the payments suite are back',
  'The rewrite of the notification service went much better than the last two attempts, and the old queue was finally retired after two weeks of dual writes',
  'Customers asked for the export in three different languages, so the format is now locale-aware and the translation workflow has a named owner',
  'We discovered that the slow query was an N+1 inside the billing loop; the fix is a single batched query plus a covering index, which is now documented in the runbook',
  'The on-call rotation now includes a written summary after every page, which cut repeat pages roughly in half over the last month',
  'The new search ranking ships behind a flag with a rollback plan, and the evaluation harness compares precision@10 against the old ranker on every change',
];

/** Short follow-up lines for multi-line notes. */
const DETAILS: readonly string[] = [
  'Follow-up: document the workaround in the runbook.',
  'Owner: Dana. Due at the end of next sprint.',
  'Verified against production data on Tuesday.',
  'Needs a design review before we can ship.',
  'Blocked on the infrastructure team’s calendar.',
  'Added to the Q3 planning board for scoping.',
  'The metric moved, but we want two more weeks of data.',
  'Rollback plan reviewed by two engineers.',
  'Ticket: ENG-4821. Linked from the incident report.',
  'Demoed in the Friday all-hands; feedback positive.',
];

/** Deterministic phrase for note index `i`. */
export function phraseFor(i: number): string {
  const base = PHRASES[i % PHRASES.length];
  if (i < PHRASES.length) {
    return base;
  }
  return `${base} (revision ${Math.floor(i / PHRASES.length) + 1})`;
}

/**
 * The 25-note retro board: a 5×5 grid (spacing wider than the notes, so most
 * notes are separate), mixed colours, half the texts multi-line, and the
 * last three notes stacked on one spot with increasing z (overlapping
 * stacking). Deterministic.
 */
export function retroNoteSpecs(): NoteSpec[] {
  const specs: NoteSpec[] = [];
  const COLS = 5;
  const SPACING_X = 280;
  const SPACING_Y = 300;
  for (let i = 0; i < 25; i += 1) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const base = phraseFor(i);
    const text = i % 2 === 1 ? `${base}\n${DETAILS[i % DETAILS.length]}` : base;
    specs.push({
      // Last three notes share one centre (stacked), the rest form the grid.
      x: i >= 22 ? 1500 : col * SPACING_X,
      y: i >= 22 ? 1500 : row * SPACING_Y,
      text,
      color: COLOR_NAMES[(col + row * 2 + i) % COLOR_NAMES.length],
    });
  }
  return specs;
}

export const RETRO_NOTE_COUNT = 25;

/**
 * `count` (default PERSIST_TESTED_NOTES) notes in 10 dense clusters of 20
 * columns × 10 rows each, separated so the board is realistic but the
 * clusters never overlap. Deterministic.
 */
export function largeNoteSpecs(count: number = PERSIST_TESTED_NOTES): NoteSpec[] {
  const specs: NoteSpec[] = [];
  const CLUSTERS = 10;
  const COLS = 20;
  const ROWS = 20; // cluster capacity 400; we use the first `count` of them
  const IN_CLUSTER_X = 240;
  const IN_CLUSTER_Y = 240;
  const BETWEEN_CLUSTERS = COLS * IN_CLUSTER_X + 1000;
  for (let i = 0; i < count; i += 1) {
    const cluster = Math.floor(i / (COLS * ROWS));
    const inCluster = i % (COLS * ROWS);
    const col = inCluster % COLS;
    const row = Math.floor(inCluster / COLS);
    specs.push({
      x: cluster * BETWEEN_CLUSTERS + col * IN_CLUSTER_X,
      y: row * IN_CLUSTER_Y,
      text: phraseFor(i),
      color: COLOR_NAMES[i % COLOR_NAMES.length],
    });
  }
  return specs;
}

/** Creates one note (spec centre/colour/text) and returns its id. */
export function applySpec(doc: Doc, spec: NoteSpec): string {
  const id = createSticky(doc, { x: spec.x, y: spec.y }, spec.color);
  if (spec.text.length > 0) {
    const text = getStickyText(doc, id);
    if (text !== undefined) {
      doc.transact(() => text.insert(0, spec.text), LOCAL_ORIGIN);
    }
  }
  return id;
}

/** Creates all notes for `specs` in `doc`; returns ids in spec order. */
export function applySpecs(doc: Doc, specs: readonly NoteSpec[]): string[] {
  return specs.map((spec) => applySpec(doc, spec));
}

/** Builds the 25-note retro board in `doc`; returns note ids in spec order. */
export function buildRetroBoard(doc: Doc): string[] {
  const ids = applySpecs(doc, retroNoteSpecs());
  // The three stacked notes get an explicit z ordering on top of the rest.
  bringToFront(doc, ids[22]);
  bringToFront(doc, ids[23]);
  bringToFront(doc, ids[24]);
  return ids;
}

/**
 * Builds the PERSIST_TESTED_NOTES-note board in `doc`; returns note ids in
 * spec order. `count` overrides the default for smaller stress variants.
 */
export function buildLargeBoard(doc: Doc, count: number = PERSIST_TESTED_NOTES): string[] {
  return applySpecs(doc, largeNoteSpecs(count));
}

/** Truncation damage: the last 10 bytes removed (TC-09). */
export function truncateUpdate(update: Uint8Array): Uint8Array {
  return update.slice(0, Math.max(0, update.byteLength - 10));
}

/**
 * Same-length scrambled bytes (TC-09/TC-10): a deterministic LCG XOR over the
 * original, so the result has the same byteLength but no valid structure.
 */
export function scrambleUpdate(update: Uint8Array, seed = 0x5eed): Uint8Array {
  const out = new Uint8Array(update.byteLength);
  let s = seed;
  for (let i = 0; i < update.byteLength; i += 1) {
    s = (s * 1103515245 + 12345) >>> 0;
    out[i] = (update[i] ^ (s & 0xff)) & 0xff;
  }
  return out;
}
