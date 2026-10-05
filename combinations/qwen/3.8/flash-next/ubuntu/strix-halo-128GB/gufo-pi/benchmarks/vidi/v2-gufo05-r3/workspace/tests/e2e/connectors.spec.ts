/**
 * E2E: arrows in a shared board (story 10, TC-25 to TC-27).
 *
 * Dana and Sam are two browser contexts on one board, so "the arrow followed" is not a
 * claim about a re-render but about a second machine's screen: the endpoint record the
 * first client wrote has to resolve against moved and deleted shapes on the other side,
 * without either client redrawing the model by hand.
 *
 * The board they meet on is `tests/fixtures/checkout-flow.ts`, pushed through the
 * test-only `__vidi6.applyUpdate` door as a real Yjs update — so it reaches the server
 * and the other participant exactly as a person's own stroke would.
 *
 * Delivery times are measured and logged against `LIVE_UPDATE_LATENCY_BUDGET_MS`, never
 * asserted (see the design's non-goals): only the outcome decides pass or fail.
 */
import { expect, test } from '@playwright/test';

import { checkoutFlow, encodeFlow, type CheckoutFlowFixture, type CheckoutFlowIds } from '../fixtures/checkout-flow';
import {
  centreOfShapeOnScreen,
  connectorsOn,
  dragOnBoard,
  dragShapeToWorld,
  objectOf,
  objectsOn,
  screenOfWorld,
  within,
  type FlowObject,
} from './helpers/flow';
import {
  closeParticipants,
  createBoard,
  expectEventually,
  openParticipant,
  openParticipants,
  type Participant,
} from './helpers/participants';
import type { Point } from '../../src/client/canvas/camera';
import type { Rect } from '../../src/shared/geometry';

/**
 * Which side of a box an anchor sits on.
 *
 * The arrow's promise is that it joins a *side*, not the middle of a shape, so "it
 * turned to the new side" is asserted by naming the side the end is on before and after
 * the move rather than by comparing two sets of numbers that could match by accident.
 */
type Side = 'left' | 'right' | 'top' | 'bottom';

function sideOf(box: Rect, at: Point): Side | null {
  const eps = 0.5;
  if (Math.abs(at.x - box.x) <= eps) return 'left';
  if (Math.abs(at.x - (box.x + box.width)) <= eps) return 'right';
  if (Math.abs(at.y - box.y) <= eps) return 'top';
  if (Math.abs(at.y - (box.y + box.height)) <= eps) return 'bottom';
  return null;
}

const boxOf = (object: FlowObject | undefined): Rect | undefined =>
  object && object.width > 0 ? { x: object.x, y: object.y, width: object.width, height: object.height } : undefined;

/** The arrow that joins two shapes, whichever way round its ends were written. */
function arrowBetween(board: FlowObject[], a: string, b: string): FlowObject | undefined {
  return board.find((c) => {
    if (c.type !== 'connector' || c.from?.kind !== 'attached' || c.to?.kind !== 'attached') return false;
    const ids = new Set([c.from.objectId, c.to.objectId]);
    return ids.size === 2 && ids.has(a) && ids.has(b);
  });
}

/** Push the fixture into a live board through the test-only door. */
async function seedFlow(participant: Participant, fixture: CheckoutFlowFixture): Promise<void> {
  const bytes = Array.from(encodeFlow(fixture));
  await participant.page.waitForFunction(
    () => typeof (window as unknown as { __vidi6?: { applyUpdate?: unknown } }).__vidi6?.applyUpdate === 'function',
  );
  await participant.page.evaluate((data) => {
    (window as unknown as { __vidi6: { applyUpdate: (bytes: number[]) => void } }).__vidi6.applyUpdate(data);
  }, bytes);
}

/** Wait until this board holds the four shapes and the four arrows of the fixture. */
async function waitForFlow(participant: Participant, label: string): Promise<void> {
  await expectEventually(
    `${label} sees the flow`,
    () => objectsOn(participant.page),
    (board) => board.filter((o) => o.type === 'shape').length === 4 && board.filter((o) => o.type === 'connector').length === 4,
  );
}

