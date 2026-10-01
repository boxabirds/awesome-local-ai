// Story 10, end to end: arrows that point at shapes.
//
// TC-25 is the collaborative half of the story: one person drags a shape, and the
// arrow someone else is looking at follows it and takes the side that now faces it -
// with nothing about sides ever written to the document. TC-26 deletes the shape an
// arrow points at; the arrow stays where it was pointing. TC-27 forces the race the
// fallback exists for: the delete arrives while the arrow is still being drawn.
//
// The board opens with its start point in the middle of the window, so the board
// points a test can click are within about 640 by 400 of it: A sits just left of the
// start point, B to its right, far enough apart to point between and well inside the
// window. Every click in these tests goes through the board's own world-to-screen
// mapping rather than a guess about where the pixels are.
//
// Delivery time to the second client is logged against LIVE_UPDATE_LATENCY_BUDGET_MS
// and never asserted, as the design asks.

import { expect, test, type Page } from '@playwright/test';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';
import type { Point as GeoPoint, Rect } from '../../src/shared/geometry';
import { centre, nearestSide, sideAnchor } from '../../src/shared/objects/connector';
import { createBoard, expectPixels } from './helpers/board';
import { openBoard, waitForSyncReady } from './helpers/live';
import { checkoutFlow, FLOW_FREE_END, FLOW_SHAPES } from '../fixtures/checkout-flow';
import {
  connectorById,
  connectorCount,
  connectorEndScreenPoint,
  connectorIndexOf,
  connectorObjects,
  connectorToolLayer,
  connectors,
  drawArrow,
  drawShape,
  dragShape,
  pressArrowAt,
  releaseArrowAt,
  selectArrow,
  selectShape,
  seedFlow,
  shapeIndexOf,
  shapeObjects,
  shapeScreenBox,
  shapeScreenCentre,
  shapes,
  screenOf,
  waitForConnectorsMatch,
  waitForShapesMatch,
  type ShapeContent,
} from './helpers/shapes';

/** How many arrows the fixture flow is drawn with: three between shapes, one loose. */
const FLOW_CONNECTOR_COUNT = 4;

/** Where the two shapes of every test here are drawn, in board units. */
const A_BOX = { from: { x: -80, y: -120 }, to: { x: 80, y: 0 } };
const B_BOX = { from: { x: 180, y: -120 }, to: { x: 340, y: 0 } };
/** How far left B is dragged in TC-25: past A, so the two change which faces them. */
const PAST_A = -560;

const rectOf = (shape: ShapeContent): Rect => ({
  x: shape.x,
  y: shape.y,
  width: shape.width,
  height: shape.height,
});

/** Two board points, near enough to be the same point. */
const nearly = (a: GeoPoint, b: GeoPoint, tolerance = 1): boolean =>
  Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;

/** Where an end anchored on `rect` is drawn when aimed at `toward`: the middle of the
 * side of the rectangle that faces the aim. */
const anchorToward = (rect: Rect, toward: GeoPoint): GeoPoint =>
  sideAnchor(rect, nearestSide(rect, toward));

/** The id of the one arrow on the board. */
async function arrowId(page: Page): Promise<string> {
  const list = await connectors(page);
  if (list.length !== 1) throw new Error(`expected one arrow on the board, found ${list.length}`);
  return list[0]!.id;
}

/** Press, move in a few steps, release: a shape is dragged by the board itself. */
async function dragByPointer(page: Page, from: GeoPoint, to: GeoPoint): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

/** Two people on one board. */
async function pair(
  browser: import('@playwright/test').Browser,
  request: import('@playwright/test').APIRequestContext,
): Promise<[Page, Page]> {
  const id = await createBoard(request);
  const dana = await openBoard(browser, id);
  const sam = await openBoard(browser, id);
  return [dana, sam];
}

/** The board every test here works on: two shapes and an arrow from one to the other. */
async function withArrow(browser: import('@playwright/test').Browser, request: import('@playwright/test').APIRequestContext) {
  const [dana, sam] = await pair(browser, request);
  await drawShape(dana, A_BOX.from, A_BOX.to);
  await drawShape(dana, B_BOX.from, B_BOX.to);
  await waitForShapesMatch([dana, sam]);
  const drawn = await shapes(dana);
  const a = drawn[0]!;
  const b = drawn[1]!;
  await drawArrow(dana, centre(rectOf(a)), centre(rectOf(b)));
  await waitForConnectorsMatch([dana, sam]);
  return { dana, sam, a, b, arrow: await arrowId(dana) };
}

