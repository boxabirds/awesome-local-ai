// Nightly only (`npm run test:e2e:nightly`): slow checks of the sync.client contract.
import { expect, test, type Page } from '@playwright/test';
import { setCamera, settle } from '../helpers/board';
import { centreOf, dragBy, noteAt, noteById, notes } from '../helpers/notes';
import { closeAll, domSnapshot, openParticipants, type Participant } from '../helpers/participants';
import { seededRandom } from '../../fixtures/random-ops';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS, STICKY_COLORS } from '../../../src/shared/config';

const IDLE_MS = 45_000;
const SOAK_MS = 60_000;

/** Counts WebSocket constructions in the page (runs before the app loads). */
function countSockets() {
  const Native = window.WebSocket;
  const w = window as unknown as { __sockets: number };
  w.__sockets = 0;
  window.WebSocket = class extends Native {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      w.__sockets++;
    }
  } as typeof WebSocket;
}

/** Records every connection state and badge text the page shows from now on. */
async function startRecorder(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __rec: { states: string[]; badges: string[] } };
    w.__rec = { states: [], badges: [] };
    const tick = () => {
      const s = String(window.__vidi6?.connectionState ?? 'none');
      if (w.__rec.states.at(-1) !== s) w.__rec.states.push(s);
      const badge = document.querySelector('[role="status"][aria-label="Connection status"]')?.textContent ?? '';
      if (badge && w.__rec.badges.at(-1) !== badge) w.__rec.badges.push(badge);
    };
    tick();
    setInterval(tick, 20);
    new MutationObserver(tick).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}

async function recorded(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __rec: { states: string[]; badges: string[] }; __sockets?: number };
    return { ...w.__rec, sockets: w.__sockets ?? 0 };
  });
}

test('TC-29 an idle board stays connected for 45 s (awareness relay keeps the socket alive)', async ({ browser }) => {
  test.setTimeout(IDLE_MS + 60_000);
  const { people } = await openParticipants(browser, ['Alex', 'Sam'], undefined, countSockets);
  for (const p of people) await startRecorder(p.page);
  await people[0].page.waitForTimeout(IDLE_MS);
  for (const p of people) {
    const rec = await recorded(p.page);
    expect(rec.states, p.name).toEqual(['connected']);
    expect(rec.badges, p.name).toEqual([]);
    expect(rec.sockets, `${p.name}: no reconnect attempts`).toBe(1);
  }
  await closeAll(people);
});

type Op = 'create' | 'move' | 'type' | 'recolour' | 'delete';
const WORDS = ['pricing', 'launch', 'retro', 'idea', 'customer', 'risk', 'roadmap', 'next', 'ship'];
const COLOURS = Object.keys(STICKY_COLORS) as Array<keyof typeof STICKY_COLORS>;
const colourLabel = (c: string) => `${c[0].toUpperCase()}${c.slice(1)} colour`;

function percentile(sorted: number[], p: number) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

