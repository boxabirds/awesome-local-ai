// Story 10, e2e: shapes drawn by hand, and arrows that follow the shapes they are
// attached to, in real browsers on a real room.
//
// What only a browser can show: that a shape is made by a drag rather than by a
// dialog; that an arrow drawn between two shapes stays attached when either shape
// is dragged — including when one is dragged *past* the other, which turns the
// arrow round to the far side with nobody touching it; that a shape deleted by one
// person leaves the other person's arrow on the screen, ending where that shape's
// side was; and that an arrow which was being drawn at the moment its shape was
// deleted still ends up in that same place.
//
// Where a number is compared, it is compared against what the page drew: a shape's
// box is its bounding box put back through the camera, and an arrow's two ends are
// the board points the arrow itself reports (`data-from-x` and friends). Nothing
// asserts wall-clock time: a change is waited for and how long it took is printed
// against the latency budget, as in stories 3 and 8.
import { expect, test, type Page } from '@playwright/test';
import {
  expectBoardAgreedAgain,
  expectEventually,
  expectNoProblems,
  expectSameBoard,
  badgeOf,
  joinBoard,
  leaveAll,
  loseTheBoard,
  newBoard,
  reportLatency,
  type Person,
} from './helpers/participants';
import {
  arrowIds,
  arrowLocator,
  arrowMidpoint,
  arrowState,
  cameraOf,
  clickArrow,
  connectorButton,
  drawArrow,
  drawShape,
  expectArrowEndAt,
  labelShape,
  selectButton,
  shapeButton,
  shapeCentre,
  shapeIds,
  shapeKind,
  shapeLabelText,
  shapeLocator,
  shapeWorldBox,
  waitForArrowCount,
  waitForShapeCount,
  type ScreenPoint,
} from './helpers/shapes';
import { gotoBoard, settle } from './helpers/board';
import { CATCH_UP_TEST_OUTAGE_MS } from '../../src/shared/config';
import { nearestSide, rectCenter, sideAnchor } from '../../src/shared/geometry/connector-geometry';
import type { ConnectorSide } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

const SCREEN = { width: 1280, height: 800 };
const CENTRE = { x: SCREEN.width / 2, y: SCREEN.height / 2 };

/** Somewhere on the open board, clear of the toolbar and of every shape in these tests. */
const EMPTY = { x: 1080, y: 720 };

test.afterEach(() => {
  reportLatency('story 10 changes measured in this test');
});

/** The side an end is drawn at: the side of its own shape that faces the other one. */
function sideFacing(shape: Rect, other: Rect): ConnectorSide {
  return nearestSide(shape, rectCenter(other));
}

/**
 * Which sides the arrow's two ends are drawn at, named — `'right|left'` and so on,
 * or `'attached|free'` when one end is a point in the air.
 *
 * This string is the functional outcome the story is named for: an arrow that
 * follows its shapes has to change it when a shape is dragged behind its neighbour.
 * So it is worth a string: `expectEventually` can be asked for it, and the wait
 * whose latency gets printed against the budget is the wait for exactly that.
 */
async function arrowSides(page: Page, arrow: string, fromShape: string, toShape: string): Promise<string> {
  const state = await arrowState(page, arrow);
  if (state.from.kind !== 'attached' || state.to.kind !== 'attached') {
    return `${state.from.kind}|${state.to.kind}`;
  }
  const a = await shapeWorldBox(page, fromShape);
  const b = await shapeWorldBox(page, toShape);
  return `${sideFacing(a, b)}|${sideFacing(b, a)}`;
}

/**
 * An end belongs on the middle of the side it is said to be at, to the pixel: the
 * point the arrow must be drawn to if "it follows the shape" is true.
 */
async function expectEndOnSideOf(page: Page, arrow: string, end: 'from' | 'to', shape: string, other: string): Promise<void> {
  const box = await shapeWorldBox(page, shape);
  const aim = await shapeWorldBox(page, other);
  await expectArrowEndAt(page, arrow, end, sideAnchor(box, sideFacing(box, aim)));
}

