/**
 * Story 10 in a real browser: draw shapes, and connect them with arrows that follow
 * when they are moved.
 *
 * The unit suite proves the model and the geometry; the jsdom suite proves the tools and
 * the state machine. What only a browser can prove is here: that a drag of two hundred
 * pixels draws a shape of two hundred pixels; that words longer than their box break into
 * lines and stay in the middle of it; that an arrow between two shapes leaves one of them
 * for the other when the other is moved in another window; and what is left of an arrow
 * when the shape it was being dragged onto is deleted underneath the pointer by the other
 * person, mid-gesture.
 *
 * Three rules hold through this file.
 *
 * Screen pixels and board units are compared through the live camera, never through a
 * number written down here: the camera is what converts between them, and a test that
 * assumes it is a test that can pass while being wrong.
 *
 * Where an arrow *is* is where it is *drawn*, so the ends are read from the drawn line
 * (`connectorScreenEnds`) and not from the stored endpoint: a stored `attached` end that
 * has kept its fallback is not the same point as the side the arrow is joined to now, and
 * the difference between those two is what this story is about.
 *
 * How long a change took to arrive is measured and printed, never asserted. A build
 * either shows the change or it does not; how long it took is a fact about the network
 * this test ran on, and the design's budget belongs in a report, not in a red test.
 */

import { expect, test } from './fixtures.js';
import type { Page } from '@playwright/test';

import {
  cameraState,
  expectNear,
  openBoard,
  setCamera,
  waitForRender,
  zoomLabel,
} from './helpers/board.js';
import {
  clickShape,
  connectorElements,
  connectorScreenEnds,
  docConnectors,
  docShapes,
  drawConnector,
  drawShape,
  enterConnectorTool,
  expectBackToSelect,
  shapeElements,
  shapeFigure,
  shapeLabelEditor,
  shapeLabelOf,
  shapeOf,
  shapePreview,
  shapeScreenBox,
  shapeScreenCentre,
  shapeStrokeButton,
  shapeAt,
  shapeToolButton,
  waitForConnectorCount,
  waitForShapeCount,
  worldOf,
  type ScreenBox,
} from './helpers/shapes.js';
import { dragBy, dragHandle, pressDelete } from './helpers/select.js';
import {
  closeParticipants,
  expectSameBoard,
  measureChange,
  openParticipants,
  person,
  waitForConnected,
  type Participant,
} from './helpers/participants.js';
import {
  CHECKOUT_FLOW_SHAPES,
  FLOW_CONNECTOR_COUNT,
  FLOW_SHAPE_COUNT,
  drawCheckoutFlow,
} from '../fixtures/checkout-flow.js';
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_KIND_NAMES,
  SHAPE_KINDS,
  SHAPE_LABEL_MAX_CHARS,
} from '../../src/shared/config.js';

/**
 * Two shapes far enough apart for an arrow between them to have a length, and an arrow
 * from the left one to the right one, drawn by Dana and arrived everywhere.
 *
 * The boxes are chosen so that everything stays inside the e2e viewport before and after
 * the move TC-25 makes: a shape dragged off the bottom of the window is a shape whose
 * arrow can still be asserted, but not by a person.
 */
async function twoShapesAndAnArrow(
  dana: Participant,
  sam: Participant,
): Promise<{ a: string; b: string; arrow: string }> {
  const a = await drawShape(dana.page, { x: 300, y: 300 }, { x: 500, y: 420 });
  const b = await drawShape(dana.page, { x: 800, y: 300 }, { x: 1000, y: 420 });
  await waitForShapeCount(sam.page, 2);
  const arrow = await drawConnector(
    dana.page,
    await shapeScreenCentre(dana.page, a.id),
    await shapeScreenCentre(dana.page, b.id),
  );
  await waitForConnectorCount(sam.page, 1);
  return { a: a.id, b: b.id, arrow: arrow.id };
}

/**
 * Which side of a drawn box a point is on, in screen pixels - the question an attached
 * end answers, since it sits on one of the four sides of the shape it is joined to and
 * moves to another side when the shape it faces goes elsewhere. A point that is on no
 * edge says so rather than being rounded to the nearest one.
 *
 * The board's world has y growing downwards, the same way the screen does (`camera.ts`),
 * so a side named here is the side a person looking at the window would name.
 */
