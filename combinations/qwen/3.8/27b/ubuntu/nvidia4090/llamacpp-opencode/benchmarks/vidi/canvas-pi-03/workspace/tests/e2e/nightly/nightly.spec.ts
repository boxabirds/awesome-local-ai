import { test, expect, type Page } from '@playwright/test';
import {
  newBoardId,
  openBoard,
  closeAll,
  waitForSynced,
  setCamera,
  createNoteAt,
  recolorNote,
  editNote,
  deleteNote,
  getNotes,
  getNote,
  getConnectionState,
  getBadgeText,
  notesKey,
  LIVE_UPDATE_LATENCY_BUDGET_MS as BUDGET,
  MAX_CONCURRENT_EDITORS,
  type Participant,
} from '../participants';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Deterministic PRNG + pools for the seeded random edits.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];
const COLORS = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
// Distinct screen cells (at zoom 0.5 notes are ~100px) so concurrent edits never
// overlap — overlapping notes make click-to-target ops flaky.
const GRID = [
  { x: 220, y: 200 },
  { x: 440, y: 200 },
  { x: 660, y: 200 },
  { x: 220, y: 440 },
  { x: 440, y: 440 },
];

/** Measures sender->receiver latency for one change (per receiver, in parallel). */
async function measureTo(others: Participant[], record: (ms: number) => void, check: (page: Page) => Promise<boolean>): Promise<void> {
  const t0 = Date.now();
  const results = await Promise.all(
    others.map(async (o) => {
      const start = Date.now();
      while (Date.now() - start < BUDGET) {
        if (await check(o.page)) return Date.now() - t0;
        await sleep(100);
      }
      return Date.now() - t0; // exceeded budget
    }),
  );
  for (const ms of results) record(ms);
}

/**
 * One participant's continuous editing loop until `until`. Each participant
 * owns exactly one note (one-writer-per-note) on its own grid cell, so there
 * are no cross-note races and no overlap. Ops: recolor, type, delete (+
 * recreate). The owned note id is tracked and refreshed across deletes.
 */
async function editLoop(
  p: Participant,
  others: Participant[],
  until: number,
  seed: number,
  home: { x: number; y: number },
  initialId: string,
  record: (ms: number) => void,
): Promise<void> {
  const rnd = mulberry32(seed);
  let id: string | null = initialId;
  while (Date.now() < until) {
    try {
      // Ensure the owned note exists (recreate if it was deleted).
      if (id === null || (await getNote(p.page, id)) === null) {
        const createdId = await createNoteAt(p.page, home.x, home.y);
        id = createdId;
        await measureTo(others, record, (op) => (getNote(op, createdId)).then((n) => n !== null));
        continue;
      }
      const curId = id; // string: the null case is handled above
      const r = rnd();
      if (r < 0.6) {
        const color = COLORS[Math.floor(rnd() * COLORS.length)];
        await recolorNote(p.page, curId, color);
        await measureTo(others, record, (op) => (getNote(op, curId)).then((n) => n?.color === color));
      } else if (r < 0.8) {
        const word = WORDS[Math.floor(rnd() * WORDS.length)];
        await editNote(p.page, curId, 'end', word);
        await measureTo(others, record, (op) => (getNote(op, curId)).then((n) => (n?.text ?? '').includes(word)));
      } else {
        await deleteNote(p.page, curId);
        await measureTo(others, record, (op) => (getNote(op, curId)).then((n) => n === null));
        id = null;
      }
      await sleep(700);
    } catch {
      await sleep(400);
    }
  }
}

