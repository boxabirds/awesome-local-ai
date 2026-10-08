/**
 * Story 10 e2e — connectors (design TC-25, TC-26, TC-27).
 *
 * Two real Chromium participants (Dana, Sam) on a board seeded from Node
 * with the checkout-flow fixture (four labelled shapes + three attached
 * connectors + one free-ended connector), driving the real UI and observing
 * through the test-only window.__vidi6 hooks.
 *
 * The default camera renders the world origin at screen (640,400) at zoom 1,
 * so screen = world + (640,400). Fixture centres (world):
 *   cart  (-220, -90)   pay (60, -90)   stock (340, -90)   ship (100, 170)
 */
import { expect, test } from '@playwright/test';
import { agentPort } from './helpers/wrangler-process';
import { createBoard, LatencyLog, Participant, sharedServerUrl } from './helpers/participants';
import { expectWithinPx } from './helpers/board';
import { NodeWsClient } from './helpers/node-ws-client';
import { buildCheckoutFlow, CHECKOUT_OBJECT_COUNT } from '../fixtures/checkout-flow';
import { allObjects, connectorBetween, type FlowObject } from './helpers/flow-objects';

/** Seeds the checkout flow from Node and waits until the room holds it. */
async function seededCheckoutBoard(): Promise<string> {
  const boardId = await createBoard(sharedServerUrl());
  const seeder = await NodeWsClient.connect(agentPort(1), boardId);
  await seeder.waitForSync();
  buildCheckoutFlow(seeder.doc, 'seeder');
  // A second client confirms the room applied (and stored) the seed before
  // the browsers join.
  const probe = await NodeWsClient.connect(agentPort(1), boardId);
  await probe.waitForSync();
  await probe.waitForNotes(CHECKOUT_OBJECT_COUNT);
  probe.close();
  seeder.close();
  return boardId;
}

/** The ids of the fixture objects on a participant's screen. */
async function fixtureIds(dana: Participant): Promise<Record<'cart' | 'pay' | 'stock' | 'ship', string>> {
  const objs = await allObjects(dana.page);
  const id = (label: string): string => {
    const o = objs.find((x) => x.label === label && x.kind !== undefined);
    if (o === undefined) {
      throw new Error(`fixture shape "${label}" not found`);
    }
    return o.id;
  };
  return { cart: id('Cart'), pay: id('Pay'), stock: id('Stock'), ship: id('Ship') };
}

/** Presses the L tool and drags an arrow from world a to world b. */
async function drawConnector(p: Participant, a: { x: number; y: number }, b: { x: number; y: number }): Promise<void> {
  await p.page.keyboard.press('l');
  await p.page.mouse.move(640 + a.x, 400 + a.y);
  await p.page.mouse.down();
  await p.page.mouse.move(640 + b.x, 400 + b.y, { steps: 10 });
  await p.page.mouse.up();
}

/** Clicks a world point and presses Delete (select + remove). */
async function deleteAtWorld(p: Participant, w: { x: number; y: number }): Promise<void> {
  await p.page.mouse.click(640 + w.x, 400 + w.y);
  await p.page.keyboard.press('Delete');
}