function sideOf(end: { x: number; y: number }, box: ScreenBox): string {
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1;
  if (near(end.x, box.x)) return 'left';
  if (near(end.x, box.x + box.width)) return 'right';
  if (near(end.y, box.y)) return 'top';
  if (near(end.y, box.y + box.height)) return 'bottom';
  return 'elsewhere';
}

const labelSelector = (id: string): string =>
  `[data-testid="shape-object"][data-object-id="${id}"] [data-testid="shape-label"]`;

/**
 * How many lines the drawn words are broken into, counted as the browser broke them: the
 * client rects of the text itself. A block element has one client rect however many lines
 * its text makes, which is why the words are measured rather than the box that holds them.
 */
function drawnLines(page: Page, selector: string): Promise<number> {
  return page.evaluate((css) => {
    const element = document.querySelector(css);
    const node = element === null ? null : element.firstChild;
    if (element === null || node === null) return 0;
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getClientRects().length;
  }, selector);
}

/**
 * Where the drawn words are, side to side and top to bottom: the middle of the ink, not
 * of the box - because "centred" is a statement about the words.
 *
 * The ink is measured a word at a time. A label is laid out with `white-space: pre-wrap`,
 * which keeps the space a line broke on rather than eating it, and that space reaches
 * past the middle of the box: measure the whole text node and a line that wrapped after
 * "somewhere" is reported as off-centre by the width of a space, which is a fact about
 * spaces and not about the label.
 */
function drawnCentre(page: Page, selector: string): Promise<{ x: number; y: number }> {
  return page.evaluate((css) => {
    const element = document.querySelector(css);
    const node = element === null ? null : element.firstChild;
    if (!(node instanceof Text)) return { x: Number.NaN, y: Number.NaN };
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    const words = /\S+/gu;
    let word: RegExpExecArray | null = words.exec(node.data);
    while (word !== null) {
      const range = document.createRange();
      range.setStart(node, word.index);
      range.setEnd(node, word.index + word[0].length);
      for (const rect of Array.from(range.getClientRects())) {
        left = Math.min(left, rect.left);
        right = Math.max(right, rect.right);
        top = Math.min(top, rect.top);
        bottom = Math.max(bottom, rect.bottom);
      }
      word = words.exec(node.data);
    }
    return { x: (left + right) / 2, y: (top + bottom) / 2 };
  }, selector);
}

/** A shape's own centre, from the box it is drawn in, ready to be dragged by. */
const centre = (box: ScreenBox): { x: number; y: number } => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

