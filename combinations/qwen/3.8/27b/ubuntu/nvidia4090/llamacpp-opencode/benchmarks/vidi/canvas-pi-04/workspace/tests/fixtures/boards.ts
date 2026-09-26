// Story 4: realistic board fixtures, generated with the real board-model
// functions so every produced byte is a genuine Yjs update (design "tests":
// "fixtures: ... realistic boards (e.g. a 25-note retro board and a 2000-note
// large board), damaged-update variants (truncated, random bytes)").
//
// Deterministic: a seeded PRNG picks positions, colours, texts and stacking,
// so the same fixture generates the same updates on every run (ids and
// timestamps are the only non-deterministic parts, and they travel inside
// the update bytes).

import * as Y from 'yjs';
import {
  bringToFront,
  createStickyAt,
  getStickyText,
  moveObject,
  snapshot,
} from '../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../src/shared/config';

export interface GeneratedBoard {
  doc: Y.Doc;
  noteCount: number;
  /** The incremental Yjs update bytes that produced the board, in order. */
  updates: Uint8Array[];
  /** The full-state snapshot of the finished board. */
  snapshot: Uint8Array;
}

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

/** mulberry32: a small deterministic PRNG (stable across node/workerd). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Realistic English text bank (sprint-retro / engineering-notes flavour).
// ---------------------------------------------------------------------------

const SHORT_TEXTS = [
  'Fix flaky login test',
  'Ship the dark mode toggle',
  'Review the payments PR',
  'Upgrade the CI runners',
  'Draft the postmortem',
  'Tune the query cache',
  'Split the billing module',
  'Add usage metrics',
  'Prune the feature flags',
  'Rotate the API keys',
  'Trim the bundle size',
  'Fix the onboarding typo',
];

const MEDIUM_TEXTS = [
  'The onboarding flow dropped two days behind after the design review changed the step order.',
  'Code review queue backed up over the weekend; two PRs waited more than a day for a first pass.',
  'The soak suite caught a connection leak in the payments pipeline before it reached staging.',
  'We should split the release notes per area so each team owns what they shipped.',
  'The new table view is much faster but the keyboard shortcuts collide with the browser.',
  'Pair on the flaky payment test; it only fails on the eu-west runner and never locally.',
  'Draft the runbook for the cache invalidation job before the next on-call rotation.',
  'The feature flag dashboard needs per-team ownership, otherwise nobody prunes stale flags.',
  'Metrics for the export pipeline are missing p95 latency; add it before we set SLOs.',
  'The migration script double-ran on one tenant; the guard for concurrent runs is missing.',
  'Accessibility pass on the new settings page: focus order and contrast on the toggle states.',
  'The build cache went stale after the lockfile bump; document how to force a clean build.',
];

const LONG_TEXTS = [
  'The payments pipeline started failing intermittently under load after we bumped the connection pool from 10 to 50; the retry storm then amplified it. Reproduce with the soak suite, add a circuit breaker, and only then restore the full pool size so we can watch the error rate for two days before closing this out.',
  'Onboarding drop-off jumped 12% the week we shipped the new step order. The instrumentation shows most of the loss is on the third step where the email field and the team name swapped places. We need to restore the old order behind a flag, verify the funnel recovers, and then decide whether the new design is worth an A/B test before we roll it back out.',
  'The flaky payment test only fails on the eu-west runner and never locally, which points at clock skew between the test container and the payment mock. The mock signs tokens with a five second tolerance and the runner images have NTP disabled. Enable NTP on the runner image, keep the tolerance, and add a slow clock warning to the test output so the next incident is obvious instead of a one-day hunt.',
  'We keep shipping feature flags nobody owns. This retro we agreed on a simple rule: every flag gets an owner and an expiry date in the flag dashboard, the owner gets pinged a week before expiry, and anything that lapses gets auto-archived to a read-only tombstone so the code path can be deleted in the next cleanup pass without a data migration.',
  'The export pipeline p95 latency is still unmeasured and that blocks the SLO work for the reporting area. The current instrumentation only records counts, so the first step is to wire histogram metrics into the exporter, backfill two weeks of data from the logs, and then set the SLO candidate at the observed p95 plus one standard deviation before we discuss error budgets with the team.',
  'The migration script for the tenant table double-ran on one tenant because the lock table entry expired mid-run and a second copy picked it up. The guard needs to be a fenced token instead of a timestamp: the run claims a monotonically increasing fence, the worker validates the fence before every write batch, and any stale fence aborts the run with a loud error instead of silently corrupting the tenant rows.',
];

function textFor(rng: () => number): string {
  const roll = rng();
  if (roll < 0.25) {
    return SHORT_TEXTS[Math.floor(rng() * SHORT_TEXTS.length)]!;
  }
  if (roll < 0.7) {
    return MEDIUM_TEXTS[Math.floor(rng() * MEDIUM_TEXTS.length)]!;
  }
  return LONG_TEXTS[Math.floor(rng() * LONG_TEXTS.length)]!;
}

function addText(doc: Y.Doc, id: string, text: string): void {
  const live = getStickyText(doc, id);
  if (live !== undefined && text.length > 0) {
    live.insert(0, text);
  }
}

/**
 * Build a board of `count` notes with the given layout, collecting the
 * incremental update bytes as it goes.
 */
function buildBoard(
  seed: number,
  place: (rng: () => number, index: number) => { x: number; y: number; color: StickyColor; text: string },
  count: number,
): GeneratedBoard {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (update) => {
    updates.push(new Uint8Array(update));
  });
  const rng = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const { x, y, color, text } = place(rng, i);
    const id = createStickyAt(doc, x, y, color);
    addText(doc, id, text);
  }
  return {
    doc,
    noteCount: count,
    updates,
    snapshot: Y.encodeStateAsUpdate(doc),
  };
}

