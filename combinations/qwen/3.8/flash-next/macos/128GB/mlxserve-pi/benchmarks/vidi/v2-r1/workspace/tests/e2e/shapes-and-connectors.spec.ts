// Shapes, and arrows that follow what they point at, in a real browser (story 10).
//
// The unit suite already holds the arithmetic — which side an arrow leaves, what a size
// means, when a write is refused. What only a browser can answer is the three things a
// person would notice first: whether a drag makes a shape the size it *looked* like at
// another zoom, whether a label re-wraps and stays centred when the shape is resized under
// it, and whether an arrow really follows a shape that somebody else moved. The last needs
// two browsers and the real sync path, because "follows" is a statement about what arrives
// on another screen.
//
// Board units and screen pixels are kept apart on purpose. Where a test speaks of the
// board, the numbers are board units, read from the places board units live (`style.left`,
// which the world layer scales by transform). Where it speaks of the screen, the numbers
// are pixels. A test that compared the two directly would be testing whatever zoom it
// happened to run at.
//
// Spec: spec/stories/010-draw-shapes-and-connect-them-with-arrows-that-foll/design.md
import { expect, test, type Browser } from '@playwright/test';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import type { Camera } from '../../src/client/canvas/camera';
import { setCamera, settle, VIEWPORT } from './helpers/board';
import {
  consoleErrorsOf,
  expectChangeEventually,
  goOffline,
  goOnline,
  openParticipantAt,
  outageNoise,
  printLatencyReport,
  type Participant,
} from './helpers/participants';
import {
  arrow,
  arrowCount,
  arrowEndKey,
  arrowIds,
  click,
  connectorDots,
  distance,
  drag,
  dragHandle,
  drawArrow,
  drawShape,
  dropShape,
  holdAt,
  labelLayout,
  moveTo,
  onScreenWidth,
  pickShapeKind,
  pixelsWide,
  pressConnectorTool,
  pressKey,
  pressShapeTool,
  release,
  selectedShapeIds,
  shape,
  shapeCentre,
  shapeCount,
  shapeLabel,
  sideMid,
  toolIsOn,
  toolSheetIsUp,
  typeLabel,
  waitForArrowIds,
  waitForShapeGone,
  waitForShapeIds,
  type Box,
  type Point,
} from './helpers/shapes';

/**
 * A view that puts a board point in the middle of the screen at a given zoom. Worked out
 * here, once, so that the board points in the tests below stay readable as board points.
 */
const viewAt = (centre: Point, zoom: number): Camera => ({
  x: centre.x - VIEWPORT.width / (2 * zoom),
  y: centre.y - VIEWPORT.height / (2 * zoom),
  zoom,
});

const MIDDLE = { x: 0, y: 0 };

/** A box centred on a board point. */
const boxAround = (centre: Point, width: number, height: number): Box => ({
  x: centre.x - width / 2,
  y: centre.y - height / 2,
  width,
  height,
});

/**
 * Long enough that no shape on this board could hold it on one line, in any font: how many
 * lines it becomes is the machine's business, which is why the assertions below speak in
 * "more lines" and "at least as many", and never in a number of them.
 */
const LONG_LABEL =
  'The quick brown fox jumps over the lazy dog, and then does it again, because a shape ' +
  'with one sentence in it is a shape that has nothing to say.';

test.afterAll(() => {
  printLatencyReport('Shapes and arrows: a change, and when the other person sees it');
});