test.describe('shape.ui: drawing a shape in a browser', () => {
  test('TC-23 draws a shape by dragging, and the box on the screen is the box in the document', async ({
    page,
  }) => {
    await openBoard(page);

    // The tool is entered with its button rather than its letter: what is under test is
    // what the pointer does once the tool is up, and the letter has its own test.
    await shapeToolButton(page).click();
    await expect(shapeToolButton(page)).toHaveAttribute('aria-pressed', 'true');

    // The PRD's drag: 200 px right and 120 px down from the corner it started at.
    await page.mouse.move(100, 100);
    await page.mouse.down();
    await page.mouse.move(200, 160, { steps: 5 });

    // While the drag is in the air the shape is a preview: something is drawn, and
    // nothing has been written.
    await expect(shapePreview(page)).toBeVisible();
    const preview = await shapePreview(page).boundingBox();
    if (preview === null) throw new Error('the shape being dragged has no box on the screen');
    expectNear(preview.x, 100, 1, 'the preview starts where the pointer went down');
    expectNear(preview.y, 100, 1, 'the preview starts where the pointer went down');
    expectNear(preview.width, 100, 1, 'the preview is as wide as the pointer has travelled');
    expectNear(preview.height, 60, 1, 'the preview is as tall as the pointer has travelled');
    expect(await docShapes(page)).toHaveLength(0);

    await page.mouse.move(300, 220, { steps: 5 });
    await page.mouse.up();

    // A tool that made its thing puts itself away, and the new shape is the selection.
    await expectBackToSelect(page);
    await waitForShapeCount(page, 1);
    const shape = await shapeAt(page, 0);
    await expect(shapeOf(page, shape.id)).toHaveAttribute('data-selected', 'true');

    // The box it was dragged in is the box it is drawn in: 200 x 120 CSS pixels, its
    // corner where the pointer went down.
    const box = await shapeScreenBox(page, shape.id);
    expectNear(box.x, 100, 1, 'the shape is where the drag started');
    expectNear(box.y, 100, 1, 'the shape is where the drag started');
    expectNear(box.width, 200, 1, 'the shape is as wide as the drag');
    expectNear(box.height, 120, 1, 'the shape is as tall as the drag');

    // And the document holds the same box in board units, which at this zoom are the same
    // numbers - the camera is what says so.
    const corner = await worldOf(page, { x: 100, y: 100 });
    const opposite = await worldOf(page, { x: 300, y: 220 });
    // A shape that was dragged carries the box it was dragged into: a shape with no size
    // is a shape that lost its box, which is a different story and a different test.
    if (shape.width === undefined || shape.height === undefined)
      throw new Error(`the drawn shape stored no size: ${JSON.stringify(shape)}`);
    expectNear(shape.x, corner.x, 0.001, 'the stored left edge');
    expectNear(shape.y, corner.y, 0.001, 'the stored top edge');
    expectNear(shape.width, opposite.x - corner.x, 0.001, 'the stored width');
    expectNear(shape.height, opposite.y - corner.y, 0.001, 'the stored height');
    expect(shape.kind).toBe('rect');
  });

  test('TC-23b gives a tired hand a shape rather than a hairline, and keeps Shift square', async ({
    page,
  }) => {
    await openBoard(page);

    // A click, which is a drag of nothing: a shape of the default size, centred on the
    // place it was touched. This is the case of a hand that meant to drag and did not.
    const clicked = await clickShape(page, { x: 900, y: 250 });
    const clickBox = await shapeScreenBox(page, clicked.id);
    expectNear(clickBox.width, SHAPE_DEFAULT_SIZE_WORLD, 1, 'a click makes a shape of the default size');
    expectNear(clickBox.height, SHAPE_DEFAULT_SIZE_WORLD, 1, 'a click makes a shape of the default size');
    expectNear(clickBox.x + clickBox.width / 2, 900, 1, 'and puts it where the board was touched');
    expectNear(clickBox.y + clickBox.height / 2, 250, 1, 'and puts it where the board was touched');

    // A drag of 200 x 120 with the square key held at the moment of letting go: the larger
    // side wins, from the corner the drag started at.
    const square = await drawShape(page, { x: 300, y: 500 }, { x: 500, y: 620 }, { shift: true });
    const squareBox = await shapeScreenBox(page, square.id);
    expectNear(squareBox.width, 200, 1, 'Shift makes the side the larger of the two');
    expectNear(squareBox.height, 200, 1, 'Shift makes the side the larger of the two');
    expectNear(squareBox.x, 300, 1, 'and keeps the corner the drag started from');
    expectNear(squareBox.y, 500, 1, 'and keeps the corner the drag started from');
  });

  test('TC-24 makes a diamond where a click happened at 200%, and its label wraps and stays centred', async ({
    page,
  }) => {
    await openBoard(page);
    const view = await cameraState(page);
    await setCamera(page, { ...view, zoom: 2 });
    await expect(zoomLabel(page)).toHaveText('200%');

    // A diamond, made by a click. The kind comes from the tool's own popup, which stays
    // open while the tool is up: three shapes are one gesture with three answers.
    const at = { x: 700, y: 400 };
    const diamond = await clickShape(page, at, 'diamond');
    expect(diamond.kind).toBe('diamond');

    // The default size is a board size, so at twice the zoom it is twice as many pixels on
    // the screen - and it is still centred on the point that was clicked.
    const box = await shapeScreenBox(page, diamond.id);
    expectNear(box.width, SHAPE_DEFAULT_SIZE_WORLD * 2, 1, 'a board-unit shape at 200% is twice the pixels');
    expectNear(box.height, SHAPE_DEFAULT_SIZE_WORLD * 2, 1, 'a board-unit shape at 200% is twice the pixels');
    expectNear(centre(box).x, at.x, 1, 'a click makes a shape centred on itself');
    expectNear(centre(box).y, at.y, 1, 'a click makes a shape centred on itself');
    // A diamond is drawn as a diamond: four points inside the box it was given, which is
    // the one thing a screenshot of a rectangle would have missed.
    const figure = shapeFigure(page, diamond.id);
    await expect(figure).toHaveCount(1);
    expect(await figure.evaluate((element) => element.tagName.toLowerCase())).toBe('polygon');

    // Words longer than the box can hold on a line.
    const label = 'The shipment is still somewhere off the coast of Rotterdam';
    await page.mouse.dblclick(at.x, at.y);
    await expect(shapeLabelEditor(page)).toBeVisible();
    await page.keyboard.type(label);
    await page.keyboard.press('Escape');
    await expect(shapeLabelOf(page, diamond.id)).toHaveText(label);

    // The words broke into lines, and they are in the middle of the shape - measured from
    // the ink, because "centred" is a statement about the words and not about the box.
    const selector = labelSelector(diamond.id);
    const lines = await drawnLines(page, selector);
    expect(lines, 'words longer than the box are drawn on more than one line').toBeGreaterThan(1);
    const words = await drawnCentre(page, selector);
    expectNear(words.x, centre(box).x, 1, 'the label is centred in the shape');

    // Grow the shape with a side handle: the same words, still centred, with more room and
    // so on no more lines. The label is never written to; the box is what changed.
    await dragHandle(page, 'e', { x: 240, y: 0 });
    const grown = await shapeScreenBox(page, diamond.id);
    expectNear(grown.width, box.width + 240, 1, 'the handle widened the shape');
    expectNear(grown.height, box.height, 1, 'a side handle leaves the height alone');
    await expect(shapeLabelOf(page, diamond.id)).toHaveText(label);
    const wider = await drawnCentre(page, selector);
    expectNear(wider.x, centre(grown).x, 1, 'the label is still centred after the resize');
    // The height did not change, so the words did not move up or down either: the label is
    // centred in both directions, before the handle and after it.
    expectNear(wider.y, words.y, 1, 'a side handle does not move the words up or down');
    expect(await drawnLines(page, selector), 'more room is never fewer lines than there were').toBeLessThanOrEqual(
      lines,
    );
  });

  test('TC-24b keeps the label to the length the design set, and shows what it kept', async ({
    page,
  }) => {
    await openBoard(page);
    const shape = await clickShape(page, { x: 640, y: 300 });

    await page.mouse.dblclick(640, 300);
    await expect(shapeLabelEditor(page)).toBeVisible();
    // The boundary itself: one character more than a label may hold.
    await page.keyboard.type('n'.repeat(SHAPE_LABEL_MAX_CHARS + 1));
    await page.keyboard.press('Escape');
    await waitForRender(page);

    const kept = (await docShapes(page))[0]!.label;
    expect(kept.length).toBe(SHAPE_LABEL_MAX_CHARS);
    // What is shown is what is stored: the characters that did not fit were refused at the
    // door, and no ghost of them is left on the board.
    await expect(shapeLabelOf(page, shape.id)).toHaveText(kept);
    expect((await shapeLabelOf(page, shape.id).textContent())!.length).toBe(SHAPE_LABEL_MAX_CHARS);
  });

  test('TC-24c offers the shape names a person would look for, and draws the one that was picked', async ({
    page,
  }) => {
    await openBoard(page);
    await shapeToolButton(page).click();
    // Every kind has a button with the name of the shape on it, and the shape drawn by
    // default is the plain rectangle.
    for (const kind of SHAPE_KINDS) {
      await expect(page.getByRole('button', { name: SHAPE_KIND_NAMES[kind] })).toBeVisible();
    }
    await page.getByRole('button', { name: SHAPE_KIND_NAMES.ellipse }).click();

    const ellipse = await drawShape(page, { x: 400, y: 200 }, { x: 600, y: 340 });
    expect(ellipse.kind).toBe('ellipse');
    // The kind belongs to the tool, not to the shape, so the next shape is an ellipse too:
    // three shapes of a kind are three drags and not three clicks.
    const another = await drawShape(page, { x: 700, y: 200 }, { x: 860, y: 340 });
    expect(another.kind).toBe('ellipse');
    expect(await shapeFigure(page, another.id).evaluate((element) => element.tagName.toLowerCase())).toBe(
      'ellipse',
    );
  });
});

