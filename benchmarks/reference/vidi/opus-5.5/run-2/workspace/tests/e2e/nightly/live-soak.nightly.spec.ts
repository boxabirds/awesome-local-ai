/**
 * Nightly (design TC-29, TC-30): idle connection stability and a 60-second soak at
 * MAX_CONCURRENT_EDITORS. Run with `npm run test:e2e:nightly`.
 */
import { expect, test, type Page } from '@playwright/test';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS, STICKY_COLORS } from '../../../src/shared/config';
import { seededRandom } from '../../fixtures/random-ops';
import { setCamera } from '../helpers/board';
import {
  centreOf,
  closeAll,
  createNoteAt,
  domSnapshot,
  dragBy,
  note,
  noteState,
  notes,
  openParticipants,
  type DomNote,
  type Participant,
} from '../helpers/participants';

const IDLE_MS = 45_000;
const IDLE_SAMPLE_MS = 500;
const SOAK_MS = 60_000;
const SOAK_ZOOM = 0.5;
const MAX_NOTES_EACH = 4;
const TEARDOWN_WATCH_MS = 3000;
const SLOT_LEFT_PX = 150;
const SLOT_SPACING_PX = 280;
const MOVE_RANGE_PX = 50;
const WORDS = ['pricing', 'churn', 'roadmap', 'launch', 'budget', 'risk', 'hiring', 'beta'];
const COLOR_NAMES = Object.keys(STICKY_COLORS).map((c) => `${c[0]!.toUpperCase()}${c.slice(1)} colour`);

let people: Participant[] = [];
test.afterEach(async () => {
  await closeAll(people);
  people = [];
});

test.beforeEach(({ browserName }) => {
  test.skip(browserName !== 'chromium', 'nightly multi-context scenarios run in chromium');
});

async function connectionLog(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => window.__vidi6?.connectionLog ?? []);
}

test('TC-29 an idle board never shows "Reconnecting…"', async ({ browser }) => {
  test.setTimeout(IDLE_MS + 60_000);
  people = await openParticipants(browser, ['Alex', 'Sam']);
  const end = Date.now() + IDLE_MS;
  while (Date.now() < end) {
    for (const p of people) {
      await expect(p.page.getByTestId('connection-status')).toHaveCount(0);
      expect(await p.page.evaluate(() => window.__vidi6?.connectionState)).toBe('connected');
    }
    await people[0]!.page.waitForTimeout(IDLE_SAMPLE_MS);
  }
  for (const p of people) {
    const log = await connectionLog(p.page);
    expect(log).not.toContain('reconnecting');
    expect(log.at(-1)).toBe('connected');
  }
});

function percentile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