test('TC-25: Dana connects cart→ship and drags ship past cart; Sam sees the arrow stay attached and switch sides', async ({ browser }) => {
  const boardId = await seededCheckoutBoard();
  const ctx = await browser.newContext();
  const dana = await Participant.join(ctx, boardId);
  const sam = await Participant.join(ctx, boardId);
  const latency = new LatencyLog();
  try {
    const ids = await fixtureIds(dana);

    // Dana draws cart → ship (a fresh arrow: the fixture has none).
    const before = await allObjects(dana.page);
    expect(connectorBetween(before, ids.cart, ids.ship)).toBeNull();
    await drawConnector(dana, { x: -220, y: -90 }, { x: 100, y: 170 });
    const t0 = Date.now();

    // Sam sees the new attached arrow (latency reported, not asserted).
    await sam.waitFor(
      (objs) =>
        connectorBetween(objs as unknown as FlowObject[], ids.cart, ids.ship) !== null,
      'the new cart→ship arrow on Sam\'s screen',
    );
    latency.record('tc25-create→sam', Date.now() - t0);

    // The arrow resolves on the facing sides: from = cart bottom (-220,-40),
    // to = ship top (100,120).
    const both = (objs: readonly FlowObject[]): boolean => {
      const c = connectorBetween(objs, ids.cart, ids.ship);
      return c !== null && c.toPoint !== undefined && Math.abs(c.toPoint.x - 100) < 2 && Math.abs(c.toPoint.y - 120) < 2;
    };
    await dana.waitFor((objs) => both(objs as unknown as FlowObject[]), 'the arrow to attach');
    await sam.waitFor((objs) => both(objs as unknown as FlowObject[]), 'the arrow to attach (Sam)');

    // Dana drags ship straight up past cart: centre (100,170) → (100,-300).
    await dana.page.mouse.move(640 + 100, 400 + 170);
    await dana.page.mouse.down();
    await dana.page.mouse.move(640 + 100, 400 - 300, { steps: 16 });
    await dana.page.mouse.up();

    // Both screens: the arrow is still attached to ship, and its ends now
    // resolve on the switched sides (cart top (-220,-140), ship bottom
    // (100,-250)).
    const switched = (objs: readonly FlowObject[]): boolean => {
      const c = connectorBetween(objs, ids.cart, ids.ship);
      if (c === null || c.fromPoint === undefined || c.toPoint === undefined) {
        return false;
      }
      return (
        c.to !== undefined &&
        c.to.objectId === ids.ship &&
        Math.abs(c.toPoint.x - 100) < 2 &&
        Math.abs(c.toPoint.y - -250) < 2 &&
        Math.abs(c.fromPoint.x - -220) < 2 &&
        Math.abs(c.fromPoint.y - -140) < 2
      );
    };
    const t1 = Date.now();
    await dana.waitFor((objs) => switched(objs as unknown as FlowObject[]), 'the arrow to switch sides');
    await sam.waitFor((objs) => switched(objs as unknown as FlowObject[]), 'the arrow to switch sides (Sam)');
    latency.record('tc25-side-switch→sam', Date.now() - t1);

    expect(dana.hasErrors()).toBe(false);
    expect(sam.hasErrors()).toBe(false);
    latency.report('TC-25', 1000);
  } finally {
    await ctx.close();
  }
});

test('TC-26: Sam deletes stock; the attached arrow keeps a free end where stock\'s side was, on both screens', async ({ browser }) => {
  const boardId = await seededCheckoutBoard();
  const ctx = await browser.newContext();
  const dana = await Participant.join(ctx, boardId);
  const sam = await Participant.join(ctx, boardId);
  try {
    const ids = await fixtureIds(dana);

    // The fixture arrow pay→stock (and stock→free) exist before the delete.
    const before = await allObjects(sam.page);
    const payToStock = connectorBetween(before, ids.pay, ids.stock);
    expect(payToStock, 'fixture arrow pay→stock').not.toBeNull();

    // Sam selects stock (centre (340,-90)) and deletes it.
    await deleteAtWorld(sam, { x: 340, y: -90 });

    const settled = (objs: readonly FlowObject[]): boolean => {
      if (objs.some((o) => o.id === ids.stock)) {
        return false;
      }
      // No endpoint anywhere may still be attached to the deleted stock.
      if (
        objs.some(
          (o) =>
            (o.from !== undefined && o.from.kind === 'attached' && o.from.objectId === ids.stock) ||
            (o.to !== undefined && o.to.kind === 'attached' && o.to.objectId === ids.stock),
        )
      ) {
        return false;
      }
      // pay→stock survives with a free end at stock's left anchor (240,-90) …
      const payArrow = objs.find(
        (o) =>
          o.from !== undefined &&
          o.from.kind === 'attached' &&
          o.from.objectId === ids.pay &&
          o.to !== undefined &&
          o.to.kind === 'free' &&
          o.to.x === 240 &&
          o.to.y === -90,
      );
      if (
        payArrow === undefined ||
        payArrow.toPoint === undefined ||
        Math.abs(payArrow.toPoint.x - 240) > 1 ||
        Math.abs(payArrow.toPoint.y - -90) > 1
      ) {
        return false;
      }
      // … and stock's free-ended arrow lost its stock end at (340,-40).
      const detached = objs.find(
        (o) =>
          o.from !== undefined &&
          o.from.kind === 'free' &&
          o.to !== undefined &&
          o.to.kind === 'free' &&
          o.to.x === 480 &&
          o.to.y === 60,
      );
      return (
        detached !== undefined &&
        detached.from !== undefined &&
        Math.abs((detached.from.x ?? Number.NaN) - 340) < 1 &&
        Math.abs((detached.from.y ?? Number.NaN) - -40) < 1
      );
    };
    await dana.waitFor((objs) => settled(objs as unknown as FlowObject[]), 'the detached arrows on Dana\'s screen');
    await sam.waitFor((objs) => settled(objs as unknown as FlowObject[]), 'the detached arrows on Sam\'s screen');

    expect(dana.hasErrors()).toBe(false);
    expect(sam.hasErrors()).toBe(false);
  } finally {
    await ctx.close();
  }
});

