// Nightly: too slow for every commit. Run with `npm run test:e2e:nightly`.
import { type Page, expect, test } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS, STICKY_COLORS } from '../../../src/shared/config';
import { seededRandom } from '../../fixtures/random-ops';
import { drag, getNotes, noteEditor, setCamera } from '../helpers/board';
import {
  LatencyLog,
  type Participant,
  connectionBadge,
  openParticipants,
} from '../helpers/participants';

const IDLE_MS = 45_000;
const SOAK_MS = 60_000;
const WORDS = ['pricing', 'churn', 'roadmap', 'launch', 'feedback', 'budget', 'hiring', 'design'];
const COLOURS = Object.keys(STICKY_COLORS);
/** Screen positions of note slots in each participant's own area (clear of toolbars). */
const SLOTS = [250, 500, 750, 1000].flatMap((x) => [200, 500].map((y) => ({ x, y })));

test.skip(({ browserName }) => browserName !== 'chromium', 'nightly runs in chromium');

async function noteModel(page: Page, id: string) {
  return (await getNotes(page)).find((n) => n.id === id);
}

test('TC-29 an idle connection stays connected', async ({ browser }, testInfo) => {
  test.setTimeout(IDLE_MS + 60_000);
  const session = await openParticipants(browser, testInfo, ['Alex', 'Sam']);
  try {
    const deadline = Date.now() + IDLE_MS;
    while (Date.now() < deadline) {
      for (const { page } of session.participants) {
        await expect(connectionBadge(page)).toHaveCount(0);
        expect(await page.evaluate(() => window.__vidi6!.connectionState)).toBe('connected');
      }
      await session.participants[0].page.waitForTimeout(500);
    }
    for (const { page } of session.participants) {
      const history = await page.evaluate(() => window.__vidi6!.connectionHistory);
      expect(history).not.toContain('reconnecting');
      expect(history?.at(-1)).toBe('connected');
    }
  } finally {
    await session.close();
  }
});

test('TC-30 capacity soak: MAX_CONCURRENT_EDITORS people edit for a minute and converge', async ({
  browser,
}, testInfo) => {
  test.setTimeout(SOAK_MS + 180_000);
  const seed = Date.now() % 1_000_000;
  console.log(`TC-30 seed: ${seed}`);
  const log = new LatencyLog();
  const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `P${i + 1}`);
  const session = await openParticipants(browser, testInfo, names);
  const people = session.participants;
  const view = testInfo.project.use.viewport!;
  const REGION = 10_000;
  const opCounts: Record<string, number> = {};

  const everyoneElse = (me: Participant, check: (page: Page) => Promise<boolean>) => async () => {
    for (const other of people) if (other !== me && !(await check(other.page))) return false;
    return true;
  };

  async function selectAt(page: Page, slot: { x: number; y: number }, id: string) {
    await page.mouse.click(slot.x, slot.y);
    await expect(page.locator(`[data-sticky-id="${id}"]`)).toHaveAttribute('data-selected', 'true');
  }

  try {
    await Promise.all(
      people.map((p, i) =>
        setCamera(p.page, { x: i * REGION - view.width / 2, y: -view.height / 2, zoom: 1 }),
      ),
    );
    const end = Date.now() + SOAK_MS;
    await Promise.all(
      people.map(async (me, i) => {
        const rand = seededRandom(seed + i);
        const slots: (string | null)[] = SLOTS.map(() => null);
        const pick = <T,>(items: T[]) => items[Math.floor(rand() * items.length)];
        while (Date.now() < end) {
          const used = slots.flatMap((id, s) => (id ? [s] : []));
          const free = slots.flatMap((id, s) => (id ? [] : [s]));
          const r = rand();
          let kind = r < 0.4 ? 'type' : r < 0.7 ? 'move' : r < 0.8 ? 'create' : r < 0.9 ? 'recolour' : 'delete';
          if (used.length === 0) kind = 'create';
          if (kind === 'move' && free.length === 0) kind = 'delete';
          if (kind === 'create' && free.length === 0) kind = 'type';
          opCounts[kind] = (opCounts[kind] ?? 0) + 1;
          const page = me.page;
          const label = `${me.name} ${kind}`;

          if (kind === 'create') {
            const s = pick(free);
            await page.mouse.dblclick(SLOTS[s].x, SLOTS[s].y);
            await expect(noteEditor(page)).toBeFocused();
            const id = await noteEditor(page).evaluate(
              (el) => el.closest<HTMLElement>('[data-sticky-id]')!.dataset.stickyId!,
            );
            await page.keyboard.press('Escape');
            slots[s] = id;
            await log.expectEventually(label, everyoneElse(me, async (p) => !!(await noteModel(p, id))));
            continue;
          }
          const s = pick(used);
          const id = slots[s]!;
          if (kind === 'move') {
            const to = pick(free);
            await drag(page, SLOTS[s], SLOTS[to].x - SLOTS[s].x, SLOTS[to].y - SLOTS[s].y);
            slots[to] = id;
            slots[s] = null;
            const n = (await noteModel(page, id))!;
            await log.expectEventually(
              label,
              everyoneElse(me, async (p) => {
                const o = await noteModel(p, id);
                return o?.x === n.x && o?.y === n.y;
              }),
            );
          } else if (kind === 'type') {
            await selectAt(page, SLOTS[s], id);
            await page.keyboard.press('Enter');
            await expect(noteEditor(page)).toBeFocused();
            await page.keyboard.type(`${pick(WORDS)} `);
            await page.keyboard.press('Escape');
            const text = (await noteModel(page, id))!.text;
            await log.expectEventually(
              label,
              everyoneElse(me, async (p) => (await noteModel(p, id))?.text === text),
            );
          } else if (kind === 'recolour') {
            await selectAt(page, SLOTS[s], id);
            const colour = pick(COLOURS);
            await page.getByRole('button', { name: `${colour[0].toUpperCase()}${colour.slice(1)} colour` }).click();
            await log.expectEventually(
              label,
              everyoneElse(me, async (p) => (await noteModel(p, id))?.color === colour),
            );
          } else {
            await selectAt(page, SLOTS[s], id);
            await page.getByRole('button', { name: 'Delete note' }).click();
            slots[s] = null;
            await log.expectEventually(label, everyoneElse(me, async (p) => !(await noteModel(p, id))));
          }
          await page.mouse.click(view.width / 2, view.height - 80); // deselect on empty board
        }
      }),
    );

    await expect
      .poll(
        async () => {
          const all = await Promise.all(people.map((p) => getNotes(p.page)));
          return all.every((s) => JSON.stringify(s) === JSON.stringify(all[0]));
        },
        { timeout: E2E_EVENTUAL_TIMEOUT_MS },
      )
      .toBe(true);
    for (const p of people) expect(p.problems, p.name).toEqual([]);
    console.log(`TC-30 operations: ${JSON.stringify(opCounts)}`);

    // Teardown: destroy() closes the socket and no reconnect is attempted afterwards.
    for (const { page } of people) {
      const sockets: string[] = [];
      page.on('websocket', (ws) => sockets.push(ws.url()));
      await page.evaluate(() => window.__vidi6!.unmount!());
      await page.waitForTimeout(3000);
      expect(sockets, 'reconnect attempts after destroy()').toEqual([]);
    }
  } finally {
    log.report('Capacity soak latency');
    await session.close();
  }
});
