import { expect, test } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS } from '../../../src/shared/config';
import { drag } from '../helpers/board';
import { boardState, closeAll, logLatencyReport, notes, openParticipants } from '../helpers/participants';

test('TC-29: an idle connection never shows Reconnecting…', async ({ browser }) => {
  test.setTimeout(120_000);
  const { people } = await openParticipants(browser, ['Alex', 'Sam']);
  const seen: string[] = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 45_000) {
    for (const p of people) {
      seen.push(await p.page.evaluate(() => window.__vidi6?.connectionState ?? 'missing'));
      await expect(p.page.getByText('Reconnecting…')).toHaveCount(0);
    }
    await people[0].page.waitForTimeout(500);
  }
  expect(new Set(seen)).toEqual(new Set(['connected']));
  await closeAll(people);
});

test('TC-30: capacity soak converges; latency is reported, not asserted', async ({ browser }) => {
  test.setTimeout(240_000);
  const seed = Number(process.env.SEED ?? Date.now() % 100000);
  console.log(`TC-30 seed ${seed}`);
  const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `P${i + 1}`);
  const { people } = await openParticipants(browser, names, { zoom: 0.5 });
  // Each person owns one horizontal band so random edits never land on someone else's note.
  const band = (i: number) => 60 + i * 140;
  let s = seed;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const latencies: number[] = [];
  const colours = ['Green colour', 'Blue colour', 'Pink colour', 'Orange colour'];

  const worker = async (i: number) => {
    const page = people[i].page;
    const mine: { x: number; y: number }[] = [];
    const end = Date.now() + 60_000;
    while (Date.now() < end) {
      const r = rand();
      if (mine.length === 0 || r < 0.15) {
        const at = { x: 160 + mine.length * 110, y: band(i) };
        if (mine.length >= 9) continue;
        await page.mouse.dblclick(at.x, at.y);
        await page.keyboard.type(`s${i}`);
        await page.keyboard.press('Escape');
        mine.push(at);
      } else if (r < 0.55) {
        const n = mine[Math.floor(rand() * mine.length)];
        await page.mouse.dblclick(n.x, n.y);
        await page.keyboard.type('w ');
        await page.keyboard.press('Escape');
      } else if (r < 0.85) {
        const n = mine[Math.floor(rand() * mine.length)];
        await drag(page, n, 0, 10);
        n.y += 10;
        if (n.y > band(i) + 20) await drag(page, n, 0, -10), (n.y -= 10);
      } else {
        const n = mine[Math.floor(rand() * mine.length)];
        await page.mouse.click(n.x, n.y);
        // Direct DOM click: a neighbour's note can overlap this toolbar at 50% zoom.
        await page.getByRole('button', { name: colours[Math.floor(rand() * colours.length)] }).evaluate((el) => (el as HTMLElement).click());
        await page.mouse.click(1200, 780);
      }
    }
  };
  await Promise.all(people.map((_, i) => worker(i)));

  const t0 = Date.now();
  await expect
    .poll(
      async () => {
        const states = await Promise.all(people.map((p) => boardState(p.page)));
        return states.every((st) => JSON.stringify(st) === JSON.stringify(states[0]));
      },
      { timeout: E2E_EVENTUAL_TIMEOUT_MS * 2 },
    )
    .toBe(true);
  latencies.push(Date.now() - t0);
  console.log(`[latency] final convergence after last edit: ${Date.now() - t0} ms; notes: ${await notes(people[0].page).count()}`);
  logLatencyReport(latencies);
  await closeAll(people);
});
