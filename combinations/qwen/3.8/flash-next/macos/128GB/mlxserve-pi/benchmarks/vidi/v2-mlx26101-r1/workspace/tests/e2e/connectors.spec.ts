// Story 10 e2e: arrows between shapes, across two people's screens.
//
// An arrow is not a picture drawn once and left behind: it stores which objects its ends are
// joined to and draws itself from their boxes, so a person moving a shape down the line moves
// the arrow's end with it, and a person deleting one leaves the other person with an arrow that
// still shows where the object was. That is what these tests are about — not the arithmetic of
// side anchors (unit) and not the tool's every branch (component), but the fact that two people
// in two browsers, joined only through the Worker's room, both end up drawing the same arrow in
// the same place, and that nobody's arrow disappears.
//
// The wall-clock time an update takes is measured and printed against the live latency budget,
// the way story 3 does it: on a shared machine a slow minute is a fact about the machine, while
// a change that never arrives is a fact about the code.

import { expect, test } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  E2E_PROPAGATION_GUARD_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../src/shared/config';
import { nearestSide, sideAnchors, type Point, type Rect } from '../../src/shared/geometry';
import { endpointObjectId, type Endpoint } from '../../src/shared/objects/connector';
import type { ShapeSnap } from '../../src/shared/objects/shape';
import {
  createFreshBoard,
  createParticipants,
  expectEventually,
  type Participant,
} from './helpers/participants';
import {
  pressTool,
  seedShapesAtScreen,
  connectorIdsOn,
  connectorOf,
  connectorPaintedEnds,
  dragScreenPoints,
  dragShapeCenterTo,
  beginDragAt,
  endDrag,
  moveDragTo,
  samePlace,
  screenOf,
  shapeOf,
  shapeIdsOn,
  shapesOn,
  connectorsOn,
  sideScreenPoint,
  waitForNewConnector,
} from './helpers/shape';
import { FLOW_ARROW_COUNT, FLOW_SHAPE_COUNT, seedFlow, waitForFlow } from '../fixtures/checkout-flow';

/** One arrow's stored ends, to be compared with itself across a delete. */
type FlowArrow = { from: Endpoint; to: Endpoint };
/** One arrow's painted ends, read off the picture. */
type PaintedEnds = { from: { x: number; y: number }; to: { x: number; y: number } };

/** Sort by id, so two screens' lists can be compared without depending on order. */
function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A shape's own box, in world units: the thing an arrow's end is computed from. */
function boxOf(shape: ShapeSnap): Rect {
  return {
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
  };
}

function centerOf(shape: ShapeSnap): Point {
  return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
}

/** Where an arrow's end is drawn on this person's screen, from what this person's model says. */
async function expectedEnd(person: Participant, other: ShapeSnap, target: ShapeSnap) {
  const side = nearestSide(boxOf(target), centerOf(other));
  const anchor = sideAnchors(boxOf(target))[side];
  return { side, at: await screenOf(person.page, anchor) };
}

/**
 * The claim both screens are asked to agree on: the arrow is joined to the two objects it was
 * joined to, and it is drawn between the two sides of their boxes that face each other.
 *
 * The two boxes and the picture are read together, in the same attempt, on purpose. While a
 * move is still arriving on this screen the boxes are things that are changing, and an
 * expectation about the picture worked out from a box read a moment ago is an expectation about
 * a board that no longer exists — it can be answered falsely by a screen that is merely behind.
 * What is asserted is that the picture agrees with the geometry of the boxes this screen has,
 * which it does as soon as the screen has caught up; how long catching up takes is measured and
 * printed by the caller against LIVE_UPDATE_LATENCY_BUDGET_MS, never asserted here, so the wait
 * is the project's generous one (E2E_EVENTUAL_TIMEOUT_MS) rather than a budget in disguise.
 */
