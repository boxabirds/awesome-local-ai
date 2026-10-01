// Story 3 nightly end-to-end: the two long-running cases the design excludes from
// the per-commit suite.
//
//   TC-29 Two idle editors: with no user activity for IDLE_KEEPALIVE_TEST_MS, the
//         status badge never renders "Reconnecting" and the mapped ConnectionState
//         never leaves `connected` (the room's periodic awareness relay keeps the
//         sockets open past the provider's 30s no-message reconnect timeout).
//
//   TC-30 Full-capacity soak: MAX_CONCURRENT_EDITORS editors make continuous
//         seeded random edits through the real UI for SOAK_DURATION_MS. Every
//         change converges on every editor and the final snapshots are identical.
//         Sender-to-receiver latency is measured and reported (p50/p95/max) but
//         NEVER asserted, because the model, browsers and server share one machine.
//         Closing a context calls destroy(); we assert no reconnect follows.
//
// These are excluded from `npm run test:e2e` (its `--grep-invert @nightly`) and
// run via `npm run test:e2e:nightly`. They wait in real time, so the per-test
// timeout is raised above the soak.

import { test, expect, type Browser, type Page } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  IDLE_KEEPALIVE_TEST_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  SOAK_DURATION_MS,
  STICKY_COLORS,
} from '../../src/shared/config';
import {
  badgeLog,
  badgeState,
  connectionState,
  content,
  createBoard,
  createNote,
  deleteNote,
  destroyConnection,
  dragNoteTo,
  editNote,
  noteCount,
  openBoard,
  reconnectCount,
  recolourNote,
  sleep,
  stateLog,
  waitForContentsMatch,
  watchBadge,
} from './helpers/live';

test.setTimeout(240_000);

const COLOR_NAMES = Object.keys(STICKY_COLORS);

/** mulberry32: a tiny deterministic PRNG, so the soak's op sequence is seedable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function openMany(browser: Browser, n: number, boardId: string): Promise<Page[]> {
  const pages: Page[] = [];
  for (let i = 0; i < n; i++) pages.push(await openBoard(browser, boardId));
  await waitForContentsMatch(pages, E2E_EVENTUAL_TIMEOUT_MS);
  return pages;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx]!;
}

function reportLatency(latencies: number[]): void {
  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const max = sorted[sorted.length - 1] ?? 0;
  console.log(
    `[latency] TC-30 ${latencies.length} changes; p50=${p50}ms p95=${p95}ms max=${max}ms ` +
      `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms; reported, not asserted)`,
  );
  // Guard only the degenerate case: a soak that measured nothing ran no changes.
  expect(latencies.length).toBeGreaterThan(0);
}

test('@nightly TC-29 idle editors never show Reconnecting', async ({ browser, request }) => {
  const boardId = await createBoard(request);
  const [alex, sam] = await openMany(browser, 2, boardId);
  await watchBadge(alex);

  // Both settle to the hidden, connected state before the idle window begins.
  await expect.poll(() => connectionState(alex), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe('connected');
  await expect.poll(() => connectionState(sam), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe('connected');
  const before = (await stateLog(alex)).length;

  // Idle for longer than the provider's no-message reconnect timeout. The badge
  // log and the mapped-state log record every transition, not just sampled ones.
  await sleep(IDLE_KEEPALIVE_TEST_MS);

  const appendedStates = (await stateLog(alex)).slice(before);
  expect(appendedStates.filter((s) => s !== 'connected'), 'mapped ConnectionState left connected while idle').toEqual(
    [],
  );
  const appendedBadges = (await badgeLog(alex)).map((b) => b.state);
  expect(appendedBadges).not.toContain('reconnecting');
  expect(appendedBadges).not.toContain('connecting');

  await expect.poll(() => badgeState(alex)).toBe('connected');
  await expect.poll(() => connectionState(alex)).toBe('connected');
});

test('@nightly TC-30 full-capacity soak converges and reports latency', async ({ browser, request }) => {
  const boardId = await createBoard(request);
  const pages = await openMany(browser, MAX_CONCURRENT_EDITORS, boardId);

  // Notes live on a spread-out grid so peers' notes never pile up on one spot
  // (overlapping notes make a selected note's colour button unclickable) and
  // never drift off-screen (moves are absolute, onto a grid cell). The live
  // count is capped under the number of cells, so cells stay effectively empty.
  const CAP = 8;
  const CELLS: { x: number; y: number }[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) CELLS.push({ x: 140 + c * 260, y: 150 + r * 240 });

  const rng = mulberry32(0xc0ffee);
  const latencies: number[] = [];
  const soakStart = Date.now();
  let change = 0;
  let createSeq = 0;

  // Continuous seeded random edits through the real UI, round-robin across the
  // editors. Each change is allowed to reach every editor before the next, so
  // its end-to-end latency can be measured; convergence is what is asserted.
  while (Date.now() - soakStart < SOAK_DURATION_MS) {
    const page = pages[change % pages.length]!;
    const count = await noteCount(page);
    const roll = rng();
    const index = count > 0 ? Math.floor(rng() * count) : 0;

    let op: string;
    if (count === 0) op = 'create';
    else if (roll < 0.3) op = count < CAP ? 'create' : 'move';
    else if (roll < 0.55) op = 'move';
    else if (roll < 0.75) op = 'type';
    else if (roll < 0.9) op = 'recolour';
    else op = 'delete';

    if (op === 'create') {
      await createNote(page, CELLS[createSeq % CELLS.length]!, `n${change}`);
      createSeq += 1;
    } else if (op === 'move') {
      await dragNoteTo(page, index, CELLS[Math.floor(rng() * CELLS.length)]!);
    } else if (op === 'type') {
      await editNote(page, index);
      await page.keyboard.type(String.fromCharCode(97 + Math.floor(rng() * 26)));
      await page.keyboard.press('Escape');
    } else if (op === 'recolour') {
      await recolourNote(page, index, COLOR_NAMES[Math.floor(rng() * COLOR_NAMES.length)]!);
    } else {
      await deleteNote(page, index);
    }

    // Sender-to-receiver convergence latency for this change.
    const start = Date.now();
    await waitForContentsMatch(pages, E2E_EVENTUAL_TIMEOUT_MS);
    latencies.push(Date.now() - start);
    change += 1;
  }

  // Every editor's final board is byte-identical.
  await waitForContentsMatch(pages, E2E_EVENTUAL_TIMEOUT_MS);
  const final = await Promise.all(pages.map(content));
  const first = JSON.stringify(final[0]);
  expect(final.every((c) => JSON.stringify(c) === first)).toBe(true);

  reportLatency(latencies);

  // Closing a context calls destroy() (what unmounting its React tree does). It
  // must not leave the provider reconnecting behind.
  const reconnects = await reconnectCount(pages[0]!);
  await destroyConnection(pages[0]!);
  await sleep(4000);
  expect(await reconnectCount(pages[0]!)).toBe(reconnects);

  await Promise.all(pages.map((p) => p.context().close()));
});