test('TC-30 capacity soak: MAX_CONCURRENT_EDITORS people edit for 60 s; every change arrives within budget', async ({
  browser,
}) => {
  test.setTimeout(SOAK_MS + 120_000);
  const seed = Number(process.env.VIDI6_SEED ?? Date.now() % 1_000_000);
  console.log(`TC-30 seed ${seed}`);
  const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `P${i + 1}`);
  const { people } = await openParticipants(browser, names);
  // Each person works on their own notes in their own area of the board (D2: two writers, different notes).
  for (const [i, p] of people.entries()) {
    await setCamera(p.page, { x: i * 5000, y: 0, zoom: 0.5 });
    await settle(p.page);
    await startRecorder(p.page);
  }

  const latencies: number[] = [];
  const failures: string[] = [];
  const deadline = Date.now() + SOAK_MS;
  const noteData = async (page: Page, id: string) => (await notes(page)).find((n) => n.id === id);

  /**
   * Waits until `check` holds on every other page and records each receiver's latency from `sentAt`
   * (the moment the sender's own screen showed the change). Measured from the test runner, so it
   * includes polling overhead: an upper bound.
   */
  async function delivered(by: Participant, what: string, sentAt: number, check: (page: Page) => Promise<boolean>) {
    await Promise.all(
      people
        .filter((o) => o !== by)
        .map(async (o) => {
          while (!(await check(o.page))) {
            if (Date.now() - sentAt > LIVE_UPDATE_LATENCY_BUDGET_MS * 5) {
              failures.push(`${what} never reached ${o.name}`);
              return;
            }
            await o.page.waitForTimeout(5);
          }
          latencies.push(Date.now() - sentAt);
        }),
    );
  }

  async function work(p: Participant, index: number) {
    const rand = seededRandom(seed * 31 + index);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
    const page = p.page;
    const mine: string[] = [];
    while (Date.now() < deadline) {
      const r = rand();
      const op: Op =
        mine.length === 0 || r < 0.15 ? 'create' : r < 0.5 ? 'move' : r < 0.8 ? 'type' : r < 0.9 ? 'recolour' : 'delete';
      if (op === 'create') {
        await page.getByRole('button', { name: 'Sticky note' }).click();
        const id = (await page.locator('[data-note-id][data-state="editing"]').getAttribute('data-note-id'))!;
        mine.push(id);
        await delivered(p, `create ${id}`, Date.now(), async (o) => (await noteById(o, id).count()) === 1);
        await page.keyboard.press('Escape');
        // Move it away from the centre so the next new note does not cover it.
        await dragBy(page, await centreOf(page, id), rand() * 1000 - 500, rand() * 600 - 300);
        const n = await noteData(page, id);
        await delivered(p, `move ${id}`, Date.now(), async (o) => {
          const m = await noteData(o, id);
          return m?.x === n?.x && m?.y === n?.y;
        });
        continue;
      }
      const id = pick(mine);
      const centre = await centreOf(page, id).catch(() => null);
      if (!centre || centre.x < 60 || centre.y < 60 || centre.x > 1220 || centre.y > 740) continue;
      if ((await noteAt(page, centre)) !== id) continue; // covered by another note
      await page.mouse.click(1270, 790); // start with nothing selected
      if (op === 'move') {
        await dragBy(page, centre, rand() * 300 - 150, rand() * 200 - 100);
        const n = await noteData(page, id);
        await delivered(p, `move ${id}`, Date.now(), async (o) => {
          const m = await noteData(o, id);
          return m?.x === n?.x && m?.y === n?.y;
        });
      } else if (op === 'type') {
        await noteById(page, id).dblclick();
        await page.keyboard.type(`${pick(WORDS)} `);
        const text = (await noteData(page, id))?.text;
        const sentAt = Date.now();
        await page.keyboard.press('Escape');
        await delivered(p, `type ${id}`, sentAt, async (o) => (await noteData(o, id))?.text === text);
      } else if (op === 'recolour') {
        await page.mouse.click(centre.x, centre.y);
        const current = (await noteData(page, id))?.color;
        const colour = pick(COLOURS.filter((c) => c !== current));
        await page.getByRole('button', { name: colourLabel(colour) }).click();
        await delivered(p, `recolour ${id}`, Date.now(), async (o) => (await noteData(o, id))?.color === colour);
      } else {
        await page.mouse.click(centre.x, centre.y);
        await page.keyboard.press('Delete');
        mine.splice(mine.indexOf(id), 1);
        await delivered(p, `delete ${id}`, Date.now(), async (o) => (await noteById(o, id).count()) === 0);
      }
    }
  }

  await Promise.all(people.map((p, i) => work(p, i)));

  latencies.sort((a, b) => a - b);
  console.log(
    `TC-30 ${latencies.length} deliveries: p50 ${percentile(latencies, 50)} ms, ` +
      `p95 ${percentile(latencies, 95)} ms, max ${latencies.at(-1)} ms`,
  );
  expect(failures).toEqual([]);
  expect(latencies.length).toBeGreaterThan(0);
  expect(latencies.at(-1)!).toBeLessThanOrEqual(LIVE_UPDATE_LATENCY_BUDGET_MS);

  const expected = await domSnapshot(people[0].page);
  for (const p of people) {
    expect(await domSnapshot(p.page), p.name).toEqual(expected);
    const rec = await recorded(p.page);
    expect(rec.states, p.name).toEqual(['connected']);
    expect(rec.badges, p.name).toEqual([]);
    expect(p.errors, p.name).toEqual([]);
  }
  await closeAll(people);
});
