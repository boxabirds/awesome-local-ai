import { expect, test, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { setCamera } from './helpers/board';
import { closeAll, noteViews, openParticipants, report } from './helpers/participants';

const notes = (page: Page) => page.getByRole('group', { name: 'Sticky note' });

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('TC-29 an idle connection stays connected for 45 s', async ({ browser }) => {
  test.setTimeout(120_000);
  const { people } = await openParticipants(browser, 2);
  const seen = new Set<string>();
  const sample = async () => {
    for (const p of people) {
      seen.add((await p.page.evaluate(() => window.__vidi6?.connectionState)) ?? 'none');
      await expect(p.page.getByRole('status').filter({ hasText: 'Reconnecting…' })).toHaveCount(0);
    }
  };
  for (let t = 0; t < 45; t++) {
    await sample();
    await people[0].page.waitForTimeout(1000);
  }
  expect([...seen]).toEqual(['connected']);

  // Teardown calls destroy(): no reconnect attempts after close.
  const attempts: string[] = [];
  people[1].page.on('websocket', (ws) => attempts.push(ws.url()));
  await people[0].context.close();
  await people[1].page.waitForTimeout(3000);
  expect(attempts).toEqual([]);
  await people[1].context.close();
});

test('TC-30 capacity soak: continuous random edits converge; latency is reported', async ({ browser }) => {
  test.setTimeout(240_000);
  const seed = Number(process.env.SEED ?? Date.now() % 100000);
  console.log(`TC-30 seed=${seed}`);
  const { people } = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
  await Promise.all(people.map((p) => setCamera(p.page, 0, 0, 0.25)));
  const deadline = Date.now() + 60_000;

  const act = async (p: (typeof people)[number], rand: () => number) => {
    const page = p.page;
    const count = await notes(page).count();
    const r = rand();
    const pick = () => notes(page).nth(Math.floor(rand() * count));
    const T = { timeout: 1500 };
    try {
      if (count === 0 || r < 0.1) {
        await page.mouse.dblclick(60 + rand() * 1100, 60 + rand() * 650);
        await page.keyboard.press('Escape');
      } else if (r < 0.5) {
        const n = pick();
        await n.dblclick(T);
        await page.keyboard.type('word ', { delay: 5 });
        await page.keyboard.press('Escape');
      } else if (r < 0.8) {
        const b = await pick().boundingBox(T);
        if (b) {
          await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
          await page.mouse.down();
          await page.mouse.move(60 + rand() * 1100, 60 + rand() * 650, { steps: 3 });
          await page.mouse.up();
        }
      } else if (r < 0.9) {
        await pick().click(T);
        await page.getByRole('button', { name: 'Pink colour' }).click(T);
      } else {
        await pick().click(T);
        await page.keyboard.press('Delete');
      }
    } catch {
      // The target may have been deleted or moved by someone else mid-action; that is part of the soak.
    }
  };

  const probes: number[] = [];
  await Promise.all([
    ...people.map(async (p, i) => {
      const rand = rng(seed + i);
      while (Date.now() < deadline) await act(p, rand);
    }),
    (async () => {
      // Latency probe: one tracked note creation every few seconds, timed until all others see it.
      while (Date.now() < deadline - 5000) {
        await people[0].page.waitForTimeout(5000);
        const before = await Promise.all(people.map(async (p) => new Set((await noteViews(p.page)).map((n) => n.id))));
        const t0 = Date.now();
        await people[0].page.mouse.dblclick(5 + Math.random() * 1200, 5 + Math.random() * 100);
        await people[0].page.keyboard.press('Escape');
        const gotIt = async (i: number) => {
          while (Date.now() - t0 < E2E_EVENTUAL_TIMEOUT_MS) {
            if ((await noteViews(people[i].page)).some((n) => !before[i].has(n.id))) return;
            await people[i].page.waitForTimeout(25);
          }
        };
        await Promise.all(people.slice(1).map((_, k) => gotIt(k + 1)));
        probes.push(Date.now() - t0);
      }
    })(),
  ]);
  console.log(`[latency] TC-30 probes: ${report(probes.length ? probes : [0])} (reported, not asserted)`);

  await expect
    .poll(async () => {
      const views = await Promise.all(people.map((p) => noteViews(p.page)));
      return views.every((v) => JSON.stringify(v) === JSON.stringify(views[0]));
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS * 2 })
    .toBe(true);
  await closeAll(people);
});
