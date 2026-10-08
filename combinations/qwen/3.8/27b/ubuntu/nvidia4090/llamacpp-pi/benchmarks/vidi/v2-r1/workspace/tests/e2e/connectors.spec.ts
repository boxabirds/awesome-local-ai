// Story 10 e2e (shapes config, chromium): collaborative connector behaviour.
//
//   TC-25  Dana connects A -> B and drags B past A; Sam's context sees the
//          arrow stay attached and switch side. The delivery time is logged
//          against LIVE_UPDATE_LATENCY_BUDGET_MS (not asserted).
//   TC-26  Sam deletes B; the A -> B arrow remains with a free end where B's
//          side was, on both screens.
//   TC-27  Delete race: Dana drags an arrow's end onto B while Sam deletes B
//          (the overlap is forced by holding the drag while Sam's delete
//          syncs) -> Dana's arrow is visible with its end at a free fallback
//          point and the page raises no console errors.
//
// The board is the checkout-flow fixture (tests/fixtures/checkout-flow.ts).
// A = shape 0 ("Start") and B = shape 2 ("Charge card") share a centre line,
// so the A -> B arrow attaches to their left/right sides and flips cleanly.

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';
import { createWranglerProcess, type WranglerProcess } from './wrangler-process';
import {
  createBoard,
  getObjects,
  openBoard,
  objectsOf,
  setCamera,
  seedCheckoutFlow,
  waitObjects,
  dragAt,
} from './shape-helpers';
import { CHECKOUT } from '../fixtures/checkout-flow';

const A_IDX = CHECKOUT.A; // "Start"
const B_IDX = CHECKOUT.B; // "Charge card"
const A_CX = 80; // A's centre x (same centre line as B)

/**
 * With the Connector tool, drag a new arrow from A's centre to B's centre
 * (camera at the origin, zoom 1: world == screen). Returns the new id.
 */
