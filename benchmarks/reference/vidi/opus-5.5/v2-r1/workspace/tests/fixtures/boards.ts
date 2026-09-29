// Realistic saved boards built with the real board-model functions, so every byte is a real
// Yjs update. Used by the storage/room integration tests and the persistence e2e tests.
import * as Y from 'yjs';
import {
  bringToFront,
  createSticky,
  getStickyText,
  initDoc,
  moveObject,
} from '../../src/shared/board-model';
import {
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config';
import { seededRandom } from './random-ops';

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

const RETRO_TEXTS = [
  'Went well: pairing on the billing bug',
  'Flaky CI on Fridays\nneeds an owner',
  'Release notes were late again',
  'Action: rotate the release captain',
  'Great demo to the sales team!',
  'Too many meetings on Tuesday',
  'Onboarding doc is out of date\n- setup steps\n- access requests',
  'Kudos to Sam for the migration',
  'Unclear priorities mid-sprint',
  'Try: async stand-up twice a week',
  '',
  'Customer interviews → 3 new insights',
  'Dashboards load slowly',
  'Pair more on code review',
  'Deploys on Friday? Let us agree on a rule',
  'Docs: API examples missing',
  'Retro action items from last time were not done',
  'Celebrate the launch 🎉',
  'Support tickets down 20%',
  'Question: who owns the design system?',
  'Improve: estimate with the whole team',
  'Keep: weekly product review',
  'Stop: last-minute scope changes',
  'Start: writing decision records',
  'Mood: tired but proud',
];

const PHRASES = [
  'Customers ask for an export to spreadsheets before renewing',
  'Onboarding checklist',
  'Could we prefill the workspace name from the email domain?',
  'Churn is highest in the second month, mostly small teams that never invited a colleague',
  'Pricing page confuses people comparing the team and business plans',
  'Interview notes: the admin wants audit logs, the end users want faster search',
  'Idea',
  'Support reports that the welcome email arrives late and links to an outdated guide, which creates tickets during the first week',
  'Mobile app reviews mention sync problems when switching networks',
  'Run a design sprint on the sharing flow with two customers joining for the final day',
  'Hiring: one more backend engineer this quarter',
  'Retention metric: share of new teams inviting a second member within seven days',
];

/** A note-making script: every board-model call's update, in order (a realistic log). */
export interface BoardFixture {
  doc: Y.Doc;
  /** Every update the doc emitted while being built, in order. */
  updates: Uint8Array[];
}

function recording(): BoardFixture {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (u: Uint8Array) => updates.push(u));
  initDoc(doc);
  return { doc, updates };
}

function text(rand: () => number): string {
  let out = PHRASES[Math.floor(rand() * PHRASES.length)];
  // 10–300 characters of realistic English.
  const target = 10 + Math.floor(rand() * 291);
  while (out.length < target) out += ` ${PHRASES[Math.floor(rand() * PHRASES.length)]}`;
  return out.slice(0, target);
}

/**
 * 25-note retro board: mixed colours, multi-line texts, overlapping notes and a changed
 * stacking order (some notes brought to front, some moved).
 */
export function retroBoard(seed = 25): BoardFixture {
  const rand = seededRandom(seed);
  const board = recording();
  const { doc } = board;
  const ids: string[] = [];
  RETRO_TEXTS.forEach((t, i) => {
    // Five columns of five, spaced less than a note apart so neighbours overlap.
    const at = { x: (i % 5) * 170 + Math.round(rand() * 20), y: Math.floor(i / 5) * 150 };
    const id = createSticky(doc, at, COLORS[i % COLORS.length]) as string;
    if (t) getStickyText(doc, id)!.insert(0, t);
    ids.push(id);
  });
  for (let i = 0; i < 5; i++) bringToFront(doc, ids[Math.floor(rand() * ids.length)]);
  for (let i = 0; i < 5; i++) {
    const id = ids[Math.floor(rand() * ids.length)];
    moveObject(doc, id, Math.round(rand() * 800) - 100, Math.round(rand() * 600) - 100);
  }
  return board;
}