/** The world position of the deliberate overlap stack on the retro board. */
export const RETRO_STACK_POSITION = { x: -90, y: -480 };

/**
 * The 25-note "retro board" (TC-05, TC-07, TC-09, TC-19, TC-24): three
 * clusters, mixed colours, multi-line text, and a deliberate overlap stack
 * where four notes share exactly one position.
 *
 * The board is built by three simulated collaborators editing in sequence
 * (so the produced log is one ordered sequence, exactly like the room
 * stores it):
 *
 *   rows 1-7   ana  - notes 1-3 (create + text) and one move of note 1;
 *                     she never edits again after row 7,
 *   rows 8-51  ben  - notes 4-25 (create + text),
 *   rows 52-56 caro - multi-line text on notes 1-3 and the re-stack of the
 *                     overlap stack.
 *
 * The split is load-semantics-driven, not just realism: Yjs chains each
 * client's items by clock, and its integrator discards every later item of a
 * client once it hits a gap ("dead wall" in yjs integrateStructs). So a
 * quarantined middle row loses all later rows of the same client. Row 7 is
 * ana's LAST update, so quarantining it (TC-09) loses only that move and
 * all 25 notes survive - the design's "all other notes present".
 */
export function generateRetroBoard(): GeneratedBoard {
  const ana = new Y.Doc();
  const ben = new Y.Doc();
  const caro = new Y.Doc();
  const docs = [ana, ben, caro];
  const REMOTE = 'fixture-remote';
  const updates: Uint8Array[] = [];
  for (const doc of docs) {
    doc.on('update', (update, origin) => {
      if (origin === REMOTE) return;
      updates.push(new Uint8Array(update));
      for (const other of docs) {
        if (other !== doc) {
          Y.applyUpdate(other, update, REMOTE);
        }
      }
    });
  }

  const rng = mulberry32(20240501);
  const OVERLAP: ReadonlySet<number> = new Set([10, 13, 16, 19]);
  const place = (i: number): { x: number; y: number; color: StickyColor; text: string } => {
    // Three cluster centres in a loose row.
    const cluster = i % 3;
    const cx = -900 + cluster * 900;
    const cy = (Math.floor(i / 3) % 3 - 1) * 420;
    if (OVERLAP.has(i)) {
      return {
        x: RETRO_STACK_POSITION.x,
        y: RETRO_STACK_POSITION.y,
        color: COLORS[(i + cluster) % COLORS.length]!,
        text: textFor(rng),
      };
    }
    return {
      x: cx - 90 + Math.floor(rng() * 8) * 260,
      y: cy - 60 + Math.floor(rng() * 3) * 240,
      color: COLORS[Math.floor(rng() * COLORS.length)]!,
      text: textFor(rng),
    };
  };

  // ana: notes 1-3 (rows 1-6), then one move of note 1 (row 7), then she
  // leaves the room and never updates again.
  const anaIds: string[] = [];
  let firstPos = { x: 0, y: 0 };
  for (let i = 0; i < 3; i++) {
    const { x, y, color, text } = place(i);
    if (i === 0) firstPos = { x, y };
    const id = createStickyAt(ana, x, y, color);
    anaIds.push(id);
    addText(ana, id, text);
  }
  moveObject(ana, anaIds[0]!, firstPos.x + 40, firstPos.y + 25);

  // ben: notes 4-25 (rows 8-51).
  for (let i = 3; i < 25; i++) {
    const { x, y, color, text } = place(i);
    const id = createStickyAt(ben, x, y, color);
    addText(ben, id, text);
  }

  // caro: multi-line text on the first note of each cluster, then re-stack
  // the overlap (bottom-up in the current z-order: bring the third one to
  // the front, then the first, so the final order of the four-note stack is
  // (first, third, second, fourth)).
  const notes = snapshot(caro);
  for (const i of [0, 1, 2]) {
    const note = notes[i];
    if (note !== undefined) {
      const live = getStickyText(caro, note.id);
      if (live !== undefined) {
        live.insert(live.length, '\n(added in the retro)');
      }
    }
  }
  const stack = notes.filter(
    (n) => n.x === RETRO_STACK_POSITION.x && n.y === RETRO_STACK_POSITION.y,
  );
  if (stack.length >= 3) {
    bringToFront(caro, stack[2]!.id);
    bringToFront(caro, stack[0]!.id);
  }

  return {
    doc: ana, // fully synced; identical to ben and caro
    noteCount: 25,
    updates,
    snapshot: Y.encodeStateAsUpdate(ana),
  };
}

/**
 * The large board (TC-08, TC-21): `count` notes laid out as clusters of 80
 * on a 5x5 grid (4000px spacing), jittered inside each cluster. Text lengths
 * follow the 25/45/30 short/medium/long mix so the snapshot is ~1MB-class.
 */
export function generateLargeBoard(count: number = 2000): GeneratedBoard {
  const perCluster = 80;
  const clusters = Math.ceil(count / perCluster);
  const grid = Math.ceil(Math.sqrt(clusters));
  return buildBoard(
    20240502,
    (rng, i) => {
      const cluster = Math.floor(i / perCluster);
      const col = cluster % grid;
      const row = Math.floor(cluster / grid);
      const cx = (col - grid / 2) * 4000;
      const cy = (row - grid / 2) * 4000;
      return {
        x: cx + Math.floor(rng() * 11) * 220 - 1100,
        y: cy + Math.floor(rng() * 8) * 230 - 800,
        color: COLORS[(cluster + Math.floor(rng() * 2)) % COLORS.length]!,
        text: textFor(rng),
      };
    },
    count,
  );
}

