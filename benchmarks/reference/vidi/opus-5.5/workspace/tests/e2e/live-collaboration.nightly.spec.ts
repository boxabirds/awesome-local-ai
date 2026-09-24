/**
 * Nightly (npm run test:e2e:nightly): long-running checks of sync.client.
 * TC-29 idle stability; TC-30 60-second capacity soak with per-change latency.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  STICKY_COLORS,
} from '../../src/shared/config';
import { nextFrames, noteLocator, setCamera } from './helpers/board';
import {
  closeParticipants,
  connectionBadge,
  editingNoteId,
  openParticipants,
  renderedNote,
  renderedNotes,
  type Participant,
  type RenderedNote,
} from './helpers/participants';

const IDLE_MS = 45_000;
const SOAK_MS = 60_000;
const TEST_MARGIN_MS = 120_000;
const RECORD_INTERVAL_MS = 50;
const POLL_MS = 10;
const HALF = 2;
const PERCENTILE_50 = 0.5;
const PERCENTILE_95 = 0.95;
const ZOOM = 0.2;
/** Each participant works in its own column of cells (screen px at ZOOM). */
const COLUMN = { first: 200, step: 200 } as const;
const ROW = { first: 150, step: 110, count: 5 } as const;
const MOVE_PX = 30;
const DRAG_STEPS = 5;
/** Operation mix (cumulative): 10% create, 40% type, 30% move, 10% recolour, 10% delete. */
const CREATE_BELOW = 0.1;
const TYPE_BELOW = 0.5;
const MOVE_BELOW = 0.8;
const RECOLOUR_BELOW = 0.9;
const WORDS = ['plan', 'risk', 'idea', 'ship', 'team', 'why', 'cost', 'goal'];
const COLORS = Object.keys(STICKY_COLORS);
const UINT32 = 2 ** 32;
const LCG_A = 1_664_525;
const LCG_C = 1_013_904_223;

/** Small seeded LCG so a failing soak can be replayed from its logged seed. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, LCG_A) + LCG_C) >>> 0;
    return s / UINT32;
  };
}

/** Records, in the page, every connection state and whether the badge ever said "Reconnecting…". */
async function startRecording(page: Page): Promise<void> {
  await page.evaluate((interval) => {
    const w = window as unknown as { __seenStates: string[]; __sawReconnecting: boolean };
    w.__seenStates = [];
    w.__sawReconnecting = false;
    const record = () => {
      const state = window.__vidi6?.connectionState;
      if (state && w.__seenStates.at(-1) !== state) w.__seenStates.push(state);
      if (document.body.textContent?.includes('Reconnecting…')) w.__sawReconnecting = true;
    };
    new MutationObserver(record).observe(document.body, { childList: true, subtree: true, characterData: true });
    setInterval(record, interval);
    record();
  }, RECORD_INTERVAL_MS);
}

async function recording(page: Page): Promise<{ states: string[]; sawReconnecting: boolean }> {
  return page.evaluate(() => {
    const w = window as unknown as { __seenStates: string[]; __sawReconnecting: boolean };
    return { states: w.__seenStates, sawReconnecting: w.__sawReconnecting };
  });
}

let people: Participant[] = [];
test.afterEach(async () => {
  await closeParticipants(people);
  people = [];
});

test('TC-29 an idle board stays connected (awareness relay keeps the socket alive)', async ({ browser }) => {
  test.setTimeout(IDLE_MS + TEST_MARGIN_MS);
  people = await openParticipants(browser, ['Alex', 'Sam']);
  for (const p of people) await startRecording(p.page);
  await people[0]!.page.waitForTimeout(IDLE_MS);
  for (const p of people) {
    const r = await recording(p.page);
    expect(r.states, `${p.name} states`).toEqual(['connected']);
    expect(r.sawReconnecting, `${p.name} badge`).toBe(false);
    await expect(connectionBadge(p.page)).toHaveCount(0);
  }
});