async function expectArrowAtTheSides(
  person: Participant,
  id: string,
  a: string,
  b: string,
): Promise<void> {
  const snap = await connectorOf(person.page, id);
  expect(endpointObjectId(snap.from), 'the arrow is still joined to the object it started at').toBe(a);
  expect(endpointObjectId(snap.to), 'and to the object it pointed at').toBe(b);

  // The attempt answers with 'ok' or with what it saw, so a screen that is behind says which
  // side it drew and where, instead of saying `false`.
  await expect
    .poll(
      async () => {
        const shapeA = await shapeOf(person.page, a);
        const shapeB = await shapeOf(person.page, b);
        const from = await expectedEnd(person, shapeB, shapeA);
        const to = await expectedEnd(person, shapeA, shapeB);
        const painted = await connectorPaintedEnds(person.page, id);
        if (samePlace(painted.from, from.at) && samePlace(painted.to, to.at)) return 'ok';
        const at = (p: Point) => `(${p.x.toFixed(1)},${p.y.toFixed(1)})`;
        return (
          `drawn ${at(painted.from)} -> ${at(painted.to)}, expected A's ${from.side} side ` +
          `${at(from.at)} -> B's ${to.side} side ${at(to.at)}; boxes ` +
          `A${at({ x: shapeA.x, y: shapeA.y })} B${at({ x: shapeB.x, y: shapeB.y })}`
        );
      },
      { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: 'the arrow is not drawn between the sides that face each other' },
    )
    .toBe('ok');
}

async function closeAll(people: readonly Participant[]): Promise<void> {
  await Promise.all(people.map((p) => p.close()));
}

