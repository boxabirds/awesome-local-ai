import { expect, test } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS } from '../../../src/shared/config';
import { rng } from '../../integration/random-ops';
import { boardSnapshot, dragNote, latencies, notesOf, openParticipants } from '../helpers/participants';

const EMPTY_SPOT = { x: 1240, y: 780 };

test('TC-29 an idle connection stays connected for 45 s', async ({ browser }) => {
  test.setTimeout(120_000);
  const people = await openParticipants(browser, 2);
  const seen = new Set<string>();
  const end = Date.now() + 45_000;
  while (Date.now() < end) {
    for (const p of people) {
      seen.add(await p.page.evaluate(() => window.__vidi6?.connectionState ?? 'none'));
      await expect(p.page.getByText('Reconnecting…')).toHaveCount(0);
    }
    await people[0].page.waitForTimeout(1000);
  }
  expect([...seen]).toEqual(['connected']);
  // Closing a context destroys the provider; no console errors afterwards.
  for (const p of people) await p.context.close();
});

test('TC-30 capacity soak: 60 s of random edits converge', async ({ browser }) => {
  test.setTimeout(240_000);
  const people = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
  const rands = people.map((_, i) => rng(30_000 + i));
  console.log('TC-30 seeds', people.map((_, i) => 30_000 + i).join(','));
  const end = Date.now() + 60_000;
  let step = 0;
  while (Date.now() < end) {
    await Promise.all(people.map(async (p, i) => {
      const r = rands[i]();
      const count = await notesOf(p.page).count();
      if (count === 0 || r < 0.15) {
        await p.page.mouse.dblclick(100 + Math.floor(rands[i]() * 1000), 100 + Math.floor(rands[i]() * 600));
        await p.page.keyboard.type('soak');
        await p.page.mouse.click(EMPTY_SPOT.x, EMPTY_SPOT.y);
      } else if (r < 0.7) {
        await dragNote(p.page, notesOf(p.page).nth(Math.floor(rands[i]() * count)), 30, 20).catch(() => undefined);
      } else if (r < 0.85) {
        await notesOf(p.page).nth(Math.floor(rands[i]() * count)).click({ timeout: 2000 }).catch(() => undefined);
        await p.page.getByRole('button', { name: 'Pink colour' }).click({ timeout: 1000 }).catch(() => undefined);
      } else {
        await notesOf(p.page).nth(Math.floor(rands[i]() * count)).click({ timeout: 2000 }).catch(() => undefined);
        await p.page.keyboard.press('Delete');
      }
    }));
    step++;
  }
  console.log(`TC-30 ran ${step} rounds`);
  await expect.poll(async () => {
    const snaps = await Promise.all(people.map((p) => boardSnapshot(p.page)));
    return snaps.every((s) => JSON.stringify(s) === JSON.stringify(snaps[0]));
  }, { timeout: E2E_EVENTUAL_TIMEOUT_MS * 2 }).toBe(true);
  const sorted = [...latencies].sort((a, b) => a - b);
  const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))] ?? 0;
  console.log(`[latency] p50=${q(0.5)} p95=${q(0.95)} max=${sorted[sorted.length - 1] ?? 0} ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms, reported not asserted)`);
  for (const p of people) await p.context.close();
});
