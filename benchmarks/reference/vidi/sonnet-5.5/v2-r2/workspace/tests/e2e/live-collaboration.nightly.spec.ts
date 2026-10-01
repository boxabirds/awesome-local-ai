import { expect, test } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';
import {
  allSnapshotsEqual, closeAll, createNoteAt, dragNote, expectEventually, latencies, notesOf, openParticipants,
} from './helpers/participants';

const IDLE_MS = 45_000;
const SOAK_MS = 60_000;

test('TC-29 @nightly idle connections stay connected', async ({ browser }) => {
  test.setTimeout(IDLE_MS + 60_000);
  const people = await openParticipants(browser, 2);
  const deadline = Date.now() + IDLE_MS;
  while (Date.now() < deadline) {
    for (const p of people) {
      await expect(p.page.locator('div[role=status]')).toHaveCount(0);
      expect(await p.page.evaluate(() => window.__vidi6?.connectionState)).toBe('connected');
    }
    await people[0].page.waitForTimeout(500);
  }
  await closeAll(people);
});

test('TC-30 @nightly capacity soak converges at MAX_CONCURRENT_EDITORS', async ({ browser }) => {
  test.setTimeout(SOAK_MS + 240_000);
  const people = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
  const words = ['pricing', 'launch', 'risk', 'idea', 'goal'];
  const end = Date.now() + SOAK_MS;

  await Promise.all(people.map(async (p, i) => {
    const row = 80 + i * 140;
    let n = 0;
    while (Date.now() < end) {
      const slot = n % 5;
      if (n < 5) {
        await createNoteAt(p.page, 120 + slot * 230, row);
        await p.page.keyboard.type(words[(i + n) % words.length]);
        await p.page.keyboard.press('Escape');
      } else {
        const note = notesOf(p.page).nth(n % Math.max(1, await notesOf(p.page).count()));
        if (await note.count()) await dragNote(p.page, note, n % 2 ? 5 : -5, n % 2 ? 5 : -5).catch(() => {});
      }
      n++;
      await p.page.waitForTimeout(150);
    }
  }));

  // Sampled latency: a fresh change from the first participant observed on all others.
  const sender = people[0];
  // Sample in an empty region of the board so no existing note is hit.
  await sender.page.evaluate(() => window.__vidi6?.setCamera({ x: 20000, y: 20000, zoom: 1 }));
  await expect.poll(async () => (await notesOf(sender.page).first().boundingBox())?.x ?? 0).toBeLessThan(-1000);
  for (let k = 0; k < 5; k++) {
    const before = await notesOf(sender.page).count();
    await createNoteAt(sender.page, 130 + k * 240, 400);
    await sender.page.keyboard.press('Escape');
    await expectEventually(`soak change ${k} on all others`, async () => {
      const counts = await Promise.all(people.slice(1).map((q) => notesOf(q.page).count()));
      return counts.every((c) => c >= before + 1);
    });
  }

  await expectEventually('soak final snapshots identical', () => allSnapshotsEqual(people.map((p) => p.page)));
  const sorted = [...latencies].sort((a, b) => a - b);
  const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
  console.log(`[latency report] n=${sorted.length} p50=${q(0.5)}ms p95=${q(0.95)}ms max=${sorted[sorted.length - 1]}ms budget=${LIVE_UPDATE_LATENCY_BUDGET_MS}ms`);
  expect(sorted.length).toBeGreaterThan(0);

  const reconnects: string[] = [];
  people.forEach((p) => p.page.on('websocket', (ws) => reconnects.push(ws.url())));
  await closeAll(people);
  await new Promise((r) => setTimeout(r, 1000));
  expect(reconnects).toEqual([]);
});