test.describe('drawing shapes', () => {
  // TC-23: the drag's size is in board units, at three zooms.
  test('TC-23 drags a shape that is the size it looked like, in board units and not pixels', async ({
    browser,
  }) => {
    const dana = await onePerson(browser);

    await setCamera(dana.page, viewAt(MIDDLE, 1));
    const id = await drawShape(dana, { x: 100, y: 100 }, { x: 300, y: 220 });

    // Where the drag went, the size the drag made, in board units — and it is the thing
    // the board now holds chosen, with the drawing tool put away.
    const drawn = await shape(dana, id);
    if (drawn === null) throw new Error('the drag made no shape on the screen');
    expect(drawn.box).toEqual({ x: 100, y: 100, width: 200, height: 120 });
    expect(drawn.kind).toBe('rect');
    expect(drawn.fill).toBe('white');
    expect(drawn.stroke).toBe('dark');
    expect(await selectedShapeIds(dana)).toEqual([id]);
    expect(await toolIsOn(dana, 'select')).toBe(true);
    expect(await toolSheetIsUp(dana, 'shape')).toBe(false);
    // At this zoom the shape's 200 units are 200 pixels, by definition of the zoom.
    expect(await onScreenWidth(dana, id)).toBeCloseTo(await pixelsWide(dana, 200), 1);

    // Out at half zoom that same shape is half as many pixels and the same shape...
    await setCamera(dana.page, viewAt(MIDDLE, 0.5));
    expect(await onScreenWidth(dana, id)).toBeCloseTo(100, 1);
    // ... and a drag that travels 200 pixels there is a shape 400 units wide, which is
    // twice what it looks like and exactly what the hand asked the board for.
    const second = await drawShape(dana, { x: -500, y: -300 }, { x: -100, y: -40 });
    const wider = await shape(dana, second);
    if (wider === null) throw new Error('the drag at half zoom made no shape');
    expect(wider.box).toEqual({ x: -500, y: -300, width: 400, height: 260 });
    expect(await onScreenWidth(dana, second)).toBeCloseTo(200, 1);

    // In at double zoom: the first shape is twice as many pixels and no bigger.
    await setCamera(dana.page, viewAt(MIDDLE, 2));
    expect(await onScreenWidth(dana, id)).toBeCloseTo(400, 1);
    // Shift holds the proportions, anchored where the pointer went down, at a zoom that is
    // not 100%: 240 units each way out of a drag that was 240 by 200 units.
    const square = await drawShape(
      dana,
      { x: -300, y: -90 },
      { x: -60, y: 110 },
      { shift: true },
    );
    const squareBox = await shape(dana, square);
    if (squareBox === null) throw new Error('the drag with Shift made no shape');
    expect(squareBox.box.width).toBeCloseTo(squareBox.box.height, 1);
    expect(squareBox.box.width).toBeCloseTo(240, 1);
    expect(squareBox.box.x).toBeCloseTo(-300, 1);
    expect(squareBox.box.y).toBeCloseTo(-90, 1);

    expect(await shapeCount(dana)).toBe(3);
    expect(await errorsOnlyFromTheNetwork([dana])).toEqual([]);
  });

  // TC-24: a click drops a shape of the default size; its label wraps, and re-wraps.
  test('TC-24 drops a diamond by clicking, and its label wraps and stays centred through a resize', async ({
    browser,
  }) => {
    const dana = await onePerson(browser);

    await setCamera(dana.page, viewAt(MIDDLE, 2));
    await pressShapeTool(dana);
    await pickShapeKind(dana, 'diamond');
    const id = await dropShape(dana, MIDDLE);
    const dropped = await shape(dana, id);
    if (dropped === null) throw new Error('the click made no shape');
    expect(dropped.kind).toBe('diamond');
    // A click is not a drag: the default size, centred on where it was clicked. Twice that
    // in pixels, because this zoom draws a board unit as two of them.
    expect(dropped.box).toEqual(boxAround(MIDDLE, SHAPE_DEFAULT_SIZE_WORLD, SHAPE_DEFAULT_SIZE_WORLD));
    expect(await onScreenWidth(dana, id)).toBeCloseTo(
      await pixelsWide(dana, SHAPE_DEFAULT_SIZE_WORLD),
      1,
    );

    await typeLabel(dana, id, LONG_LABEL);
    expect(await shapeLabel(dana, id)).toBe(LONG_LABEL);

    const before = await labelLayout(dana, id);
    expect(before.lines).toBeGreaterThan(1);
    expect(before.width).toBeLessThanOrEqual(await onScreenWidth(dana, id) + 1);
    // The middle of the words is the middle of the diamond.
    expect(centred(before)).toBe(true);

    // Make the shape narrower *under* the words: 40 board units off the east handle, which
    // is 80 pixels of pointer at this zoom.
    await dragHandle(dana, 'e', -40, 0);
    const resized = await shape(dana, id);
    if (resized === null) throw new Error('the shape left the screen when it was resized');
    expect(resized.box.width).toBeCloseTo(120, 1);
    // A side handle moves one edge: the height is the shape's own and was never asked about.
    expect(resized.box.height).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD, 1);

    const after = await labelLayout(dana, id);
    expect(after.width).toBeLessThanOrEqual(await onScreenWidth(dana, id) + 1);
    // Fewer words fit on a line, so there are at least as many lines as there were.
    expect(after.lines).toBeGreaterThanOrEqual(before.lines);
    // Re-wrapping is not re-positioning: the words stay in the middle of the shape.
    expect(centred(after)).toBe(true);

    // It is still one shape, still saying the same thing, still the only thing there.
    expect(await shapeCount(dana)).toBe(1);
    expect(await shapeLabel(dana, id)).toBe(LONG_LABEL);
    expect(await errorsOnlyFromTheNetwork([dana])).toEqual([]);
  });

  // A drag too small to be a shape makes a shape of the smallest size, not nothing.
  test('a drag smaller than the least size makes the least size', async ({ browser }) => {
    const dana = await onePerson(browser);

    await setCamera(dana.page, viewAt(MIDDLE, 1));
    const id = await drawShape(dana, { x: 100, y: 100 }, { x: 112, y: 106 });

    const drawn = await shape(dana, id);
    if (drawn === null) throw new Error('a small drag made no shape');
    expect(drawn.box.width).toBeGreaterThanOrEqual(SHAPE_MIN_SIZE_WORLD);
    expect(drawn.box.height).toBeGreaterThanOrEqual(SHAPE_MIN_SIZE_WORLD);
    expect(await shapeCount(dana)).toBe(1);
  });
});

