/**
 * Story 10, end to end: arrows that stay attached while other people move the world.
 *
 * Two isolated browser contexts, two real WebSockets to one BoardRoom. Dana draws the arrow, Sam
 * deletes the shape underneath it, and the assertions are made on both screens, because "the arrow
 * followed" is a claim about what two people see and not about what one document contains.
 *
 * Delivery times are logged against `LIVE_UPDATE_LATENCY_BUDGET_MS` and never asserted, which is
 * what the story asks for: a shared runner decides how fast a room is, and a red test that says so
 * is not information.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import type { ConnectorSnapshot } from '../../src/shared/board-model';
import { drag, setCamera } from './helpers/board';
import {
  closeParticipants,
  LatencyLog,
  openParticipants,
  personAt,
  type Participant,
} from './helpers/participants';
import { CHECKOUT_FLOW } from '../fixtures/checkout-flow';
import {
  applyCheckoutFlow,
  centredCamera,
  connectorsOn,
  createShape,
  createConnector,
  drawnEnds,
  shapeById,
  toScreen,
  waitForConnectorCount,
  waitForGone,
  waitForShapeCount,
  type World,
} from './helpers/shapes';

test.use({ actionTimeout: 10_000 });

/**
 * The two shapes of the scenario, 100 units apart: A on the left, B on the right, both at the same
 * height so that the arrow between them is horizontal and every side it can switch to is one move
 * away.
 */
const A = { kind: 'rect', x: -400, y: -60, width: 200, height: 120, label: 'Take payment' } as const;
const B = { kind: 'rect', x: -100, y: -60, width: 200, height: 120, label: 'Retry' } as const;

const centre = (shape: { x: number; y: number; width: number; height: number }): World => ({
  x: shape.x + shape.width / 2,
  y: shape.y + shape.height / 2,
});

const at = (point: World): string => `${Math.round(point.x)},${Math.round(point.y)}`;

/** One arrow as a line of text: what each end is attached to, and where it is drawn. */
function describeArrow(connector: ConnectorSnapshot | undefined): string {
  if (!connector) return 'no arrow on this board';
  return (
    `${connector.from.kind}@${at(connector.ends.from)} -> ` +
    `${connector.to.kind}@${at(connector.ends.to)}`
  );
}

/** How one person's board shows one arrow, ready to be compared with another person's. */
async function arrowOn(page: Page, id: string): Promise<string> {
  const found = (await connectorsOn(page)).find((connector) => connector.id === id);
  return describeArrow(found);
}

/**
 * Dana and Sam on a board of their own, both looking at the world origin at 100%.
 *
 * `openParticipants` names people from the suite's own list; the design calls these two Dana and
 * Sam, and a failure message that says "Alex dragged B" next to a test about Dana is confusing.
 */
async function pair(browser: Browser): Promise<{ dana: Participant; sam: Participant; all: Participant[] }> {
  const all = await openParticipants(browser, newBoardId(), 2);
  const dana = personAt(all, 0);
  const sam = personAt(all, 1);
  dana.name = 'Dana';
  sam.name = 'Sam';
  await setCamera(dana.page, centredCamera());
  await setCamera(sam.page, centredCamera());
  return { dana, sam, all };
}

/** Two shapes, made by Dana, that Sam is already looking at. */
async function twoShapes(dana: Participant, sam: Participant): Promise<{ a: string; b: string }> {
  const a = await createShape(dana.page, A);
  const b = await createShape(dana.page, B);
  await waitForShapeCount(sam.page, 2);
  return { a, b };
}

/** Dana drags an arrow from one shape's middle to another's, with the Connector tool. */
async function drawArrow(dana: Participant, from: World, to: World): Promise<void> {
  const surface = dana.page.getByTestId('connector-tool-surface');
  await dana.page.keyboard.press('l');
  await expect(surface).toBeVisible();
  await drag(dana.page, toScreen(from), toScreen(to));
  // a created arrow hands the pointer back to Select
  await expect(surface).toHaveCount(0);
}

/** The one arrow on a board, failing loudly if there is not exactly one. */
async function onlyArrow(page: Page): Promise<ConnectorSnapshot> {
  const [connector] = await connectorsOn(page);
  if (!connector) throw new Error('there is no arrow on this board');
  return connector;
}