/** Look at the board at `zoom`, with the board point `world` in the middle of the window. */
async function zoomAround(page: Page, world: ScreenPoint, zoom: number): Promise<void> {
  await page.evaluate(
    (args: { world: ScreenPoint; zoom: number; centre: ScreenPoint }) => {
      const hook = window.__vidi6;
      if (hook === undefined) throw new Error('test hook missing: e2e builds with --mode test');
      hook.setCamera({
        x: args.world.x - args.centre.x / args.zoom,
        y: args.world.y - args.centre.y / args.zoom,
        zoom: args.zoom,
      });
    },
    { world, zoom, centre: CENTRE },
  );
  await settle(page);
}

/** The camera the board was opened with, put back. */
async function restCamera(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__vidi6!.setCamera({ x: -window.innerWidth / 2, y: -window.innerHeight / 2, zoom: 1 });
  });
  await settle(page);
}

test.describe('drawing a flow, and having it stay drawn', () => {
  test('TC-23: four shapes drawn by hand, labelled, joined by arrows, and the flow follows a shape', async ({
    page,
  }) => {
    await gotoBoard(page);

    // Four shapes, each one made by a single drag of the mouse: a rectangle, an
    // ellipse, a diamond and a second ellipse. The kind comes from the Shape tool's
    // own menu, which is also the thing that takes up the tool.
    const start = await drawShape(page, { x: 110, y: 180 }, { x: 290, y: 300 }, 'rect');
    const stock = await drawShape(page, { x: 430, y: 150 }, { x: 610, y: 270 }, 'ellipse');
    const ship = await drawShape(page, { x: 750, y: 150 }, { x: 930, y: 270 }, 'diamond');
    const waitlist = await drawShape(page, { x: 430, y: 470 }, { x: 610, y: 590 }, 'ellipse');
    await waitForShapeCount(page, 4);
    expect(await shapeKind(page, start)).toBe('rect');
    expect(await shapeKind(page, stock)).toBe('ellipse');
    expect(await shapeKind(page, ship)).toBe('diamond');
    expect(await shapeKind(page, waitlist)).toBe('ellipse');

    // A shape is the size it was dragged, not a standard size handed back.
    const startBox = await shapeWorldBox(page, start);
    expect(Math.round(startBox.width)).toBe(180);
    expect(Math.round(startBox.height)).toBe(120);

    // Words in all four, typed into the shape itself.
    await labelShape(page, start, 'Customer checks out');
    await labelShape(page, stock, 'In stock?');
    await labelShape(page, ship, 'Ship it today');
    await labelShape(page, waitlist, 'Join the waitlist');
    expect(await shapeLabelText(page, start)).toBe('Customer checks out');
    expect(await shapeLabelText(page, stock)).toBe('In stock?');
    expect(await shapeLabelText(page, ship)).toBe('Ship it today');
    expect(await shapeLabelText(page, waitlist)).toBe('Join the waitlist');

    // Three arrows, drawn from the edge of one shape to the edge of the next.
    const first = await drawArrow(page, { x: 284, y: 240 }, { x: 436, y: 210 });
    const second = await drawArrow(page, { x: 604, y: 210 }, { x: 756, y: 210 });
    const third = await drawArrow(page, { x: 520, y: 264 }, { x: 520, y: 476 });
    await waitForArrowCount(page, 3);
    for (const arrow of [first, second, third]) {
      const state = await arrowState(page, arrow);
      expect(state.from.kind).toBe('attached');
      expect(state.to.kind).toBe('attached');
      expect(state.detached).toBe(false);
    }

    // The board took itself back to Select after each arrow, holding the last one.
    await expect(connectorButton(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(selectButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(arrowLocator(page, third)).toHaveAttribute('data-selected', 'true');

    // Where everything is before the one shape is dragged away.
    const before = {
      first: await arrowState(page, first),
      second: await arrowState(page, second),
      third: await arrowState(page, third),
    };
    const stockWas = await shapeCentre(page, stock);
    await page.mouse.move(stockWas.x, stockWas.y);
    await page.mouse.down();
    await page.mouse.move(stockWas.x + 60, stockWas.y + 180, { steps: 10 });
    await page.mouse.up();
    await settle(page);

    // The shape moved by exactly the drag that moved it.
    const now = await shapeCentre(page, stock);
    expect(Math.abs(now.x - (stockWas.x + 60))).toBeLessThanOrEqual(1);
    expect(Math.abs(now.y - (stockWas.y + 180))).toBeLessThanOrEqual(1);

    // All three arrows are still there, still attached at both ends, and every end
    // sits on the middle of the side of its shape that faces the other one — which
    // is what "the arrow followed" means, stated as a point.
    expect(await arrowIds(page)).toHaveLength(3);
    await expectEndOnSideOf(page, first, 'from', start, stock);
    await expectEndOnSideOf(page, first, 'to', stock, start);
    await expectEndOnSideOf(page, second, 'from', stock, ship);
    await expectEndOnSideOf(page, second, 'to', ship, stock);
    await expectEndOnSideOf(page, third, 'from', stock, waitlist);
    await expectEndOnSideOf(page, third, 'to', waitlist, stock);

    // Every end attached to the shape that moved moved with it; nobody touched an
    // arrow, and no arrow was left pointing at the place its shape had been.
    const after = {
      first: await arrowState(page, first),
      second: await arrowState(page, second),
      third: await arrowState(page, third),
    };
    for (const [key, end] of [
      ['first', 'to'],
      ['second', 'from'],
      ['third', 'from'],
    ] as const) {
      const moved = Math.abs(after[key][end].x - before[key][end].x) + Math.abs(after[key][end].y - before[key][end].y);
      expect(moved, `${key}.${end} did not go with the shape it is attached to`).toBeGreaterThan(1);
    }

    // The shapes nobody moved are where they were and still say what they said, and
    // the whole flow is on the screen, drawn.
    expect(await shapeLabelText(page, start)).toBe('Customer checks out');
    expect(await shapeLabelText(page, waitlist)).toBe('Join the waitlist');
    await expect(shapeLocator(page, start)).toBeVisible();
    await expect(arrowLocator(page, first)).toBeVisible();
    await expect(arrowLocator(page, second)).toBeVisible();
    await expect(arrowLocator(page, third)).toBeVisible();
  });

  test('TC-24: my undo takes back my own shape and leaves my colleague’s alone', async ({
    browser,
    request,
  }) => {
    const boardId = await newBoard(request);
    const mia = await joinBoard(browser, 'Mia', boardId);
    const raj = await joinBoard(browser, 'Raj', boardId);

    // Two shapes on one board, made by two people: Raj's first, so that the order
    // they were made in is not the order the undos are asked for.
    const theirs = await drawShape(raj.page, { x: 640, y: 380 }, { x: 860, y: 540 }, 'ellipse');
    await waitForShapeCount(mia.page, 1);
    const mine = await drawShape(mia.page, { x: 200, y: 200 }, { x: 400, y: 340 }, 'rect');
    await waitForShapeCount(raj.page, 2);
    expect(await shapeKind(mia.page, theirs)).toBe('ellipse');

    // And an arrow of mine between them, so that there is an arrow for Undo to deal
    // with as well: undoing it must not so much as rewrite its ends.
    const arrow = await drawArrow(mia.page, { x: 394, y: 270 }, { x: 646, y: 460 });
    await waitForArrowCount(raj.page, 1);
    const sorted = (page: Page) => async () => (await shapeIds(page)).slice().sort();

    // Mia undoes her own last step, the arrow. Raj sees it go, because undo is a
    // change to the shared board like any other.
    await mia.page.keyboard.press('Control+z');
    await expectEventually('the arrow is gone from Mia’s screen', () => arrowIds(mia.page), []);
    await expectEventually('and from Raj’s screen too', () => arrowIds(raj.page), []);

    // Undo again takes Mia's shape, and only Mia's.
    await mia.page.keyboard.press('Control+z');
    await expectEventually('Mia’s shape is gone from both screens', sorted(mia.page), [theirs]);
    await expectEventually('…including Raj’s', sorted(raj.page), [theirs]);    // Raj's shape is the shape Raj dragged, in the place Raj left it.
    expect(Math.round((await shapeWorldBox(raj.page, theirs)).width)).toBe(220);

    // Raj undoes: their own shape goes, and Mia watches it go.
    await raj.page.keyboard.press('Control+z');
    await expectEventually('Raj’s shape is gone from both screens', sorted(mia.page), []);
    await expectEventually('…including Raj’s', sorted(raj.page), []);
    // Raj redoes: it comes back on both screens, where Raj left it.
    await raj.page.keyboard.press('Control+Shift+z');
    await expectEventually('Raj’s shape is back on Mia’s screen', sorted(mia.page), [theirs]);
    expect(Math.round((await shapeWorldBox(mia.page, theirs)).width)).toBe(220);

    // Mia redoes twice: her shape, then the arrow that joins the two.
    await mia.page.keyboard.press('Control+Shift+z');
    await expectEventually('Mia’s shape is back on both screens', sorted(raj.page), [mine, theirs].sort());
    await mia.page.keyboard.press('Control+Shift+z');
    await expectEventually('and so is the arrow', async () => (await arrowIds(raj.page)).length, 1);
    const restored = (await arrowIds(mia.page))[0]!;
    const state = await arrowState(mia.page, restored);
    expect(state.from.kind).toBe('attached');
    expect(state.to.kind).toBe('attached');
    // It is the same arrow: attached to the same two shapes, on the sides they face.
    await expectEndOnSideOf(mia.page, restored, 'from', mine, theirs);
    await expectEndOnSideOf(mia.page, restored, 'to', theirs, mine);

    await leaveAll([mia, raj]);
    expectNoProblems([mia, raj]);
  });
});

test.describe('rearranging a flow while somebody else watches', () => {
  test('TC-25: a shape dragged past its neighbour turns the arrow round on both screens', async ({
    browser,
    request,
  }) => {
    const boardId = await newBoard(request);
    const dana = await joinBoard(browser, 'Dana', boardId);
    const sam = await joinBoard(browser, 'Sam', boardId);

    // Two shapes and an arrow between them, all of it drawn by Dana.
    const left = await drawShape(dana.page, { x: 200, y: 300 }, { x: 380, y: 420 }, 'rect');
    const right = await drawShape(dana.page, { x: 600, y: 280 }, { x: 780, y: 400 }, 'ellipse');
    const arrow = await drawArrow(dana.page, { x: 374, y: 360 }, { x: 606, y: 340 });
    await waitForShapeCount(sam.page, 2);
    await waitForArrowCount(sam.page, 1);

    // Both screens agree the arrow is stuck to the two shapes, on the sides that
    // face one another: the right side of the left-hand shape, the left of the other.
    await expectEventually('the arrow is attached, right to left, on Sam’s screen', () => arrowSides(sam.page, arrow, left, right), 'right|left');
    await expectEndOnSideOf(sam.page, arrow, 'from', left, right);
    await expectEndOnSideOf(sam.page, arrow, 'to', right, left);

    // Dana drags the right-hand shape the whole way past the other one.
    const at = await shapeCentre(dana.page, right);
    await dana.page.mouse.move(at.x, at.y);
    await dana.page.mouse.down();
    await dana.page.mouse.move(at.x - 250, at.y, { steps: 6 });
    await dana.page.mouse.move(at.x - 500, at.y, { steps: 10 });
    await dana.page.mouse.up();
    await settle(dana.page);

    // On Sam’s screen the arrow is still one arrow, still attached at both ends, and
    // its ends have gone round to the far sides of their shapes without anybody
    // drawing near it.
    await expectEventually('the arrow turned round on Sam’s screen', () => arrowSides(sam.page, arrow, left, right), 'left|right');
    await expectEndOnSideOf(sam.page, arrow, 'from', left, right);
    await expectEndOnSideOf(sam.page, arrow, 'to', right, left);

    // Both people are looking at one arrow, in one place, attached to two shapes.
    const state = await arrowState(sam.page, arrow);
    expect(state.detached).toBe(false);
    expect(await arrowIds(dana.page)).toHaveLength(1);

    // And dragging the shape back brings the sides it started on, on both screens.
    const back = await shapeCentre(sam.page, right);
    await dana.page.mouse.move(back.x, back.y);
    await dana.page.mouse.down();
    await dana.page.mouse.move(back.x + 500, back.y, { steps: 10 });
    await dana.page.mouse.up();
    await expectEventually('the arrow turned back on Sam’s screen', () => arrowSides(sam.page, arrow, left, right), 'right|left');
    await expectEndOnSideOf(sam.page, arrow, 'from', left, right);
    await expectEndOnSideOf(sam.page, arrow, 'to', right, left);
    await expectSameBoard([dana, sam], 'the flow after the rearrangement');

    await leaveAll([dana, sam]);
    expectNoProblems([dana, sam]);
  });

  test('TC-26: a shape my colleague deletes leaves my arrow ending where its side was', async ({
    browser,
    request,
  }) => {
    const boardId = await newBoard(request);
    const dana = await joinBoard(browser, 'Dana', boardId);
    const sam = await joinBoard(browser, 'Sam', boardId);

    const left = await drawShape(dana.page, { x: 200, y: 300 }, { x: 380, y: 420 }, 'rect');
    const right = await drawShape(dana.page, { x: 600, y: 280 }, { x: 780, y: 400 }, 'diamond');
    const arrow = await drawArrow(dana.page, { x: 374, y: 360 }, { x: 606, y: 340 });
    await waitForShapeCount(sam.page, 2);
    await waitForArrowCount(sam.page, 1);

    // Where the arrow's far end is drawn while the shape is there: the middle of the
    // side of the diamond that faces the other shape.
    const box = await shapeWorldBox(sam.page, right);
    const other = await shapeWorldBox(sam.page, left);
    const lastSide = sideAnchor(box, sideFacing(box, other));

    // Sam deletes the shape the arrow is attached to.
    const at = await shapeCentre(sam.page, right);
    await sam.page.mouse.click(at.x, at.y);
    await sam.page.keyboard.press('Delete');

    // Dana's arrow is still on the screen — an arrow is not thrown away just because
    // one end of it came loose — and it ends where that shape's side was.
    await expectEventually('Dana is told the shape is gone', async () => (await shapeIds(dana.page)).length, 1);
    await expect(arrowLocator(dana.page, arrow)).toBeVisible();
    await expectArrowEndAt(dana.page, arrow, 'to', lastSide);
    // The end is a point in the board now, which is why it could stay where it was.
    expect((await arrowState(dana.page, arrow)).to.kind).toBe('free');
    // The board put the loose end down rather than leave it pointing at nothing, so
    // the arrow is not drawn as a stranded one: the transaction that deletes a shape
    // turns the ends attached to it into free points, and it is only an end that was
    // never told — the race of the next test — that is left orphaned.
    await expectEventually('the arrow is not drawn as stranded', () => arrowLocator(dana.page, arrow).getAttribute('data-detached'), 'false');
    // The other end is still an end stuck to a shape, on the side that faces the
    // space the deleted one left — which is now a point rather than a shape, so the
    // side it is on is the side of the remaining shape that faces where the arrow
    // ended.
    expect((await arrowState(dana.page, arrow)).from.kind).toBe('attached');
    const leftBox = await shapeWorldBox(dana.page, left);
    await expectArrowEndAt(dana.page, arrow, 'from', sideAnchor(leftBox, nearestSide(leftBox, lastSide)));

    // The delete left no half-written arrow: both screens show the same one.
    await expectArrowEndAt(sam.page, arrow, 'to', lastSide);
    expect(await arrowSides(sam.page, arrow, left, right)).toBe('attached|free');

    // The arrow that was left behind is a thing in its own right: it can be clicked,
    // and it can be deleted, and both people see either.
    await clickArrow(dana.page, arrow);
    await dana.page.keyboard.press('Delete');
    await expectEventually('the arrow is gone from Sam’s screen too', async () => (await arrowIds(sam.page)).length, 0);
    await expectSameBoard([dana, sam], 'the board after the arrow was cleared away');

    await leaveAll([dana, sam]);
    expectNoProblems([dana, sam]);
  });

  test('TC-27: an arrow whose shape is deleted while it is being drawn still lands where it was aimed', async ({
    browser,
    request,
  }) => {
    test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + 150_000);
    const boardId = await newBoard(request);
    const dana = await joinBoard(browser, 'Dana', boardId);
    const sam = await joinBoard(browser, 'Sam', boardId);

    const left = await drawShape(dana.page, { x: 200, y: 300 }, { x: 380, y: 420 }, 'rect');
    const right = await drawShape(dana.page, { x: 600, y: 280 }, { x: 780, y: 400 }, 'ellipse');
    await waitForShapeCount(sam.page, 2);

    // Where the far end of the arrow is going to land: the side of the shape Dana is
    // aiming at, read while that shape is still on both boards.
    const box = await shapeWorldBox(sam.page, right);
    const other = await shapeWorldBox(sam.page, left);
    const aimed = sideAnchor(box, sideFacing(box, other));

    // The race cannot be caught by slipping a wait into the few milliseconds a change
    // takes to cross a room, and Playwright cannot hold up the frames of a WebSocket
    // that is already open. So the overlap is made the way the product is specified to
    // behave when it cannot see the room: Dana loses the board for as long as the
    // product says it may stay lost. While it is lost, nothing Dana does can reach the
    // room and nothing the room does can reach Dana — which is precisely an operation
    // overlapping a delete, held open for as long as anybody cares to look.
    await loseTheBoard(dana, CATCH_UP_TEST_OUTAGE_MS);
    await expectEventually('Dana is told the board is out of reach', () => badgeOf(dana.page), 'Reconnecting…');

    // Dana arms the Connector tool and presses on one shape, dragging to the other.
    await connectorButton(dana.page).click();
    const from = await shapeCentre(dana.page, left);
    const to = {
      x: (await shapeWorldBox(dana.page, right)).x + CENTRE.x + 6,
      y: (await shapeWorldBox(dana.page, right)).y + CENTRE.y,
    };
    await dana.page.mouse.move(from.x, from.y);
    await dana.page.mouse.down();
    await dana.page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
    await dana.page.mouse.move(to.x, to.y, { steps: 6 });

    // While Dana's pointer is still down, Sam deletes the shape it is aimed at.
    const at = await shapeCentre(sam.page, right);
    await sam.page.mouse.click(at.x, at.y);
    await sam.page.keyboard.press('Delete');
    await expectEventually('the shape is gone from Sam’s screen', async () => (await shapeIds(sam.page)).length, 1);

    // Dana lets go. On Dana's board the shape is still there, so the arrow is drawn to
    // it like any other arrow: attached, ending on its facing side. This is the half of
    // the race in which the release is first.
    await dana.page.mouse.up();
    const arrow = (await waitForArrowCount(dana.page, 1))[0]!;
    expect((await arrowState(dana.page, arrow)).to.kind).toBe('attached');
    await expectArrowEndAt(dana.page, arrow, 'to', aimed);

    // The link comes back and Sam's delete lands. The arrow stays where it is and stays
    // on the screen, but the end stops being attached to something that no longer
    // exists — which is the other half of the race, and it ends in the same place on
    // the screen as the first half did.
    await expectBoardAgreedAgain(dana, 'Dana’s board, mid-drag');
    await expectEventually('the shape is gone from Dana’s screen as well', async () => (await shapeIds(dana.page)).length, 1);
    await expect(arrowLocator(dana.page, arrow)).toBeVisible();
    await expectEventually('the arrow is drawn as stranded', () => arrowLocator(dana.page, arrow).getAttribute('data-detached'), 'true');
    const state = await arrowState(dana.page, arrow);
    // The end is written as attached to a shape that is not there, and drawn as a
    // point in the air: the two together — a free-looking end on an arrow the board
    // says is stranded — are what no other state of an arrow looks like, which is why
    // this is the case the drawn kind is worth reading.
    expect(state.to.kind).toBe('free');
    expect(state.from.kind).toBe('attached');
    await expectArrowEndAt(dana.page, arrow, 'to', aimed);
    // Both people's arrows are one arrow, in one place, stranded in the same way.
    await expectArrowEndAt(sam.page, arrow, 'to', aimed);
    expect(await arrowSides(sam.page, arrow, left, right)).toBe('attached|free');
    await expectSameBoard([dana, sam], 'the arrow that outran a delete');

    // Nothing crashed, on either screen, through any of it.
    await leaveAll([dana, sam]);
    expectNoProblems([dana, sam]);
  });
});

test.describe('an arrow is a thing you can click', () => {
  test('TC-28: an arrow is clickable at half size and at double', async ({ page }) => {
    await gotoBoard(page);

    const left = await drawShape(page, { x: 200, y: 300 }, { x: 380, y: 420 }, 'rect');
    const right = await drawShape(page, { x: 620, y: 300 }, { x: 800, y: 420 }, 'ellipse');
    // An arrow drawn from a shape out into empty board: the one kind of arrow whose
    // own ends a drag of the arrow moves, which is what makes it the one to drag here.
    const loose = await drawArrow(page, { x: 794, y: 360 }, { x: 1000, y: 560 });

    for (const zoom of [0.5, 2]) {
      // Zoom in on the middle of the arrow's line. Zoomed out, a line two board units
      // wide is one screen pixel wide; the corridor a click has to be inside to be a
      // click on the arrow is six screen pixels at every zoom, which is the whole
      // reason it is stated in screen pixels.
      const world = await arrowWorldMidpoint(page, loose);
      await zoomAround(page, world, zoom);
      expect((await cameraOf(page)).zoom).toBeCloseTo(zoom, 3);
      const at = await arrowMidpoint(page, loose);
      // The point of the board the camera was put on is in the middle of the window,
      // at either scale: the numbers the click is aimed with are in the same place the
      // arrow is drawn, whatever the zoom.
      expect(Math.abs(at.x - CENTRE.x)).toBeLessThan(2);
      expect(Math.abs(at.y - CENTRE.y)).toBeLessThan(2);

      // Click there, and the arrow is what gets clicked rather than the board behind it.
      await page.mouse.click(at.x, at.y);
      await expect(arrowLocator(page, loose)).toHaveAttribute('data-selected', 'true', { timeout: 10_000 });
      await expect(shapeLocator(page, left)).toHaveAttribute('data-selected', 'false');
      await expect(shapeLocator(page, right)).toHaveAttribute('data-selected', 'false');
      // The two ends of a selected arrow are on the screen to be dragged.
      await expect(page.getByTestId('connector-end-from')).toBeVisible();
      await expect(page.getByTestId('connector-end-to')).toBeVisible();

      // Drag the arrow itself, and only the end that is a point in the air goes with it:
      // a drag of an arrow never drags the shapes it joins.
      const before = await arrowState(page, loose);
      await page.mouse.down();
      await page.mouse.move(at.x, at.y + 60, { steps: 6 });
      await page.mouse.up();
      await settle(page);
      const after = await arrowState(page, loose);
      expect(after.to.y).toBeCloseTo(before.to.y + 60 / zoom, 2);
      expect(after.to.x).toBeCloseTo(before.to.x, 2);
      expect(after.from.x).toBeCloseTo(before.from.x, 3);
      expect(after.from.y).toBeCloseTo(before.from.y, 3);
      expect(after.to.kind).toBe('free');
      expect(after.from.kind).toBe('attached');

      await restCamera(page);
      await page.mouse.click(EMPTY.x, EMPTY.y);
      await expect(arrowLocator(page, loose)).toHaveAttribute('data-selected', 'false');
    }

    // A shape held under the Connector tool offers four points, one at the middle of
    // each side; moving the pointer off the shape takes them away again.
    await connectorButton(page).click();
    const over = await shapeCentre(page, left);
    await page.mouse.move(over.x, over.y);
    await expect(page.locator('[data-testid^="attach-dot-"]')).toHaveCount(4, { timeout: 10_000 });
    await page.mouse.move(EMPTY.x, EMPTY.y);
    await expect(page.locator('[data-testid^="attach-dot-"]')).toHaveCount(0, { timeout: 10_000 });
  });
});

/** The middle of an arrow's line, in board units. */
async function arrowWorldMidpoint(page: Page, arrow: string): Promise<ScreenPoint> {
  const state = await arrowState(page, arrow);
  return { x: (state.from.x + state.to.x) / 2, y: (state.from.y + state.to.y) / 2 };
}