test.describe('arrows that follow', () => {
  // TC-25: an arrow follows a shape the other person moved, and changes side.
  test('TC-25 follows a shape the other person dragged past the first one', async ({
    browser,
  }) => {
    const [dana, sam] = await twoPeople(browser);

    await setCamera(dana.page, viewAt(MIDDLE, 1));
    const left = await drawShape(dana, { x: -420, y: -160 }, { x: -220, y: -40 });
    const right = await drawShape(dana, { x: 200, y: -160 }, { x: 400, y: -40 });
    const arrowId = await drawArrow(dana, await shapeCentre(dana, left), await shapeCentre(dana, right));
    if (arrowId === null) throw new Error('a drag between two shapes made no arrow');

    // The other person sees all three before anything is moved.
    await waitForShapeIds(sam, [left, right]);
    await waitForArrowIds(sam, [arrowId]);

    const before = await arrow(sam, arrowId);
    if (before === null) throw new Error('the arrow is not drawn on the other screen');
    // Straight across: the ends are on the two sides that face one another.
    expect(before.from).toEqual(await sideMid(sam, left, 'right'));
    expect(before.to).toEqual(await sideMid(sam, right, 'left'));

    // Sam drags the second shape down and to the left, until it is under the first one.
    const below = { x: -320, y: 200 };
    await drag(sam, await shapeCentre(sam, right), below);

    // On Sam's screen the arrow goes with it without ever being touched. The way from one
    // shape to the other is now mostly downwards, so the ends are the bottom of the upper
    // shape and the top of the lower one: the side switch, on the real sync path.
    const switched = [
      Math.round((await sideMid(sam, left, 'bottom')).x),
      Math.round((await sideMid(sam, left, 'bottom')).y),
      Math.round((await sideMid(sam, right, 'top')).x),
      Math.round((await sideMid(sam, right, 'top')).y),
    ];
    await expectChangeEventually('the arrow follows the shape Sam moved', () =>
      arrowEndKey(sam, arrowId),
      switched,
    );

    // Both ends are still tied: the arrow is drawn between the shapes and not between
    // where the pointer once was.
    const moved = await shape(sam, right);
    if (moved === null) throw new Error('the shape Sam dragged is not on the screen');
    const after = await arrow(sam, arrowId);
    if (after === null) throw new Error('the arrow left the screen');
    expect(after.from).toEqual(await sideMid(sam, left, 'bottom'));
    expect(after.to).toEqual(await sideMid(sam, right, 'top'));

    // Dana moved nothing and is shown the same two points.
    await expectChangeEventually('the same arrow on the other screen', () =>
      arrowEndKey(dana, arrowId),
      switched,
    );
    expect(await arrowIds(sam)).toEqual([arrowId]);
    expect(await arrowIds(dana)).toEqual([arrowId]);
    expect(await errorsOnlyFromTheNetwork([dana, sam])).toEqual([]);
  });

  // TC-26: deleting what an arrow points at leaves the arrow, with its end let go.
  test('TC-26 leaves the arrow where the shape was when the other person deletes it', async ({
    browser,
  }) => {
    const [dana, sam] = await twoPeople(browser);

    await setCamera(dana.page, viewAt(MIDDLE, 1));
    const left = await drawShape(dana, { x: -420, y: -160 }, { x: -220, y: -40 });
    const right = await drawShape(dana, { x: 200, y: -160 }, { x: 400, y: -40 });
    const arrowId = await drawArrow(dana, await shapeCentre(dana, left), await shapeCentre(dana, right));
    if (arrowId === null) throw new Error('a drag between two shapes made no arrow');
    await waitForShapeIds(sam, [left, right]);
    await waitForArrowIds(sam, [arrowId]);

    // The end that is about to be let go is tied to the left side of the second shape.
    const tied = await sideMid(sam, right, 'left');
    const before = await arrow(sam, arrowId);
    if (before === null) throw new Error('the arrow is not drawn on the other screen');
    expect(before.to).toEqual(tied);

    // Sam deletes the shape it points at: chosen, then Delete.
    await click(sam, await shapeCentre(sam, right));
    expect(await selectedShapeIds(sam)).toEqual([right]);
    await pressKey(sam, 'Delete');
    await waitForShapeGone(sam, right);

    // The arrow is not something you lose by deleting what it pointed at. Its end is now a
    // point of its own, and the point it kept is the one it was tied to.
    expect(await shapeCount(sam)).toBe(1);
    expect(await arrowCount(sam)).toBe(1);
    const after = await arrow(sam, arrowId);
    if (after === null) throw new Error('the arrow left the screen when its end was let go');
    expect(after.to).toEqual(tied);
    expect(after.from).toEqual(await sideMid(sam, left, 'right'));

    // And on Dana's screen, which deleted nothing, the same arrow in the same place.
    await expectChangeEventually('the let-go arrow on the other screen', () =>
      arrowEndKey(dana, arrowId),
      [Math.round(after.from.x), Math.round(after.from.y), Math.round(after.to.x), Math.round(after.to.y)],
    );
    expect(await arrowIds(dana)).toEqual([arrowId]);
    expect(await errorsOnlyFromTheNetwork([dana, sam])).toEqual([]);
  });

  // TC-27: the two operations that cannot both win, and the one thing they promise.
  //
  // Which of them the room sees first is not something two browsers can be made to agree
  // about, so this makes the overlap happen the way it really does happen for somebody on
  // a bad connection: Dana works while her network is down, and reconnects afterwards. Her
  // arrow, aimed at a shape that is no longer there, then arrives after the delete did —
  // the arrow's end is attached to an object that is gone, which is the case the drawing
  // has to survive on every screen.
  test('TC-27 survives drawing an arrow onto a shape the other person deletes while you draw it', async ({
    browser,
  }) => {
    const [dana, sam] = await twoPeople(browser, { outageSwitch: true });

    await setCamera(dana.page, viewAt(MIDDLE, 1));
    const left = await drawShape(dana, { x: -420, y: -160 }, { x: -220, y: -40 });
    const right = await drawShape(dana, { x: 200, y: -160 }, { x: 400, y: -40 });
    await waitForShapeIds(sam, [left, right]);

    // Where the second shape's left side is, before anybody deletes it: the point an
    // attached end keeps when the object it was tied to goes.
    const tied = await sideMid(sam, right, 'left');

    // Dana's network goes. Her board stays as it is, including the shape that is about to
    // be deleted on the other screen.
    await goOffline(dana);
    const arrowId = await drawArrow(
      dana,
      await shapeCentre(dana, left),
      await shapeCentre(dana, right),
    );
    if (arrowId === null) throw new Error('a drag between two shapes made no arrow while offline');

    // Sam deletes the shape, and never sees the arrow: it has nowhere to go yet.
    await click(sam, await shapeCentre(sam, right));
    await pressKey(sam, 'Delete');
    await waitForShapeGone(sam, right);

    // Dana comes back. Her arrow arrives after the delete, and stays attached to an object
    // that is not on the board any more.
    await goOnline(dana);
    await waitForArrowIds(sam, [arrowId]);
    await waitForArrowIds(dana, [arrowId]);
    await waitForShapeGone(dana, right);

    // Both screens draw it, as one arrow between two points. The end that lost its object
    // stands where the side of that shape was, because that is the point an attached end
    // keeps; what it may not be is missing, or a dot, or different on the two screens.
    const onSam = await arrow(sam, arrowId);
    const onDana = await arrow(dana, arrowId);
    if (onSam === null || onDana === null) throw new Error('the arrow is not drawn between two points');
    expect(onDana.from).toEqual(await sideMid(sam, left, 'right'));
    expect(onDana.to).toEqual(tied);
    expect(onSam.to).toEqual(tied);
    expect(distance(onDana.from, onDana.to)).toBeGreaterThan(1);
    expect(await arrowCount(sam)).toBe(1);
    expect(await arrowCount(dana)).toBe(1);
    expect(await errorsOnlyFromTheNetwork([dana, sam])).toEqual([]);
  });

  // The Connector tool's own promises, where the pointer is really over the board.
  test('the Connector tool offers the four sides of what the pointer is over, and lights one', async ({
    browser,
  }) => {
    const dana = await onePerson(browser);

    await setCamera(dana.page, viewAt(MIDDLE, 1));
    const left = await drawShape(dana, { x: -420, y: -160 }, { x: -220, y: -40 });
    const right = await drawShape(dana, { x: 200, y: -160 }, { x: 400, y: -40 });

    await pressConnectorTool(dana);
    // Nothing is offered over bare board.
    await moveTo(dana, { x: 0, y: 300 });
    expect((await connectorDots(dana)).sides).toEqual([]);

    // The pointer rests on a shape: its four sides, none of them chosen.
    await moveTo(dana, await shapeCentre(dana, right));
    expect((await connectorDots(dana)).sides).toEqual(['top', 'right', 'bottom', 'left']);
    expect((await connectorDots(dana)).lit).toEqual([]);

    // Drag from the other shape to this one: the side this arrow would take lights up, and
    // it is the side that faces the way the arrow comes from.
    await holdAt(dana, await shapeCentre(dana, left));
    await moveTo(dana, await shapeCentre(dana, right));
    expect((await connectorDots(dana)).lit).toEqual(['left']);
    await release(dana);

    const arrowId = await onlyArrowId(dana);
    const drawn = await arrow(dana, arrowId);
    if (drawn === null) throw new Error('the drag made no arrow');
    expect(drawn.from).toEqual(await sideMid(dana, left, 'right'));
    expect(drawn.to).toEqual(await sideMid(dana, right, 'left'));
    expect((await connectorDots(dana)).sides).toEqual([]);
  });
});