test.describe('collaborative rearrange', () => {
  test('TC-25 an arrow follows a shape a colleague drags, and takes the side now facing it', async ({
    browser,
    request,
  }) => {
    const { dana, sam, a, b, arrow } = await withArrow(browser, request);

    const before = await connectorById(dana, arrow);
    expect(before.from).toMatchObject({ kind: 'attached', objectId: a.id });
    expect(before.to).toMatchObject({ kind: 'attached', objectId: b.id });
    // each end sits on the side of its shape that faces the other one
    expect(before.ends.from.x).toBeCloseTo(a.x + a.width, 3); // A's right edge
    expect(before.ends.from.y).toBeCloseTo(a.y + a.height / 2, 3);
    expect(before.ends.to.x).toBeCloseTo(b.x, 3); // B's left edge
    expect(before.ends.to.y).toBeCloseTo(b.y + b.height / 2, 3);

    // Dana drags B past A. Nothing is written about the arrow during the drag.
    const bCentre = await shapeScreenCentre(dana, await shapeIndexOf(dana, b.id));
    const target = { x: bCentre.x + PAST_A, y: bCentre.y };
    await dragByPointer(dana, bCentre, target);
    const released = Date.now();

    // where the ends belong now: B is to the left of A, so A's left edge faces it and
    // B's right edge faces A. Both ends change sides, from the rectangles alone.
    const moved: ShapeContent = { ...b, x: b.x + PAST_A };
    const expectFrom = anchorToward(rectOf(a), centre(rectOf(moved)));
    const expectTo = anchorToward(rectOf(moved), centre(rectOf(a)));
    expect(expectFrom.x).toBeCloseTo(a.x, 3); // A's left edge, having been its right
    expect(expectTo.x).toBeCloseTo(moved.x + moved.width, 3);

    await expect
      .poll(
        async () => {
          const seen = await connectorById(sam, arrow).catch(() => undefined);
          return seen !== undefined && nearly(seen.ends.from, expectFrom) && nearly(seen.ends.to, expectTo);
        },
        { timeout: 15_000, message: "Sam's arrow to follow the drag" },
      )
      .toBe(true);
    const latency = Date.now() - released;
    console.log(
      `TC-25 Sam's arrow followed the drag in ${latency} ms ` +
        `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms; logged, not asserted)`,
    );

    // both ends are still attached, on both screens, to the same two shapes
    for (const page of [dana, sam]) {
      const seen = await connectorById(page, arrow);
      expect(seen.from).toMatchObject({ kind: 'attached', objectId: a.id });
      expect(seen.to).toMatchObject({ kind: 'attached', objectId: b.id });
      expect(seen.ends.from.x).toBeCloseTo(expectFrom.x, 1);
      expect(seen.ends.from.y).toBeCloseTo(expectFrom.y, 1);
      expect(seen.ends.to.x).toBeCloseTo(expectTo.x, 1);
      expect(seen.ends.to.y).toBeCloseTo(expectTo.y, 1);
      expect(await connectors(page)).toHaveLength(1);
    }

    // and Sam sees the arrowhead painted on the edge of B that now faces A
    const index = await connectorIndexOf(sam, arrow);
    await selectArrow(sam, index);
    const handle = await connectorEndScreenPoint(sam, index, 'to');
    const box = await shapeScreenBox(sam, await shapeIndexOf(sam, b.id));
    expectPixels(handle.x, box.x + box.width);
    expectPixels(handle.y, box.y + box.height / 2);
  });

});

test.describe('deleting what an arrow points at', () => {
  test('TC-26 deleting the shape an arrow points at leaves the arrow where it pointed', async ({
    browser,
    request,
  }) => {
    const { dana, sam, b, arrow } = await withArrow(browser, request);

    const pointedAt = (await connectorById(dana, arrow)).ends.to;
    // it was pointing at the side of B that faced A
    expect(pointedAt.x).toBeCloseTo(b.x, 3);
    expect(pointedAt.y).toBeCloseTo(b.y + b.height / 2, 3);

    // Sam deletes B
    await selectShape(sam, await shapeIndexOf(sam, b.id));
    await sam.keyboard.press('Delete');
    await waitForShapesMatch([dana, sam]);
    await waitForConnectorsMatch([dana, sam]);

    // B is gone; the arrow is not, and the end that was on B is now free, exactly
    // where it had been - on the side B's side used to be
    for (const page of [dana, sam]) {
      expect(await shapes(page)).toHaveLength(1);
      const seen = await connectorById(page, arrow);
      expect(seen.to.kind).toBe('free');
      expect(seen.ends.to.x).toBeCloseTo(pointedAt.x, 3);
      expect(seen.ends.to.y).toBeCloseTo(pointedAt.y, 3);
      expect(await connectorCount(page)).toBe(1);
    }

    // and it is drawn there: the end handle lands on the board point the end is at
    const index = await connectorIndexOf(sam, arrow);
    await selectArrow(sam, index);
    const handle = await connectorEndScreenPoint(sam, index, 'to');
    const where = await screenOf(sam, pointedAt);
    expectPixels(handle.x, where.x);
    expectPixels(handle.y, where.y);
  });
});