test(`TC-30 capacity soak: ${MAX_CONCURRENT_EDITORS} people edit for 60 s, every change within budget`, async ({ browser }) => {
  test.setTimeout(SOAK_MS + TEST_MARGIN_MS * HALF);
  const seed = Date.now() >>> 0;
  console.log(`TC-30 seed ${seed}`);
  const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Person ${i + 1}`);
  people = await openParticipants(browser, names);
  for (const p of people) {
    await setCamera(p.page, { x: 0, y: 0, zoom: ZOOM });
    await nextFrames(p.page);
    await startRecording(p.page);
  }

  const latencies: number[] = [];
  const failures: string[] = [];

  /** Waits until every other screen shows `expected` for note `id`; records each latency. */
  const deliver = async (sender: Participant, id: string, expected: RenderedNote | undefined, what: string) => {
    const shownAt = Date.now();
    await Promise.all(
      people
        .filter((p) => p !== sender)
        .map(async (p) => {
          for (;;) {
            const seen = await renderedNote(p.page, id);
            const elapsed = Date.now() - shownAt;
            if (JSON.stringify(seen) === JSON.stringify(expected)) {
              latencies.push(elapsed);
              if (elapsed > LIVE_UPDATE_LATENCY_BUDGET_MS) failures.push(`${what} → ${p.name}: ${elapsed} ms`);
              return;
            }
            if (elapsed > LIVE_UPDATE_LATENCY_BUDGET_MS * HALF) {
              failures.push(`${what} → ${p.name}: not delivered`);
              return;
            }
            await p.page.waitForTimeout(POLL_MS);
          }
        }),
    );
  };

  const deadline = Date.now() + SOAK_MS;
  await Promise.all(
    people.map(async (p, i) => {
      const rand = seeded(seed + i);
      const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
      const x = COLUMN.first + i * COLUMN.step;
      const cells: (string | null)[] = Array.from({ length: ROW.count }, () => null);
      const page = p.page;
      const centre = async (id: string) => {
        const box = (await noteLocator(page, id).boundingBox())!;
        return { x: box.x + box.width / HALF, y: box.y + box.height / HALF };
      };

      while (Date.now() < deadline) {
        const free = cells.flatMap((c, r) => (c === null ? [r] : []));
        const used = cells.flatMap((c, r) => (c === null ? [] : [r]));
        const roll = rand();
        if (used.length === 0 || (roll < CREATE_BELOW && free.length > 0)) {
          const r = pick(free);
          await page.mouse.dblclick(x, ROW.first + r * ROW.step);
          const id = await editingNoteId(page);
          await page.keyboard.press('Escape');
          cells[r] = id;
          await deliver(p, id, await renderedNote(page, id), `create by ${p.name}`);
          continue;
        }
        const r = pick(used);
        const id = cells[r]!;
        if (roll < TYPE_BELOW) {
          const c = await centre(id);
          await page.mouse.dblclick(c.x, c.y);
          await page.keyboard.type(`${pick(WORDS)} `);
          await page.keyboard.press('Escape');
          await deliver(p, id, await renderedNote(page, id), `type by ${p.name}`);
        } else if (roll < MOVE_BELOW) {
          const c = await centre(id);
          const home = { x, y: ROW.first + r * ROW.step };
          // Alternate around the cell's home so notes never wander into other cells.
          const dx = c.x > home.x ? -MOVE_PX : MOVE_PX;
          await page.mouse.move(c.x, c.y);
          await page.mouse.down();
          await page.mouse.move(c.x + dx, c.y, { steps: DRAG_STEPS });
          await page.mouse.up();
          await nextFrames(page);
          await deliver(p, id, await renderedNote(page, id), `move by ${p.name}`);
        } else if (roll < RECOLOUR_BELOW) {
          const c = await centre(id);
          await page.mouse.click(c.x, c.y);
          await page.getByRole('button', { name: `${pick(COLORS).replace(/^./, (ch) => ch.toUpperCase())} colour` }).click();
          await deliver(p, id, await renderedNote(page, id), `recolour by ${p.name}`);
        } else {
          const c = await centre(id);
          await page.mouse.click(c.x, c.y);
          await page.keyboard.press('Delete');
          cells[r] = null;
          await deliver(p, id, undefined, `delete by ${p.name}`);
        }
      }
    }),
  );

  const sorted = [...latencies].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  console.log(
    `TC-30 deliveries ${sorted.length}: p50 ${at(PERCENTILE_50)} ms, p95 ${at(PERCENTILE_95)} ms, max ${sorted.at(-1)} ms`,
  );
  expect(failures).toEqual([]);

  for (const p of people) {
    const r = await recording(p.page);
    expect(r.states, `${p.name} states`).toEqual(['connected']);
    expect(r.sawReconnecting).toBe(false);
  }
  const snapshots = await Promise.all(people.map((p) => renderedNotes(p.page)));
  for (const s of snapshots) expect(s).toEqual(snapshots[0]);
});
