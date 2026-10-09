import { expect, test, type Browser } from '@playwright/test';
import {
  applyChange,
  boardLink,
  clipboardContext,
  closeParticipants,
  createBoard,
  expectConverged,
  expectNoErrors,
  logLatencySummary,
  participantOf,
  type LatencySample,
  type Participant,
} from './helpers/participants';
import { waitForCentredBoard, dragPointer } from './helpers/board';
import {
  clickConnectorTool,
  deleteSelectionOnBoard,
  connectorsOn,
  createShapeOnBoard,
  selectShape,
  shapeCentre,
  shapesOn,
  waitForConnectors,
  waitForShapes,
  type ConnectorRecord,
  type ShapeRecord,
  type XY,
} from './helpers/shapes';
import type { Page } from '@playwright/test';

/**
 * Story 10's arrows in real browsers, with two people in one room (TC-25, TC-26, TC-27).
 *
 * An arrow stores no route: what it stores is which shape each end sits on, so moving a shape
 * is one change and each screen works out the same line from it. That is what these tests look
 * at — the same resolved ends in both browsers, from the same document — and TC-27 forces the
 * awkward moment where one person is holding an arrow out to a shape the other has just
 * deleted. Delivery times are logged against the live budget, never asserted.
 */

/** Two shapes on Dana's screen, A to the left of B, both clear of the controls. */
const A_FROM = { x: 360, y: 240 };
const A_TO = { x: 520, y: 360 };
const B_FROM = { x: 760, y: 300 };
const B_TO = { x: 920, y: 420 };

/** Dana and Sam, by the names the story uses, on a board the service made. */
async function twoPeople(browser: Browser): Promise<{
  dana: Participant;
  sam: Participant;
  people: Participant[];
}> {
  const link = boardLink(await createBoard(browser));
  const people: Participant[] = [];
  for (const name of ['Dana', 'Sam']) {
    const context = await clipboardContext(browser);
    const page = await context.newPage();
    const person = participantOf(name, context, page);
    await page.goto(link);
    await waitForCentredBoard(page);
    people.push(person);
  }
  const [dana, sam] = people as [Participant, Participant];
  return { dana, sam, people };
}

interface OnBoard {
  dana: Participant;
  sam: Participant;
  people: Participant[];
  a: string;
  b: string;
  samples: LatencySample[];
}

/** Dana draws two shapes, and Sam sees both. */
async function twoShapes(browser: Browser): Promise<OnBoard> {
  const { dana, sam, people } = await twoPeople(browser);
  const samples: LatencySample[] = [];
  let a = '';
  let b = '';
  samples.push(
    ...(await applyChange(
      'shape A',
      dana,
      async () => {
        a = await createShapeOnBoard(dana.page, A_FROM, A_TO);
      },
      [sam],
    )),
  );
  samples.push(
    ...(await applyChange(
      'shape B',
      dana,
      async () => {
        b = await createShapeOnBoard(dana.page, B_FROM, B_TO);
      },
      [sam],
    )),
  );
  return { dana, sam, people, a, b, samples };
}

/** Dana also draws the arrow from A to B, and Sam sees that too. */
async function connected(browser: Browser): Promise<OnBoard & { arrow: ConnectorRecord }> {
  const board = await twoShapes(browser);
  const from = await shapeCentre(board.dana.page, board.a);
  const to = await shapeCentre(board.dana.page, board.b);
  board.samples.push(
    ...(await applyChange(
      'arrow from A to B',
      board.dana,
      async () => {
        await clickConnectorTool(board.dana.page);
        await dragPointer(board.dana.page, from, to);
      },
      [board.sam],
    )),
  );
  const [arrow] = await waitForConnectors(board.sam.page, 1);
  await waitForShapes(board.sam.page, 2);
  return { ...board, arrow };
}

function point(at: XY): [number, number] {
  return [Math.round(at.x), Math.round(at.y)];
}

async function shapeOf(page: Page, id: string): Promise<ShapeRecord> {
  const shape = (await shapesOn(page)).find((entry) => entry.id === id);
  if (!shape) throw new Error(`no shape with id ${id}`);
  return shape;
}

/** The four side anchors a shape offers, in board units, as this browser holds the shape. */
async function anchorsOf(page: Page, id: string): Promise<Record<'left' | 'right' | 'top' | 'bottom', XY>> {
  const shape = await shapeOf(page, id);
  return {
    left: { x: shape.x, y: shape.y + shape.height / 2 },
    right: { x: shape.x + shape.width, y: shape.y + shape.height / 2 },
    top: { x: shape.x + shape.width / 2, y: shape.y },
    bottom: { x: shape.x + shape.width / 2, y: shape.y + shape.height },
  };
}

