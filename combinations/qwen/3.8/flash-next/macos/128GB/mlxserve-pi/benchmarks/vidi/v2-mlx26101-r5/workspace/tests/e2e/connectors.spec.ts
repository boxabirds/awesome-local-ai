/**
 * Arrows that follow the things they are attached to.
 *
 * These three tests are the reason the arrow stores what its ends are *attached to* rather than where they
 * are. Each one moves or destroys a shape in one browser and then asks what the arrow is doing in another:
 * a shape that walks away from its neighbour takes the arrow with it, a shape that is deleted leaves the
 * arrow standing where it was, and a shape that is deleted while an arrow is still being pulled towards it
 * is met safely either way the two changes happen to arrive.
 *
 * Each test reads two things and keeps them apart: what the document holds (which shape each end belongs
 * to) and what the page draws (where the line and its point actually are). The first is what makes an arrow
 * an arrow; the second is what a person sees. A test of only the first would pass on an arrow drawn in the
 * wrong place, and a test of only the second would pass on an arrow that was rewritten by hand.
 *
 * Design matrix: TC-25 (follow, both screens), TC-26 (delete the target), TC-27 (delete while drawing).
 */
import { expect, test } from '@playwright/test';

import {
  closeParticipants,
  expectChangeToArrive,
  expectNoConsoleErrors,
  latencyReport,
  latencySamples,
  newBoard,
  openParticipants,
  resetLatencySamples,
  writeLatencyReport,
  type Participant,
} from './helpers/participants';
import { dragObjectAndSettle, objectWorld } from './helpers/board';
import { drawShapeByDrag, enterTool, expectShapeCount, shapeIds } from './helpers/shapes';
import {
  connector,
  connectorEnds,
  connectorIds,
  dottedShape,
  drawnArrow,
  drawConnector,
  expectConnectorCount,
  litDots,
  waitForArrowAtRest,
} from './helpers/connectors';

/**
 * Two shapes a person can draw an arrow between without scrolling, on a 1280 × 800 screen at 100 %, with
 * the world's origin at the middle. The screen points are where the mouse goes; the world numbers are what
 * the board holds afterwards, and every expectation below is written from these.
 *
 *   A: screen (300, 150) → (500, 270) → world x -340, y -250, 200 × 120, centre (-240, -190)
 *   B: screen (700, 150) → (900, 270) → world x   60, y -250, 200 × 120, centre ( 160, -190)
 *
 * Both shapes are clear of the toolbar down the left of the screen and of the zoom controls in the corner:
 * those belong to the board's chrome, and the tools deliberately leave their clicks alone.
 */
const A_FROM = { x: 300, y: 150 };
const A_TO = { x: 500, y: 270 };
const B_FROM = { x: 700, y: 150 };
const B_TO = { x: 900, y: 270 };
const A_CENTRE = { x: 400, y: 210 };
const B_CENTRE = { x: 800, y: 210 };

const A = { x: -340, y: -250, width: 200, height: 120 };
const B = { x: 60, y: -250, width: 200, height: 120 };
/** The middle of the side of each shape that faces the other one, in world units. */
const A_RIGHT = { x: A.x + A.width, y: A.y + A.height / 2 };
const B_LEFT = { x: B.x, y: B.y + B.height / 2 };

/** Draws the two shapes, in Dana's browser, and waits for Sam's screen to hold them too. */
async function twoShapes(dana: Participant, sam: Participant): Promise<{ a: string; b: string }> {
  await enterTool(dana.page, 'shape');
  const a = await drawShapeByDrag(dana.page, A_FROM, A_TO);
  await enterTool(dana.page, 'shape');
  const b = await drawShapeByDrag(dana.page, B_FROM, B_TO);
  await expectShapeCount(dana.page, 2);
  await expectChangeToArrive([sam], 'the two shapes Dana drew', (person) =>
    shapeIds(person.page).then((ids) => ids.length === 2),
  );
  return { a, b };
}

