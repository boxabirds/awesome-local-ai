import { type Page, expect, test } from '@playwright/test';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { nextFrames, setCamera } from './helpers/board';
import { LatencyLog, closeParticipants, createBoardIn, openParticipants } from './helpers/participants';

// Camera at world (0, 0), 100%: screen pixels = world units.
const CAMERA = { x: 0, y: 0, zoom: 1 };
const A = { kind: 'rect', x: 400, y: 300, width: 160, height: 100, label: 'Cart' };
const B = { kind: 'rect', x: 800, y: 300, width: 160, height: 100, label: 'Pay' };

async function objects(page: Page): Promise<ObjectSnapshot[]> {
  return page.evaluate(() => [...(window.__vidi6?.getObjects?.() ?? [])]);
}

async function arrows(page: Page): Promise<ObjectSnapshot[]> {
  return (await objects(page)).filter((o) => o.type === 'connector');
}

/** The arrow's end points as drawn on this page (from the rendered element). */
async function drawnEnds(page: Page, id: string) {
  const el = page.locator(`[data-connector-object][data-id="${id}"]`);
  if ((await el.count()) === 0) return null;
  return el.evaluate((e) => {
    const d = (e as HTMLElement).dataset;
    return { from: { x: Number(d.x1), y: Number(d.y1) }, to: { x: Number(d.x2), y: Number(d.y2) } };
  });
}

async function seedShapes(page: Page, shapes: object[]): Promise<string[]> {
  return page.evaluate((list) => window.__vidi6!.seedShapes!(list as never), shapes);
}

async function waitForObjects(page: Page, ids: string[]) {
  await expect
    .poll(async () => {
      const present = new Set((await objects(page)).map((o) => o.id));
      return ids.every((id) => present.has(id));
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(true);
}

/** Connector tool drag between two screen points. */
async function drawArrow(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.keyboard.press('l');
  await expect(page.getByRole('button', { name: 'Connector (L)' })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await expect(page.locator('[data-testid="connector-dot"][data-highlighted="true"]')).toHaveCount(1);
  await page.mouse.up();
}

test.describe('Collaborative rearrange', () => {
  test('TC-25/TC-26 arrows follow a moved shape on both screens and survive its deletion', async ({ browser }, testInfo) => {
    const [dana, sam] = await openParticipants(browser, 2);
    const log = new LatencyLog();
    try {
      for (const p of [dana!, sam!]) await setCamera(p.page, CAMERA);
      const [a, b] = await seedShapes(dana!.page, [A, B]);
      await waitForObjects(sam!.page, [a!, b!]);

      // Dana connects A to B with the Connector tool.
      await drawArrow(dana!.page, { x: 480, y: 350 }, { x: 880, y: 350 });
      await expect.poll(async () => (await arrows(dana!.page)).length).toBe(1);
      const [arrow] = await arrows(dana!.page);
      expect(arrow!.from).toMatchObject({ kind: 'attached', objectId: a });
      expect(arrow!.to).toMatchObject({ kind: 'attached', objectId: b });
      const joined = { from: { x: 560, y: 350 }, to: { x: 800, y: 350 } };
      expect(arrow!.ends).toEqual(joined);
      await expect(dana!.page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => drawnEnds(sam!.page, arrow!.id), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toEqual(joined);

      // Dana drags B across the arrow's other end, to the left of A: both ends switch sides.
      await dana!.page.mouse.click(1100, 650);
      await dana!.page.mouse.move(880, 350);
      await dana!.page.mouse.down();
      await dana!.page.mouse.move(600, 360, { steps: 6 });
      await dana!.page.mouse.move(180, 350, { steps: 10 });
      const sentAt = Date.now();
      await dana!.page.mouse.up();
      await nextFrames(dana!.page);
      // B is now at x 100…260: A's left side faces B's right side.
      const switched = { from: { x: 400, y: 350 }, to: { x: 260, y: 350 } };
      await expect.poll(() => drawnEnds(dana!.page, arrow!.id)).toEqual(switched);
      await expect.poll(() => drawnEnds(sam!.page, arrow!.id), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toEqual(switched);
      log.record('moved shape → arrow redrawn on Sam', Date.now() - sentAt);

      // TC-26: Sam deletes B; the arrow stays, its end free where B's side was, on both screens.
      await sam!.page.mouse.click(180, 350);
      await expect.poll(() => sam!.page.evaluate(() => window.__vidi6?.getSelection?.())).toEqual([b]);
      await sam!.page.keyboard.press('Delete');
      for (const p of [sam!, dana!]) {
        await expect
          .poll(async () => (await objects(p.page)).some((o) => o.id === b), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
          .toBe(false);
        await expect.poll(async () => (await arrows(p.page))[0]?.to, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toEqual({
          kind: 'free',
          x: 260,
          y: 350,
        });
        expect(await drawnEnds(p.page, arrow!.id)).toEqual(switched);
      }
      for (const p of [dana!, sam!]) expect(p.problems).toEqual([]);
    } finally {
      await log.report(testInfo);
      await closeParticipants([dana!, sam!]);
    }
  });
});

test.describe('Delete race', () => {
  test('TC-27 Dana draws an arrow to B while Sam deletes B: the arrow shows with its end at the fallback', async ({ browser }) => {
    const boardId = await createBoardIn(browser);
    // Sam's outgoing socket traffic can be held back, so his delete reaches Dana only after her arrow exists.
    const held: { on: boolean; queue: (() => void)[] } = { on: false, queue: [] };
    const [dana, sam] = await openParticipants(browser, 2, boardId, {
      beforeOpen: async (page, index) => {
        if (index !== 1) return;
        await page.routeWebSocket(/\/api\/rooms\//, (ws) => {
          const server = ws.connectToServer();
          ws.onMessage((m) => {
            if (held.on) held.queue.push(() => server.send(m));
            else server.send(m);
          });
          server.onMessage((m) => ws.send(m));
        });
      },
    });
    try {
      for (const p of [dana!, sam!]) await setCamera(p.page, CAMERA);
      const [a, b] = await seedShapes(dana!.page, [A, B]);
      await waitForObjects(sam!.page, [a!, b!]);

      held.on = true;
      await sam!.page.evaluate((id) => window.__vidi6!.deleteObjects!([id]), b!);
      expect((await objects(sam!.page)).some((o) => o.id === b)).toBe(false);

      // Dana still sees B and connects A to it.
      await drawArrow(dana!.page, { x: 480, y: 350 }, { x: 880, y: 350 });
      await expect.poll(async () => (await arrows(dana!.page)).length).toBe(1);
      const [arrow] = await arrows(dana!.page);
      const fallback = { x: 800, y: 350 };
      expect(arrow!.to).toEqual({ kind: 'attached', objectId: b, fallback });

      // Sam gets the arrow for a shape he already deleted: drawn at the fallback.
      await expect
        .poll(() => drawnEnds(sam!.page, arrow!.id), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toEqual({ from: { x: 560, y: 350 }, to: fallback });

      // Sam's delete now reaches Dana: her arrow stays visible, its end at the fallback.
      held.on = false;
      for (const send of held.queue.splice(0)) send();
      await expect
        .poll(async () => (await objects(dana!.page)).some((o) => o.id === b), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(false);
      await expect(dana!.page.locator(`[data-connector-object][data-id="${arrow!.id}"]`)).toBeVisible();
      await expect.poll(() => drawnEnds(dana!.page, arrow!.id)).toEqual({ from: { x: 560, y: 350 }, to: fallback });
      for (const p of [dana!, sam!]) expect(p.problems).toEqual([]);
    } finally {
      await closeParticipants([dana!, sam!]);
    }
  });
});
