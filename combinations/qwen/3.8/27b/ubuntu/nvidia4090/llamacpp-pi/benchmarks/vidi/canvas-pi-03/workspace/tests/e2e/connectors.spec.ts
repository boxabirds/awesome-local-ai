import { test, expect, type Page } from '@playwright/test';
import { getObjects, type ObjectSnapshot } from './helpers/board';
import { buildCheckoutFlow, type CheckoutFlow } from '../fixtures/checkout-flow';
import {
  closeAll,
  dropConnection,
  expectWithin,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  newBoardId,
  openBoard,
  resumeConnection,
} from './participants';

/**
 * Story 10 e2e (chromium): connectors that follow their objects over the
 * real sync path. The board is seeded with the "Checkout flow" fixture
 * (4 labelled shapes, 3 attached arrows + 1 free-ended arrow) via the
 * `applyUpdates` test hook.
 *
 * Camera is (-640, -360) at zoom 1: screen = world + (640, 360).
 *   Start  (-500,-60,120,90)  centre screen (200, 345)
 *   Charge (-200,-60,120,90)  centre screen (500, 345)
 *   Card   ( 100,-60,120,90)  centre screen (800, 345)
 *   Done   ( 400,-60,120,90)  centre screen (1100, 345)
 */

async function seedFlow(page: Page): Promise<CheckoutFlow> {
  const flow = buildCheckoutFlow();
  await page.evaluate((u) => (window as any).__vidi6?.applyUpdates([u]), flow.update);
  await expect
    .poll(async () => (await getObjects(page)).filter((o) => o.type === 'shape').length, { timeout: 5000 })
    .toBe(4);
  return flow;
}

async function getObj(page: Page, id: string): Promise<ObjectSnapshot | undefined> {
  return (await getObjects(page)).find((o) => o.id === id);
}

async function waitForFlowOn(page: Page): Promise<void> {
  await expect
    .poll(async () => (await getObjects(page)).filter((o) => o.type === 'shape').length, { timeout: 10_000 })
    .toBe(4);
}

/** Clicks a shape's centre to select it. */
async function selectShape(page: Page, o: ObjectSnapshot): Promise<void> {
  const cam = { x: -640, y: -360, zoom: 1 };
  const sx = (o.x + (o.width ?? 0) / 2 - cam.x) * cam.zoom;
  const sy = (o.y + (o.height ?? 0) / 2 - cam.y) * cam.zoom;
  await page.mouse.click(sx, sy);
}

interface EndState {
  /** The object the end is attached to (null: free end). */
  attachedTo: string | null;
  /** The resolved point (world units) the end is drawn at. */
  point: { x: number; y: number };
}

async function connectorEnds(page: Page, id: string): Promise<{ from: EndState; to: EndState } | null> {
  const c = await getObj(page, id);
  if (c === undefined || c.type !== 'connector') return null;
  const snapEnd = (e: ObjectSnapshot['from'], p: { x: number; y: number } | undefined): EndState => ({
    attachedTo: e?.kind === 'attached' ? e.objectId ?? null : null,
    point: p ?? { x: 0, y: 0 },
  });
  return { from: snapEnd(c.from, c.fromPoint), to: snapEnd(c.to, c.toPoint) };
}

/** True when both ends match the expected attached/free state and points. */
async function endsMatch(page: Page, id: string, want: { from: EndState; to: EndState }): Promise<boolean> {
  const got = await connectorEnds(page, id);
  if (got === null) return false;
  const ok = (a: EndState, b: EndState): boolean =>
    a.attachedTo === b.attachedTo &&
    Math.abs(a.point.x - b.point.x) <= 0.01 &&
    Math.abs(a.point.y - b.point.y) <= 0.01;
  return ok(got.from, want.from) && ok(got.to, want.to);
}