test.describe('Nightly: sync.client long-running verification (chromium, real wrangler dev)', () => {
  // These are long-running, context-heavy tests (2 + 5 browser contexts). Run
  // them serially so their contexts never overlap and contend for the browser.
  test.describe.configure({ mode: 'serial' });

  test('TC-29: idle 45s -> stays connected, badge never shows Reconnecting/Connecting', async ({ browser }) => {
    test.setTimeout(90_000);
    const boardId = newBoardId();
    const a = await openBoard(browser, boardId);
    const b = await openBoard(browser, boardId);
    const badStates: string[] = [];
    const badBadges: string[] = [];
    try {
      const tEnd = Date.now() + 45_000;
      while (Date.now() < tEnd) {
        for (const p of [a, b]) {
          const state = await getConnectionState(p.page);
          if (state !== 'connected' && state !== 'confirmed') badStates.push(state);
          const badge = await getBadgeText(p.page);
          if (badge === 'Reconnecting…' || badge === 'Connecting…') badBadges.push(badge);
        }
        await sleep(400);
      }
    } finally {
      await closeAll(a, b);
    }
    expect(badStates, `unexpected states: ${badStates.join(',')}`).toHaveLength(0);
    expect(badBadges, `unexpected badges: ${badBadges.join(',')}`).toHaveLength(0);
  });

  test('TC-30: 60s capacity soak -> latencies within budget, badge hidden, snapshots identical', async ({ browser }) => {
    test.setTimeout(240_000);
    const boardId = newBoardId();
    const N = MAX_CONCURRENT_EDITORS;
    const parts: Participant[] = [];
    for (let i = 0; i < N; i++) parts.push(await openBoard(browser, boardId));
    for (const p of parts) {
      await setCamera(p.page, { x: -640, y: -360, zoom: 0.5 });
      await waitForSynced(p.page);
    }

    const latencies: number[] = [];
    const record = (ms: number) => latencies.push(ms);
    const badgeViolations: string[] = [];
    const SOAK_MS = 60_000;
    const until = Date.now() + SOAK_MS;

    // Seed: each participant creates its own note on a distinct grid cell.
    const homeIds: string[] = [];
    for (let i = 0; i < N; i++) {
      const id = await createNoteAt(parts[i].page, GRID[i].x, GRID[i].y);
      homeIds.push(id);
      await measureTo(parts.filter((q) => q !== parts[i]), record, (op) => (getNote(op, id)).then((n) => n !== null));
    }

    // Concurrent badge/state monitor.
    const monitor = (async () => {
      while (Date.now() < until) {
        for (let i = 0; i < N; i++) {
          const badge = await getBadgeText(parts[i].page);
          const state = await getConnectionState(parts[i].page);
          if (badge === 'Reconnecting…' || badge === 'Connecting…') badgeViolations.push(`${i}:${badge}`);
          else if (state !== 'connected' && state !== 'confirmed') badgeViolations.push(`${i}:state=${state}`);
        }
        await sleep(1000);
      }
    })();

    // Continuous seeded edits: each participant owns its grid note (one-writer-per-note).
    await Promise.all(parts.map((p, i) => editLoop(p, parts.filter((q) => q !== p), until, 4242 + i, GRID[i], homeIds[i], record)));
    await monitor;

    // Final convergence: all board snapshots identical.
    await expect
      .poll(
        async () => {
          const keys = new Set<string>();
          for (const p of parts) keys.add(notesKey(await getNotes(p.page)));
          return keys.size === 1;
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    const outOfBudget = latencies.filter((l) => l > BUDGET);
    expect(latencies.length, 'measured at least one change').toBeGreaterThan(0);
    expect(outOfBudget, `latencies over budget: ${outOfBudget.slice(0, 10).join(',')}`).toHaveLength(0);
    expect(badgeViolations, `badge violations: ${badgeViolations.slice(0, 10).join(',')}`).toHaveLength(0);

    const sorted = [...latencies].sort((x, y) => x - y);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const max = sorted[sorted.length - 1];
    console.log(`[TC-30] samples=${latencies.length} p50=${p50}ms p95=${p95}ms max=${max}ms budget=${BUDGET}ms notes=${(await getNotes(parts[0].page)).length}`);

    // Teardown: close one participant; the rest stay connected and functional.
    await parts[0].context.close();
    await expect
      .poll(async () => {
        for (const p of parts.slice(1)) {
          const s = await getConnectionState(p.page);
          if (s !== 'connected' && s !== 'confirmed') return false;
        }
        return true;
      }, { timeout: 10_000 })
      .toBe(true);

    await closeAll(...parts.slice(1));
  });
});