test.describe('arrows that follow', () => {
  // TC-25: an arrow attached at both ends follows a shape moved halfway across the board, in both browsers,
  // and switches from one side of each shape to the other as the shapes pass.
  test('a shape dragged past its neighbour takes the arrow with it, onto the other sides, on both screens', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(240_000);
    resetLatencySamples();
    const boardId = newBoard();
    const [dana, sam] = await openParticipants(browser, ['Dana', 'Sam'], boardId);
    const { a, b } = await twoShapes(dana, sam);

    // An arrow from A to B, pulled from the middle of one to the middle of the other. Which sides it lands
    // on is not asked for and is not guessed: it is what the board works out, and what is checked below.
    await enterTool(dana.page, 'connector');
    let lit: string[] = [];
    let over: string | null = null;
    const arrow = await drawConnector(dana.page, A_CENTRE, B_CENTRE, {
      // Halfway there the pointer is over nothing in particular, so move onto B first — the dot that is lit
      // is the side of B this arrow will be drawn to, which is the one facing A.
      whileDown: async () => {
        await dana.page.mouse.move(B_CENTRE.x, B_CENTRE.y, { steps: 4 });
        lit = await litDots(dana.page);
        over = await dottedShape(dana.page);
      },
    });
    expect(arrow, 'a drag from one shape to another makes an arrow').not.toBeNull();
    expect(over, 'while the pointer is over B, B is the shape wearing the dots').toBe(b);
    expect(lit).toEqual(['left']);

    // The document holds two ends attached to two shapes; the page draws the line between the two sides of
    // those shapes that face each other.
    const ends = await connectorEnds(dana.page, arrow as string);
    expect(ends.from).toBe(a);
    expect(ends.to).toBe(b);
    const before = await drawnArrow(dana.page, arrow as string);
    expect(before.from.x).toBeCloseTo(A_RIGHT.x, 1);
    expect(before.from.y).toBeCloseTo(A_RIGHT.y, 1);
    expect(before.tip.x).toBeCloseTo(B_LEFT.x, 1);
    expect(before.tip.y).toBeCloseTo(B_LEFT.y, 1);
    // The board drew it in the place the shapes put it, and the arrow itself was not moved to get there:
    // its stacking number is the one it was born with, which is the only number of its own it has.
    const z = ends.z;

    // Sam is looking at the same arrow in the same place.
    await expectChangeToArrive([sam], 'the arrow Dana drew', (person) =>
      connectorEnds(person.page, arrow as string)
        .then((seen) => seen.from === a && seen.to === b)
        .catch(() => false),
    );

    // Dana takes B and walks it west, past A. Five hundred screen pixels, which at this zoom is five
    // hundred world units: B ends up with its centre at (-340, -190), west of A's (-240, -190).
    await dragObjectAndSettle(dana.page, b, -500, 0);
    const moved = await objectWorld(dana.page, b);
    expect(moved.x).toBeCloseTo(B.x - 500, 0);

    // On Dana's screen the arrow has gone with it, and has turned round: its point now arrives at the side
    // of B that faces A, and it leaves by the side of A that faces where B has got to. Nobody wrote that
    // down anywhere — the arrow holds two shapes, and the sides are asked again on every read.
    const after = await waitForArrowAtRest(dana.page, arrow as string);
    expect(after.tip.x).toBeCloseTo(B.x - 500 + B.width, 1);
    expect(after.tip.y).toBeCloseTo(A.y + A.height / 2, 1);
    expect(after.from.x).toBeCloseTo(A.x, 1);
    expect(after.from.y).toBeCloseTo(A_RIGHT.y, 1);
    const stillAttached = await connectorEnds(dana.page, arrow as string);
    expect(stillAttached.from).toBe(a);
    expect(stillAttached.to).toBe(b);
    expect(stillAttached.z, 'following a shape is not a change of the arrow itself').toBe(z);

    // And on Sam's screen, in the second the design gives a live change: the same arrow, at the same place,
    // with the same two sides. How long that took goes into the report, and is not asserted — a machine
    // that is busy is not a board that is wrong.
    const waited = await expectChangeToArrive([sam], 'the arrow following the shape it is attached to', (person) =>
      drawnArrow(person.page, arrow as string)
        .then((seen) => Math.abs(seen.tip.x - (B.x - 500 + B.width)) < 0.5 && Math.abs(seen.from.x - A.x) < 0.5)
        .catch(() => false),
    );
    console.info(`${latencyReport(latencySamples())} for an arrow to follow a shape (${waited} ms here)`);

    expectNoConsoleErrors([dana, sam]);
    await writeLatencyReport(testInfo, 'tc-25-arrow-follows');
    await closeParticipants([dana, sam]);
  });

  // TC-26: the shape an arrow points at is deleted. The arrow stays, and its end stays at the place on that
  // shape where it was attached, in both browsers.
  test('a shape somebody deletes leaves the arrow pointing at the place it stood', async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    resetLatencySamples();
    const boardId = newBoard();
    const [dana, sam] = await openParticipants(browser, ['Dana', 'Sam'], boardId);
    const { a } = await twoShapes(dana, sam);

    await enterTool(dana.page, 'connector');
    const arrow = await drawConnector(dana.page, A_CENTRE, B_CENTRE);
    expect(arrow).not.toBeNull();
    await expectChangeToArrive([sam], 'the arrow Dana drew', (person) =>
      connectorIds(person.page).then((ids) => ids.length === 1),
    );
    // Sam deletes B. On Sam's screen it is a click and a key, the ordinary way a shape goes away.
    await sam.page.mouse.click(B_CENTRE.x, B_CENTRE.y);
    await sam.page.keyboard.press('Delete');
    await expectShapeCount(sam.page, 1);

    // On Sam's screen: the shape is gone and the arrow is not, and the end that was on it is fixed at the
    // point it was drawn at — the middle of B's left side, which is where the arrow's point still is.
    const onSam = await connectorEnds(sam.page, arrow as string);
    expect(onSam.from, 'the end on the shape that is still there is still on it').toBe(a);
    expect(onSam.to, 'the end on the shape that is gone belongs to nothing now').toBe('free');
    const samArrow = await drawnArrow(sam.page, arrow as string);
    expect(samArrow.tip.x).toBeCloseTo(B_LEFT.x, 1);
    expect(samArrow.tip.y).toBeCloseTo(B_LEFT.y, 1);
    expect(samArrow.from.x).toBeCloseTo(A_RIGHT.x, 1);

    // And on Dana's screen, which never saw a key pressed: the same. The delete arrives carrying the
    // message that the arrow's end is now a point rather than a shape, so the arrow never has to be drawn
    // at a shape that is not there.
    await expectChangeToArrive([dana], 'the arrow left pointing at nothing but still standing', (person) =>
      connectorEnds(person.page, arrow as string)
        .then((seen) => seen.to === 'free' && seen.from === a)
        .catch(() => false),
    );
    const onDana = await drawnArrow(dana.page, arrow as string);
    expect(onDana.tip.x).toBeCloseTo(B_LEFT.x, 1);
    expect(onDana.tip.y).toBeCloseTo(B_LEFT.y, 1);
    expect(await connector(dana.page, arrow as string).getAttribute('aria-label')).toBe(
      'Arrow from a shape to nothing',
    );
    // One arrow, one shape: the delete took the shape and left the arrow alone.
    await expectConnectorCount(dana.page, 1);
    await expectConnectorCount(sam.page, 1);
    await expectShapeCount(dana.page, 1);

    expectNoConsoleErrors([dana, sam]);
    await writeLatencyReport(testInfo, 'tc-26-delete-target');
    await closeParticipants([dana, sam]);
  });

  // TC-27: the race. An arrow is being pulled towards a shape at the moment that shape is deleted elsewhere.
  // Whichever change this browser sees first, the arrow it is left holding is an arrow it can draw.
  test('an arrow still being drawn when its target is deleted is drawn anyway, at the point it was aimed at', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(240_000);
    resetLatencySamples();
    const boardId = newBoard();
    const [dana, sam] = await openParticipants(browser, ['Dana', 'Sam'], boardId);
    const { a, b } = await twoShapes(dana, sam);

    await enterTool(dana.page, 'connector');
    const arrow = await drawConnector(dana.page, A_CENTRE, B_CENTRE, {
      // The pointer is on its way to B when, in another browser, Sam selects B and deletes it. The button
      // is still down here: this is the two changes crossing, not one after the other.
      whileDown: async () => {
        await sam.page.mouse.click(B_CENTRE.x, B_CENTRE.y);
        await sam.page.keyboard.press('Delete');
        await expectShapeCount(sam.page, 1);
      },
    });

    // Whether this browser has heard about the delete by the time the pointer lets go decides only which of
    // two honest things the end becomes: a point fixed where the pointer was released, or the shape's side
    // that the delete turned into a point. Both are the same arrow, and both are drawable.
    expect(arrow, 'an arrow aimed at a shape that has just gone is still an arrow').not.toBeNull();
    const ends = await connectorEnds(dana.page, arrow as string);
    expect(ends.from).toBe(a);
    expect(['free', b]).toContain(ends.to);

    const drawn = await drawnArrow(dana.page, arrow as string);
    for (const value of [drawn.from.x, drawn.from.y, drawn.tip.x, drawn.tip.y]) {
      expect(Number.isFinite(value), 'an arrow is drawn somewhere, not nowhere').toBe(true);
    }
    // Its point is inside the space B filled — at the release point, or at the side of B the delete left
    // behind. Nothing about it is drawn at a shape that is not there.
    expect(drawn.tip.y).toBeCloseTo(A.y + A.height / 2, 1);
    expect(drawn.tip.x).toBeGreaterThanOrEqual(B.x - 1);
    expect(drawn.tip.x).toBeLessThanOrEqual(B.x + B.width + 1);
    expect(drawn.from.x).toBeCloseTo(A_RIGHT.x, 1);

    // Sam sees the arrow Dana made, and sees it in the same place.
    await expectChangeToArrive([sam], 'the arrow made during the delete', (person) =>
      drawnArrow(person.page, arrow as string)
        .then((seen) => Math.abs(seen.from.x - A_RIGHT.x) < 0.5)
        .catch(() => false),
    );

    // And neither browser had anything to complain about, which for this test is most of the point: the
    // arrow that survives the race must survive it without a board that has fallen over.
    expect(await connector(dana.page, arrow as string).getAttribute('aria-label')).toMatch(
      /^Arrow from a shape to (a shape|nothing)$/,
    );
    expectNoConsoleErrors([dana, sam]);
    await writeLatencyReport(testInfo, 'tc-27-delete-race');
    await closeParticipants([dana, sam]);
  });
});