test('TC-27: a create (Dana) racing a delete (Sam) leaves a visible arrow at the fallback, no console errors', async ({ browser }) => {
  const boardId = await seededCheckoutBoard();
  const ctx = await browser.newContext();
  const dana = await Participant.join(ctx, boardId);
  const sam = await Participant.join(ctx, boardId);
  try {
    const ids = await fixtureIds(dana);

    // Delay every OUTBOUND frame from Sam so the room applies Dana's create
    // before Sam's delete (the deterministic overlap the design asks for).
    await sam.page.evaluate(() => {
      const proto = WebSocket.prototype;
      const orig = proto.send;
      proto.send = function (
        this: WebSocket,
        data: string | ArrayBufferLike | ArrayBufferView<ArrayBufferLike> | Blob,
      ) {
        setTimeout(() => {
          if (this.readyState === WebSocket.OPEN) {
            orig.call(this, data);
          }
        }, 600);
      };
    });

    // Overlapping actions: Dana draws cart→ship while Sam deletes ship.
    await Promise.all([
      drawConnector(dana, { x: -220, y: -90 }, { x: 100, y: 170 }),
      deleteAtWorld(sam, { x: 100, y: 170 }),
    ]);

    // Both screens converge: no ship, and Dana's arrow is visible with its
    // end at the stored fallback (100,120) — whether the race detached it
    // (free) or left it attached to a now-missing ship (orphan; the renderer
    // falls back to the same point).
    /** The cart→ship arrow: still attached, or detached to the same point. */
    const cartArrow = (objs: readonly FlowObject[]): FlowObject | undefined =>
      objs.find(
        (o) =>
          o.from !== undefined &&
          o.from.kind === 'attached' &&
          o.from.objectId === ids.cart &&
          o.to !== undefined &&
          (o.to.objectId === ids.ship ||
            (o.to.kind === 'free' && o.to.x === 100 && o.to.y === 120)),
      );

    const settled = (objs: readonly FlowObject[]): boolean => {
      if (objs.some((o) => o.id === ids.ship)) {
        return false;
      }
      const c = cartArrow(objs);
      return c !== undefined && c.toPoint !== undefined && Math.abs(c.toPoint.x - 100) < 2 && Math.abs(c.toPoint.y - 120) < 2;
    };
    await dana.waitFor((objs) => settled(objs as unknown as FlowObject[]), 'the arrow at the fallback on Dana\'s screen');
    await sam.waitFor((objs) => settled(objs as unknown as FlowObject[]), 'the arrow at the fallback on Sam\'s screen');

    // The arrow is actually rendered (not just in the model).
    for (const p of [dana, sam]) {
      const objs = await allObjects(p.page);
      const c = cartArrow(objs)!;
      await p.page.locator(`[data-connector-object="${c.id}"]`).waitFor({ timeout: 5_000 });
    }

    expect(dana.hasErrors()).toBe(false);
    expect(sam.hasErrors()).toBe(false);
  } finally {
    await ctx.close();
  }
});