test.describe('story 10: connectors (e2e)', () => {
  test('TC-25: dragging B past A keeps the arrow attached and switches sides on both screens', async ({ browser }) => {
    const boardId = newBoardId();
    const dana = await openBoard(browser, boardId);
    const flow = await seedFlow(dana.page);
    const sam = await openBoard(browser, boardId);
    try {
      const A = flow.shapes[0]; // Start
      const B = flow.shapes[1]; // Charge
      const conn = flow.connectors.find((c) => c.fromId === A.id && c.toId === B.id);
      if (conn === undefined) throw new Error('fixture has no Start->Charge arrow');

      await waitForFlowOn(sam.page);

      // Pre-state on both screens: A's right anchor, B's left anchor.
      const pre = {
        from: { attachedTo: A.id, point: { x: -380, y: -15 } },
        to: { attachedTo: B.id, point: { x: -200, y: -15 } },
      };
      expect(await endsMatch(dana.page, conn.id, pre)).toBe(true);
      expect(await endsMatch(sam.page, conn.id, pre)).toBe(true);

      // Dana drags B from its centre (screen 500,345) to a centre left of A
      // (world -620,-15 -> screen 20,345): B's new box is (-680,-60,120,90).
      await dana.page.mouse.move(500, 345);
      await dana.page.mouse.down();
      await dana.page.mouse.move(20, 345, { steps: 15 });
      await dana.page.mouse.up();

      // Dana's local state: B moved, arrow switched sides (A left, B right).
      const post = {
        from: { attachedTo: A.id, point: { x: -500, y: -15 } },
        to: { attachedTo: B.id, point: { x: -560, y: -15 } },
      };
      await expect
        .poll(async () => (await getObj(dana.page, B.id))?.x !== undefined && Math.abs((await getObj(dana.page, B.id))!.x - (-680)) <= 1, {
          timeout: 5000,
        })
        .toBe(true);
      expect(await endsMatch(dana.page, conn.id, post)).toBe(true);

      // Sam's context sees the same switched arrow within the budget.
      await expectWithin(
        LIVE_UPDATE_LATENCY_BUDGET_MS,
        'Sam sees the arrow still attached and switched side',
        async () => endsMatch(sam.page, conn.id, post),
      );
    } finally {
      await closeAll(dana, sam);
    }
  });

  test('TC-26: deleting B leaves the two arrows with free ends where B was, on both screens', async ({ browser }) => {
    const boardId = newBoardId();
    const dana = await openBoard(browser, boardId);
    const flow = await seedFlow(dana.page);
    const sam = await openBoard(browser, boardId);
    try {
      const A = flow.shapes[0]; // Start
      const B = flow.shapes[1]; // Charge
      const C = flow.shapes[2]; // Card
      const ab = flow.connectors.find((c) => c.fromId === A.id && c.toId === B.id);
      const bc = flow.connectors.find((c) => c.fromId === B.id && c.toId === C.id);
      if (ab === undefined || bc === undefined) throw new Error('fixture arrows missing');

      await waitForFlowOn(sam.page);

      // Sam selects B and deletes it.
      const bOnSam = (await getObj(sam.page, B.id))!;
      await selectShape(sam.page, bOnSam);
      await sam.page.keyboard.press('Delete');
      await expect
        .poll(async () => (await getObj(sam.page, B.id)) === undefined, { timeout: 5000 })
        .toBe(true);

      // The arrows remain: the B ends are FREE at the side anchors B occupied
      // (its left and right midpoints).
      const wantAb = {
        from: { attachedTo: A.id, point: { x: -380, y: -15 } },
        to: { attachedTo: null, point: { x: -200, y: -15 } },
      };
      const wantBc = {
        from: { attachedTo: null, point: { x: -80, y: -15 } },
        to: { attachedTo: C.id, point: { x: 100, y: -15 } },
      };
      expect(await endsMatch(sam.page, ab.id, wantAb)).toBe(true);
      expect(await endsMatch(sam.page, bc.id, wantBc)).toBe(true);

      // Dana's screen catches up within the budget.
      await expectWithin(
        LIVE_UPDATE_LATENCY_BUDGET_MS,
        'Dana sees the arrows detached at B former side anchors',
        async () => (await endsMatch(dana.page, ab.id, wantAb)) && (await endsMatch(dana.page, bc.id, wantBc)),
      );
    } finally {
      await closeAll(dana, sam);
    }
  });

  test('TC-27: Dana connects to B while Sam deletes B; the arrow survives at its fallback, no console errors', async ({ browser }) => {
    const boardId = newBoardId();
    const dana = await openBoard(browser, boardId);
    const flow = await seedFlow(dana.page);
    const sam = await openBoard(browser, boardId);
    try {
      const A = flow.shapes[0]; // Start
      const B = flow.shapes[1]; // Charge
      const fixtureConnectorIds = new Set(flow.connectors.map((c) => c.id));

      await waitForFlowOn(sam.page);

      // Count page errors from here on.
      const pageErrors: string[] = [];
      dana.page.on('pageerror', (err) => pageErrors.push(String(err)));
      dana.page.on('console', (msg) => {
        if (msg.type() === 'error') pageErrors.push(msg.text());
      });
      sam.page.on('pageerror', (err) => pageErrors.push(`sam: ${String(err)}`));

      // Sam goes dark: his deletion cannot reach Dana while the socket is
      // down (Playwright setOffline does not tear down an open socket, so
      // the test-build dropConnection hook does the job).
      await dropConnection(sam.page);
      const bOnSam = (await getObj(sam.page, B.id))!;
      await selectShape(sam.page, bOnSam);
      await sam.page.keyboard.press('Delete');
      await expect
        .poll(async () => (await getObj(sam.page, B.id)) === undefined, { timeout: 5000 })
        .toBe(true);

      // Dana still sees B. She drags a NEW arrow from A's right side onto
      // B: press at screen (250,345) = world (-390,-15) inside A near its
      // right edge (anchor -380,-15); release at (450,345) = world
      // (-190,-15) inside B (anchor -200,-15).
      await dana.page.keyboard.press('l');
      await dana.page.mouse.move(250, 345);
      await dana.page.mouse.down();
      await dana.page.mouse.move(450, 345, { steps: 10 });
      await dana.page.mouse.up();

      // The new connector (the one Dana made, not a fixture arrow).
      let newId: string | null = null;
      await expect
        .poll(async () => {
          const conns = (await getObjects(dana.page)).filter(
            (o) => o.type === 'connector' && !fixtureConnectorIds.has(o.id),
          );
          const mine = conns.find(
            (c) => c.from?.kind === 'attached' && c.from?.objectId === A.id && c.to?.kind === 'attached' && c.to?.objectId === B.id,
          );
          newId = mine?.id ?? null;
          return newId !== null;
        }, { timeout: 5000 })
        .toBe(true);

      // The network returns: Sam's deletion reaches Dana and Dana's arrow
      // reaches Sam. On BOTH screens the arrow is visible with its B end at
      // the fallback (B's former left anchor) — it was attached to an object
      // that no longer exists (connector.target_deleted).
      await resumeConnection(sam.page);

      const want = {
        from: { attachedTo: A.id, point: { x: -380, y: -15 } },
        to: { attachedTo: B.id, point: { x: -200, y: -15 } }, // stored attached, drawn at fallback
      };
      await expectWithin(10_000, 'Dana sees her arrow at the fallback point', async () =>
        endsMatch(dana.page, newId!, want),
      );
      await expectWithin(10_000, 'Sam sees the orphaned arrow at the fallback point', async () =>
        endsMatch(sam.page, newId!, want),
      );

      // The orphaned end renders at the fallback: the snapshot point equals
      // the stored fallback even though B is gone on both docs.
      const cDana = (await getObj(dana.page, newId!))!;
      if (cDana.to?.kind !== 'attached') throw new Error('to end should stay stored attached');
      expect(cDana.to?.fallback).toEqual({ x: -200, y: -15 });

      // No console/page errors on either page during the whole overlap.
      expect(pageErrors).toEqual([]);
    } finally {
      await closeAll(dana, sam);
    }
  });
});