test.describe('connectors: arrows that follow', () => {
  // TC-25 (connector.follow): Dana joins A to B and then drags B past A. The arrow's ends are
  // not coordinates that were drawn once; they are the two objects' sides, so the ends travel to
  // the sides that now face each other and the arrow stays joined at both ends. Sam, in another
  // browser, sees the same arrow in the same place, because the document stores the join and
  // each screen does the same arithmetic on it.
  test('TC-25 an arrow follows the object it points at and switches sides on both screens', async ({
    browser,
    request,
  }) => {
    const people = await createParticipants(browser, await createFreshBoard(request), [
      'Dana',
      'Sam',
    ]);
    const [dana, sam] = people as [Participant, Participant];

    const [a, b] = await seedTwoShapes(dana);

    // Dana joins them with the tool: press the dot on A's facing side, travel to the dot on B's,
    // and let go there.
    const arrowsBefore = await connectorIdsOn(dana.page);
    await pressTool(dana.page, 'L');
    await dragScreenPoints(
      dana.page,
      await sideScreenPoint(dana.page, a, 'right'),
      await sideScreenPoint(dana.page, b, 'left'),
    );
    await pressTool(dana.page, 'V');

    const made = await waitForNewConnector(dana.page, arrowsBefore);
    const id = made.id;
    expect(id, 'the drag on the connector layer joined the two shapes').toBeDefined();
    const joined = await expectEventually(
      () => connectorIdsOn(sam.page),
      (list) => list.includes(id!),
      E2E_PROPAGATION_GUARD_MS,
    );
    console.log(
      `[TC-25] the new arrow reached Sam in ${joined.ms} ms ` +
        `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms)`,
    );

    // Before the move, the arrow leaves A on the right and arrives on B's left.
    await expectArrowAtTheSides(dana, id!, a, b);
    expect(
      nearestSide(boxOf(await shapeOf(dana.page, b)), centerOf(await shapeOf(dana.page, a))),
      'B faces A from the left to begin with',
    ).toBe('left');

    // Dana drags B past A: left of it and below, where the sides have to change.
    const started = Date.now();
    await dragShapeCenterTo(dana.page, b, { x: 220, y: 620 });
    const moved = await shapeOf(dana.page, b);
    expect(moved.x + moved.width / 2, 'B is left of A now').toBeLessThan(
      (await shapeOf(dana.page, a)).x,
    );

    // Dana's own screen: still attached, and the ends are at the sides that face each other now.
    await expectArrowAtTheSides(dana, id!, a, b);
    expect(
      nearestSide(boxOf(moved), centerOf(await shapeOf(dana.page, a))),
      'the side on B has switched',
    ).not.toBe('left');

    // Sam sees the same arrow, at the same sides. The wait is the room, not the code.
    const waiting = Date.now();
    await expect
      .poll(
        async () =>
          samePlace(
            (await connectorPaintedEnds(sam.page, id!)).to,
            (await expectedEnd(sam, await shapeOf(sam.page, a), await shapeOf(sam.page, b))).at,
          ),
        {
          // A screen drawing somebody else's move is the thing whose time is logged, not
          // asserted: the wait is generous, and the time it took is printed below.
          timeout: E2E_EVENTUAL_TIMEOUT_MS,
          message: "Sam's screen never drew Dana's move of B",
        },
      )
      .toBe(true);
    console.log(
      `[TC-25] Dana's move of B was drawn on Sam's screen ${Date.now() - started} ms after the ` +
        `mouse let go, of which ${Date.now() - waiting} ms was Sam's screen catching up ` +
        `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms)`,
    );
    await expectArrowAtTheSides(sam, id!, a, b);

    expect(people.flatMap((p) => p.pageErrors)).toEqual([]);
    await closeAll(people);
  });

  // TC-26 (connector.detaches): Sam deletes B. The arrow is not one of the things deleted — it
  // belongs to Dana's screen and to the document, not to the object that ended there — so it
  // stays, its end now a point on the board where B's facing side used to be. Both people see
  // the same arrow in the same place, and nobody is shown an arrow that vanished.
  test('TC-26 deleting the object an arrow points at leaves the arrow, with its end where that object was', async ({
    browser,
    request,
  }) => {
    const people = await createParticipants(browser, await createFreshBoard(request), [
      'Dana',
      'Sam',
    ]);
    const [dana, sam] = people as [Participant, Participant];

    const [a, b] = await seedTwoShapes(dana);
    const arrowsBefore = await connectorIdsOn(dana.page);
    await pressTool(dana.page, 'L');
    await dragScreenPoints(
      dana.page,
      await sideScreenPoint(dana.page, a, 'right'),
      await sideScreenPoint(dana.page, b, 'left'),
    );
    await pressTool(dana.page, 'V');
    const made = await waitForNewConnector(dana.page, arrowsBefore);
    const id = made.id;
    await expectEventually(
      () => connectorIdsOn(sam.page),
      (list) => list.includes(id!),
      E2E_PROPAGATION_GUARD_MS,
    );

    // Where the arrow is drawn on each screen while both objects are there.
    const before = {
      dana: await connectorPaintedEnds(dana.page, id!),
      sam: await connectorPaintedEnds(sam.page, id!),
    };
    expect(samePlace(before.dana.to, before.sam.to), 'both screens agree to begin with').toBe(true);

    // Sam deletes B, with the keyboard, the way a person does.
    await sam.page.getByTestId(`shape-${b}`).click();
    await sam.page.keyboard.press('Delete');

    // On both screens the arrow is still there and still drawn, its end where B's side was.
    for (const person of people) {
      await expectEventually(
        () => shapeIdsOn(person.page),
        (list) => !list.includes(b),
        E2E_PROPAGATION_GUARD_MS,
      );
      const snap = await connectorOf(person.page, id!);
      expect(snap.to.kind, 'the end is a point on the board now, not a join').toBe('free');
      expect(endpointObjectId(snap.from), 'the other end is still joined').toBe(a);
      const painted = await connectorPaintedEnds(person.page, id!);
      expect(
        samePlace(painted.to, before.dana.to),
        `${person.name} draws the end where B's side was`,
      ).toBe(true);
      expect(
        samePlace(painted.from, before.dana.from),
        'and the joined end where it always was',
      ).toBe(true);
    }
    expect((await shapesOn(dana.page)).map((s) => s.id)).toEqual([a]);
    expect(people.flatMap((p) => p.pageErrors)).toEqual([]);
    await closeAll(people);
  });

  // A second case for the same rule, on a whole flow: the document detaches the ends of the
  // arrows that were joined to the object that went away, and it is not allowed to disturb the
  // arrows that had nothing to do with it. That last part is invisible in a board with one arrow
  // on it, which is why the flow fixture has an arrow that is already free at one end and an
  // arrow that never touched the deleted shape at all: both of them have to come out of the
  // delete with not one field changed.
  test('a delete detaches the arrows that touched the deleted shape and leaves the others as they were', async ({
    browser,
    request,
  }) => {
    const people = await createParticipants(browser, await createFreshBoard(request), [
      'Dana',
      'Sam',
    ]);
    const [dana, sam] = people as [Participant, Participant];

    const flow = await seedFlow(dana.page);
    const diamond = flow.shapes[1]!;
    // The flow is four shapes and four arrows written as eight separate transactions, so it
    // arrives at Sam's screen in pieces. Everything below compares what Sam's screen holds with
    // what Dana's does, so it waits until Sam has the whole of it.
    await waitForFlow(sam.page);

    // Every arrow on the board, stored and painted, before anybody deletes anything.
    const storedBefore: Record<string, FlowArrow> = {};
    const paintedBefore: Record<string, PaintedEnds> = {};
    for (const id of [...flow.arrows, flow.freeArrow]) {
      const snap = await connectorOf(sam.page, id);
      storedBefore[id] = { from: snap!.from, to: snap!.to };
      paintedBefore[id] = await connectorPaintedEnds(sam.page, id!);
    }

    await sam.page.getByTestId(`shape-${diamond}`).click();
    await sam.page.keyboard.press('Delete');

    for (const person of people) {
      // Wait for this page to have the delete: the shape gone and all four arrows still there.
      // (Counting arrows alone would be satisfied by the board as it was before the delete.)
      await expectEventually(
        async () => ({
          shapes: await shapeIdsOn(person.page),
          arrows: await connectorsOn(person.page),
        }),
        (board) =>
          board.shapes.length === FLOW_SHAPE_COUNT - 1 &&
          !board.shapes.includes(diamond) &&
          board.arrows.length === FLOW_ARROW_COUNT &&
          !board.arrows.some((c) => !storedBefore[c.id]),
        E2E_PROPAGATION_GUARD_MS,
      );
      expect(await shapeIdsOn(person.page), 'three shapes are left').toHaveLength(
        FLOW_SHAPE_COUNT - 1,
      );

      // The two arrows that were joined to the diamond have an end that is a point on the board
      // now, where it used to name the deleted shape.
      const [intoDiamond, outOfDiamond] = flow.arrows;
      for (const [id, end] of [
        [intoDiamond, 'to'],
        [outOfDiamond, 'from'],
      ] as const) {
        const snap = await connectorOf(person.page, id!);
        expect((snap![end] as { kind: string }).kind, `${id}'s ${end} end is a point now`).toBe(
          'free',
        );
      }

      // The arrow between the two shapes that are still there, and the arrow whose end was
      // already a point on the board, are stored without one field different.
      for (const id of [flow.arrows[2]!, flow.freeArrow]) {
        const snap = await connectorOf(person.page, id);
        expect(
          { from: snap!.from, to: snap!.to },
          `${id} is stored exactly as it was before the delete`,
        ).toEqual(storedBefore[id]);
      }

      // And the whole flow is drawn where it was drawn. Deleting a shape takes two arrows' ends
      // off it and moves nothing: an end that was resting on the deleted shape's side is left at
      // that same place, and the other arrows were never involved. This is the picture a person
      // is left with, so it is waited for rather than assumed: the wait is for this screen to
      // have drawn the delete, which is the part whose time is logged elsewhere.
      for (const id of [...flow.arrows, flow.freeArrow]) {
        await expect
          .poll(
            async () => {
              const painted = await connectorPaintedEnds(person.page, id);
              return (
                samePlace(painted.from, paintedBefore[id]!.from) &&
                samePlace(painted.to, paintedBefore[id]!.to)
              );
            },
            {
              timeout: E2E_EVENTUAL_TIMEOUT_MS,
              message: `${person.name} does not draw ${id} where it was drawn before the delete`,
            },
          )
          .toBe(true);
      }
    }

    // And the two screens are not each holding a slightly different flow.
    const [danaArrows, samArrows] = await Promise.all([
      connectorsOn(dana.page),
      connectorsOn(sam.page),
    ]);
    expect(
      danaArrows.map((c) => ({ id: c.id, from: c.from, to: c.to })).sort(byId),
      'both screens store the same four arrows',
    ).toEqual(samArrows.map((c) => ({ id: c.id, from: c.from, to: c.to })).sort(byId));
    expect(people.flatMap((p) => p.pageErrors)).toEqual([]);
    await closeAll(people);
  });

  // TC-27 (connector.orphan): an arrow being created and the object it is being created onto
  // being deleted are two people's actions in two browsers at one moment, and the room gets to
  // choose which of them the document sees first. If the delete is applied first, the arrow
  // arrives joined to an object that is no longer there, and the board draws it from the place
  // that end was stored with — a place on the board, not a phantom object. If the create is
  // applied first, the delete's own pass takes the end off the object it is deleting and leaves
  // it a place on the board. Either way the arrow is there, both people are looking at the same
  // one in the same place, and nothing threw on the way (connector.no_target at render).
  test('TC-27 an arrow created onto an object that is deleted at the same moment is left drawn, at a place on the board, on both screens', async ({
    browser,
    request,
  }) => {
    const people = await createParticipants(browser, await createFreshBoard(request), [
      'Dana',
      'Sam',
    ]);
    const [dana, sam] = people as [Participant, Participant];

    const [a, b] = await seedTwoShapes(dana);

    // Dana begins an arrow on A's facing dot, travels to B's dot, and is about to let go there.
    await pressTool(dana.page, 'L');
    const start = await sideScreenPoint(dana.page, a, 'right');
    const target = await sideScreenPoint(dana.page, b, 'left');
    await beginDragAt(dana.page, start);
    await moveDragTo(dana.page, target);

    // Sam has B selected, and is about to press Delete. Both actions are then issued without
    // waiting for the other: the overlap is real, and which write the room merges first is not
    // something this test can choose, which is the whole point of it.
    await sam.page.getByTestId(`shape-${b}`).click();
    await Promise.all([
      endDrag(dana.page),
      sam.page.keyboard.press('Delete'),
    ]);
    await pressTool(dana.page, 'V');

    // The two screens converge on one document, and that document has one arrow.
    await expectEventually(
      () => Promise.all([connectorIdsOn(dana.page), connectorIdsOn(sam.page)]).then(
        ([x, y]) => x.length === 1 && y.length === 1 && x[0] === y[0],
      ),
      (same) => same,
      E2E_PROPAGATION_GUARD_MS,
    );
    const [id] = await connectorIdsOn(dana.page);
    expect(id, 'the arrow the drag made is there').toBeDefined();

    // B is gone from both screens, and the arrow is not joined to it in a way that leaves one
    // person's arrow somewhere another person cannot see.
    for (const person of people) {
      const snap = await connectorOf(person.page, id!);
      expect(endpointObjectId(snap.from), 'the end that left A is joined to A').toBe(a);
      expect(
        snap.to.kind === 'free' || endpointObjectId(snap.to) === b,
        'the other end is a place on the board, or names the object that was deleted',
      ).toBe(true);
      await expect
        .poll(
          async () =>
            samePlace(
              (await connectorPaintedEnds(person.page, id!)).to,
              target,
            ),
          {
            timeout: E2E_EVENTUAL_TIMEOUT_MS,
            message: `${person.name} does not draw that end where the pointer was let go, which is where B's side was`,
          },
        )
        .toBe(true);
      expect(await shapeIdsOn(person.page), 'and B really is gone').toEqual([a]);
    }
    const stored = await Promise.all(people.map((p) => connectorOf(p.page, id!).then((c) => c.to)));
    expect(stored[1], 'both screens store the same end').toEqual(stored[0]);

    // The line is in both screens' documents. Playwright's own "visible" is not the thing being
    // asked here: an arrow between two points on one row is a line with no height, and the
    // library calls a zero-height box hidden. What is asked is that the element is painted and
    // has the coordinates it should have, which is what reading them off the element does.
    for (const person of people) {
      await expect(person.page.getByTestId(`connector-line-${id!}`)).toHaveCount(1);
    }
    expect(people.flatMap((p) => p.pageErrors)).toEqual([]);
    await closeAll(people);
  });
});

/** Two shapes far enough apart that the sides between them are unambiguous. */
async function seedTwoShapes(dana: Participant): Promise<[string, string]> {
  const ids = await seedShapesAtScreen(dana.page, [
    { x: 400, y: 400 },
    { x: 900, y: 400 },
  ]);
  return [ids[0]!, ids[1]!];
}
