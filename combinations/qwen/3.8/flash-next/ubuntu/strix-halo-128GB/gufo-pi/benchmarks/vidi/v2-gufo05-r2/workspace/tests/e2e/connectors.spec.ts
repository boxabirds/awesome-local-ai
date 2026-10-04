/**
 * Story 10 end to end: arrows that hang on objects, in two browsers on one room.
 *
 * The claim of this story is about what happens on *somebody else's* screen: an arrow is
 * stored as a pair of ends, and the line is computed when it is drawn, so a person who is
 * not touching the arrow sees it re-route as the shapes it hangs on are moved, and it does
 * not disappear when one of them is deleted. Each case therefore reads the same two things
 * on both screens — the ends the document holds and the line this browser drew — and the
 * timing of the delivery is logged against the story's budget rather than asserted, since
 * model, browsers and server share this one machine.
 *
 * TC-25 an arrow follows its object past the other one and switches side on both screens ·
 * TC-26 deleting the object leaves the arrow where it hung · TC-27 an object deleted under
 * a drag whose end is about to hang on it leaves an arrow drawn with real numbers, and the
 * two screens agree.
 */

import type { Page } from '@playwright/test';

import { changeArrives, expect, expectNoErrors, test } from './helpers/live';
import { setCamera, type Pixel } from './helpers/board';
import {
  arrowLine,
  createArrowByDrag,
  deleteShape,
  dragShapeTo,
  getConnectors,
  grabArrowEnd,
  releaseAt,
  selectArrow,
  seedArrow,
  seedShapeAt,
} from './helpers/drawing';
import type { ConnectorSnapshot } from '../../src/shared/objects/connector';

/** One board unit to one screen pixel, from the board's top-left corner. */
const FLAT = { x: 0, y: 0, zoom: 1 };

const A_CENTRE: Pixel = { x: 300, y: 300 };
const B_CENTRE: Pixel = { x: 700, y: 300 };
/** The standard shape is 160 wide, so these are the sides that face each other. */
const A_RIGHT: Pixel = { x: 380, y: 300 };
const B_LEFT: Pixel = { x: 620, y: 300 };

function near(at: Pixel, want: Pixel, tolerance = 1): boolean {
  return Math.abs(at.x - want.x) <= tolerance && Math.abs(at.y - want.y) <= tolerance;
}

function connectorOf(list: ConnectorSnapshot[], id: string): ConnectorSnapshot {
  const found = list.find((entry) => entry.id === id);
  if (!found) throw new Error(`arrow ${id} is no longer in the document`);
  return found;
}

/** Put a board with two shapes and an arrow between them in front of both people. */
async function boardWithArrow(
  dana: Page,
  sam: Page,
): Promise<{ a: string; b: string; arrow: string }> {
  await setCamera(dana, FLAT);
  await setCamera(sam, FLAT);
  const a = await seedShapeAt(dana, 'rect', A_CENTRE);
  const b = await seedShapeAt(dana, 'ellipse', B_CENTRE);
  const arrow = await seedArrow(dana, a, b);
  await expect(sam.locator(`[data-testid="connector-${arrow}"]`)).toBeVisible();
  return { a, b, arrow };
}