test.describe('connector.ui: an arrow that follows', () => {
  test('TC-25 follows a shape the other person moved, and switches to the side it now faces', async ({
    browser,
  }) => {
    const people = await openParticipants(browser, ['Dana', 'Sam']);
    const dana = person(people, 'Dana');
    const sam = person(people, 'Sam');
    const { a, b, arrow } = await twoShapesAndAnArrow(dana, sam);

    // The arrow joins two shapes, attached at both ends, and it is the same arrow in both
    // documents: an arrow is board content, and there is one of it.
    for (const participant of [dana, sam]) {
      const here = (await docConnectors(participant.page))[0]!;
      expect(here.id, `${participant.name} has the arrow`).toBe(arrow);
      expect(here.from).toMatchObject({ kind: 'attached', objectId: a });
      expect(here.to).toMatchObject({ kind: 'attached', objectId: b });
    }

    // B is to the right of A, so the arrow leaves A on the right and arrives on B's left -
    // and it is *drawn* that way, which is the only claim about pixels in this test.
    const before = await connectorScreenEnds(dana.page, arrow);
    expect(sideOf(before.from, await shapeScreenBox(dana.page, a))).toBe('right');
    expect(sideOf(before.to, await shapeScreenBox(dana.page, b))).toBe('left');

    // Dana takes B up and to the left, past A. What is measured is how long that takes to
    // reach Sam's screen, arrow and all: printed, never asserted.
    await measureChange(
      'TC-25 moving a shape until the other person draws its arrow at the new side',
      async () => {
        const box = await shapeScreenBox(dana.page, b);
        await dragBy(dana.page, centre(box), { x: -560, y: -260 });
      },
      async () => {
        const ends = await connectorScreenEnds(sam.page, arrow);
        // B has arrived, and each end of the arrow is on the side of its shape that the
        // other shape is on now: A's top, and B's bottom.
        return (
          sideOf(ends.from, await shapeScreenBox(sam.page, a)) === 'top' &&
          sideOf(ends.to, await shapeScreenBox(sam.page, b)) === 'bottom'
        );
      },
    );

    // The two ends switched sides, and nobody wrote a position for the arrow to make it
    // happen: an arrow stores two objects and their sides are recomputed from where those
    // objects are.
    const samEnds = await connectorScreenEnds(sam.page, arrow);
    expect(sideOf(samEnds.from, await shapeScreenBox(sam.page, a))).toBe('top');
    expect(sideOf(samEnds.to, await shapeScreenBox(sam.page, b))).toBe('bottom');
    // The stored arrow did not change at all, except for who moved it: the same two ends.
    expect((await docConnectors(sam.page))[0]).toEqual(await docConnectors(dana.page).then((list) => list[0]));

    // And it is drawn in the same place on both screens, to the pixel: one object, two
    // people looking at it.
    const danaEnds = await connectorScreenEnds(dana.page, arrow);
    expectNear(samEnds.from.x, danaEnds.from.x, 1, 'the tail is in the same place on both screens');
    expectNear(samEnds.from.y, danaEnds.from.y, 1, 'the tail is in the same place on both screens');
    expectNear(samEnds.to.x, danaEnds.to.x, 1, 'the head is in the same place on both screens');
    expectNear(samEnds.to.y, danaEnds.to.y, 1, 'the head is in the same place on both screens');

    await expectSameBoard(people);
    await closeParticipants(people);
  });

  test('TC-26 leaves the arrow behind when the other person deletes what it pointed at, on both screens', async ({
    browser,
  }) => {
    const people = await openParticipants(browser, ['Dana', 'Sam']);
    const dana = person(people, 'Dana');
    const sam = person(people, 'Sam');
    const { a, b, arrow } = await twoShapesAndAnArrow(dana, sam);

    // Where the head is, and which side of B it is on. That position is the only one the
    // arrow ever had, so it is the position the arrow has to keep.
    const head = await connectorScreenEnds(dana.page, arrow);
    const boxOfB = await shapeScreenBox(dana.page, b);
    const side = sideOf(head.to, boxOfB);
    expect(side).not.toBe('elsewhere');
    const headInBoard = await worldOf(dana.page, head.to);

    // Sam deletes B: he selects it and presses Delete, the way a person does.
    await sam.page.mouse.click(centre(boxOfB).x, centre(boxOfB).y);
    await expect(shapeOf(sam.page, b)).toHaveAttribute('data-selected', 'true');
    await measureChange(
      'TC-26 a delete until the arrow is detached on the other screen',
      () => pressDelete(sam.page),
      async () => (await docConnectors(dana.page))[0]!.to.kind === 'free',
    );

    // B is gone from both boards and the arrow is still there - on both of them.
    for (const participant of [sam, dana]) {
      await waitForShapeCount(participant.page, 1);
      await waitForConnectorCount(participant.page, 1);
    }

    for (const participant of [sam, dana]) {
      const left = (await docConnectors(participant.page))[0]!;
      expect(left.id, `${participant.name} still has the arrow`).toBe(arrow);
      // The end that was joined to B is a point of board now, fixed where B's side was.
      expect(left.to.kind, `${participant.name}: the end that lost its shape is free`).toBe('free');
      if (left.to.kind === 'free') {
        expectNear(left.to.x, headInBoard.x, 0.001, `${participant.name}: the free end stayed where it was`);
        expectNear(left.to.y, headInBoard.y, 0.001, `${participant.name}: the free end stayed where it was`);
      }
      // The other end never stopped being joined to A.
      expect(left.from).toMatchObject({ kind: 'attached', objectId: a });
      // And it is drawn there: the head lands on the edge of the space B used to fill,
      // which is where a person last saw it.
      const drawn = await connectorScreenEnds(participant.page, arrow);
      expectNear(drawn.to.x, head.to.x, 1, `${participant.name} draws the head where it was`);
      expectNear(drawn.to.y, head.to.y, 1, `${participant.name} draws the head where it was`);
      expect(sideOf(drawn.to, boxOfB), `${participant.name} draws the head on B's side`).toBe(side);
      // The tail still leaves A, which is the end nobody touched.
      expect(sideOf(drawn.from, await shapeScreenBox(participant.page, a))).toBe('right');
    }

    // A shape that is gone is gone on both screens, and the arrow did not take the rest of
    // the board with it.
    await expect(shapeElements(dana.page)).toHaveCount(1);
    await expect(connectorElements(dana.page)).toHaveCount(1);
    for (const participant of people) {
      expect(participant.consoleErrors, `${participant.name} console errors`).toEqual([]);
      expect(participant.dialogs, `${participant.name} dialogs`).toEqual([]);
    }
    await expectSameBoard(people);
    await closeParticipants(people);
  });

  test('TC-25b lets go of an end over nothing, and it stays exactly where it was let go', async ({
    page,
  }) => {
    await openBoard(page);
    const shape = await clickShape(page, { x: 400, y: 250 });

    // An arrow from a shape out into empty board: one end belongs to a shape, the other end
    // is a place.
    const arrow = await drawConnector(page, await shapeScreenCentre(page, shape.id), { x: 900, y: 600 });
    expect(arrow.from).toMatchObject({ kind: 'attached', objectId: shape.id });
    expect(arrow.to.kind).toBe('free');

    const before = await connectorScreenEnds(page, arrow.id);
    const box = await shapeScreenBox(page, shape.id);
    // A move that leaves the shape on the same side of the free end it started on, so this
    // test says one thing: the joined end came along, the fixed end did not. (Which side a
    // joined end is on when the shape goes round the other way is TC-25's subject.)
    const delta = { x: 100, y: -20 };
    await dragBy(page, centre(box), delta);
    const moved = await connectorScreenEnds(page, arrow.id);
    expectNear(moved.from.x, before.from.x + delta.x, 1, 'the end joined to a shape moves with it');
    expectNear(moved.from.y, before.from.y + delta.y, 1, 'the end joined to a shape moves with it');
    expectNear(moved.to.x, before.to.x, 1, 'the end fixed to board stays where it was fixed');
    expectNear(moved.to.y, before.to.y, 1, 'the end fixed to board stays where it was fixed');
    // The joined end is still on the shape it belongs to, and the free end is still a point
    // of the board rather than glued to the shape that moved.
    expect(sideOf(moved.from, await shapeScreenBox(page, shape.id))).not.toBe('elsewhere');
    expect(sideOf(moved.to, await shapeScreenBox(page, shape.id))).toBe('elsewhere');
  });

  test('TC-27 keeps the arrow that was being drawn when its shape was deleted under the pointer', async ({
    browser,
  }) => {
    const people = await openParticipants(browser, ['Dana', 'Sam']);
    const dana = person(people, 'Dana');
    const sam = person(people, 'Sam');

    // Two shapes and no arrow yet: the arrow is the thing being drawn when the trouble
    // starts.
    const a = await drawShape(dana.page, { x: 200, y: 300 }, { x: 400, y: 420 });
    const b = await drawShape(dana.page, { x: 700, y: 300 }, { x: 900, y: 420 });
    await waitForShapeCount(sam.page, 2);
    const boxOfB = await shapeScreenBox(dana.page, b.id);

    // Sam's socket is put behind a wall of the test's own making, so the room cannot
    // deliver his delete while Dana's pointer is still down. A Playwright route is the only
    // lever that reaches a WebSocket; a route only takes connections opened after it; and
    // the board opens its one socket when the page loads - so the route is laid down now,
    // and Sam's page is reloaded through it. Nothing about his connection is fake: what he
    // sends is held back for a moment, which is precisely what a slow network does.
    let holding = false;
    let release = (): void => {
      throw new Error("Sam's socket never went through the route this test laid down for it");
    };
    await sam.context.routeWebSocket(/\/api\/rooms\//u, (socket) => {
      // 1.63's route: `connectToServer` opens the real upstream, and once a message
      // handler is installed the page's own messages stop being forwarded - which is the
      // whole mechanism this test needs. Messages the room sends are left to flow
      // straight through, because what is being delayed is what Sam sends, not what he
      // is told.
      const upstream = socket.connectToServer();
      const waiting: (string | Buffer)[] = [];
      socket.onMessage((message) => {
        if (holding) waiting.push(message);
        else upstream.send(message);
      });
      release = () => {
        for (const message of waiting.splice(0)) upstream.send(message);
      };
    });
    await sam.page.reload();
    await waitForConnected(sam);
    await waitForShapeCount(sam.page, 2);

    // Dana begins an arrow from A to B: down on A, over B, and the button is still held.
    await enterConnectorTool(dana.page);
    const centreA = await shapeScreenCentre(dana.page, a.id);
    const centreB = await shapeScreenCentre(dana.page, b.id);
    await dana.page.mouse.move(centreA.x, centreA.y);
    await dana.page.mouse.down();
    await dana.page.mouse.move(centreB.x, centreB.y, { steps: 8 });

    // While her pointer is on B, Sam deletes B. His board forgets it at once; hers has not
    // been told, because the message that would tell her is in the test's pocket.
    holding = true;
    await sam.page.mouse.click(centreB.x, centreB.y);
    await expect(shapeOf(sam.page, b.id)).toHaveAttribute('data-selected', 'true');
    await pressDelete(sam.page);
    await expect(shapeElements(sam.page)).toHaveCount(1);
    // The overlap is established rather than assumed: at this moment B is gone for Sam and
    // still there for Dana, and her pointer is on it.
    await expect(shapeElements(dana.page)).toHaveCount(2);

    // She lets go, on the body of a shape that is already gone from the board he is looking
    // at. Her tool made its thing and puts itself away, as it always does.
    await dana.page.mouse.up();
    await expectBackToSelect(dana.page);
    await waitForConnectorCount(dana.page, 1);
    const drawn = await docConnectors(dana.page).then((list) => list[0]!);

    // Her arrow exists, is drawn, and its head is where she aimed it: on B's outline, which
    // is where an attached end is drawn. It is joined to a shape that no longer exists on
    // his board, which is the case an attached end keeps a position for.
    const ends = await connectorScreenEnds(dana.page, drawn.id);
    await expect(connectorElements(dana.page).first()).toBeVisible();
    expect(sideOf(ends.to, boxOfB), 'the head of the arrow is on the shape it was drawn to').not.toBe('elsewhere');

    // Now let Sam's delete through, and the two boards are one board again.
    release();
    holding = false;
    await waitForShapeCount(dana.page, 1);
    await waitForConnectorCount(sam.page, 1);

    const settled = await docConnectors(dana.page).then((list) => list[0]!);
    expect(settled.id).toBe(drawn.id);
    expect(settled.from).toMatchObject({ kind: 'attached', objectId: a.id });
    // The head is still drawn where it was aimed, whichever way the two writes arrived: a
    // join to a shape that has gone, drawn from the position it kept for exactly this, or a
    // point of board left where it was put. What is not allowed is an arrow that vanished,
    // or one that jumped somewhere else.
    const after = await connectorScreenEnds(dana.page, drawn.id);
    expect(sideOf(after.to, boxOfB), 'the arrow is still drawn where it was aimed').not.toBe('elsewhere');
    expectNear(after.to.x, ends.to.x, 1, 'the head did not move when the delete arrived');
    expectNear(after.to.y, ends.to.y, 1, 'the head did not move when the delete arrived');

    // Both people are looking at one arrow, in one place.
    for (const participant of people) {
      const here = (await docConnectors(participant.page))[0]!;
      expect(here.id, `${participant.name} has the arrow`).toBe(drawn.id);
      expect(here.from).toMatchObject({ kind: 'attached', objectId: a.id });
      const drawnHere = await connectorScreenEnds(participant.page, drawn.id);
      expectNear(drawnHere.to.x, after.to.x, 1, `${participant.name} draws the head in the same place`);
      expectNear(drawnHere.to.y, after.to.y, 1, `${participant.name} draws the head in the same place`);
    }

    // Nobody was shouted at, and nobody lost anything else.
    for (const participant of people) {
      expect(participant.consoleErrors, `${participant.name} console errors`).toEqual([]);
      expect(participant.dialogs, `${participant.name} dialogs`).toEqual([]);
    }
    await expectSameBoard(people);
    await closeParticipants(people);
  });
});