// The design asks for TC-23 in every engine and for the rest of the functional cases in chromium;
// these three need two browser contexts each, which is the expensive part of the suite to triple.
test.describe('arrows that follow what they are attached to', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'chromium is what the design asks for here');

  test('TC-25 an arrow stays attached and switches side when the other shape is dragged past its own', async ({
    browser,
  }) => {
    const { dana, sam, all } = await pair(browser);
    const latency = new LatencyLog();
    try {
      const { b } = await twoShapes(dana, sam);

      // attached ends first: the arrow leaves A on the side that faces B, and arrives on the side
      // of B that faces A, which for two shapes in a row means right and left
      const connected = 'attached@-200,0 -> attached@-100,0';
      await latency.measure(
        'Dana connects A to B',
        async () => {
          await drawArrow(dana, centre(A), centre(B));
          return Date.now();
        },
        async () => (await arrowOn(sam.page, (await onlyArrow(dana.page)).id)) === connected,
      );
      const arrow = await onlyArrow(dana.page);
      expect(describeArrow(arrow)).toBe(connected);
      expect(arrow.from.kind).toBe('attached');
      expect(arrow.to.kind).toBe('attached');

      // now B goes past A, to its left. Both ends have to pick a new side: A's arrow leaves to the
      // left and B's arrives on the side that faces A, which is B's right
      const moved = { x: -560, y: 0 }; // where B's middle ends up
      const following = 'attached@-400,0 -> attached@-460,0';
      await latency.measure(
        'Dana drags B past A',
        async () => {
          await drag(dana.page, toScreen(centre(B)), toScreen(moved));
          return Date.now();
        },
        async () => (await arrowOn(sam.page, arrow.id)) === following,
      );

      // both people see the same arrow, attached to the same two shapes, drawn between the same two
      // points - and the picture agrees with the document on each screen
      for (const who of [dana, sam]) {
        await expect.poll(() => arrowOn(who.page, arrow.id)).toBe(following);
        const ends = await drawnEnds(who.page, arrow.id);
        expect(at(ends.from)).toBe('-400,0');
        expect(at(ends.to)).toBe('-460,0');
        const movedShape = await shapeById(who.page, b);
        expect(at({ x: movedShape.x + movedShape.width / 2, y: movedShape.y + movedShape.height / 2 })).toBe(
          at(moved),
        );
      }
      // dragging a shape is not a way of moving an arrow: it is still one arrow, and it is still
      // attached to both shapes rather than left behind as a free line
      expect((await connectorsOn(sam.page)).length).toBe(1);
      for (const who of all) expect(who.consoleErrors).toEqual([]);
      latency.report('arrow follow latency');
    } finally {
      await closeParticipants(all);
    }
  });

  test('TC-26 when the other person deletes the shape at one end, the arrow stays and its end lets go where it was attached', async ({
    browser,
  }) => {
    const { dana, sam, all } = await pair(browser);
    try {
      const { a, b } = await twoShapes(dana, sam);
      await drawArrow(dana, centre(A), centre(B));
      const arrow = await onlyArrow(dana.page);
      await expect.poll(() => arrowOn(sam.page, arrow.id)).toBe('attached@-200,0 -> attached@-100,0');

      // Sam selects B and deletes it. Nothing about the arrow is mentioned: deleting a shape must
      // not be a way of deleting the arrows on it.
      await sam.page.mouse.click(toScreen(centre(B)).x, toScreen(centre(B)).y);
      await expect(sam.page.locator(`[data-shape-id="${b}"]`)).toHaveAttribute('data-selected', 'true');
      await sam.page.keyboard.press('Delete');
      await waitForGone(sam.page, b);
      await waitForGone(dana.page, b);

      // the head of the arrow is free, at the point on B's side where it used to be attached; the
      // tail is still attached to A, and A is where it always was
      const letGo = 'attached@-200,0 -> free@-100,0';
      for (const who of all) {
        await expect.poll(() => arrowOn(who.page, arrow.id)).toBe(letGo);
        const ends = await drawnEnds(who.page, arrow.id);
        expect(at(ends.to)).toBe('-100,0');
        await expect(who.page.locator(`[data-connector-id="${arrow.id}"]`)).toHaveCount(1);
      }
      expect((await connectorsOn(sam.page)).length).toBe(1);
      expect((await shapeById(dana.page, a)).id).toBe(a);
      for (const who of all) expect(who.consoleErrors).toEqual([]);
    } finally {
      await closeParticipants(all);
    }
  });

  test('the checkout flow: four shapes, four arrows, and every arrow keeps up with the shape it is on', async ({
    browser,
  }) => {
    const { dana, sam, all } = await pair(browser);
    try {
      const { connectors } = await applyCheckoutFlow(dana.page);
      expect(connectors.length).toBe(4);

      // Sam is looking at the same board the fixture describes: three arrows attached at both ends,
      // and one whose head is still pointing at empty space
      // Each end is the middle of the side that faces the other shape: Start leaves right and enters
      // In stock on its left; the diamond leaves right into Take payment's left; Ask for another card
      // is below Start, so it leaves its own top and arrives at Start's bottom; and the last arrow
      // leaves the ellipse at the bottom, the side that faces the empty point it was left at.
      const flow = [
        'attached@-400,-140 -> attached@-280,-140',
        'attached@-60,-140 -> attached@80,-140',
        'attached@-480,80 -> attached@-500,-80',
        'attached@190,-80 -> free@380,120',
      ];
      for (const who of all) {
        await waitForShapeCount(who.page, CHECKOUT_FLOW.shapes.length);
        await waitForConnectorCount(who.page, connectors.length);
        for (const [index, id] of connectors.entries()) {
          await expect.poll(() => arrowOn(who.page, id)).toBe(flow[index]);
        }
      }

      // one shape moves: the two arrows on it move with it, the other two do not change at all, and
      // both screens end up saying the same thing about all four
      const start = CHECKOUT_FLOW.shapes[0];
      if (!start) throw new Error('the fixture lost its first shape');
      const from = centre(start);
      const to = { x: from.x + 80, y: from.y - 190 };
      // the fixture made exactly the four arrows it describes, so each one can be named by number
      const one = (arrows: readonly string[], index: number): string =>
        arrows[index] ?? 'no arrow at that position in the fixture';
      const before = await Promise.all(connectors.map((id) => arrowOn(dana.page, id)));
      await drag(dana.page, toScreen(from), toScreen(to));

      // Start is above and to the left of In stock? now, so the two ends that were facing each other
      // across a row meet top to bottom instead
      const moved = 'attached@-420,-270 -> attached@-170,-210';
      await expect
        .poll(() => arrowOn(sam.page, one(connectors, 0)), { message: 'the first arrow did not follow' })
        .toBe(moved);
      for (const who of all) {
        const now = await Promise.all(connectors.map((id) => arrowOn(who.page, id)));
        expect(one(now, 1)).toBe(one(before, 1));
        expect(one(now, 3)).toBe(one(before, 3));
        expect(one(now, 0)).toBe(moved);
        // the arrow into the shape that moved knows it moved too, and picks a side for it afresh
        expect(one(now, 2)).not.toBe(one(before, 2));
        expect(one(now, 2).startsWith('attached@')).toBe(true);
      }
      for (const who of all) expect(who.consoleErrors).toEqual([]);
    } finally {
      await closeParticipants(all);
    }
  });

  test('TC-27 an arrow released onto a shape that was deleted mid-drag still lands, and is drawn where it was let go', async ({
    browser,
  }) => {
    const { dana, sam, all } = await pair(browser);
    try {
      const { a, b } = await twoShapes(dana, sam);
      const target = toScreen(centre(B));

      // Dana is holding the arrow over B
      await dana.page.keyboard.press('l');
      await expect(dana.page.getByTestId('connector-tool-surface')).toBeVisible();
      await dana.page.mouse.move(toScreen(centre(A)).x, toScreen(centre(A)).y);
      await dana.page.mouse.down();
      await dana.page.mouse.move(target.x, target.y, { steps: 6 });

      // Sam deletes B in the middle of that gesture. Waiting for the delete to arrive on Dana's
      // board is what makes this a race and not a coincidence: Dana's pointer is still down when it
      // does. (Playwright cannot delay the frames of a WebSocket that is already open, so the
      // overlap is arranged instead of timed.)
      await sam.page.mouse.click(target.x, target.y);
      await sam.page.keyboard.press('Delete');
      await waitForGone(dana.page, b);

      await dana.page.mouse.up();
      await waitForConnectorCount(dana.page, 1);
      const arrow = await onlyArrow(dana.page);
      // Which of the two interleavings happened depends on the room; the promise is the same either
      // way, so the kind of the end is reported and the position of the head is what is asserted.
      console.log(`[vidi6] TC-27: the head of the arrow was stored as ${JSON.stringify(arrow.to)}`);
      expect(Math.abs(arrow.ends.to.x - centre(B).x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(arrow.ends.to.y - centre(B).y)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(arrow.ends.from.x - -200)).toBeLessThanOrEqual(0.5);

      // an arrow nobody can see is the same as no arrow: it is on the screen, with its head at that
      // point and a length to it
      const drawn = await drawnEnds(dana.page, arrow.id);
      expect(at(drawn.to)).toBe(at(arrow.ends.to));
      const box = await dana.page.locator(`[data-connector-id="${arrow.id}"]`).boundingBox();
      if (!box) throw new Error('the arrow of the delete race was never rendered');
      expect(box.width).toBeGreaterThan(50);

      // Sam's screen gets the same arrow
      await waitForConnectorCount(sam.page, 1);
      await expect.poll(async () => at((await onlyArrow(sam.page)).ends.to)).toBe(at(arrow.ends.to));

      // The other half of the same promise, from the document's side: an end that still names a
      // shape which is gone is drawn at the last point it had, which is what an arrow arriving at a
      // shape two people were deleting needs to do.
      const orphan = await createConnector(
        dana.page,
        { kind: 'attached', objectId: a, fallback: centre(A) },
        { kind: 'attached', objectId: b, fallback: { x: 300, y: -260 } },
      );
      const dangling = (await connectorsOn(dana.page)).find((connector) => connector.id === orphan);
      if (!dangling) throw new Error('the arrow pointing at the deleted shape was not created');
      expect(dangling.to.kind).toBe('attached'); // it still names the shape that is gone
      expect(at(dangling.ends.to)).toBe('300,-260');
      expect(at((await drawnEnds(dana.page, orphan)).to)).toBe('300,-260');

      for (const who of all) expect(who.consoleErrors).toEqual([]);
    } finally {
      await closeParticipants(all);
    }
  });
});