async function connectAB(page: Page, shapeIds: string[]): Promise<string> {
  const A = shapeIds[A_IDX]!;
  const B = shapeIds[B_IDX]!;
  const before = new Set((await objectsOf(page, 'connector')).map((o) => o.id));
  const objs = await getObjects(page);
  const a = objs.get(A)!;
  const b = objs.get(B)!;
  const acx = a.x + a.width / 2;
  const acy = a.y + a.height / 2;
  const bcx = b.x + b.width / 2;
  const bcy = b.y + b.height / 2;

  await page.keyboard.press('l');
  await page.mouse.move(acx, acy);
  await page.mouse.down();
  await page.mouse.move(bcx, bcy, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(async () => (await objectsOf(page, 'connector')).length, { timeout: 10000 })
    .toBe(before.size + 1);
  const after = (await objectsOf(page, 'connector')).map((o) => o.id);
  return after.find((x) => !before.has(x))!;
}

/** Log a delivery time against the live-update budget (never asserts it). */
function logDelivery(name: string, ms: number): void {
  const over = ms > LIVE_UPDATE_LATENCY_BUDGET_MS;
  console.log(
    `[delivery] ${name}: ${ms}ms ` +
      `(${over ? 'over' : 'within'} the ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms budget)`,
  );
  test.info().annotations.push({
    type: 'delivery',
    description: `${name}: ${ms}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`,
  });
}

/** Measure how long until `page` satisfies `predicate`, from now. */
async function measureUntil(
  page: Page,
  predicate: () => Promise<boolean>,
): Promise<number> {
  const t0 = Date.now();
  await expect.poll(predicate, { timeout: 15000 }).toBe(true);
  return Date.now() - t0;
}

test.describe('story 10: collaborative connectors (wrangler)', () => {
  test('TC-25: Dana connects A->B and drags B past A; Sam sees it attached and switching side', async ({ browser }) => {
    const ctxs: BrowserContext[] = [];
    const wrangler: WranglerProcess = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);
      const danaCtx = await browser.newContext();
      const samCtx = await browser.newContext();
      ctxs.push(danaCtx, samCtx);
      const dana = await danaCtx.newPage();
      const sam = await samCtx.newPage();
      await openBoard(dana, boardId);
      const shapeIds = await seedCheckoutFlow(dana);
      await openBoard(sam, boardId);
      await setCamera(dana, { x: 0, y: 0, zoom: 1 });
      await setCamera(sam, { x: 0, y: 0, zoom: 1 });
      await waitObjects([dana, sam], 'shape', 4);
      await waitObjects([dana, sam], 'connector', 4);

      const A = shapeIds[A_IDX]!;
      const B = shapeIds[B_IDX]!;

      // Dana connects A -> B.
      const newId = await connectAB(dana, shapeIds);
      const delivered = await measureUntil(
        sam,
        async () => {
          const c = (await getObjects(sam)).get(newId);
          return c?.from?.kind === 'attached' && c.from.objectId === A &&
            c.to?.kind === 'attached' && c.to.objectId === B;
        },
      );
      logDelivery('connect A->B visible to Sam', delivered);

      // Dana drags B left, past A (B centre 660 -> 60, left of A's centre 80).
      const b = (await getObjects(dana)).get(B)!;
      const bcx = b.x + b.width / 2;
      const bcy = b.y + b.height / 2;
      await dragAt(dana, bcx, bcy, 60 - bcx, 0);
      await expect
        .poll(async () => {
          const bb = (await getObjects(dana)).get(B)!;
          return bb.x + bb.width / 2 < A_CX;
        }, { timeout: 15000 })
        .toBe(true);

      const sideFlip = await measureUntil(
        sam,
        async () => {
          const objs = await getObjects(sam);
          const c = objs.get(newId);
          const bb = objs.get(B);
          if (!c || !bb) return false;
          if (c.from?.kind !== 'attached' || c.from.objectId !== A) return false;
          if (c.to?.kind !== 'attached' || c.to.objectId !== B) return false;
          if (!(bb.x + bb.width / 2 < A_CX)) return false;
          // The arrow's B end is now on B's right side (it switched side).
          return !!c.toPoint && c.toPoint.x - bb.x > bb.width / 2;
        },
      );
      logDelivery('B moved past A + side switch visible to Sam', sideFlip);

      // Functional assertions: on both screens the arrow is attached to both
      // and its B end is on B's right side.
      for (const p of [dana, sam]) {
        const objs = await getObjects(p);
        const c = objs.get(newId)!;
        const bb = objs.get(B)!;
        expect(c.from?.kind).toBe('attached');
        expect(c.from?.objectId).toBe(A);
        expect(c.to?.kind).toBe('attached');
        expect(c.to?.objectId).toBe(B);
        expect(c.toPoint).toBeDefined();
        expect(c.toPoint!.x - bb.x).toBeGreaterThan(bb.width / 2);
      }

      for (const c of ctxs) await c.close();
    } finally {
      await Promise.all(ctxs.map((c) => c.close().catch(() => undefined)));
      await wrangler.dispose();
    }
  });

  test('TC-26: Sam deletes B -> the arrow remains with a free end where B was, on both screens', async ({ browser }) => {
    const ctxs: BrowserContext[] = [];
    const wrangler: WranglerProcess = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);
      const danaCtx = await browser.newContext();
      const samCtx = await browser.newContext();
      ctxs.push(danaCtx, samCtx);
      const dana = await danaCtx.newPage();
      const sam = await samCtx.newPage();
      await openBoard(dana, boardId);
      const shapeIds = await seedCheckoutFlow(dana);
      await openBoard(sam, boardId);
      await setCamera(dana, { x: 0, y: 0, zoom: 1 });
      await setCamera(sam, { x: 0, y: 0, zoom: 1 });
      await waitObjects([dana, sam], 'shape', 4);
      await waitObjects([dana, sam], 'connector', 4);

      const A = shapeIds[A_IDX]!;
      const B = shapeIds[B_IDX]!;

      const newId = await connectAB(dana, shapeIds);
      await waitObjects([dana, sam], 'connector', 5);

      // Dana drags B left, past A (so the arrow's B end is on B's right side).
      const b = (await getObjects(dana)).get(B)!;
      await dragAt(dana, b.x + b.width / 2, b.y + b.height / 2, 60 - (b.x + b.width / 2), 0);
      await waitObjects([dana, sam], 'shape', 4);
      await expect
        .poll(async () => {
          const bb = (await getObjects(sam)).get(B)!;
          return bb.x + bb.width / 2 < A_CX;
        }, { timeout: 15000 })
        .toBe(true);

      // Sam selects and deletes B.
      const bb = (await getObjects(sam)).get(B)!;
      await sam.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await sam.keyboard.press('Delete');

      // Both screens: B is gone; the arrow remains with a free B end at the
      // place of B's (right) side, and A end still attached.
      await waitObjects([dana, sam], 'shape', 3);
      for (const p of [dana, sam]) {
        await expect
          .poll(async () => {
            const objs = await getObjects(p);
            const c = objs.get(newId);
            return !!c && c.to?.kind === 'free';
          }, { timeout: 15000 })
          .toBe(true);
        const objs = await getObjects(p);
        const c = objs.get(newId)!;
        expect(c.from?.kind).toBe('attached');
        expect(c.from?.objectId).toBe(A);
        expect(c.to?.kind).toBe('free');
        // The free end sits at B's right side (B right edge, centre line y=80).
        expect(c.to!.x).toBeCloseTo(160, 0);
        expect(c.to!.y).toBeCloseTo(80, 0);
      }

      for (const c of ctxs) await c.close();
    } finally {
      await Promise.all(ctxs.map((c) => c.close().catch(() => undefined)));
      await wrangler.dispose();
    }
  });

  test('TC-27: delete race — Dana drags an end onto B as Sam deletes B: fallback end, no console errors', async ({ browser }) => {
    const ctxs: BrowserContext[] = [];
    const wrangler: WranglerProcess = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);
      const danaCtx = await browser.newContext();
      const samCtx = await browser.newContext();
      ctxs.push(danaCtx, samCtx);
      const dana = await danaCtx.newPage();
      const sam = await samCtx.newPage();

      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      dana.on('pageerror', (e) => pageErrors.push(String(e)));
      dana.on('console', (msg) => {
        if (msg.type() === 'error' && !/Failed to load resource/i.test(msg.text())) {
          consoleErrors.push(msg.text());
        }
      });

      await openBoard(dana, boardId);
      const shapeIds = await seedCheckoutFlow(dana);
      await openBoard(sam, boardId);
      await setCamera(dana, { x: 0, y: 0, zoom: 1 });
      await setCamera(sam, { x: 0, y: 0, zoom: 1 });
      await waitObjects([dana, sam], 'shape', 4);
      await waitObjects([dana, sam], 'connector', 4);

      const A = shapeIds[A_IDX]!;
      const B = shapeIds[B_IDX]!;

      // Dana connects A -> B, then selects the arrow.
      const newId = await connectAB(dana, shapeIds);
      await waitObjects([dana, sam], 'connector', 5);

      // Select the arrow (click its line, mid-way between A and B at y=80).
      await dana.mouse.click(360, 80);
      await expect
        .poll(async () =>
          dana.locator('[data-testid="connector-object"]').count(), { timeout: 10000 })
        .toBeGreaterThan(0);

      // Dana grabs the 'to' end (on B) and drags it away, then back over B,
      // holding the pointer there (no release yet).
      const handle = dana.getByTestId('connector-handle-to');
      const hb = await handle.boundingBox();
      if (!hb) throw new Error('connector to-handle not found');
      const hx = hb.x + hb.width / 2;
      const hy = hb.y + hb.height / 2;
      await dana.mouse.move(hx, hy);
      await dana.mouse.down();
      await dana.mouse.move(400, 300, { steps: 8 }); // away over empty space
      const b = (await getObjects(dana)).get(B)!;
      const bcx = b.x + b.width / 2;
      const bcy = b.y + b.height / 2;
      await dana.mouse.move(bcx, bcy, { steps: 8 }); // back over B, hold

      // While Dana holds over B, Sam deletes B; wait for it to reach Dana.
      await sam.mouse.click(bcx, bcy);
      await sam.keyboard.press('Delete');
      await expect
        .poll(async () => (await objectsOf(dana, 'shape')).length, { timeout: 15000 })
        .toBe(3);

      // Dana releases over B's (now empty) spot.
      await dana.mouse.up();

      // Dana's arrow is visible; its dragged end is free (fallback), the A end
      // still attached. No console errors.
      await expect
        .poll(async () => {
          const c = (await getObjects(dana)).get(newId);
          return !!c && c.to?.kind === 'free';
        }, { timeout: 15000 })
        .toBe(true);
      const c = (await getObjects(dana)).get(newId)!;
      expect(c.from?.kind).toBe('attached');
      expect(c.from?.objectId).toBe(A);
      expect(c.to?.kind).toBe('free');

      // Sam converges: the arrow is present with a free end.
      await expect
        .poll(async () => {
          const cc = (await getObjects(sam)).get(newId);
          return !!cc && cc.to?.kind === 'free';
        }, { timeout: 15000 })
        .toBe(true);

      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);

      for (const c of ctxs) await c.close();
    } finally {
      await Promise.all(ctxs.map((c) => c.close().catch(() => undefined)));
      await wrangler.dispose();
    }
  });
});