test('TC-25: an arrow follows a shape the other person dragged past its partner, and changes side', async ({
  browser,
}) => {
  const { dana, sam, people, a, b, arrow, samples } = await connected(browser);
  try {
    // Both ends attached, on the sides that face each other, in both browsers.
    expect(arrow.from.kind).toBe('attached');
    expect(arrow.to.kind).toBe('attached');
    expect(arrow.sides).toEqual({ from: 'right', to: 'left' });
    expect((await connectorsOn(dana.page))[0].sides).toEqual({ from: 'right', to: 'left' });

    // Sam drags B to the left of A in the real UI, and Dana's arrow is waited for.
    const centre = await shapeCentre(sam.page, b);
    const target = { x: 200, y: 300 };
    const moved = await applyChange(
      'Sam drags B past A',
      sam,
      async () => {
        await dragPointer(sam.page, centre, target);
      },
      [dana],
    );
    samples.push(...moved);

    // Both screens resolved the same arrow: still attached at both ends, but now leaving A
    // from its left side and B from its right, because that is how they sit.
    for (const person of [dana, sam]) {
      const arrows = await connectorsOn(person.page);
      expect(arrows).toHaveLength(1);
      const followed = arrows[0];
      expect(followed.from.kind).toBe('attached');
      expect(followed.to.kind).toBe('attached');
      expect(followed.sides).toEqual({ from: 'left', to: 'right' });
      const aLeft = (await anchorsOf(person.page, a)).left;
      const bRight = (await anchorsOf(person.page, b)).right;
      expect(followed.ends.from.x).toBeCloseTo(aLeft.x, 1);
      expect(followed.ends.from.y).toBeCloseTo(aLeft.y, 1);
      expect(followed.ends.to.x).toBeCloseTo(bRight.x, 1);
      expect(followed.ends.to.y).toBeCloseTo(bRight.y, 1);
    }
    await expectConverged(people);
    logLatencySummary(samples);
    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});

test('TC-26: deleting a shape leaves the arrow, its end freed where the shape was', async ({
  browser,
}) => {
  const { dana, sam, people, a, b, arrow, samples } = await connected(browser);
  try {
    expect(arrow.sides).toEqual({ from: 'right', to: 'left' });
    // Where B's facing side sits, before anybody deletes B.
    const bBefore = await shapeOf(sam.page, b);
    const side = { x: bBefore.x, y: bBefore.y + bBefore.height / 2 };

    samples.push(
      ...(await applyChange(
        'Sam deletes B',
        sam,
        async () => {
          await selectShape(sam.page, b);
          await deleteSelectionOnBoard(sam.page);
        },
        [dana],
      )),
    );

    // The arrow is still there on both screens, its end now free at the side B was on.
    for (const person of [dana, sam]) {
      const arrows = await waitForConnectors(person.page, 1);
      expect(arrows).toHaveLength(1);
      expect((await shapesOn(person.page)).map((shape) => shape.id)).toEqual([a]);
      const freed = arrows[0];
      expect(freed.to.kind).toBe('free');
      expect(freed.from.kind).toBe('attached');
      expect(freed.ends.to.x).toBeCloseTo(side.x, 1);
      expect(freed.ends.to.y).toBeCloseTo(side.y, 1);
    }
    logLatencySummary(samples);
    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});

test('TC-27: a shape deleted while an arrow is being dragged to it leaves an arrow that is still drawn', async ({
  browser,
}) => {
  const { dana, sam, people, a, b, samples } = await twoShapes(browser);
  try {
    // Dana presses on A and drags towards B, but does not let go; while her button is still
    // down, Sam deletes B. The overlap is forced by the paused drag rather than by a fake
    // network, so the test does not depend on winning a race.
    const from = await shapeCentre(dana.page, a);
    const release = await shapeCentre(dana.page, b);
    const bBefore = await shapeOf(dana.page, b);
    await clickConnectorTool(dana.page);
    await dana.page.mouse.move(...point(from));
    await dana.page.mouse.down();
    await dana.page.mouse.move(...point(release), { steps: 10 });
    // The arrow is half-drawn: the preview is on the screen and the button is still down.
    await expect(dana.page.locator('[data-testid="connector-preview"]')).toHaveCount(1);

    samples.push(
      ...(await applyChange(
        'Sam deletes B while Dana is still dragging',
        sam,
        async () => {
          await selectShape(sam.page, b);
          await deleteSelectionOnBoard(sam.page);
        },
        [dana],
      )),
    );

    // Dana lets go over the empty space where B was. An arrow appears, and it is drawn.
    await dana.page.mouse.up();
    const arrows = await waitForConnectors(dana.page, 1);
    const drawn = arrows[0];
    // Its B end cannot be attached to anything that still exists: either the model freed it at
    // the side B was on, or it attached to B a moment before the delete and is drawn from the
    // fallback point Dana released at. Both are inside the box B left behind.
    expect(drawn.ends.to.x).toBeGreaterThanOrEqual(bBefore.x - 1);
    expect(drawn.ends.to.x).toBeLessThanOrEqual(bBefore.x + bBefore.width + 1);
    expect(drawn.ends.to.y).toBeGreaterThanOrEqual(bBefore.y - 1);
    expect(drawn.ends.to.y).toBeLessThanOrEqual(bBefore.y + bBefore.height + 1);
    // The arrow at the other end of the room is drawn too, and nothing was thrown anywhere.
    const forSam = await waitForConnectors(sam.page, 1);
    expect(forSam[0].ends.to).toEqual(drawn.ends.to);
    expect(await connectorsOn(dana.page)).toHaveLength(1);
    logLatencySummary(samples);
    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});
