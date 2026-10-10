import { expect, test, type Page } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../src/shared/config';
import {
  CHECKOUT_FLOW_CONNECTORS,
  CHECKOUT_FLOW_SHAPES,
} from '../fixtures/checkout-flow';
import { openBoard } from './helpers/board';
import { setFlatCamera } from './helpers/selection';
import { joinBoard, newLiveBoardId, trackErrors, waitForBoardConnection } from './helpers/live';
import {
  createShapeOnBoard,
  dragShapeBy,
  getShapes,
  shapeCentre,
  shapeScreenOf,
  waitForSameShapes,
  waitForShapeCount,
  waitForShapeGone,
  waitForShapeSelected,
} from './helpers/shapes';
import {
  clickConnectorAt,
  connectorOf,
  createConnectorOnBoard,
  drawnAttachSide,
  drawnConnectorEnds,
  getConnectors,
  pressConnectorTool,
  waitForConnectorCount,
  waitForConnectorEndNear,
  waitForSameConnectors,
} from './helpers/connectors';

/**
 * Story 10 - arrows that follow the shapes they join, in real browsers on the real
 * sync server (task 15).
 *
 * Anchors: `connector.tool` (drawing one), `connector.follow` (an arrow stays
 * attached and moves when a shape moves, on every screen), `connector.detach`
 * (deleting a shape leaves the arrow with a free end where that shape's side was)
 * and `connector.orphaned` (an arrow aimed at a shape that is going away still ends
 * somewhere a person can see). TC-25, TC-26 and TC-27.
 *
 * The layout every test starts from, in world units at 100%:
 *
 *   A: centre (300, 300) - rect 220,220 160x160
 *   B: centre (700, 300) - rect 620,220 160x160
 *
 * so an arrow from A to B runs along the horizontal, from A's right side to B's left
 * side. Nothing in the document stores a side, so each test reads the side back out
 * of the two points the page resolved - which is the whole design of
 * `connector.endpoints` and `connector.follow`.
 */

const A_CENTRE = { x: 300, y: 300 };
const B_CENTRE = { x: 700, y: 300 };
const A_RECT = { x: 220, y: 220, width: 160, height: 160 };
const B_RECT = { x: 620, y: 220, width: 160, height: 160 };

/** The four side midpoints of a rectangle. */
function sideMidpoints(rect: { x: number; y: number; width: number; height: number }) {
  return [
    { x: rect.x, y: rect.y + rect.height / 2 },
    { x: rect.x + rect.width, y: rect.y + rect.height / 2 },
    { x: rect.x + rect.width / 2, y: rect.y },
    { x: rect.x + rect.width / 2, y: rect.y + rect.height },
  ];
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

async function centreOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  const shapes = await getShapes(page);
  const found = shapes.find((shape) => shape.id === id);
  if (!found) {
    throw new Error(`shape ${id} is not on ${page.url()}`);
  }
  return { x: found.x + found.width / 2, y: found.y + found.height / 2 };
}

/** One shape each, put on one page, agreed on by every page. */
async function seedTwoShapes(
  page: Page,
  others: readonly Page[],
): Promise<{ a: string; b: string }> {
  const a = await createShapeOnBoard(page, A_CENTRE, { label: 'A' });
  const b = await createShapeOnBoard(page, B_CENTRE, { label: 'B' });
  await waitForSameShapes([page, ...others]);
  return { a, b };
}

/** The product's way of deleting: click the shape, then the Delete key. */
async function deleteShapeByKey(page: Page, id: string): Promise<void> {
  const centre = await shapeCentre(page, id);
  await page.mouse.click(centre.x, centre.y);
  await waitForShapeSelected(page, id);
  await page.keyboard.press('Delete');
  await waitForShapeGone(page, id);
}

/**
 * Slow this page's network, to widen a race.
 *
 * Chromium only, and deliberately not what the test hangs on: the ordering of the
 * two clients' local actions is what creates the overlap, the latency only turns a
 * window of a few milliseconds into a visible one.
 */
async function widenRace(page: Page, ms: number): Promise<boolean> {
  if (page.context().browser()?.browserType().name() !== 'chromium') {
    return false;
  }
  const client = await page.context().newCDPSession(page);
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: ms,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  return true;
}

/** Hold the Connector tool, press on one world point and drag to another, releasing last. */
async function dragArrowFromTo(
  page: Page,
  fromWorld: { x: number; y: number },
  toWorld: { x: number; y: number },
): Promise<void> {
  await pressConnectorTool(page);
  const from = await shapeScreenOf(page, fromWorld);
  const to = await shapeScreenOf(page, toWorld);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
}

