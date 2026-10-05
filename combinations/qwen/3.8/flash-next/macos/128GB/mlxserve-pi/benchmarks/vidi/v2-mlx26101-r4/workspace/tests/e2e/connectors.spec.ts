/**
 * e2e tests for arrows joined to shapes (story 10, TC-25 to TC-27).
 *
 * All three tests need two browsers open on one board, because what is being claimed is about two
 * people's screens: that an arrow drawn between two shapes is still joined to those shapes when
 * somebody else drags one of them across the board, and is drawn from a different side of a shape that
 * has moved; that an arrow outlives a shape deleted underneath it, its end left at the place that
 * shape's side used to be; and that nothing is lost or broken when one person is holding an arrow's end
 * over a shape that another person deletes while the end is in the air.
 *
 * The harness names its participants in order, so these two are Alex and Sam where the design's
 * examples say Dana and Sam. Everything else is as the design describes it: one board, two pages, each
 * with its own camera — a camera is where a person is looking, not part of the board — both framed on
 * the same piece of board so that the pixel positions in this file mean the same thing on both screens.
 *
 * The thing that makes these tests say something rather than everything: **an arrow that follows a
 * shape is not written when the shape moves.** The stored ends of an arrow name objects, so after a
 * move the assertion is that the arrow's own record is unchanged, byte for byte, while the line drawn
 * on both screens runs to a different side of a shape that is somewhere else. A test that asserted the
 * stored ends had changed would be asserting a bug.
 */
import { expect, test } from '@playwright/test';

import type { ShapeSnap } from '../../src/shared/objects/shape';

import { expectPixels, openBoard, settled, setCamera, worldToScreen } from './helpers/board';
import type { Point } from './helpers/board';
import {
  closeParticipants,
  expectConverged,
  expectEventually,
  logLatencies,
  measurements,
  openParticipants,
  who,
} from './helpers/participants';
import type { Participant } from './helpers/participants';
import {
  PLAIN,
  arrowHeadMiss,
  arrowHeadSide,
  arrowSelected,
  armConnectorTool,
  armShapeTool,
  arrowElement,
  connectorOnPage,
  connectorsOnPage,
  drawArrow,
  drawShape,
  holdArrowEnd,
  pressShape,
  releasePointer,
  selectArrow,
  shapeCentre,
  shapeOnPage,
  shapesOnPage,
  storedEnds,
} from './helpers/shapes';

/**
 * Two shapes, side by side, in board units: 160 by 120 each, two hundred units apart, which is a board
 * the size of a hand and an arrow long enough to be seen pointing somewhere.
 */
const A_BOX = { from: { x: 150, y: 250 }, to: { x: 310, y: 370 } };
const B_BOX = { from: { x: 470, y: 250 }, to: { x: 630, y: 370 } };

/** How far Sam drags the second shape: far enough left to get clean past the first one. */
const PAST_THE_OTHER_ONE = -620;

/**
 * How far the painted head may miss the place it is aimed at, in screen pixels.
 *
 * The head's own geometry is accounted for in the measurement (`arrowHeadMiss` pulls the aim back by
 * half an arrowhead, which is how an arrow is drawn so that its point lands on the aim rather than the
 * middle of the triangle sitting on it), so what is left here is the browser's own rounding of a
 * polygon. Two pixels says nothing about which side was chosen — that is asserted separately, by a
 * measurement that can only answer which side — so this is not slack about the claim, only about ink.
 */
const INK_SLACK = 2;

/** The middle of a rectangle, in board units. */
function middleOf(box: { x: number; y: number; width: number; height: number }): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The middle of one of the boxes this file draws shapes into, in board units. */
function middleOfBox(box: { from: Point; to: Point }): Point {
  return middleOf({ x: box.from.x, y: box.from.y, width: box.to.x - box.from.x, height: box.to.y - box.from.y });
}

