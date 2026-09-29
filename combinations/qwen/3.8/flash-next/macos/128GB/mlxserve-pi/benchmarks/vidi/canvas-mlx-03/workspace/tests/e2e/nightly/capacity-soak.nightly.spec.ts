import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  openSharedBoard,
  noteTexts,
  connectionStatus,
} from '../helpers/board.ts';
import { newBoardId } from '../../../src/shared/board-id.ts';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS } from '../../../src/shared/config.ts';

// Design TC-30 (nightly): MAX_CONCURRENT_EDITORS contexts, each with its own
// provider, make continuous edits for ~60 s. For every change measure the time
// from the sender's DOM update to each receiver's DOM update; assert every
// per-change latency <= LIVE_UPDATE_LATENCY_BUDGET_MS, the badge stays hidden
// (connected) on every context, and all final snapshots are identical. Prints
// p50/p95/max.
//
// A failing run here does NOT block the story (per tasks.md): on one machine
// running the model, the browsers and the server at once these timings may not
// hold. The outcome is recorded in NOTES.md.
const STOP_STARTING_AT_MS = 48_000;

async function createNote(page: Page, text: string): Promise<void> {
  // Toolbar always creates a fresh note (no dblclick hit-test), then the just
  // created editor receives the typed text.
  await page.getByRole('button', { name: 'Sticky note' }).click();
  await page.getByTestId('sticky-text-editor').waitFor();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx]!;
}

test('TC-30 capacity soak: continuous edits at MAX_CONCURRENT_EDITORS within budget', async ({
  context,
}) => {
  test.setTimeout(150_000);
  const id = newBoardId();
  const pages: Page[] = [];
  for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
    const p = await context.newPage();
    await openSharedBoard(p, id);
    pages.push(p);
  }

  const latencies: number[] = [];
  const t0 = Date.now();
  let round = 0;
  while (Date.now() - t0 < STOP_STARTING_AT_MS) {
    const sender = pages[round % MAX_CONCURRENT_EDITORS]!;
    const text = `s${round}`;
    await createNote(sender, text);
    // Time from "now" to the sender seeing its own change (its committed DOM).
    await expect
      .poll(async () => (await noteTexts(sender)).includes(text), { timeout: 5_000, intervals: [20] })
      .toBe(true);
    const tSend = Date.now();

    // Time from the sender's commit to each receiver's DOM update.
    for (const r of pages) {
      if (r === sender) continue;
      await expect
        .poll(async () => (await noteTexts(r)).includes(text), { timeout: 5_000, intervals: [20] })
        .toBe(true);
      latencies.push(Date.now() - tSend);
    }

    // Badges must stay hidden (connected) throughout the soak.
    for (const p of pages) {
      if ((await connectionStatus(p).count()) > 0) {
        expect(await connectionStatus(p).isVisible()).toBe(false);
      }
    }
    round++;
  }

  const sorted = [...latencies].sort((x, y) => x - y);
  const max = sorted.length ? sorted[sorted.length - 1]! : 0;
  // eslint-disable-next-line no-console
  console.log(
    `\n[TC-30 soak] rounds=${round} samples=${latencies.length} ` +
      `p50=${percentile(sorted, 0.5)}ms p95=${percentile(sorted, 0.95)}ms max=${max}ms ` +
      `(budget=${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`,
  );

  // Every per-change latency within budget.
  expect(max, `max latency ${max}ms exceeds budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms`).toBeLessThanOrEqual(
    LIVE_UPDATE_LATENCY_BUDGET_MS,
  );

  // Final snapshots identical across every context; badges connected.
  const final = await noteTexts(pages[0]!);
  expect(final.length).toBeGreaterThan(0);
  for (const p of pages) {
    expect(await noteTexts(p)).toEqual(final);
    await expect(connectionStatus(p)).toBeHidden();
  }
});
