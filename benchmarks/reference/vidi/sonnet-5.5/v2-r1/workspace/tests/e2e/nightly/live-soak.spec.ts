import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS } from '../../../src/shared/config';
import { seededRandom } from '../../fixtures/random-ops';
import { setCamera } from '../helpers/board';
import {
  badge,
  closeAll,
  dragNote,
  expectEventually,
  latencies,
  logLatencyReport,
  newNoteAt,
  noteView,
  noteViews,
  openParticipants,
  sameBoard,
} from '../helpers/participants';
import type { Participant } from '../helpers/participants';

const IDLE_MS = 45_000;
const SOAK_MS = 60_000;
const SEED = 20260930;
const WORDS = ['pricing', 'launch', 'risk', 'idea', 'users', 'budget'];
const COLOURS = ['Yellow', 'Orange', 'Green', 'Blue', 'Pink', 'Violet'];

test.describe('nightly live collaboration', () => {
  test('TC-29 an idle connection never shows Reconnecting…', async ({ browser }) => {
    test.setTimeout(IDLE_MS + 60_000);
    const people = await openParticipants(browser, 2);
    try {
      const start = Date.now();
      while (Date.now() - start < IDLE_MS) {
        for (const p of people) {
          expect(await p.page.evaluate(() => window.__vidi6?.connectionState)).toBe('connected');
          await expect(badge(p.page)).toHaveCount(0);
        }
        await people[0].page.waitForTimeout(500);
      }
    } finally {
      await closeAll(people);
    }
  });

  test('TC-30 capacity soak: continuous random edits converge', async ({ browser }) => {
    test.setTimeout(SOAK_MS + 180_000);
    console.log(`TC-30 seed=${SEED}`);
    const people = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
    try {
      await Promise.all(people.map((p) => setCamera(p.page, { x: -1280, y: -800, zoom: 0.5 })));
      const created: { by: number; id: string; at: number }[] = [];
      const deadline = Date.now() + SOAK_MS;

      const worker = async (i: number) => {
        const p: Participant = people[i];
        const rand = seededRandom(SEED + i);
        const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];
        while (Date.now() < deadline) {
          const roll = rand();
          try {
            const views = await noteViews(p.page);
            if (views.length === 0 || roll < 0.15) {
              // Aim at an empty row for this person so a double click creates rather than edits.
              const id = await newNoteAt(p.page, 140 + Math.floor(rand() * 9) * 110, 90 + i * 130);
              created.push({ by: i, id, at: Date.now() });
              await p.page.keyboard.press('Escape');
            } else if (roll < 0.5) {
              await p.page.locator(`[data-note-id="${pick(views).id}"]`).dblclick({ timeout: 2000 });
              await p.page.keyboard.type(`${pick(WORDS)} `, { delay: 10 });
              await p.page.keyboard.press('Escape');
            } else if (roll < 0.85) {
              await dragNote(p.page, pick(views).id, Math.round(rand() * 60 - 30), Math.round(rand() * 60 - 30));
            } else if (roll < 0.93) {
              await p.page.locator(`[data-note-id="${pick(views).id}"]`).click({ timeout: 2000 });
              await p.page.getByRole('button', { name: `${pick(COLOURS)} colour` }).click({ timeout: 2000 });
            } else {
              await p.page.locator(`[data-note-id="${pick(views).id}"]`).click({ timeout: 2000 });
              await p.page.keyboard.press('Delete');
            }
          } catch {
            // The note vanished under us (someone deleted it) — part of the workload.
          }
        }
      };
      await Promise.all(people.map((_, i) => worker(i)));

      await p0(people).keyboard.press('Escape');
      await expectEventually('all screens identical after soak', () => sameBoard(people));

      // Latency of a fresh change once the load stops: pan every screen to empty space so creates never hit a note.
      await Promise.all(people.map((p) => setCamera(p.page, { x: -1280 - 20_000, y: -800 - 20_000, zoom: 0.5 })));
      for (const [i, sender] of people.entries()) {
        const t = Date.now();
        const id = await newNoteAt(sender.page, 140 + i * 120, 400);
        await sender.page.keyboard.press('Escape');
        for (const other of people.filter((_, j) => j !== i)) {
          await expectEventually(`post-soak create ${sender.name}`, async () => !!(await noteView(other.page, id)), t);
        }
      }
      await expectEventually('identical at the end', () => sameBoard(people));
      logLatencyReport('TC-30 sender-to-receiver', latencies);
      expect(created.length).toBeGreaterThan(0);

      // Teardown: leaving the page destroys the provider; no reconnect attempts follow.
      const reconnects: string[] = [];
      for (const p of people) p.page.on('websocket', (ws) => reconnects.push(ws.url()));
      await Promise.all(people.map((p) => p.page.goto('about:blank')));
      await people[0].page.waitForTimeout(1500);
      expect(reconnects).toEqual([]);
    } finally {
      await closeAll(people);
    }
  });
});

function p0(people: Participant[]): Page {
  return people[0].page;
}
