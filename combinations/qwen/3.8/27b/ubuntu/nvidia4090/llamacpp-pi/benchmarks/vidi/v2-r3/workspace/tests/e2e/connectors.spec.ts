import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { apiCreateBoard, logLatency, openBoard, setCamera } from './helpers';
import {
  buildCheckoutFlow,
  connectorIds,
  hasObject,
  readEndpoint,
  seedCheckoutFlow,
  shapeCount,
  type CheckoutFlow,
} from '../fixtures/checkout-flow';

/**
 * Story 10 e2e (connectors.spec.ts): connectors that follow their shapes
 * (TC-25), the delete-keeps-the-arrow behaviour (TC-26) and the concurrent
 * delete/create race (TC-27).
 *
 * Every page uses camera (0,0,1), so screen coordinates equal world units.
 */

interface Participant {
  context: BrowserContext;
  page: Page;
}

async function join(browser: Browser, boardId: string): Promise<Participant> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openBoard(page, boardId);
  await setCamera(page, 0, 0, 1);
  return { context, page };
}

async function closeAll(...ps: Participant[]): Promise<void> {
  await Promise.all(
    ps.map(async (p) => {
      await p.page.close().catch(() => undefined);
      await p.context.close().catch(() => undefined);
    }),
  );
}

/** Two participants on a fresh board, both showing the checkout-flow fixture. */
async function twoWithFlow(browser: Browser, request: import('@playwright/test').APIRequestContext) {
  const board = await apiCreateBoard(request);
  const a = await join(browser, board);
  const b = await join(browser, board);
  const flow = buildCheckoutFlow();
  // Seeding through Dana's doc: the update is broadcast to Sam over the server.
  await seedCheckoutFlow(a.page, flow);
  await expect.poll(() => shapeCount(a.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(4);
  await expect.poll(() => shapeCount(b.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(4);
  return { a, b, flow, board };
}

/**
 * Delete the single object whose centre is at screen (sx, sy): select it
 * (click), then press Delete. (The "Delete selection" bar only renders for
 * multi-selections; a single shape has no delete button of its own.)
 */
async function deleteAt(page: Page, sx: number, sy: number): Promise<void> {
  await page.mouse.click(sx, sy);
  await page.keyboard.press('Delete');
}

test.describe('connectors (real browsers + wrangler dev)', () => {
  test('TC-25: Dana connects A→B and drags B past A; Sam sees the arrow follow and switch sides', async ({
    browser,
    request,
  }) => {
    const { a, b, flow } = await twoWithFlow(browser, request);
    const dana = a.page;
    const sam = b.page;
    try {
      // Dana connects A = Pick (centre 500,160) → B = Ship (centre 790,160).
      const before = await connectorIds(dana);
      await dana.keyboard.press('l');
      await expect(dana.locator('[data-connector-tool-layer]')).toBeVisible();
      await dana.mouse.move(500, 160);
      await dana.mouse.down();
      await dana.mouse.move(790, 160, { steps: 10 });
      await dana.mouse.up();
      const after = await connectorIds(dana);
      expect(after).toHaveLength(before.length + 1);
      const newConn = after.find((id) => !before.includes(id))!;
      // Sam's client sees the new connector too.
      await expect.poll(() => hasObject(sam, newConn), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(true);

      // Drag B (Ship) past A (Pick): centre (790,160) → (350,160). Ship is now
      // left of Pick, so the new connector's ends must switch sides:
      // Pick's left (420,160) → Ship's right (440,160).
      const t0 = Date.now();
      await dana.mouse.move(790, 160);
      await dana.mouse.down();
      await dana.mouse.move(350, 160, { steps: 15 });
      await dana.mouse.up();
      const line = sam.locator(`[data-connector-id="${newConn}"] [data-connector-line]`);
      await logLatency('arrow follows + switches side (Sam)', t0, async () => {
        const box = await line.boundingBox();
        return box !== null && box.x >= 415 && box.x <= 445 && box.width > 5 && box.width < 40;
      });

      // On Sam's doc the end is still attached to B (nothing was detached),
      // and B's centre is now (350,160).
      const to = await readEndpoint(sam, newConn, 'to');
      expect(to.kind).toBe('attached');
      expect(to.objectId).toBe(flow.ids.ship);
      const shipX = await sam.evaluate(
        (id) => (window.__vidi6!.doc.getMap('objects').get(id) as { get(k: string): unknown }).get('x'),
        flow.ids.ship,
      );
      expect(shipX).toBe(260); // 700 - 440
    } finally {
      await closeAll(a, b);
    }
  });

  test('TC-26: Sam deletes B → the arrow remains with a free end at the side where B used to be, on both screens', async ({
    browser,
    request,
  }) => {
    const { a, b, flow } = await twoWithFlow(browser, request);
    const dana = a.page;
    const sam = b.page;
    try {
      // The fixture's Ship→Done connector: from Ship's right (880,160) to
      // Done's left (950,160).
      const line = (p: Page) => p.locator(`[data-connector-id="${flow.ids.cShipDone}"] [data-connector-line]`);
      // The line is (880,160)→(950,160); the round linecap adds ~1px each end.
      const beforeBox = (await line(dana).boundingBox())!;
      expect(beforeBox.x).toBeGreaterThanOrEqual(878);
      expect(beforeBox.x).toBeLessThanOrEqual(882);
      expect(beforeBox.width).toBeGreaterThan(68);
      expect(beforeBox.width).toBeLessThanOrEqual(74);

      // Sam deletes B = Ship (centre 790,160).
      await deleteAt(sam, 790, 160);
      await expect.poll(() => shapeCount(sam), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(3);
      await expect.poll(() => shapeCount(dana), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(3);

      // Both screens: the arrow is still there, with the end freed at the
      // side anchor where Ship used to be (880,160) — the same rendered line.
      for (const p of [dana, sam]) {
        const still = await hasObject(p, flow.ids.cShipDone);
        expect(still).toBe(true);
        const from = await readEndpoint(p, flow.ids.cShipDone, 'from');
        expect(from.kind).toBe('free');
        expect(from.x).toBe(880);
        expect(from.y).toBe(160);
        const box = (await line(p).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(878);
        expect(box.x).toBeLessThanOrEqual(882);
        expect(box.width).toBeGreaterThan(68);
        expect(box.width).toBeLessThanOrEqual(74);
      }
      // No connector is removed: the fixture's 4 remain (deleting Ship frees
      // the two ends that touched it — Pick→Ship's to end and Ship→Done's
      // from end — but removes no connector).
      expect((await connectorIds(sam)).length).toBe(4);
    } finally {
      await closeAll(a, b);
    }
  });

  test('TC-27: Dana drags an arrow onto B while Sam deletes B → the arrow renders at the fallback, no console errors', async ({
    browser,
    request,
  }) => {
    const { a, b, flow } = await twoWithFlow(browser, request);
    const dana = a.page;
    const sam = b.page;
    const consoleErrors: string[] = [];
    dana.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    try {
      const B = flow.ids.done; // Done: centre (1050,160), left side (950,160)
      const A = flow.ids.ship; // Ship: centre (790,160)

      // Dana goes stale: her drag + release happen against a doc that still
      // contains B, while Sam (online) deletes B in the meantime. On
      // reconnection Dana's create reaches the server after Sam's delete, so
      // the connector ends attached to a missing object (the concurrent
      // delete/create race).
      const before = await connectorIds(dana);
      await a.context.setOffline(true);
      await dana.keyboard.press('l');
      await dana.mouse.move(790, 160);
      await dana.mouse.down();
      await dana.mouse.move(1050, 160, { steps: 10 });
      await dana.mouse.up();
      // Dana released with B still in her view: the end is attached to B with
      // the side anchor (950,160) as fallback.
      // Now Sam deletes B while Dana is offline.
      await deleteAt(sam, 1050, 160);
      await expect.poll(() => shapeCount(sam), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(3);

      // Dana comes back: her create (attached to B) merges with Sam's delete.
      await a.context.setOffline(false);
      await expect
        .poll(async () => dana.evaluate(() => window.__vidi6?.connectionState), { timeout: 30_000 })
        .toBe('connected');
      await expect.poll(() => shapeCount(dana), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(3);
      await expect.poll(() => hasObject(dana, B), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(false);

      const newConn = (await connectorIds(dana)).find((id) => !before.includes(id));
      expect(newConn).toBeTruthy();
      // The orphaned end: still attached to the missing B, carrying the
      // fallback where B's left side used to be.
      const to = await readEndpoint(dana, newConn!, 'to');
      expect(to.kind).toBe('attached');
      expect(to.objectId).toBe(B);
      expect(to.fallback).toEqual({ x: 950, y: 160 });
      // And it renders at the fallback: the line's right end is at x≈950.
      const box = (await dana.locator(`[data-connector-id="${newConn}"] [data-connector-line]`).boundingBox())!;
      expect(box.x + box.width).toBeGreaterThan(948);
      expect(box.x + box.width).toBeLessThan(952);
      // No uncaught errors on Dana's page.
      expect(consoleErrors.filter((e) => !/favicon|404/i.test(e))).toEqual([]);
    } finally {
      await closeAll(a, b);
    }
  }, 180_000);
});