test.describe('arrows in a shared board (TC-25 to TC-27)', () => {
  test('TC-25 an arrow stays joined and turns to the new side when a remote peer drags its shape past the other', async ({
    browser,
    request,
  }) => {
    const flow = checkoutFlow('dana');
    const boardId = await createBoard(request);
    const [dana, sam] = await openParticipants(browser, boardId, ['Dana', 'Sam']);
    try {
      await seedFlow(dana, flow);
      await waitForFlow(sam, 'Sam');

      // Dana draws the arrow herself: pressed inside the cart, released inside payment.
      await dana.page.keyboard.press('l');
      await dragOnBoard(
        dana.page,
        await centreOfShapeOnScreen(dana.page, flow.ids.start),
        await centreOfShapeOnScreen(dana.page, flow.ids.pay),
      );
      await expectEventually(
        'TC-25 Sam sees Dana draw the new arrow',
        () => connectorsOn(sam.page),
        (arrows) => arrowBetween(arrows, flow.ids.start, flow.ids.pay) !== undefined,
      );

      /** Both ends joined, and the side each one is on. */
      const joints = async (participant: Participant) => {
        const board = await objectsOn(participant.page);
        const arrow = arrowBetween(board, flow.ids.start, flow.ids.pay);
        const start = boxOf(board.find((o) => o.id === flow.ids.start));
        const pay = boxOf(board.find((o) => o.id === flow.ids.pay));
        if (!arrow || !arrow.ends || !start || !pay) return null;
        return {
          fromSide: sideOf(start, arrow.ends.from),
          toSide: sideOf(pay, arrow.ends.to),
        };
      };

      // Payment is to the right of the cart, so the arrow leaves the cart's right side.
      await expectEventually('TC-25 the arrow starts on the cart\'s right side', () => joints(sam), (j) => j?.fromSide === 'right' && j?.toSide === 'left');

      // Somebody drags payment right down, below the cart.
      const below = { x: flow.boxes.start.x + flow.boxes.start.width / 2, y: flow.boxes.start.y + flow.boxes.start.height + 240 };
      await dragShapeToWorld(dana.page, flow.ids.pay, below);

      // On Sam's screen the arrow is still joined to the same two shapes — and has
      // turned to the pair of sides that now face each other.
      await expectEventually(
        'TC-25 Sam sees the arrow turn to the new sides',
        () => joints(sam),
        (j) => j?.fromSide === 'bottom' && j?.toSide === 'top',
      );
      // Dana sees the same thing she drew.
      const onDana = await joints(dana);
      expect(onDana).toEqual({ fromSide: 'bottom', toSide: 'top' });

      // And it is really painted on Sam's screen, not only present in his model.
      const arrow = arrowBetween(await objectsOn(sam.page), flow.ids.start, flow.ids.pay)!;
      await expect(sam.page.locator(`[data-testid="connector-line-${arrow.id}"]`)).toHaveCount(1);
      // Nothing fell over on the way.
      expect(dana.consoleErrors).toEqual([]);
      expect(sam.consoleErrors).toEqual([]);
    } finally {
      await closeParticipants([dana, sam]);
    }
  });

  test('TC-26 deleting the shape an arrow points at leaves the arrow with a loose end where the side was', async ({
    browser,
    request,
  }) => {
    const flow = checkoutFlow('dana');
    const boardId = await createBoard(request);
    const [dana, sam] = await openParticipants(browser, boardId, ['Dana', 'Sam']);
    try {
      await seedFlow(dana, flow);
      await waitForFlow(sam, 'Sam');

      // The arrow payment -> shipped leaves shipped on its left side, facing payment.
      const shippedLeft = {
        x: flow.boxes.shipped.x,
        y: flow.boxes.shipped.y + flow.boxes.shipped.height / 2,
      };

      /** Sam deletes the last shape in the flow. */
      await sam.page.mouse.click((await centreOfShapeOnScreen(sam.page, flow.ids.shipped)).x, (await centreOfShapeOnScreen(sam.page, flow.ids.shipped)).y);
      await sam.page.keyboard.press('Delete');

      // On both screens: shipped is gone, the arrow is still there, and its end is
      // loose at the point where shipped's side used to be.
      // The arrow is the one that starts at payment: the fixture's spare arrow also has
      // a loose end, but it hangs from the decision.
      const after = async (participant: Participant) => {
        const board = await objectsOn(participant.page);
        const gone = !board.some((o) => o.id === flow.ids.shipped);
        const arrow = board.find(
          (c) => c.type === 'connector' && c.from?.kind === 'attached' && c.from.objectId === flow.ids.pay && c.to?.kind === 'free',
        );
        return { gone, arrow, arrows: board.filter((o) => o.type === 'connector').length };
      };
      for (const participant of [sam, dana]) {
        await expectEventually(
          `TC-26 ${participant.name}: the arrow survives with a loose end`,
          () => after(participant),
          (state) =>
            state.gone &&
            state.arrows === 4 &&
            state.arrow !== undefined &&
            state.arrow.from?.kind === 'attached' &&
            state.arrow.ends !== undefined &&
            within(state.arrow.ends.to.x, shippedLeft.x, 1) &&
            within(state.arrow.ends.to.y, shippedLeft.y, 1),
        );
      }

      // The arrow the fixture left loose is untouched, and nothing logged an error.
      expect((await connectorsOn(dana.page)).length).toBe(4);
      expect(dana.consoleErrors).toEqual([]);
      expect(sam.consoleErrors).toEqual([]);
    } finally {
      await closeParticipants([dana, sam]);
    }
  });

  test('TC-27 dropping an arrow onto a shape that is being deleted leaves it drawn at its fallback', async ({
    browser,
    request,
  }) => {
    const flow = checkoutFlow('dana');
    const boardId = await createBoard(request);
    const dana = await openParticipant(browser, 'Dana', boardId);
    // Sam's link is slow on purpose: his delete is in the air while Dana lets go of the
    // arrow, which is the overlap the design asks for and which two clients on one
    // machine would never manage on their own.
    const sam = await openParticipant(browser, 'Sam', boardId, { delayOutgoingMs: 800 });
    try {
      await seedFlow(dana, flow);
      await waitForFlow(sam, 'Sam');

      // Dana picks up the spare arrow's loose end.
      const branch = (await objectOf(dana.page, flow.ids.branch))!;
      const press: Point = {
        x: (branch.ends!.from.x + branch.ends!.to.x) / 2,
        y: (branch.ends!.from.y + branch.ends!.to.y) / 2,
      };
      await dana.page.mouse.click((await screenOfWorld(dana.page, press)).x, (await screenOfWorld(dana.page, press)).y);
      const handle = dana.page.locator(`[data-testid="connector-handle-to"]`);
      await expect(handle).toBeVisible({ timeout: 5_000 });
      const grabbed = await handle.boundingBox();
      expect(grabbed).not.toBeNull();

      // Sam selects payment and deletes it; the write leaves his machine 800ms later.
      const payCentre = await centreOfShapeOnScreen(sam.page, flow.ids.pay);
      await sam.page.mouse.click(payCentre.x, payCentre.y);
      await sam.page.keyboard.press('Delete');

      // Dana lets go on payment while it is still on her board.
      const drop = await screenOfWorld(dana.page, {
        x: flow.boxes.pay.x + flow.boxes.pay.width / 2,
        y: flow.boxes.pay.y + flow.boxes.pay.height / 2,
      });
      await dragOnBoard(dana.page, { x: grabbed!.x + grabbed!.width / 2, y: grabbed!.y + grabbed!.height / 2 }, drop);

      // The delete lands. Dana's arrow is not thrown away with its target: the end keeps
      // the shape's last anchor as its fallback and the arrow goes on being drawn there.
      await expectEventually(
        'TC-27 Dana sees payment deleted',
        () => objectOf(dana.page, flow.ids.pay),
        (found) => found === undefined,
      );

      const arrow = await objectOf(dana.page, flow.ids.branch);
      expect(arrow, 'the arrow is still on the board').toBeDefined();
      expect(arrow!.ends).toBeDefined();
      expect(Number.isFinite(arrow!.ends!.to.x) && Number.isFinite(arrow!.ends!.to.y)).toBe(true);
      if (arrow!.to?.kind === 'attached') {
        expect(arrow!.to.objectId).toBe(flow.ids.pay);
        expect(within(arrow!.ends!.to.x, arrow!.to.fallback.x, 0.001), 'drawn at the fallback').toBe(true);
        expect(within(arrow!.ends!.to.y, arrow!.to.fallback.y, 0.001), 'drawn at the fallback').toBe(true);
      } else {
        // The other legal ending of the race: Dana's board already knew, so the end was
        // let go as a loose one where it was dropped.
        expect(within(arrow!.ends!.to.x, flow.boxes.pay.x + flow.boxes.pay.width / 2, 40)).toBe(true);
        expect(within(arrow!.ends!.to.y, flow.boxes.pay.y + flow.boxes.pay.height / 2, 40)).toBe(true);
      }
      await expect(dana.page.locator(`[data-testid="connector-line-${flow.ids.branch}"]`)).toHaveCount(1);
      expect(dana.consoleErrors).toEqual([]);
      expect(sam.consoleErrors).toEqual([]);
    } finally {
      await closeParticipants([dana, sam]);
    }
  });

  test('the fixture board is the flow it claims to be (fixture)', async ({ browser, request }) => {
    const flow = checkoutFlow('dana');
    const boardId = await createBoard(request);
    const dana = await openParticipant(browser, 'Dana', boardId);
    try {
      await seedFlow(dana, flow);
      await waitForFlow(dana, 'Dana');
      const board = await objectsOn(dana.page);
      const labels = board.filter((o) => o.type === 'shape').map((o) => o.label).sort();
      expect(labels).toEqual(['Add to cart', 'In stock?', 'Shipped', 'Take payment']);
      expect(board.filter((o) => o.type === 'connector').every((c) => c.ends && Number.isFinite(c.ends.from.x))).toBe(true);
      // Three arrows joined at both ends, one with a loose end.
      const joined = board.filter(
        (c) => c.type === 'connector' && c.from?.kind === 'attached' && c.to?.kind === 'attached',
      );
      expect(joined).toHaveLength(3);
      expect(idsOf(flow.ids).filter((id) => !board.some((o) => o.id === id))).toEqual([]);
    } finally {
      await closeParticipants([dana]);
    }
  });
});

/** Every id the fixture hands out. */
function idsOf(ids: CheckoutFlowIds): string[] {
  return [ids.start, ids.decide, ids.pay, ids.shipped, ids.branch, ...ids.links];
}