test.describe('a flow, drawn once and read back', () => {
  test('the golden path: four shapes, four arrows, and the arrows that come when a shape moves', async ({
    page,
  }) => {
    await openBoard(page);
    const flow = await drawCheckoutFlow(page);
    expect(flow.shapes).toHaveLength(FLOW_SHAPE_COUNT);
    expect(flow.connectors).toHaveLength(FLOW_CONNECTOR_COUNT);

    // The four shapes are the four the fixture describes: kinds, words and colours.
    const shapes = await docShapes(page);
    expect(shapes.map((shape) => shape.kind)).toEqual(CHECKOUT_FLOW_SHAPES.map((shape) => shape.kind));
    expect(shapes.map((shape) => shape.label)).toEqual(CHECKOUT_FLOW_SHAPES.map((shape) => shape.label));
    for (const shape of CHECKOUT_FLOW_SHAPES) {
      const drawn = shapes.find((candidate) => candidate.label === shape.label)!;
      await expect(shapeOf(page, drawn.id)).toHaveAttribute('data-kind', shape.kind);
      // A colour the fixture names is the colour it is drawn with; the ones it leaves out
      // are the defaults, which is a fact about the fixture worth saying out loud.
      await expect(shapeOf(page, drawn.id)).toHaveAttribute('data-fill', shape.fill ?? DEFAULT_SHAPE_FILL);
      await expect(shapeOf(page, drawn.id)).toHaveAttribute('data-stroke', shape.stroke ?? DEFAULT_SHAPE_STROKE);
    }

    // Three arrows joined at both ends and one joined at one, which is every case an
    // arrow has.
    const connectors = await docConnectors(page);
    expect(
      connectors.filter((one) => one.from.kind === 'attached' && one.to.kind === 'attached').length,
    ).toBe(3);
    const freeEnded = connectors.find((one) => one.from.kind === 'free');
    expect(freeEnded, 'one arrow has an end that follows nothing').toBeDefined();

    // Move the shape one arrow ends at: the joined end comes with it and the free end is
    // the same point of board it always was. The move is small enough to leave the joined
    // end on the same side, so the claim is about following and not about switching.
    const first = flow.shapes[0]!;
    const arrow = connectors.find((one) => one.to.kind === 'attached' && one.to.objectId === first)!;
    const box = await shapeScreenBox(page, first);
    const ends = await connectorScreenEnds(page, arrow.id);
    const delta = { x: 100, y: -20 };
    await dragBy(page, centre(box), delta);
    const after = await connectorScreenEnds(page, arrow.id);
    expectNear(after.to.x, ends.to.x + delta.x, 1, 'the end joined to the shape went with it');
    expectNear(after.to.y, ends.to.y + delta.y, 1, 'the end joined to the shape went with it');
    expectNear(after.from.x, ends.from.x, 1, 'the end fixed to board stayed');
    expectNear(after.from.y, ends.from.y, 1, 'the end fixed to board stayed');

    // And a colour, clicked on the toolbar of a selected shape, is in the document and in
    // the pixels: the shape toolbar is the shape's own, not a global setting.
    const diamond = flow.shapes[1]!;
    const at = centre(await shapeScreenBox(page, diamond));
    await page.mouse.click(at.x, at.y);
    await expect(shapeOf(page, diamond)).toHaveAttribute('data-selected', 'true');
    await shapeStrokeButton(page, 'red').click();
    await waitForRender(page);
    expect((await docShapes(page)).find((shape) => shape.id === diamond)!.stroke).toBe('red');
    await expect(shapeOf(page, diamond)).toHaveAttribute('data-stroke', 'red');
    // The other shapes keep the colours they had.
    expect((await docShapes(page)).find((shape) => shape.id === flow.shapes[2])!.stroke).toBe(
      CHECKOUT_FLOW_SHAPES[2]!.stroke ?? DEFAULT_SHAPE_STROKE,
    );
  });
});