/**
 * `count` notes (default PERSIST_TESTED_NOTES) with 10–300 character phrases, in clusters.
 * Built in one transaction (one update) unless `oneTransaction` is false (one per change).
 */
export function largeBoard(
  count = PERSIST_TESTED_NOTES,
  seed = 2000,
  { oneTransaction = true } = {},
): BoardFixture {
  const rand = seededRandom(seed);
  const board = recording();
  const { doc } = board;
  const clusters = 20;
  const build = (fn: () => void) => (oneTransaction ? doc.transact(fn) : fn());
  build(() => {
    for (let i = 0; i < count; i++) {
      const c = i % clusters;
      const cx = (c % 5) * 3000;
      const cy = Math.floor(c / 5) * 3000;
      const at = { x: cx + Math.round(rand() * 2000), y: cy + Math.round(rand() * 2000) };
      const id = createSticky(doc, at, COLORS[Math.floor(rand() * COLORS.length)]) as string;
      getStickyText(doc, id)!.insert(0, text(rand));
    }
  });
  return board;
}

/** The update with its last 10 bytes cut off. */
export function truncated(update: Uint8Array): Uint8Array {
  return update.slice(0, Math.max(0, update.length - 10));
}

/** Random bytes of the same length (seeded). */
export function randomBytesLike(update: Uint8Array, seed = 7): Uint8Array {
  const rand = seededRandom(seed);
  return Uint8Array.from(update, () => Math.floor(rand() * 256));
}

const CLUSTER_TEXTS = [
  'Went well: pairing on the billing bug',
  'Great demo to the sales team!',
  'Kudos to Sam for the migration',
  'Support tickets down 20%',
  'Customer interviews → 3 new insights',
  'Keep: weekly product review',
  'Celebrate the launch 🎉',
  'Docs: API examples missing',
  'Try: async stand-up twice a week',
  'Start: writing decision records',
  'Mood: tired but proud',
  'Improve: estimate with the whole team',
  'Flaky CI on Fridays\nneeds an owner',
  'Release notes were late again',
  'Too many meetings on Tuesday',
  'Unclear priorities mid-sprint',
  'Dashboards load slowly',
  'Stop: last-minute scope changes',
  'Onboarding doc is out of date',
  'Question: who owns the design system?',
];

/** Grid of the "went well" cluster: columns and rows, top-left corners in world units. */
export const SELECTION_GRID = { columns: 4, rows: 3, left: -1250, top: -750, pitch: 230 };

/**
 * Story 7's 20-note retro board in two clusters: a tidy 4 × 3 "went well" grid (`grid[row][col]`,
 * 30 units apart) and 8 overlapping "to improve" notes stacked left to right.
 */
export function selectionBoard(): BoardFixture & { grid: string[][]; overlapping: string[] } {
  const board = recording();
  const { doc } = board;
  const { columns, rows, left, top, pitch } = SELECTION_GRID;
  const half = STICKY_SIZE_WORLD / 2;
  let n = 0;
  const grid: string[][] = [];
  for (let r = 0; r < rows; r++) {
    grid.push([]);
    for (let c = 0; c < columns; c++) {
      const at = { x: left + c * pitch + half, y: top + r * pitch + half };
      const id = createSticky(doc, at, COLORS[2]) as string;
      getStickyText(doc, id)!.insert(0, CLUSTER_TEXTS[n++]);
      grid[r].push(id);
    }
  }
  const overlapping: string[] = [];
  for (let i = 0; i < 8; i++) {
    const at = { x: 100 + i * 140 + half, y: 100 + (i % 2) * 120 + half };
    const id = createSticky(doc, at, COLORS[i % 2 === 0 ? 1 : 4]) as string;
    getStickyText(doc, id)!.insert(0, CLUSTER_TEXTS[n++]);
    overlapping.push(id);
  }
  return { ...board, grid, overlapping };
}
