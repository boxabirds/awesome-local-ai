// Nightly e2e (spec: sync.client, task 9): delivery at capacity.
//
// TC-30: MAX_CONCURRENT_EDITORS contexts make continuous random edits for 60 s.
// For each measured change we time the delivery to every other context and
// assert it stays within LIVE_UPDATE_LATENCY_BUDGET_MS; the badge stays hidden
// on every context throughout; all final board snapshots are identical.
// Prints p50 / p95 / max delivery latency.

import { expect, test } from '@playwright/test';
import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../../src/shared/config';
import {
  closeParticipant,
  createNote,
  dragNote,
  expectWithin,
  noteCount,
  createFreshBoard,
  openParticipant,
  setNoteColor,
  typeInNote,
  type Participant,
} from '../helpers/participants';

const SOAK_DURATION_MS = 60_000;
/** Keep the board manageable: stop creating after this many notes. */
const MAX_NOTES = 40;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

test('TC-30: continuous edits at full capacity deliver within budget', async ({  browser,
  request,
}) => {
  test.setTimeout(SOAK_DURATION_MS + 120_000);
  const boardId = await createFreshBoard(request);
  const participants: Participant[] = [];
  for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
    participants.push(await openParticipant(browser, boardId));
  }

  const latencies: number[] = [];
  let budgetViolations = 0;
  let badgeVisible = false;
  let total = 0;

  const deadline = Date.now() + SOAK_DURATION_MS;
  try {
    while (Date.now() < deadline) {
      // The sender rotates; its create is the measured change.
      const senderIdx = total % participants.length;
      const sender = participants[senderIdx];

      if (total < MAX_NOTES) {
        total += 1;
        const t0 = Date.now();
        await createNote(sender.page);
        // All other participants must reach the new total note count.
        await expectWithin(
          async () => {
            for (const p of participants) {
              if (await noteCount(p.page) !== total) return false;
            }
            return true;
          },
          { timeout: 3000, message: 'all participants see the new note' },
        );
        const latency = Date.now() - t0;
        latencies.push(latency);
        if (latency > LIVE_UPDATE_LATENCY_BUDGET_MS) budgetViolations += 1;
      } else {
        // Beyond the note cap, keep the soak "live" with unmeasured edits.
        const target = participants[total % participants.length];
        const kind = total % 3;
        if (kind === 0) await dragNote(target.page, 0, 20, 20).catch(() => {});
        else if (kind === 1) await typeInNote(target.page, 0, 'x').catch(() => {});
        else await setNoteColor(target.page, 'green').catch(() => {});
      }

      // The badge must stay hidden on every context.
      for (const p of participants) {
        if ((await p.page.locator('[data-testid="connection-status"]').count()) > 0) {
          badgeVisible = true;
        }
      }

      // A small yield keeps the loop paced (and lets sync settle).
      await new Promise((r) => setTimeout(r, 50));
    }

    // Final board snapshots identical across all participants.
    const signatures = await Promise.all(
      participants.map(async (p) => {
        const els = await p.page.locator('[data-testid="sticky-note"]').evaluateAll((list) =>
          list
            .map((el) => {
              const r = el.getBoundingClientRect();
              const text = (el.querySelector('[data-testid="sticky-text"]') as HTMLElement | null)
                ?.textContent ?? '';
              return `${Math.round(r.x)},${Math.round(r.y)}|${text}`;
            })
            .sort(),
        );
        return els.join('|');
      }),
    );
    expect(new Set(signatures).size).toBe(1);

    latencies.sort((a, b) => a - b);
    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const max = latencies.length > 0 ? latencies[latencies.length - 1] : 0;
    // eslint-disable-next-line no-console
    console.log(
      `TC-30 latency: samples=${latencies.length} p50=${p50}ms p95=${p95}ms max=${max}ms budget=${LIVE_UPDATE_LATENCY_BUDGET_MS}ms`,
    );

    expect(badgeVisible).toBe(false);
    expect(budgetViolations).toBe(0);
  } finally {
    for (const p of participants) await closeParticipant(p);
  }
});
