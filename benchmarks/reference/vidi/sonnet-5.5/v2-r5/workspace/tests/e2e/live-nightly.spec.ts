import { expect, test } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { mulberry32 } from '../integration/helpers/random-ops';
import {
  badge, boardSnapshot, drag, notesOf, openParticipants, percentile,
} from './helpers/participants';

const IDLE_MS = 45_000;
const SOAK_MS = 60_000;

test('TC-29 @nightly idle connection never reports Reconnecting', async ({ browser }) => {
  test.setTimeout(IDLE_MS + 60_000);
  const people = await openParticipants(browser, ['Alex', 'Sam']);
  const seen = new Set<string>();
  const end = Date.now() + IDLE_MS;
  while (Date.now() < end) {
    for (const p of people) {
      seen.add(await p.page.evaluate(() => window.__vidi6?.connectionState ?? 'unknown'));
      expect(await badge(p.page).count()).toBe(0);
    }
    await people[0].page.waitForTimeout(500);
  }
  expect([...seen]).toEqual(['connected']);
  for (const p of people) await p.context.close();
});

test('TC-30 @nightly capacity soak converges; latency reported', async ({ browser }) => {
  test.setTimeout(SOAK_MS + 240_000);
  const seed = 12345; // change to replay a different run
  console.log(`TC-30 seed ${seed}`);
  const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `P${i + 1}`);
  const people = await openParticipants(browser, names);
  const latencies: number[] = [];
  const end = Date.now() + SOAK_MS;

  await Promise.all(people.map(async (p, i) => {
    const rnd = mulberry32(seed + i);
    while (Date.now() < end) {
      const count = await notesOf(p.page).count();
      const roll = rnd();
      const x = 150 + Math.floor(rnd() * 900);
      const y = 100 + Math.floor(rnd() * 600);
      if (count === 0 || roll < 0.15) {
        await p.page.mouse.dblclick(x, y);
        await p.page.keyboard.type(`${p.name} `);
        await p.page.keyboard.press('Escape');
        await p.page.mouse.click(1250, 780);
      } else if (roll < 0.45) {
        const note = notesOf(p.page).nth(Math.floor(rnd() * count));
        const box = await note.boundingBox();
        if (box) await drag(p.page, { x: box.x + 100, y: box.y + 100 }, Math.floor(rnd() * 100) - 50, Math.floor(rnd() * 100) - 50);
      } else if (roll < 0.8) {
        await notesOf(p.page).nth(Math.floor(rnd() * count)).dblclick({ timeout: 2000 }).catch(() => {});
        await p.page.keyboard.type('word ');
        await p.page.keyboard.press('Escape');
      } else if (roll < 0.9) {
        await notesOf(p.page).nth(Math.floor(rnd() * count)).click({ timeout: 2000 }).catch(() => {});
        await p.page.getByRole('button', { name: 'Blue colour' }).click({ timeout: 1000 }).catch(() => {});
      } else if (count > 3) {
        await notesOf(p.page).nth(Math.floor(rnd() * count)).click({ timeout: 2000 }).catch(() => {});
        await p.page.getByRole('button', { name: 'Delete note' }).click({ timeout: 1000 }).catch(() => {});
      }
      await p.page.mouse.click(1250, 780);
    }
  }));

  const start = Date.now();
  await expect.poll(async () => {
    const snaps = await Promise.all(people.map((p) => boardSnapshot(p.page)));
    return snaps.every((s) => JSON.stringify(s) === JSON.stringify(snaps[0]));
  }, { timeout: 60_000 }).toBe(true);
  latencies.push(Date.now() - start);
  console.log(
    `[latency report] TC-30 final settle p50=${percentile(latencies, 50)}ms max=${percentile(latencies, 100)}ms`,
  );
  expect(await notesOf(people[0].page).count()).toBeGreaterThan(0);

  const closed: string[] = [];
  for (const p of people) {
    p.page.on('console', (m) => { if (/reconnect/i.test(m.text())) closed.push(m.text()); });
    await p.context.close();
  }
  expect(closed).toEqual([]);
});