test.describe('arrows that follow the shapes they join', () => {
  test('TC-25: an arrow stays attached and switches side when a shape is dragged past the other, on both screens', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const board = newLiveBoardId();
    const danaContext = await browser.newContext();
    const samContext = await browser.newContext();
    const dana = await joinBoard(danaContext, board);
    const sam = await joinBoard(samContext, board);
    const errors = [...trackErrors(dana), ...trackErrors(sam)];
    try {
      await setFlatCamera(dana);
      await setFlatCamera(sam);

      const { a, b } = await seedTwoShapes(dana, [sam]);

      // Dana draws the arrow by hand: press on A, drag onto B, release.
      await dragArrowFromTo(dana, A_CENTRE, B_CENTRE);
      await dana.mouse.up();
      const onDana = await waitForConnectorCount(dana, 1);
      const onSam = await waitForConnectorCount(sam, 1);
      const id = onDana[0]!.id;
      expect(onSam[0]!.id).toBe(id);

      // `tool.return_to_select`, for an arrow: the tool is put away again.
      await expect(dana.locator('[data-testid="board"]')).toHaveAttribute('data-tool', 'select');

      // Stored, on both screens: two attached ends, and no side anywhere
      // (`connector.endpoints`).
      for (const page of [dana, sam]) {
        const entry = await connectorOf(page, id);
        expect(entry.from.kind).toBe('attached');
        expect(entry.to.kind).toBe('attached');
        if (entry.from.kind === 'attached') {
          expect(entry.from.objectId).toBe(a);
        }
        if (entry.to.kind === 'attached') {
          expect(entry.to.objectId).toBe(b);
        }
        // Each end sits on a side midpoint of the shape it is attached to, which is
        // what the page drew as well.
        const ends = await drawnConnectorEnds(page, id);
        expect(sideMidpoints(A_RECT).some((point) => distance(point, ends.from) <= 2)).toBe(true);
        expect(sideMidpoints(B_RECT).some((point) => distance(point, ends.to) <= 2)).toBe(true);
      }

      // Drawn, on both screens: A's right side to B's left side.
      for (const page of [dana, sam]) {
        expect(await drawnAttachSide(page, id, a, 'from')).toBe('right');
        expect(await drawnAttachSide(page, id, b, 'to')).toBe('left');
      }

      // Dana drags B past A, so B ends above and to the left of it. At 100% a screen
      // delta and a world delta are the same numbers.
      const before = await centreOf(dana, b);
      const target = { x: 100, y: 120 };
      await dragShapeBy(dana, b, target.x - before.x, target.y - before.y);

      // `connector.follow` on the screen that did the moving first.
      await expect
        .poll(
          async () => {
            const centre = await centreOf(dana, b);
            return distance(centre, target) <= 2;
          },
          { timeout: E2E_EVENTUAL_TIMEOUT_MS },
        )
        .toBe(true);
      const started = Date.now();

      // ...and on the other screen, with the delivery time reported rather than
      // asserted (`live.propagate`).
      await expect
        .poll(
          async () => {
            const centre = await centreOf(sam, b);
            return distance(centre, target) <= 2;
          },
          { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: 'B never moved on Sam\'s board' },
        )
        .toBe(true);
      const deliveryMs = Date.now() - started;
      console.log(
        `latency follow to Sam: ${deliveryMs} ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms)`,
      );

      await waitForSameConnectors([dana, sam]);
      await waitForSameShapes([dana, sam]);

      // No write happened to make this true: the arrow is still attached to the same
      // two shapes, and both screens now resolve it to the other pair of sides.
      for (const page of [dana, sam]) {
        const entry = await connectorOf(page, id);
        expect(entry.from.kind).toBe('attached');
        expect(entry.to.kind).toBe('attached');
        expect(await drawnAttachSide(page, id, a, 'from')).toBe('left');
        expect(await drawnAttachSide(page, id, b, 'to')).toBe('right');
      }

      await waitForConnectorEndNear(dana, id, 'from', { x: A_RECT.x, y: A_RECT.y + A_RECT.height / 2 }, 2);
      await waitForConnectorEndNear(dana, id, 'to', { x: 180, y: 120 }, 2);

      expect(errors).toEqual([]);
    } finally {
      await danaContext.close();
      await samContext.close();
    }
  });

  test('TC-26: deleting a shape leaves the arrow, its far end free where that shape used to be', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const board = newLiveBoardId();
    const samContext = await browser.newContext();
    const danaContext = await browser.newContext();
    const sam = await joinBoard(samContext, board);
    const dana = await joinBoard(danaContext, board);
    const errors = [...trackErrors(sam), ...trackErrors(dana)];
    try {
      await setFlatCamera(sam);
      await setFlatCamera(dana);

      const { a, b } = await seedTwoShapes(sam, [dana]);
      const id = await createConnectorOnBoard(
        sam,
        { kind: 'attached', objectId: a },
        { kind: 'attached', objectId: b },
      );
      await waitForSameConnectors([sam, dana]);

      // Sam deletes B.
      await deleteShapeByKey(sam, b);

      // `connector.detach`: the arrow survives on both screens, its far end no
      // longer attached to anything and sitting on the side of the rectangle B was.
      const onSam = await waitForConnectorCount(sam, 1);
      const onDana = await waitForConnectorCount(dana, 1);
      expect(onSam[0]!.id).toBe(id);
      expect(onDana[0]!.id).toBe(id);

      for (const page of [sam, dana]) {
        const entry = await connectorOf(page, id);
        expect(entry.to.kind).toBe('free');
        expect(entry.from.kind).toBe('attached');
        if (entry.from.kind === 'attached') {
          expect(entry.from.objectId).toBe(a);
        }
        const stored = entry.to.kind === 'free' ? { x: entry.to.x, y: entry.to.y } : entry.points.to;
        expect(sideMidpoints(B_RECT).some((point) => distance(point, stored) <= 1)).toBe(true);

        // Drawn as one continuous line between A's right side and where B's left side
        // was.
        const ends = await drawnConnectorEnds(page, id);
        expect(distance(ends.from, { x: A_RECT.x + A_RECT.width, y: A_RECT.y + A_RECT.height / 2 })).toBeLessThanOrEqual(
          2,
        );
        expect(distance(ends.to, { x: B_RECT.x, y: B_RECT.y + B_RECT.height / 2 })).toBeLessThanOrEqual(2);
        await expect(page.locator(`[data-testid="connector-line-${id}"]`)).toHaveCount(1);
      }

      await waitForSameConnectors([sam, dana]);

      // The arrow is still a thing a person can pick up: clicking the line selects it.
      const ends = await drawnConnectorEnds(sam, id);
      await clickConnectorAt(sam, {
        x: (ends.from.x + ends.to.x) / 2,
        y: (ends.from.y + ends.to.y) / 2,
      });
      await expect(sam.locator(`[data-testid="connector-object-${id}"]`)).toHaveAttribute(
        'data-selected',
        'true',
      );

      expect(errors).toEqual([]);
    } finally {
      await samContext.close();
      await danaContext.close();
    }
  });

  test('TC-27: an arrow aimed at a shape that is being deleted still ends somewhere visible, with no console errors', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const board = newLiveBoardId();
    const danaContext = await browser.newContext();
    const samContext = await browser.newContext();
    const dana = await joinBoard(danaContext, board);
    const sam = await joinBoard(samContext, board);
    const errors = [...trackErrors(dana), ...trackErrors(sam)];
    try {
      await setFlatCamera(dana);
      await setFlatCamera(sam);

      const { a, b } = await seedTwoShapes(dana, [sam]);
      const widened = await widenRace(dana, 400);

      // Dana starts an arrow on A and drags it onto B, holding the pointer down.
      await dragArrowFromTo(dana, A_CENTRE, B_CENTRE);

      // While that press is still alive, Sam deletes B - waited for only on Sam's own
      // screen, so the delete and the arrow are genuinely in flight together.
      await deleteShapeByKey(sam, b);

      // Dana releases onto the place B was.
      await dana.mouse.up();

      const onDana = await waitForConnectorCount(dana, 1);
      const onSam = await waitForConnectorCount(sam, 1);
      const id = onDana[0]!.id;
      expect(onSam[0]!.id).toBe(id);
      await waitForSameConnectors([dana, sam]);

      const entry = await connectorOf(dana, id);
      const aimedAtTheDeletedShape = entry.to.kind === 'attached' && entry.to.objectId === b;
      console.log(
        `race outcome (${widened ? 'network widened' : 'ordering only'}): the far end is ${
          entry.to.kind
        }${aimedAtTheDeletedShape ? ', attached to a shape that is gone, so it renders at its fallback' : ''}`,
      );

      // Either way the arrow is not attached to anything that still exists, and its
      // far end lands inside the rectangle B occupied: on Dana's screen there is an
      // arrow that ends where the shape was.
      if (!aimedAtTheDeletedShape) {
        expect(entry.to.kind).toBe('free');
      }
      const ends = await drawnConnectorEnds(dana, id);
      expect(ends.to.x >= B_RECT.x - 2 && ends.to.x <= B_RECT.x + B_RECT.width + 2).toBe(true);
      expect(ends.to.y >= B_RECT.y - 2 && ends.to.y <= B_RECT.y + B_RECT.height + 2).toBe(true);

      // Visible on both screens, with real endpoints.
      for (const page of [dana, sam]) {
        const line = page.locator(`[data-testid="connector-line-${id}"]`);
        await expect(line).toHaveCount(1);
        await expect(line).toHaveAttribute('x2', /^-?\d+(\.\d+)?$/u);
        await expect(line).toHaveAttribute('y2', /^-?\d+(\.\d+)?$/u);
      }

      // The board is still coherent: the shape that was not deleted keeps its end of
      // the arrow.
      expect(await drawnAttachSide(dana, id, a, 'from')).toBe('right');

      expect(errors).toEqual([]);
    } finally {
      await danaContext.close();
      await samContext.close();
    }
  });

  test('the checkout flow is still a connected flow when the board is reopened', async ({ page }) => {
    // The fixture from `tests/fixtures/checkout-flow.ts`, built through the product on
    // a real board and then reopened: shapes, their labels and four arrows have to
    // survive the trip through storage and come back resolving their ends onto the
    // shapes they are attached to. Nothing else in this story checks that a board
    // full of shapes and arrows is a board that reloads.
    const errors = trackErrors(page);
    await openBoard(page);

    const ids: Record<string, string> = {};
    for (const entry of CHECKOUT_FLOW_SHAPES) {
      ids[entry.key] = await createShapeOnBoard(page, { x: entry.x, y: entry.y }, {
        size: { width: entry.width, height: entry.height },
        kind: entry.kind,
        fill: entry.fill,
        stroke: entry.stroke,
        label: entry.label,
      });
    }
    const arrows: Record<string, string> = {};
    for (const entry of CHECKOUT_FLOW_CONNECTORS) {
      const end = (which: 'from' | 'to') =>
        'shape' in entry[which]
          ? { kind: 'attached' as const, objectId: ids[entry[which].shape]! }
          : { kind: 'free' as const, x: entry[which].point.x, y: entry[which].point.y };
      arrows[entry.key] = await createConnectorOnBoard(page, end('from'), end('to'));
    }
    await waitForShapeCount(page, CHECKOUT_FLOW_SHAPES.length);
    await waitForConnectorCount(page, CHECKOUT_FLOW_CONNECTORS.length);

    await page.reload();
    await page.waitForSelector('[data-testid="board"]');
    await page.waitForSelector('[data-testid="world-layer"]');
    await waitForBoardConnection(page);

    const shapes = await getShapes(page);
    expect(shapes).toHaveLength(CHECKOUT_FLOW_SHAPES.length);
    for (const entry of CHECKOUT_FLOW_SHAPES) {
      const found = shapes.find((shape) => shape.id === ids[entry.key]);
      expect(found, `${entry.key} did not come back`).toBeTruthy();
      expect(found!.kind).toBe(entry.kind);
      expect(found!.fill).toBe(entry.fill);
      expect(found!.stroke).toBe(entry.stroke);
      expect(found!.label).toBe(entry.label);
      expect({ x: found!.x, y: found!.y, width: found!.width, height: found!.height }).toEqual({
        x: entry.x,
        y: entry.y,
        width: entry.width,
        height: entry.height,
      });
    }

    const connectors = await getConnectors(page);
    expect(connectors).toHaveLength(CHECKOUT_FLOW_CONNECTORS.length);
    // The ends come back as the same attachments and the same free point - never as
    // resolved coordinates (`connector.endpoints`) - and each end resolves onto the
    // side of its shape that faces the other end, exactly as it did when it was drawn.
    const expected: Record<string, { from: { x: number; y: number }; to: { x: number; y: number } }> = {
      'cart-payment': { from: { x: 300, y: 150 }, to: { x: 420, y: 150 } },
      'payment-paid': { from: { x: 640, y: 150 }, to: { x: 760, y: 160 } },
      'paid-receipt': { from: { x: 980, y: 160 }, to: { x: 1100, y: 150 } },
      chargeback: { from: { x: 530, y: 260 }, to: { x: 530, y: 420 } },
    } as const;
    for (const entry of CHECKOUT_FLOW_CONNECTORS) {
      const want = expected[entry.key]!;
      const stored = await connectorOf(page, arrows[entry.key]!);
      expect(stored.from.kind).toBe('attached');
      expect(stored.to.kind === 'attached' ? stored.to.objectId : 'free').toBe(
        'shape' in entry.to ? ids[entry.to.shape]! : 'free',
      );
      expect(stored.points).toEqual(want);
      // And the line on the screen is drawn between those same two places.
      const drawn = await drawnConnectorEnds(page, arrows[entry.key]!);
      expect(drawn.from.x).toBeCloseTo(want.from.x, 1);
      expect(drawn.from.y).toBeCloseTo(want.from.y, 1);
      expect(drawn.to.x).toBeCloseTo(want.to.x, 1);
      expect(drawn.to.y).toBeCloseTo(want.to.y, 1);
    }

    expect(errors).toEqual([]);
  });
});
