/**
 * Nightly e2e (story 3, task 9): long-running sync.client verification that is
 * too slow for every commit. Runs via `test:e2e:nightly` (the `@nightly` tag),
 * excluded from the default `test:e2e` run.
 *
 * - TC-29: an idle connection stays `connected` (the badge never shows
 *   "Reconnecting…") for 45 s.
 * - TC-30: full capacity (MAX_CONCURRENT_EDITORS) makes continuous seeded
 *   random edits for 60 s; every change converges, final snapshots are
 *   identical, and a sender→receiver latency report (p50/p95/max) is printed
 *   against LIVE_UPDATE_LATENCY_BUDGET_MS. Latency is reported, never asserted.
 *
 * Both are tagged `@nightly` so the default e2e run skips them.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import {
  openParticipants,
  createNote,
  moveNote,
  recolorNote,
  deleteNote,
  noteCount,
  boardSnapshot,
  connectionState,
  connectionStateLog,
  type Participant,
} from './helpers/participants';
import { setCamera } from './helpers/board';
import {
  MAX_CONCURRENT_EDITORS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../src/shared/config';

/** Deterministic PRNG (LCG) so nightly runs are reproducible. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** Percentile (0-100) of an ascending-sorted array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/** True when every participant reports the identical board snapshot. */
async function allSnapshotsIdentical(parts: Participant[]): Promise<boolean> {
  const ref = await boardSnapshot(parts[0].page);
  for (let i = 1; i < parts.length; i++) {
    if ((await boardSnapshot(parts[i].page)) !== ref) return false;
  }
  return true;
}

/**
 * Cheap convergence pre-check: all participants show the same note count.
 * (A move/recolour/type does not change the count, so this is a fast proxy
 * used per-edit; the full snapshot comparison is reserved for the end.)
 */
async function countsMatch(parts: Participant[]): Promise<boolean> {
  const c = await noteCount(parts[0].page);
  for (let i = 1; i < parts.length; i++) {
    if ((await noteCount(parts[i].page)) !== c) return false;
  }
  return true;
}