test(`TC-30 ${MAX_CONCURRENT_EDITORS} people editing for 60 s: every change arrives within budget`, async ({ browser }) => {
  test.setTimeout(SOAK_MS + 120_000);
  const seed = Date.now() % 1_000_000;
  console.log(`TC-30 seed ${seed}`);
  const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Person ${i + 1}`);
  people = await openParticipants(browser, names);
  await Promise.all(people.map((p) => setCamera(p.page, { x: -100, y: -100, zoom: SOAK_ZOOM })));
  const band = 1400 / MAX_CONCURRENT_EDITORS; // world units per participant row
  const latencies: number[] = [];
  const late: string[] = [];

  /** Waits (in each receiver page) until `id` renders as `expected` (null = gone). */
  async function measure(me: Participant, id: string, what: string): Promise<void> {
    const expected = await noteState(me.page, id);
    const t0 = Date.now();
    await Promise.all(
      people
        .filter((o) => o !== me)
        .map(async (o) => {
          try {
            await o.page.waitForFunction(
              ({ id: noteId, exp }: { id: string; exp: DomNote | null }) => {
                const el = document.querySelector<HTMLElement>(`[data-id="${noteId}"]`);
                if (exp === null) return el === null;
                return (
                  el !== null &&
                  parseFloat(el.style.left) === exp.x &&
                  parseFloat(el.style.top) === exp.y &&
                  el.dataset.color === exp.color &&
                  (el.querySelector('.sticky-text-content')?.textContent ?? '') === exp.text
                );
              },
              { id, exp: expected },
              { polling: 'raf', timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 5 },
            );
            latencies.push(Date.now() - t0);
          } catch {
            late.push(`${what} by ${me.name} never reached ${o.name}`);
          }
        }),
    );
  }

  await Promise.all(
    people.map(async (me, row) => {
      const rand = seededRandom(seed + row);
      const mine: string[] = [];
      /** Screen x of each note's slot; moves stay within MOVE_RANGE_PX of it. */
      const home = new Map<string, number>();
      const free = Array.from({ length: MAX_NOTES_EACH }, (_, i) => i);
      const slotOf = new Map<string, number>();
      const top = row * band;
      const screenY = (worldY: number) => (worldY + 100) * SOAK_ZOOM;
      const deadline = Date.now() + SOAK_MS;
      while (Date.now() < deadline) {
        const r = rand();
        const target = mine[Math.floor(rand() * mine.length)];
        if (target === undefined || (r < 0.15 && free.length > 0)) {
          const slot = free.shift()!;
          const x = SLOT_LEFT_PX + slot * SLOT_SPACING_PX;
          const id = await createNoteAt(me.page, { x, y: screenY(top + band / 2) });
          mine.push(id);
          home.set(id, x);
          slotOf.set(id, slot);
          await measure(me, id, 'create');
        } else if (r < 0.55) {
          await note(me.page, target).dblclick();
          await me.page.keyboard.press('End');
          await me.page.keyboard.type(`${WORDS[Math.floor(rand() * WORDS.length)]} `);
          await me.page.keyboard.press('Escape');
          await measure(me, target, 'type');
        } else if (r < 0.85) {
          const from = await centreOf(note(me.page, target));
          // Random target within the slot, so notes never drift onto each other.
          const dx = Math.round(home.get(target)! + (rand() - 0.5) * 2 * MOVE_RANGE_PX - from.x);
          await dragBy(me.page, from, dx, 0);
          await measure(me, target, 'move');
        } else if (r < 0.95) {
          await note(me.page, target).click();
          await me.page.getByRole('button', { name: COLOR_NAMES[Math.floor(rand() * COLOR_NAMES.length)]! }).click();
          await measure(me, target, 'recolour');
        } else {
          await note(me.page, target).click();
          await me.page.getByRole('button', { name: 'Delete note' }).click();
          mine.splice(mine.indexOf(target), 1);
          free.push(slotOf.get(target)!);
          await measure(me, target, 'delete');
        }
      }
    }),
  );

  const sorted = [...latencies].sort((a, b) => a - b);
  console.log(
    `TC-30 ${sorted.length} deliveries: p50 ${percentile(sorted, 0.5)} ms, p95 ${percentile(sorted, 0.95)} ms, max ${sorted.at(-1)} ms`,
  );
  expect(late).toEqual([]);
  expect(sorted.at(-1) ?? 0).toBeLessThanOrEqual(LIVE_UPDATE_LATENCY_BUDGET_MS);

  const final = await domSnapshot(people[0]!.page);
  for (const p of people) {
    expect(await domSnapshot(p.page)).toEqual(final);
    expect(await connectionLog(p.page)).not.toContain('reconnecting');
    await expect(p.page.getByTestId('connection-status')).toHaveCount(0);
  }
  expect(await notes(people[0]!.page).count()).toBe(final.length);

  // Teardown: leaving the board destroys the provider; no reconnect attempts follow.
  const reconnects: string[] = [];
  for (const p of people) {
    p.page.on('websocket', (ws) => reconnects.push(`${p.name}: ${ws.url()}`));
    await p.page.goto('about:blank');
  }
  await people[0]!.page.waitForTimeout(TEARDOWN_WATCH_MS);
  expect(reconnects).toEqual([]);
});