test.describe('delete race', () => {
  test('TC-27 an arrow whose target is deleted mid-drag ends up at its fallback point', async ({
    browser,
    request,
  }) => {
    const [dana, sam] = await pair(browser, request);

    const errors: string[] = [];
    for (const page of [dana, sam]) {
      page.on('console', (message) => {
        if (message.type() === 'error') {
          errors.push(`${page === dana ? 'Dana' : 'Sam'}: ${message.text()}`);
        }
      });
      page.on('pageerror', (error) => errors.push(`${page === dana ? 'Dana' : 'Sam'}: ${String(error)}`));
    }

    await drawShape(dana, A_BOX.from, A_BOX.to);
    await drawShape(dana, B_BOX.from, B_BOX.to);
    await waitForShapesMatch([dana, sam]);
    const drawn = await shapes(dana);
    const a = drawn[0]!;
    const b = drawn[1]!;

    // Sam selects B first. The delete is what has to arrive mid-drag; selecting
    // afterwards would ask Firefox to click a page while another page in the same
    // browser is already holding its pointer down, which is a question about the
    // harness rather than about the board.
    await selectShape(sam, await shapeIndexOf(sam, b.id));

    // Dana presses the arrow at A and holds it there - the arrow is aimed at B
    await pressArrowAt(dana, centre(rectOf(a)));

    // while that press is still down, Sam deletes B, and the delete reaches Dana: the
    // shape the arrow is aimed at is gone before the pointer comes up
    await sam.keyboard.press('Delete');
    await waitForShapesMatch([dana, sam]);

    // Dana lets go where B was. There is nothing there to attach to, so the end is
    // free, and it is put where the arrow was aimed.
    const drop = centre(rectOf(b));
    await releaseArrowAt(dana, drop);
    await waitForConnectorsMatch([dana, sam]);

    expect(await connectorCount(dana)).toBe(1);
    const arrow = await arrowId(dana);
    const seen = await connectorById(dana, arrow);
    expect(seen.from).toMatchObject({ kind: 'attached', objectId: a.id });
    expect(seen.to.kind).toBe('free');
    // the end is free at the point it was let go at, which is where B was: the arrow
    // keeps the place it was aimed at instead of vanishing with the shape
    expect(seen.ends.to.x).toBeCloseTo(drop.x, 1);
    expect(seen.ends.to.y).toBeCloseTo(drop.y, 1);

    // Sam sees the same arrow, and both boards still hold A
    const shared = await connectorById(sam, arrow);
    expect(shared.ends.to.x).toBeCloseTo(seen.ends.to.x, 3);
    expect(await shapes(dana)).toHaveLength(1);
    expect(await shapes(sam)).toHaveLength(1);

    // the arrow is drawn, between the ends the document says it has
    await selectArrow(dana, await connectorIndexOf(dana, arrow));
    const drawnEnds = await connectorObjects(dana)
      .nth(await connectorIndexOf(dana, arrow))
      .evaluate((el) => ({
        from: { x: Number(el.getAttribute('data-arrow-from-x')), y: Number(el.getAttribute('data-arrow-from-y')) },
        to: { x: Number(el.getAttribute('data-arrow-to-x')), y: Number(el.getAttribute('data-arrow-to-y')) },
      }));
    expect(drawnEnds.from.x).toBeCloseTo(seen.ends.from.x, 3);
    expect(drawnEnds.to.x).toBeCloseTo(seen.ends.to.x, 3);
    expect(drawnEnds.to.y).toBeCloseTo(seen.ends.to.y, 3);

    // the tool let go afterwards, and nothing was thrown anywhere on the way
    await expect(connectorToolLayer(dana)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('a flow drawn by someone else', () => {
  // The fixture flow is four labelled shapes with three arrows drawn between them and
  // one let go over open board, built by the same model calls the tools make. It arrives
  // here the way anything from another client arrives: an update applied to the document
  // the page is holding, which the board then paints. What the board paints from it is
  // what the arrows are supposed to do with shapes they did not draw.
  test('a flow that arrives from elsewhere is drawn with its arrows on the sides that face each other', async ({
    browser,
    request,
  }) => {
    const [dana, sam] = await pair(browser, request);
    const flow = checkoutFlow();
    expect(flow.shapes).toHaveLength(FLOW_SHAPES.length);

    await seedFlow(dana, flow.all);
    await waitForShapesMatch([dana, sam]);
    await waitForConnectorsMatch([dana, sam]);

    // painted on both boards, in the order the flow was drawn, labels and all
    for (const page of [dana, sam]) {
      await expect(shapeObjects(page)).toHaveCount(FLOW_SHAPES.length);
      await expect(connectorObjects(page)).toHaveCount(FLOW_CONNECTOR_COUNT);
      const list = await shapes(page);
      expect(list.map((shape) => shape.kind)).toEqual(FLOW_SHAPES.map((shape) => shape.kind));
      expect(list.map((shape) => shape.label)).toEqual(FLOW_SHAPES.map((shape) => shape.label));
    }

    // the three arrows drawn between shapes point at the sides that face each other,
    // and the one let go over open board keeps the point it was let go at
    const drawn = await shapes(sam);
    const arrows = await connectors(sam);
    expect(arrows).toHaveLength(FLOW_CONNECTOR_COUNT);
    for (const [index, [from, to]] of [[0, 1], [1, 2], [2, 3]].entries()) {
      const arrow = arrows[index]!;
      expect(arrow.from).toMatchObject({ kind: 'attached', objectId: drawn[from]!.id });
      expect(arrow.to).toMatchObject({ kind: 'attached', objectId: drawn[to]!.id });
      expect(nearly(arrow.ends.from, anchorToward(rectOf(drawn[from]!), centre(rectOf(drawn[to]!))))).toBe(true);
      expect(nearly(arrow.ends.to, anchorToward(rectOf(drawn[to]!), centre(rectOf(drawn[from]!))))).toBe(true);
    }
    const loose = arrows[FLOW_CONNECTOR_COUNT - 1]!;
    expect(loose.from).toMatchObject({ kind: 'attached', objectId: drawn[1]!.id });
    expect(loose.to).toEqual({ kind: 'free', x: FLOW_FREE_END.x, y: FLOW_FREE_END.y });

    // Drag the decision on Sam's board: the ends of every arrow drawn to it follow it,
    // on both boards, and the point in open board does not move. Nobody wrote a side
    // down, and nobody was drawing an arrow at the time.
    const decision = drawn[1]!;
    const start = drawn[0]!;
    const shipIt = drawn[2]!;
    await dragShape(sam, await shapeIndexOf(sam, decision.id), 0, 200);
    const moved = { ...decision, y: decision.y + 200 };

    // every arrow that was drawn to the decision follows it, on both boards: the end
    // on it changes side, the end in open board does not move, and the arrows that
    // never touched it are untouched
    const arrives = async (page: Page): Promise<boolean> => {
      const list = await connectors(page);
      const into = list.find((arrow) => arrow.to.kind === 'attached' && arrow.to.objectId === decision.id);
      const out = list.find(
        (arrow) =>
          arrow.from.kind === 'attached' &&
          arrow.from.objectId === decision.id &&
          arrow.to.kind === 'attached' &&
          arrow.to.objectId === shipIt.id,
      );
      const loose = list.find(
        (arrow) => arrow.from.kind === 'attached' && arrow.from.objectId === decision.id && arrow.to.kind === 'free',
      );
      return (
        into !== undefined &&
        out !== undefined &&
        loose !== undefined &&
        nearly(into.ends.to, anchorToward(moved, centre(rectOf(start)))) &&
        nearly(out.ends.from, anchorToward(moved, centre(rectOf(shipIt)))) &&
        nearly(loose.ends.from, anchorToward(moved, FLOW_FREE_END)) &&
        loose.ends.to.x === FLOW_FREE_END.x &&
        loose.ends.to.y === FLOW_FREE_END.y
      );
    };
    for (const page of [dana, sam]) {
      await expect
        .poll(() => arrives(page), { timeout: 15_000, message: 'every arrow on the flow to follow the shape' })
        .toBe(true);
    }

    // and the flow is still a flow after the board is opened again: the shapes, the
    // labels and the arrows are what the document holds, not what was painted
    await dana.reload();
    await waitForSyncReady(dana);
    await waitForShapesMatch([dana, sam]);
    await waitForConnectorsMatch([dana, sam]);
    expect(await shapes(dana)).toEqual(await shapes(sam));
    expect((await connectors(dana)).map((arrow) => arrow.ends)).toEqual(
      (await connectors(sam)).map((arrow) => arrow.ends),
    );
    await expect(shapeObjects(dana)).toHaveCount(FLOW_SHAPES.length);
    await expect(connectorObjects(dana)).toHaveCount(FLOW_CONNECTOR_COUNT);
  });
});