test.describe('arrows between shapes', () => {
  test('TC-25: an arrow follows the shape it hangs on, and switches side on both screens', async ({
    liveBoards,
  }) => {
    const { people } = await liveBoards.open(['dana', 'sam']);
    const [dana, sam] = people;
    const { a, b, arrow } = await boardWithArrow(dana.page, sam.page);

    // Both screens agree before the move: the ends hang on the facing sides.
    const before = await arrowLine(dana.page, arrow);
    expect(near(before.from, A_RIGHT)).toBe(true);
    expect(near(before.to, B_LEFT)).toBe(true);

    // Dana takes B away, past A and below it. Nobody touches the arrow.
    const below: Pixel = { x: 300, y: 700 };
    await changeArrives(
      'arrow follows its shape',
      () => dragShapeTo(dana.page, b, below),
      async () => {
        const line = await arrowLine(sam.page, arrow).catch(() => null);
        // A's facing side is now its bottom, B's is its top: the arrow turned through 90°.
        return !!line && near(line.from, { x: 300, y: 380 }) && near(line.to, { x: 300, y: 620 });
      },
    );

    // …and Dana's own screen says the same thing, to the pixel.
    const danaLine = await arrowLine(dana.page, arrow);
    const samLine = await arrowLine(sam.page, arrow);
    expect(near(danaLine.from, { x: 300, y: 380 })).toBe(true);
    expect(near(danaLine.to, { x: 300, y: 620 })).toBe(true);
    expect(Math.abs(danaLine.from.y - samLine.from.y)).toBeLessThanOrEqual(1);

    // The document still holds ends, not points: both are attached, to their own shape.
    const stored = connectorOf(await getConnectors(sam.page), arrow);
    expect(stored.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(stored.to).toMatchObject({ kind: 'attached', objectId: b });

    expectNoErrors(people);
  });

  test('TC-25b: a drag from one shape to another hangs the arrow on both', async ({
    liveBoards,
  }) => {
    const { people } = await liveBoards.open(['dana', 'sam']);
    const [dana, sam] = people;
    await setCamera(dana.page, FLAT);
    await setCamera(sam.page, FLAT);
    const a = await seedShapeAt(dana.page, 'rect', A_CENTRE);
    const b = await seedShapeAt(dana.page, 'diamond', B_CENTRE);
    await expect(sam.page.locator(`[data-object-id="${b}"]`)).toBeVisible();

    // A real drag, starting on A and ending on B, with the tool in between.
    const arrow = await createArrowByDrag(dana.page, A_CENTRE, B_CENTRE);
    const stored = connectorOf(await getConnectors(dana.page), arrow);
    expect(stored.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(stored.to).toMatchObject({ kind: 'attached', objectId: b });

    await expect
      .poll(async () => (await getConnectors(sam.page)).some((entry) => entry.id === arrow), {
        timeout: 10_000,
      })
      .toBe(true);
    const line = await arrowLine(sam.page, arrow);
    expect(near(line.from, A_RIGHT)).toBe(true);
    expect(near(line.to, B_LEFT)).toBe(true);

    // The hand went back to Select, as it does for any creation.
    await expect(dana.page.getByTestId('connector-tool-layer')).toHaveCount(0);
    expectNoErrors(people);
  });

  test('TC-26: deleting the shape at one end leaves the arrow where it hung', async ({
    liveBoards,
  }) => {
    const { people } = await liveBoards.open(['dana', 'sam']);
    const [dana, sam] = people;
    const { a, b, arrow } = await boardWithArrow(dana.page, sam.page);

    // Sam deletes B, the shape the arrow's point hangs on.
    await changeArrives(
      'arrow survives its shape being deleted',
      () => deleteShape(sam.page, b),
      async () => {
        const list = await getConnectors(dana.page);
        const found = list.find((entry) => entry.id === arrow);
        return !!found && found.to.kind === 'free' && list.length === 1;
      },
    );

    for (const person of people) {
      const stored = connectorOf(await getConnectors(person.page), arrow);
      expect(stored.to.kind).toBe('free');
      expect(stored.from).toMatchObject({ kind: 'attached', objectId: a });
      // It hangs where B's side used to be: the arrow did not jump when B went away.
      const line = await arrowLine(person.page, arrow);
      expect(near(line.from, A_RIGHT)).toBe(true);
      expect(near(line.to, B_LEFT)).toBe(true);
    }

    expectNoErrors(people);
  });

  test('TC-27: a shape deleted under an arrow being dragged onto it leaves a drawn arrow', async ({
    liveBoards,
  }) => {
    const { people } = await liveBoards.open(['dana', 'sam']);
    const [dana, sam] = people;
    const { b, arrow } = await boardWithArrow(dana.page, sam.page);

    // Dana's hand goes down on the point of the arrow and starts moving it towards B…
    await selectArrow(dana.page, arrow);
    await grabArrowEnd(dana.page, arrow, 'to');
    await dana.page.mouse.move(660, 300, { steps: 4 });

    // …and while it is down, Sam deletes B. Neither person waits for the other.
    await deleteShape(sam.page, b);

    // Dana lets go over the place B was. Nothing is there any more.
    await releaseAt(dana.page, B_CENTRE);

    // Dana still has an arrow, drawn with real numbers, pointing roughly where it was
    // released, and its other end is still hanging on A.
    const line = await arrowLine(dana.page, arrow);
    expect(near(line.from, A_RIGHT)).toBe(true);
    expect(line.to.x).toBeGreaterThanOrEqual(B_LEFT.x - 1);
    expect(line.to.x).toBeLessThanOrEqual(B_CENTRE.x + 1);
    expect(Math.abs(line.to.y - B_CENTRE.y)).toBeLessThanOrEqual(1);
    expect(line.raw.every((value) => value.length > 0)).toBe(true);

    // However the two writes interleaved, both screens end up holding one arrow.
    await expect
      .poll(
        async () =>
          JSON.stringify(await getConnectors(sam.page)) ===
          JSON.stringify(await getConnectors(dana.page)),
        { timeout: 10_000, message: 'the two screens did not converge on one arrow' },
      )
      .toBe(true);
    expect((await getConnectors(dana.page)).length).toBe(1);

    // Sam's screen drew the orphaned arrow without falling over either.
    await arrowLine(sam.page, arrow);
    expectNoErrors(people);
  });
});