/** The middle of the side of a shape that faces a given board point, in board units. */
function facingSide(shape: { x: number; y: number; width: number; height: number }, towards: Point): Point {
  const centre = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  const dx = towards.x - centre.x;
  const dy = towards.y - centre.y;
  // The same proportions the board itself uses: whether a place is "to the side of" a shape or "below"
  // it depends on the shape's own width and height, not on the angle alone.
  return Math.abs(dy) * shape.width > Math.abs(dx) * shape.height
    ? { x: centre.x, y: dy < 0 ? shape.y : shape.y + shape.height }
    : { x: dx < 0 ? shape.x : shape.x + shape.width, y: centre.y };
}

/**
 * The box an arrow drawn between two shapes is drawn in: the span between the two sides the arrow
 * joins, each side being the side of a shape that faces the other shape.
 *
 * This box is stored nowhere. Each end of an arrow names a shape, and which side of that shape the
 * arrow is drawn to is decided from where the two shapes are at the moment the board is looked at; the
 * box is the span between those two sides. That is why an arrow follows a shape across a board without
 * being written, and it is why a test can say what ought to be painted by doing the same arithmetic —
 * including which side of a shape the arrow lands on, which is the thing that changes when a shape is
 * dragged past the other one.
 */
function drawnBetween(first: ShapeSnap, second: ShapeSnap): { x: number; y: number; width: number; height: number } {
  const a = facingSide(first, middleOf(second));
  const b = facingSide(second, middleOf(first));
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** Both pages framed on the same piece of board, so screen pixels mean the same thing on each. */
async function frameBoth(alex: Participant, sam: Participant): Promise<void> {
  await setCamera(alex.page, PLAIN);
  await setCamera(sam.page, PLAIN);
}

/**
 * Two shapes, drawn by Alex with the Shape tool, and agreed on by both pages.
 *
 * Drawn with a gesture rather than written into the document by the test, because an arrow is then
 * drawn between two shapes that a person really put there — and if a shape were only put on the board
 * by a test, the arrow drawn to it would be evidence about the test.
 */
async function twoShapes(alex: Participant, sam: Participant): Promise<{ a: string; b: string }> {
  await armShapeTool(alex.page);
  await drawShape(alex.page, A_BOX.from, A_BOX.to);
  // The Shape tool handed itself back to Select after the first shape, so it has to be picked up again.
  await armShapeTool(alex.page);
  await drawShape(alex.page, B_BOX.from, B_BOX.to);
  await expectEventually('both shapes reach the other person', () => shapesOnPage(sam.page).then((s) => s.length)).toBe(2);
  const shapes = await shapesOnPage(alex.page);
  return { a: shapes[0].id, b: shapes[1].id };
}

/**
 * An arrow from the middle of one shape to the middle of the other, drawn by Alex, and agreed on by
 * both pages. Returns its id.
 *
 * A drag from the middle of a shape to the middle of another is what a person does; which sides of the
 * two shapes the arrow then joins is the board's business, and is what the tests below measure.
 */
async function arrowBetween(alex: Participant, sam: Participant): Promise<string> {
  await armConnectorTool(alex.page);
  await drawArrow(alex.page, middleOfBox(A_BOX), middleOfBox(B_BOX));
  await expectEventually('the arrow reaches the other person', () =>
    connectorsOnPage(sam.page).then((arrows) => arrows.length),
  ).toBe(1);
  return (await connectorsOnPage(alex.page))[0].id;
}

/** Drags a shape a long way sideways, and says when the pointer came up: the moment the board is told. */
async function dragShapeSideways(participant: Participant, id: string, dx: number): Promise<number> {
  const grab = await shapeCentre(participant.page, id);
  await participant.page.mouse.move(grab.x, grab.y);
  await participant.page.mouse.down();
  await participant.page.mouse.move(grab.x + dx / 2, grab.y, { steps: 6 });
  await participant.page.mouse.move(grab.x + dx, grab.y, { steps: 6 });
  // A shape's place is written when the pointer comes up, so that is where the change starts as far as
  // the rest of the board is concerned.
  const since = Date.now();
  await participant.page.mouse.up();
  await settled(participant.page);
  return since;
}

test.describe('arrows that are joined to shapes', () => {
  test.afterAll(() => {
    logLatencies('arrow live-update latency');
  });

  test('TC-25: an arrow stays joined when somebody else drags its shape right across the board, and changes to the other side on both screens', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    try {
      await frameBoth(alex, sam);
      const { a, b } = await twoShapes(alex, sam);
      const id = await arrowBetween(alex, sam);

      // Both ends are joined to the two shapes, on both screens. Joined to the *shapes*: the record
      // holds an object and the place it was last drawn at, and that is all it ever holds.
      for (const participant of [alex, sam]) {
        const ends = await storedEnds(participant.page, id);
        expect(ends.from.kind === 'attached' && ends.from.objectId, `${who(participant)}: the arrow starts at the first shape`).toBe(a);
        expect(ends.to.kind === 'attached' && ends.to.objectId, `${who(participant)}: the arrow ends at the second shape`).toBe(b);
      }

      // The head is drawn at the second shape's left side, because the first shape is to its left.
      expect(await arrowHeadSide(sam.page, id, b)).toBe('left');

      // The arrow as a record, before the move — and the box it is drawn in, which the record does not
      // hold: it is worked out from the two shapes every time the board is looked at.
      const before = await connectorOnPage(alex.page, id);
      const drawnBefore = drawnBetween(await shapeOnPage(alex.page, a), await shapeOnPage(alex.page, b));
      expectPixels(before.x, drawnBefore.x, 'the arrow is drawn between the two sides that face each other');
      expectPixels(before.width, drawnBefore.width, 'spanning them');

      // Sam drags the second shape a long way to the left, until it is clean on the other side of the
      // first one. The arrow is not written by any of this.
      const since = await dragShapeSideways(sam, b, PAST_THE_OTHER_ONE);

      // On Alex's screen the head is drawn at the second shape's *right* side now — the side that faces
      // the first shape from where the second one has got to — and the same on Sam's screen. Waiting on
      // Alex's page is the point: this is the arrow following a shape that moved on another person's
      // board, arriving across the room.
      await expectEventually('the arrow drawn on Alex’s screen reaches the far side of the shape it is joined to', () =>
        arrowHeadSide(alex.page, id, b),
        { since },
      ).toBe('right');
      expect(await arrowHeadSide(sam.page, id, b)).toBe('right');

      // What the arrow stores is what it stored before: the same two shapes at its two ends, the same
      // person's arrow, in the same place in the stack. Moving a shape writes nothing to the arrows joined
      // to it, which is the whole reason an arrow can follow a shape across a board without anybody
      // having to decide where its ends ought to go.
      const after = await connectorOnPage(alex.page, id);
      expect(
        { from: after.from, to: after.to, createdBy: after.createdBy, z: after.z },
        'moving a shape writes nothing to the arrow joined to it',
      ).toEqual({ from: before.from, to: before.to, createdBy: before.createdBy, z: before.z });

      // What is drawn is another matter: it is drawn from the shapes as they are now. The box this arrow
      // is painted in is the span between the two sides that face each other, worked out again every time
      // the board is looked at, and it has come right round to the other side of the shape that moved.
      const drawnAfter = drawnBetween(await shapeOnPage(alex.page, a), await shapeOnPage(alex.page, b));
      expectPixels(after.x, drawnAfter.x, 'the drawn box followed the shape that moved');
      expectPixels(after.width, drawnAfter.width, 'and spans the two shapes from where they now are');

      // And the head is drawn where the shape's side now is, on both screens, to within two pixels of ink.
      for (const participant of [alex, sam]) {
        const second = await shapeOnPage(participant.page, b);
        const first = await shapeOnPage(participant.page, a);
        const miss = await arrowHeadMiss(participant.page, id, facingSide(second, middleOf(first)), middleOf(first));
        expect(miss, `${who(participant)}: the head is drawn on the side that faces the other shape`).toBeLessThanOrEqual(
          INK_SLACK,
        );
      }

      await expectConverged('a board whose arrow followed a shape across it', [alex, sam]);
      expect(measurements().length, 'the delivery was timed, and said out loud what it cost').toBeGreaterThan(0);
      for (const participant of [alex, sam]) {
        expect(participant.errors, `${who(participant)}’s console said nothing bad`).toEqual([]);
      }
    } finally {
      await closeParticipants([alex, sam]);
    }
  });

  test('TC-26: when the shape an arrow points at is deleted, the arrow stays, and its end is left at the side that shape used to have', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    try {
      await frameBoth(alex, sam);
      const { a, b } = await twoShapes(alex, sam);
      const id = await arrowBetween(alex, sam);
      const second = await shapeOnPage(sam.page, b);
      const first = await shapeOnPage(sam.page, a);

      // Where the arrow was drawn onto the second shape: the middle of the side of it that faces the
      // first shape. This is the place the end has to be left at, because it is the place the arrow was
      // measured from the shape by, and it is the only place left that means anything once the shape is
      // gone.
      const whereTheSideWas = facingSide(second, middleOf(first));

      // Sam deletes the second shape.
      const since = Date.now();
      await pressShape(sam.page, b);
      await sam.page.keyboard.press('Backspace');

      // The arrow is still there on Alex's screen, and its far end is no longer joined to anything: it
      // is free, and free at the side the deleted shape used to have. Not at that shape's middle — an
      // arrow that jumped to the middle of a shape that is no longer there would be an arrow pointing at
      // nothing in particular — and not at wherever the pointer happened to be, which was another
      // person's screen.
      await expectEventually('the arrow outlives the shape it was joined to, end and all', () =>
        storedEnds(alex.page, id).then((ends) => ends.to),
        { since },
      ).toEqual({ kind: 'free', x: whereTheSideWas.x, y: whereTheSideWas.y });

      const ends = await storedEnds(alex.page, id);
      expect(ends.to).toEqual({ kind: 'free', x: whereTheSideWas.x, y: whereTheSideWas.y });
      expect(ends.from.kind === 'attached' && ends.from.objectId, 'the end that was never touched is still joined').toBe(a);

      // Both screens draw it, head and all, at that place.
      for (const participant of [alex, sam]) {
        expect(
          await arrowHeadMiss(participant.page, id, whereTheSideWas, middleOf(first)),
          `${who(participant)} draws the remaining arrow pointing at the place the side was`,
        ).toBeLessThanOrEqual(INK_SLACK);
        await expect(arrowElement(participant.page, id)).toBeVisible();
      }

      // One shape left, on both screens; the arrow is not one of the shapes.
      await expect.poll(() => shapesOnPage(alex.page).then((shapes) => shapes.length)).toBe(1);
      await expect.poll(() => shapesOnPage(sam.page).then((shapes) => shapes.length)).toBe(1);

      await expectConverged('a board that lost one of the shapes an arrow was joined between', [alex, sam]);
      for (const participant of [alex, sam]) {
        expect(participant.errors, `${who(participant)}’s console said nothing bad`).toEqual([]);
      }
    } finally {
      await closeParticipants([alex, sam]);
    }
  });

  test('TC-27: an end held over a shape that somebody else deletes comes to rest at the place it was aimed at, with the arrow still drawn', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    try {
      await frameBoth(alex, sam);
      const { a, b } = await twoShapes(alex, sam);
      const id = await arrowBetween(alex, sam);

      // Alex takes the arrow's far end and pulls it onto the second shape, and holds the pointer there.
      // Nothing has been written since the pointer went down: an end is written when it is let go, and
      // this one has not been let go. That is the overlap the design wants — one person's hand in the
      // middle of a gesture, another person's change landing underneath it — forced by a held pointer
      // rather than by a delay, which is the same overlap and a great deal less like a guess.
      await selectArrow(alex.page, id);
      expect(await arrowSelected(alex.page, id), 'an arrow has to be picked up before an end of it can be pulled').toBe(true);
      await holdArrowEnd(alex.page, id, 'to', middleOfBox(B_BOX));

      // While that hand is over the second shape, Sam deletes it — and the deletion arrives on Alex's
      // screen, so Alex is now holding an end over a place where a shape was.
      await pressShape(sam.page, b);
      await sam.page.keyboard.press('Backspace');
      await expect
        .poll(() => shapesOnPage(alex.page).then((shapes) => shapes.some((shape) => shape.id === b)))
        .toBe(false);

      // Alex lets go there.
      await releasePointer(alex.page);

      // There is one arrow, as there was. The end that was never touched is still joined to the shape
      // that is left; the end that was in the air is free, at the place the pointer was let go, which is
      // where the shape used to be. Nothing is joined to a shape that does not exist.
      const ends = await storedEnds(alex.page, id);
      expect(ends.from.kind === 'attached' && ends.from.objectId, 'the untouched end is still joined').toBe(a);
      expect(ends.to.kind, 'the end that was in the air came to rest as a free end').toBe('free');
      if (ends.to.kind === 'free') {
        expectPixels(ends.to.x, middleOfBox(B_BOX).x, 'it came to rest where the pointer was let go, sideways');
        expectPixels(ends.to.y, middleOfBox(B_BOX).y, 'and downwards');
      }

      // Alex's screen draws the arrow, head and all, at that place: the arrow is not left pointing at a
      // shape that is gone, and it is not missing.
      expect(
        await arrowHeadMiss(alex.page, id, middleOfBox(B_BOX), middleOfBox(A_BOX)),
        'the arrow is drawn to the place its end came to rest at',
      ).toBeLessThanOrEqual(INK_SLACK);

      // Sam's screen agrees, end for end: what Alex let go of is what Sam now has.
      await expectConverged('a board whose arrow had an end dropped where a shape had been', [alex, sam]);
      expect(await storedEnds(sam.page, id)).toEqual(ends);

      // Neither page keeps an arrow joined to the shape that went away.
      for (const participant of [alex, sam]) {
        const joined = (await connectorsOnPage(participant.page)).filter(
          (arrow) =>
            (arrow.from.kind === 'attached' && arrow.from.objectId === b) ||
            (arrow.to.kind === 'attached' && arrow.to.objectId === b),
        );
        expect(joined, `${who(participant)} holds no arrow joined to the shape that is gone`).toEqual([]);
      }

      // Neither the shape that vanished from under Alex's pointer nor the arrow left over it put
      // anything in either console.
      for (const participant of [alex, sam]) {
        expect(participant.errors, `${who(participant)}’s console said nothing bad`).toEqual([]);
      }
    } finally {
      await closeParticipants([alex, sam]);
    }
  });

  test('an arrow is drawn between two shapes and nothing else is disturbed: the shapes stay where they were, and the board goes back to Select', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, PLAIN);
    await settled(page);

    await armShapeTool(page);
    await drawShape(page, A_BOX.from, A_BOX.to);
    await armShapeTool(page, 'ellipse');
    await drawShape(page, B_BOX.from, B_BOX.to);
    const shapes = await shapesOnPage(page);
    expect(shapes.map((shape) => shape.kind)).toEqual(['rect', 'ellipse']);

    await armConnectorTool(page);
    await drawArrow(page, middleOfBox(A_BOX), middleOfBox(B_BOX));

    expect(await connectorsOnPage(page).then((arrows) => arrows.length)).toBe(1);
    // Drawing an arrow did not move the shapes it was drawn between.
    for (const [index, box] of [A_BOX, B_BOX].entries()) {
      const shape = (await shapesOnPage(page))[index];
      expectPixels(shape.x, box.from.x, 'the shape stayed where it was drawn, sideways');
      expectPixels(shape.y, box.from.y, 'and downwards');
    }

    // The board is back in Select hands, and the arrow is what is picked up, being the last thing made.
    await expect.poll(() => page.evaluate(() => document.querySelector('[data-active-tool]')?.getAttribute('data-active-tool') ?? null)).toBe('select');
    expect(await arrowSelected(page, (await connectorsOnPage(page))[0].id)).toBe(true);

    // A click on empty board, with nothing armed, chooses nothing and changes nothing: no arrow is
    // made by a stray press, and the one that exists is untouched.
    const before = await connectorOnPage(page, (await connectorsOnPage(page))[0].id);
    const empty = worldToScreen(await settled(page), { x: 150, y: 600 });
    await page.mouse.click(empty.x, empty.y);
    expect(await connectorsOnPage(page).then((arrows) => arrows.length)).toBe(1);
    expect(await connectorOnPage(page, before.id)).toEqual(before);
  });
});