test.describe('@nightly idle & capacity', () => {
  test('TC-29: idle connection stays connected for 45s (badge never Reconnecting)', async ({
    browser,
  }: { browser: Browser }) => {
    test.setTimeout(120_000);
    const [a, b] = await openParticipants(browser, 2);
    try {
      // Both must reach `connected` before the idle window starts.
      await a.page.waitForFunction(
        () => (window as { __vidi6?: { connectionState: string } }).__vidi6?.connectionState === 'connected',
      );
      await b.page.waitForFunction(
        () => (window as { __vidi6?: { connectionState: string } }).__vidi6?.connectionState === 'connected',
      );

      // Idle for 45 s, sampling the mapped state throughout.
      const IDLE_MS = 45_000;
      const start = Date.now();
      let leftConnected = false;
      while (Date.now() - start < IDLE_MS) {
        if ((await connectionState(a.page)) !== 'connected' || (await connectionState(b.page)) !== 'connected') {
          leftConnected = true;
          break;
        }
        await a.page.waitForTimeout(2000);
      }
      expect(leftConnected, 'connection left `connected` while idle').toBe(false);
      expect(await connectionState(a.page)).toBe('connected');
      expect(await connectionState(b.page)).toBe('connected');
      // The full state log never contains a reconnect.
      expect(await connectionStateLog(a.page)).not.toContain('reconnecting');
      expect(await connectionStateLog(b.page)).not.toContain('reconnecting');
    } finally {
      await a.close();
      await b.close();
    }
  });

  test('TC-30: capacity soak — 5 editors, 60s random edits, identical snapshots + latency report', async ({
    browser,
  }: { browser: Browser }) => {
    test.setTimeout(240_000);
    const n = MAX_CONCURRENT_EDITORS;
    const parts = await openParticipants(browser, n);
    const rng = makeRng(0x5eed);
    const latencies: number[] = [];
    // A grid of non-overlapping creation points at 50% zoom (notes are 200
    // world units ≈ 100px on screen; 120px spacing keeps dblclicks on empty).
    const grid: Array<{ x: number; y: number }> = [];
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        grid.push({ x: 240 + c * 120, y: 160 + r * 120 });
      }
    }
    let gridCursor = 0;

    try {
      for (const p of parts) {
        await setCamera(p.page, { x: -640, y: -400, zoom: 0.5 });
      }

      const SOAK_MS = 60_000;
      const start = Date.now();
      let edits = 0;
      // Seed a few notes so move/type/recolour/delete have targets.
      for (let i = 0; i < 6; i++) {
        const pt = grid[gridCursor++ % grid.length];
        await createNote(parts[i % n].page, pt.x, pt.y, `seed${i}`);
      }
      await parts[0].page.waitForFunction(
        async () => (await (async () => document.querySelectorAll('[data-testid="sticky-note"]').length)()) >= 6,
      );

      // One random edit on a random editor. Individual UI operations are
      // best-effort: a dblclick can land on a neighbour, a textarea can be slow
      // to appear, etc. A failed edit is skipped (not counted) so one flake
      // cannot sink the whole soak.
      const randomEdit = async (): Promise<boolean> => {
        const editor = parts[Math.floor(rng() * n)];
        const kind = Math.floor(rng() * 5);
        const count = await noteCount(editor.page);
        try {
          if (kind === 0 || count === 0) {
            const pt = grid[gridCursor++ % grid.length];
            await createNote(editor.page, pt.x, pt.y, `e${edits}`);
          } else if (kind === 1) {
            await moveNote(editor.page, Math.floor(rng() * count), 40, 40);
          } else if (kind === 2) {
            const idx = Math.floor(rng() * count);
            const ta = editor.page.locator('[data-testid="sticky-textarea"]');
            await editor.page.locator('[data-testid="sticky-note"]').nth(idx).dblclick();
            await ta.waitFor({ state: 'visible', timeout: 4000 });
            await ta.pressSequentially(`x${edits}`, { delay: 5 });
            await editor.page.keyboard.press('Escape');
          } else if (kind === 3) {
            const swatches = ['swatch-blue', 'swatch-green', 'swatch-pink', 'swatch-violet'];
            await recolorNote(editor.page, Math.floor(rng() * count), swatches[Math.floor(rng() * swatches.length)]);
          } else {
            await deleteNote(editor.page, Math.floor(rng() * count));
          }
          return true;
        } catch {
          // Deselect / close any half-open editor so the board settles.
          await editor.page.keyboard.press('Escape').catch(() => {});
          return false;
        }
      };

      while (Date.now() - start < SOAK_MS) {
        const t0 = Date.now();
        const ok = await randomEdit();
        if (ok) {
          // Measure sender→receiver convergence (cheap count check): time until
          // every context shows the same note count. Reported, never asserted.
          let converged = false;
          while (Date.now() - t0 < 3000) {
            if (await countsMatch(parts)) {
              converged = true;
              break;
            }
            await parts[0].page.waitForTimeout(50);
          }
          if (converged) latencies.push(Date.now() - t0);
          edits++;
        }
      }

      // Settle: close any half-open editor / deselect on every context so the
      // final snapshot is a clean, comparable state.
      for (const p of parts) {
        await p.page.keyboard.press('Escape').catch(() => {});
        await p.page.mouse.click(15, 790).catch(() => {});
      }
      // Then require identical final snapshots (full comparison, less frequent).
      const deadline = Date.now() + 30_000;
      let identical = false;
      while (Date.now() < deadline) {
        if (await allSnapshotsIdentical(parts)) {
          identical = true;
          break;
        }
        await parts[0].page.waitForTimeout(500);
      }
      if (!identical) {
        for (let i = 0; i < n; i++) {
          console.log(`[final-snap] P${i} count=${await noteCount(parts[i].page)} snap=${JSON.stringify(await boardSnapshot(parts[i].page))}`);
        }
      }
      expect(identical, 'final board snapshots differ across the 5 editors').toBe(true);

      // Latency report (never asserted).
      const sorted = [...latencies].sort((x, y) => x - y);
      const p50 = percentile(sorted, 50);
      const p95 = percentile(sorted, 95);
      const max = sorted.length ? sorted[sorted.length - 1] : 0;
      console.log(
        `[latency-report] edits=${edits} samples=${latencies.length} ` +
          `p50=${p50}ms p95=${p95}ms max=${max}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms — reported only)`,
      );

      // Teardown contract: each context's log ends in a stable state (destroy()
      // stops the provider, so no reconnect is pending when it is closed).
      for (const p of parts) {
        const log = await connectionStateLog(p.page);
        expect(log[log.length - 1], 'last state before close should be stable').toBe('connected');
      }
    } finally {
      for (const p of parts) await p.close();
    }
  });
});
