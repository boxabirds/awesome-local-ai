/**
 * Story 3 nightly e2e: long-running sync.client contract checks.
 *
 * - TC-29: idle connection stability (stays `connected` for 45 s).
 * - TC-30: delivery at capacity (60 s of edits across MAX_CONCURRENT_EDITORS).
 *
 * Both are timing-sensitive; run via `test:e2e:nightly` (excluded from the
 * default `test:e2e`). A failure here does not block the story.
 */
import { test, expect } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS } from 'src/shared/config';
import { openParticipants, createNote, expectWithin, BUDGET } from './helpers/participants';
import { setCamera } from './helpers/board';
import { getNotes } from './helpers/board';

const IDLE_SECONDS = 45;

test('TC-29: idle connection stays connected for 45 s (no Reconnecting badge)', async ({ browser }) => {
  test.setTimeout(90_000);
  const ps = await openParticipants(browser, 2);
  const a = ps[0];

  const states: string[] = [];
  const t0 = Date.now();
  while (Date.now() - t0 < IDLE_SECONDS * 1000) {
    const s = await a.page.evaluate(() => (window as any).__vidi6?.connectionState);
    states.push(s);
    await a.page.waitForTimeout(500);
  }

  // Never left `connected`.
  expect(states.every((s) => s === 'connected')).toBe(true);
  expect(new Set(states).size).toBe(1);
  // The badge is hidden the whole time.
  await expect(a.page.getByTestId('connection-status')).not.toBeVisible();

  // Close both idle contexts; destroy() should not log reconnect attempts.
  for (const p of ps) p.context.close();
});

test('TC-30: capacity soak 60 s — latency within budget, identical final boards', async ({ browser }) => {
  test.setTimeout(150_000);
  const ps = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
  const total = MAX_CONCURRENT_EDITORS;

  // Zoom out so a 5x5 grid of 200px notes fits on-screen without overlap.
  const ZOOM = 0.5;
  const CELL = 100; // screen px at ZOOM (=> 200 world, notes tile without overlap)
  const X0 = 140, Y0 = 120;
  for (const p of ps) {
    await setCamera(p.page, 0, 0, ZOOM);
  }

  const latencies: number[] = [];
  const soakMs = 60_000;
  const maxProbes = 25; // 5x5 grid
  const t0 = Date.now();
  let i = 0;

  // Sample every context's connection state throughout the soak; the badge must
  // stay hidden (state `connected`) on every context the whole time.
  const seenStates = new Set<string>();
  const sampler = (async () => {
    while (Date.now() - t0 < soakMs) {
      for (const p of ps) {
        const st = await p.page.evaluate(
          () => (window as any).__vidi6?.connectionState,
        );
        if (st) seenStates.add(st);
      }
      await ps[0].page.waitForTimeout(250);
    }
  })();

  // Continuous edits: each probe has one context create a note on its grid cell;
  // measure the time until the receiver's DOM shows it (a representative
  // per-change latency). Probes are spaced ~2 s apart for the 60 s window.
  while (Date.now() - t0 < soakMs && i < maxProbes) {
    const sender = ps[i % total];
    const victim = ps[(i + 1) % total];
    const before = (await getNotes(sender.page)).length;
    const start = Date.now();
    const col = i % 5;
    const row = Math.floor(i / 5);
    await createNote(sender.page, X0 + col * CELL, Y0 + row * CELL, `p${i}`);
    // Wait for the note to appear in the receiver.
    await expectWithin(async () => (await getNotes(victim.page)).length > before, true);
    latencies.push(Date.now() - start);
    i++;
    await sender.page.waitForTimeout(1000);
  }

  await sampler;
  // The badge stayed hidden on every context throughout (state never left `connected`).
  expect([...seenStates], `states seen: ${[...seenStates]}`).toEqual(['connected']);

  const sorted = [...latencies].sort((x, y) => x - y);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  console.log(
    `[TC-30] probes=${latencies.length} p50=${q(0.5)}ms p95=${q(0.95)}ms max=${max}ms budget=${BUDGET}ms`,
  );

  // Every probe landed within the live-update budget.
  for (const l of latencies) expect(l, `probe latency ${l}ms`).toBeLessThanOrEqual(BUDGET);

  // All final boards are identical (sorted by id).
  const snap = (pg: import('@playwright/test').Page) =>
    getNotes(pg).then((ns) => ns.map((n) => `${n.id}:${n.x},${n.y}`).sort());
  const ref = await snap(ps[0].page);
  for (const p of ps) {
    await expect.poll(() => snap(p.page), { timeout: BUDGET * 3 }).toEqual(ref);
  }

  for (const p of ps) p.context.close();
});