// --- helpers local to this file ----------------------------------------------

/**
 * One person, on a board of their own. `openParticipantAt` with `create` arrives the way a
 * person does, by making a board from home, and brings its console with it.
 */
async function onePerson(browser: Browser): Promise<Participant> {
  return openParticipantAt(browser, '/', 'Dana', { create: true });
}

/** Two people on one board, the first of them the one who made it. */
async function twoPeople(
  browser: Browser,
  options: { outageSwitch?: boolean } = {},
): Promise<[Participant, Participant]> {
  const dana = await openParticipantAt(browser, '/', 'Dana', {
    create: true,
    outageSwitch: options.outageSwitch,
  });
  const sam = await openParticipantAt(browser, await addressOf(dana), 'Sam', {
    outageSwitch: options.outageSwitch,
  });
  return [dana, sam];
}

/** The address of the board this person is on, for somebody else to come to. */
async function addressOf(who: Participant): Promise<string> {
  const path = await who.page.evaluate(() => window.location.pathname);
  if (!path.startsWith('/b/')) throw new Error(`that page is not a board (${path})`);
  return path;
}

/** The console errors that are not the network being down. */
async function errorsOnlyFromTheNetwork(people: Participant[]): Promise<string[]> {
  await settle(people[0]!.page);
  return consoleErrorsOf(people).filter((line) => !outageNoise(line));
}

/** The words are in the middle of the shape they are on. */
const centred = (layout: Awaited<ReturnType<typeof labelLayout>>): boolean =>
  Math.abs(layout.centre.x - layout.shapeCentre.x) < 2 &&
  Math.abs(layout.centre.y - layout.shapeCentre.y) < 2;

/** The one arrow's id, when a test asked for exactly one. */
async function onlyArrowId(who: Participant): Promise<string> {
  const ids = await arrowIds(who);
  if (ids.length !== 1) throw new Error(`expected one arrow, found ${String(ids.length)}`);
  return ids[0] as string;
}
