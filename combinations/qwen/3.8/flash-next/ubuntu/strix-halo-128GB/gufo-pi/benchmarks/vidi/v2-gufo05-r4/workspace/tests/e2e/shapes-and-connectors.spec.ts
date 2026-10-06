/**
 * Story 10 end-to-end tests: drawing shapes with the mouse, and arrows that follow the shapes
 * they are tied to, in a real browser against the real room.
 *
 * Two things only a real browser can answer. One is whether the box the Shape tool promises is
 * the box that appears on the screen at the place the pointer actually was, at a zoom that is
 * not 100%. The other is whether an arrow drawn by one person follows a shape moved by another,
 * including the awkward cases: the shape dragged past its neighbour, so both ends change side;
 * the shape deleted from under an end; and a shape deleted at the same moment as an arrow is
 * drawn to it, which is what the last case arranges by stopping one person's side of the
 * conversation.
 */

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type WebSocketRoute
} from '@playwright/test';
import { BASE_URL } from '../../playwright.config';
import { SHAPE_DEFAULT_SIZE_WORLD } from '../../src/shared/config';
import type { Point } from '../../src/client/canvas/camera';
import { createShape } from '../../src/shared/objects/shape';
import {
  arrowBoxOnScreen,
  arrowOn,
  connectorElement,
  connectorEndHandle,
  arrowsOn,
  chooseShapeKind,
  connectorElements,
  dragByMouse,
  dragResizeHandleBy,
  drawArrowByDrag,
  drawShapeByClick,
  getCamera,
  objectCentreOnScreen,
  openBoard,
  pressedTool,
  screenOf,
  setCamera,
  shapeElement,
  shapeLabelBox,
  shapesOn,
  toolMode,
  worldOf
} from './helpers/board';
import { closeSessions, openSession, type Participant, type Session } from './helpers/participants';
import { seedAllObjects } from './helpers/board-writer';

/** Sessions and contexts opened here, so a failing test leaves no browsers behind. */
const sessions: Session[] = [];

test.afterEach(async () => {
  await closeSessions(sessions);
});

async function withPeople(browser: Browser, ...names: string[]): Promise<Session> {
  const session = await openSession(browser, names);
  sessions.push(session);
  return session;
}

/**
 * Two shapes 200 units across, side by side on the same row: A's right side at x = -250, B's
 * left side at x = -150, so an arrow between them is 100 long and both ends face horizontally.
 */
const A = { x: -450, y: -100 };
const B = { x: -150, y: -100 };
const SIDE = 200;

async function seedPair(session: Session): Promise<{ a: string; b: string }> {
  const ids: string[] = [];
  await seedAllObjects(
    BASE_URL,
    session.boardId,
    (doc) => {
      ids.push(createShape(doc, { kind: 'rect', rect: { ...A, width: SIDE, height: SIDE }, at: A }, '') ?? '');
      ids.push(createShape(doc, { kind: 'rect', rect: { ...B, width: SIDE, height: SIDE }, at: B }, '') ?? '');
    },
    2
  );
  await session.eventually('everybody holds both shapes', async () => {
    for (const person of session.people) {
      const count = (await shapesOn(person.page)).length;
      if (count !== 2) return `${person.name} holds ${count} shape(s)`;
    }
    return true;
  });
  if (ids.some((id) => id === '')) throw new Error('the seeded shapes were not created');
  return { a: ids[0], b: ids[1] };
}

/** Drag a shape so that its top-left lands on a board point. */
async function dragShapeTo(page: Page, id: string, world: Point): Promise<void> {
  const shape = (await shapesOn(page)).find((candidate) => candidate.id === id);
  if (!shape) throw new Error(`shape ${id} is not on this page`);
  const centre = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  await dragByMouse(page, await screenOf(page, centre), await screenOf(
    page,
    { x: world.x + shape.width / 2, y: world.y + shape.height / 2 }
  ));
}

/** The ends an arrow should have, given where its shapes are: the sides that face each other. */
function facing(a: Point, b: Point, size = SIDE) {
  return a.x < b.x
    ? { from: { x: a.x + size, y: a.y + size / 2 }, to: { x: b.x, y: b.y + size / 2 } }
    : { from: { x: a.x, y: a.y + size / 2 }, to: { x: b.x + size, y: b.y + size / 2 } };
}

function samePoint(actual: Point, expected: Point): boolean {
  return Math.abs(actual.x - expected.x) < 0.01 && Math.abs(actual.y - expected.y) < 0.01;
}

test('TC-23: a shape dragged out with the mouse is the box that was dragged', async ({ page }) => {
  await openBoard(page);
  const camera = await getCamera(page);
  const from = { x: 100, y: 100 };
  const to = { x: 300, y: 220 };

  const expectedWorld = await worldOf(page, from);
  const before = (await shapesOn(page)).map((shape) => shape.id);
  await page.keyboard.press('s');
  expect(await toolMode(page)).toBe('shape');
  expect(await pressedTool(page)).toBe('shape');
  await dragByMouse(page, from, to);

  const [shape] = (await shapesOn(page)).filter((candidate) => !before.includes(candidate.id));
  expect(shape).toBeDefined();
  // The board keeps board measurements: 200x120 screen pixels at 100% is 200x120 board units.
  expect(shape.width).toBeCloseTo((to.x - from.x) / camera.zoom, 0);
  expect(shape.height).toBeCloseTo((to.y - from.y) / camera.zoom, 0);
  expect(shape.x).toBeCloseTo(expectedWorld.x, 0);
  expect(shape.y).toBeCloseTo(expectedWorld.y, 0);

  // And the screen shows exactly that box, to within a pixel, where the pointer left off.
  const box = await shapeElement(page, shape.id).boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box!.width - (to.x - from.x))).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.height - (to.y - from.y))).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.x - from.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.y - from.y)).toBeLessThanOrEqual(1);

  // The tool is put down after one shape, and the shape is what is selected (`tools.pen`).
  await expect.poll(() => toolMode(page)).toBe('select');
  await expect(page.locator(`[data-object-id="${shape.id}"]`)).toHaveAttribute('data-selected', 'true');
  // Polled rather than read once: the socket is allowed to have re-made itself at some point in a
  // test that has just drawn a shape over it.
  await expect.poll(() => page.evaluate(() => window.__vidi6?.connectionState)).toBe('connected');
});

test('TC-24: a clicked diamond is a standard size, and its label wraps and stays centred when it is resized', async ({
  page
}) => {
  await openBoard(page);
  const camera = await getCamera(page);
  // 200%: the size a click makes is a board measurement, so the screen doubles with it.
  await setCamera(page, { ...camera, zoom: 2 });

  // Choose the kind beside the tool, then click where it should go.
  await chooseShapeKind(page, 'diamond');
  const clicked = { x: 620, y: 420 };
  const centreWorld = await worldOf(page, clicked);
  const shape = await drawShapeByClick(page, centreWorld);
  expect(shape.kind).toBe('diamond');
  // A click makes the standard size, in board units, centred on the click — at any zoom.
  expect(shape.width).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD, 0);
  expect(shape.height).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD, 0);
  expect(shape.x + shape.width / 2).toBeCloseTo(centreWorld.x, 0);
  expect(shape.y + shape.height / 2).toBeCloseTo(centreWorld.y, 0);
  const box = await shapeElement(page, shape.id).boundingBox();
  expect(box!.width).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD * 2, 0);

  // A label longer than the shape is wrapped inside it, and stays in the middle.
  const words = 'a great many words for one small diamond '.repeat(4);
  await writeLabel(page, shape.id, words);
  const written = shapeLabelBox(page, shape.id);
  const oneLine = await labelLineHeight(page, shape.id);
  const before = await written;
  expect(before.words.length).toBeGreaterThan(40);
  expect(before.label.height).toBeGreaterThan(oneLine * 1.5);
  expect(Math.abs(before.label.x + before.label.width / 2 - (before.shape.x + before.shape.width / 2))).toBeLessThanOrEqual(
    2
  );

  // Resize it by a handle: the label re-wraps to the new width and is still centred.
  await dragResizeHandleBy(page, 'se', -120, 60);
  const resized = await shapesOn(page).then((all) => all.find((candidate) => candidate.id === shape.id)!);
  expect(resized.width).toBeLessThan(shape.width - 1);
  expect(resized.height).toBeGreaterThan(shape.height + 1);
  const after = await shapeLabelBox(page, shape.id);
  expect(after.words).toBe(before.words);
  expect(after.label.height).toBeGreaterThan(oneLine * 1.5);
  expect(Math.abs(after.label.x + after.label.width / 2 - (after.shape.x + after.shape.width / 2))).toBeLessThanOrEqual(2);
  expect(Math.abs(after.label.y + after.label.height / 2 - (after.shape.y + after.shape.height / 2))).toBeLessThanOrEqual(
    2
  );
});

/** Double-click a shape, type its label, and put the pen down. */
async function writeLabel(page: Page, id: string, words: string): Promise<void> {
  const centre = await objectCentreOnScreen(page, id);
  await page.mouse.dblclick(centre.x, centre.y);
  const editor = page.locator('[data-testid="shape-input"]');
  await expect(editor).toBeVisible();
  await editor.fill(words);
  await editor.press('Escape');
  await expect(editor).toHaveCount(0);
}

/** How tall one line of a shape's label is, as drawn: the ruler for "did it wrap". */
async function labelLineHeight(page: Page, id: string): Promise<number> {
  const size = await shapeElement(page, id)
    .locator('[data-testid="shape-label"]')
    .evaluate((element) => {
      const style = window.getComputedStyle(element);
      const lineHeight = parseFloat(style.lineHeight);
      return Number.isFinite(lineHeight) ? lineHeight : parseFloat(style.fontSize) * 1.4;
    });
  return size;
}

test('TC-25: an arrow follows a shape somebody else drags past its neighbour', async ({ browser }) => {
  const session = await withPeople(browser, 'dana', 'sam');
  const { a, b } = await seedPair(session);
  const dana = session.person('dana');

  // Dana ties an arrow from A to B.
  const arrow = await drawArrowByDrag(dana.page, { x: -250, y: 0 }, { x: -150, y: 0 });
  expect(arrow.from).toMatchObject({ kind: 'attached', objectId: a });
  expect(arrow.to).toMatchObject({ kind: 'attached', objectId: b });
  await session.eventually('the arrow is on both boards', async () => {
    const onSam = (await arrowsOn(session.person('sam').page)).length;
    return onSam === 1 ? true : `sam holds ${onSam} arrow(s)`;
  });
  // A to B, so it points rightwards to begin with.
  expect(arrow.points.from.x).toBeLessThan(arrow.points.to.x);

  // Dana drags B right past A. Only B moves: the arrow is not touched by this gesture.
  await dragShapeTo(dana.page, b, { x: -900, y: -100 });

  // On both screens the arrow has followed, and both of its ends have changed side at the
  // diagonal (`connector.follow`, TC-10 seen from the outside).
  await session.eventually('the arrow has followed B and switched to the sides that face', async () => {
    const moved = await shapesOn(dana.page).then((all) => all.find((shape) => shape.id === b)!);
    const expected = facing(A, { x: moved.x, y: moved.y });
    for (const person of session.people) {
      const held = await arrowOn(person.page, arrow.id);
      if (held.from.kind !== 'attached' || held.to.kind !== 'attached') {
        return `${person.name} has lost an end: ${JSON.stringify({ from: held.from, to: held.to })}`;
      }
      if (!samePoint(held.points.from, expected.from) || !samePoint(held.points.to, expected.to)) {
        return `${person.name} sees ${JSON.stringify(held.points)}, expected ${JSON.stringify(expected)}`;
      }
    }
    return true;
  });

  for (const person of session.people) {
    await expectArrowDrawnBetween(person.page, arrow.id);
  }

  // Zoom Dana right in on the two shapes: the arrow that followed is drawn at the new scale, in
  // the new place — a screen that had simply kept its old picture would be wrong here.
  await setCamera(dana.page, { ...(await getCamera(dana.page)), zoom: 2 });
  await expectArrowDrawnBetween(dana.page, arrow.id);

  for (const person of session.people) expect(person.errors).toEqual([]);
  session.report();
});

test('TC-26: when the shape at its end is deleted, the arrow goes on pointing at that place', async ({
  browser
}) => {
  const session = await withPeople(browser, 'dana', 'sam');
  const { b } = await seedPair(session);
  const dana = session.person('dana');
  const sam = session.person('sam');

  const arrow = await drawArrowByDrag(dana.page, { x: -250, y: 0 }, { x: -150, y: 0 });
  await session.eventually('the arrow is on both boards', async () => {
    const onSam = (await arrowsOn(sam.page)).length;
    return onSam === 1 ? true : `sam holds ${onSam} arrow(s)`;
  });

  // Sam deletes B.
  await sam.page.bringToFront();
  await dragShapeSelect(sam, b);
  await sam.page.keyboard.press('Delete');
  await session.eventually('both boards have lost B', async () => {
    for (const person of session.people) {
      if ((await shapesOn(person.page)).some((shape) => shape.id === b)) return `${person.name} still holds B`;
    }
    return true;
  });

  // On both screens the arrow is still there, and its end is fixed at the side B was tied to.
  await session.eventually('the arrow keeps an end where B used to be', async () => {
    for (const person of session.people) {
      const held = await arrowOn(person.page, arrow.id);
      if (held.to.kind !== 'free') return `${person.name} has ${held.to.kind} where B was`;
      if (!samePoint(held.to, { x: -150, y: 0 })) {
        return `${person.name} has the end at ${JSON.stringify(held.to)}, expected B's left side`;
      }
    }
    return true;
  });
  for (const person of session.people) {
    await expect(connectorElements(person.page)).toHaveCount(1);
  }

  // Dana then drags that loose end somewhere else (`connector.reattach`, seen through a real
  // stylesheet: the handle answers to the pointer although the box around it does not), and Sam
  // sees the end fixed where she let go.
  const middle = await screenOf(dana.page, { x: -200, y: 0 });
  await dana.page.mouse.click(middle.x, middle.y);
  await expect(connectorElement(dana.page, arrow.id)).toHaveAttribute('data-selected', 'true');
  const handle = connectorEndHandle(dana.page, 'to');
  await expect(handle).toHaveCount(1);
  const grabbed = await handle.boundingBox();
  if (!grabbed) throw new Error('the selected arrow shows no end to drag');
  await dragByMouse(dana.page, { x: grabbed.x + grabbed.width / 2, y: grabbed.y + grabbed.height / 2 }, await screenOf(dana.page, { x: -300, y: 200 }));
  await session.eventually('the end is fixed where Dana let go', async () => {
    for (const person of session.people) {
      const held = await arrowOn(person.page, arrow.id);
      if (held.from.kind !== 'attached') return `${person.name} lost the end that was tied to A`;
      if (held.to.kind !== 'free') return `${person.name} has ${held.to.kind} at the dragged end`;
      if (!samePoint(held.to, { x: -300, y: 200 })) return `${person.name} sees the end at ${JSON.stringify(held.to)}`;
    }
    return true;
  });

  for (const person of session.people) expect(person.errors).toEqual([]);
  session.report();
});

test('TC-27: an arrow drawn at the same moment as its shape is deleted is still an arrow', async ({
  browser
}) => {
  // Sam's side of the conversation is stopped before his page opens, so his delete really can
  // be sitting in the wire while Dana draws: the overlap is arranged, not hoped for.
  const gate = stoppedWire();
  const session = await openSession(browser, ['dana', 'sam'], {
    beforeOpen: async (context, name) => {
      if (name === 'sam') await gate.install(context);
    }
  });
  sessions.push(session);

  const { b } = await seedPair(session);
  const dana = session.person('dana');
  const sam = session.person('sam');

  gate.hold();
  await dragShapeSelect(sam, b);
  await sam.page.keyboard.press('Delete');
  await expect.poll(async () => (await shapesOn(sam.page)).length).toBe(1);
  // Proof the wire is stopped rather than the delete failing: Sam's own board changed and
  // Dana's did not.
  expect((await shapesOn(dana.page)).length).toBe(2);

  // Dana draws an arrow onto a shape her board still believes in.
  const arrow = await drawArrowByDrag(dana.page, { x: -250, y: 0 }, { x: -150, y: 0 });
  expect(arrow.to).toMatchObject({ kind: 'attached', objectId: b });

  gate.release();

  // The delete arrives. Nobody's board stops making sense: the arrow is still drawn, with its
  // end at the place its shape's side was (`connector.create` with a target that has gone).
  await session.eventually('both boards show the arrow at the place B was', async () => {
    for (const person of session.people) {
      if ((await shapesOn(person.page)).some((shape) => shape.id === b)) return `${person.name} still holds B`;
      const held = await arrowOn(person.page, arrow.id);
      // The end stays what it was tied to — nobody rewrites an arrow because a merge arrived —
      // and it is drawn at the fallback the arrow was created with.
      if (held.to.kind !== 'attached') return `${person.name} rewrote the end to ${held.to.kind}`;
      if (!samePoint(held.points.to, { x: -150, y: 0 })) {
        return `${person.name} draws the end at ${JSON.stringify(held.points.to)}`;
      }
    }
    return true;
  });
  for (const person of session.people) {
    await expect(connectorElements(person.page)).toHaveCount(1);
    expect(person.errors).toEqual([]);
  }
  session.report();
});

/**
 * The arrow is not only in the model but on the screen: the picture runs between the two ends the
 * board resolved, through this screen's camera, whatever the zoom.
 */
async function expectArrowDrawnBetween(page: Page, id: string): Promise<void> {
  // Polled, because a picture is allowed to be a frame behind the document: what is being asserted
  // is that the two run through the same geometry, and an arrow drawn somewhere it was not pointed
  // at is wrong by tens of pixels, every time, rather than occasionally wrong by one.
  await expect
    .poll(
      async () => {
        const held = await arrowOn(page, id);
        const drawn = await arrowBoxOnScreen(page, id);
        const from = await screenOf(page, held.points.from);
        const to = await screenOf(page, held.points.to);
        return Math.max(
          Math.abs(drawn.x - Math.min(from.x, to.x)),
          Math.abs(drawn.x + drawn.width - Math.max(from.x, to.x)),
          Math.abs(drawn.y + drawn.height / 2 - (from.y + to.y) / 2)
        );
      },
      { message: `the arrow on ${id} is drawn between the ends the board resolved` }
    )
    .toBeLessThanOrEqual(2);
}

/** Click a shape so it is the selection, ready to be deleted. */
async function dragShapeSelect(person: Participant, id: string): Promise<void> {
  const centre = await objectCentreOnScreen(person.page, id);
  await person.page.mouse.click(centre.x, centre.y);
  await expect(person.page.locator(`[data-object-id="${id}"]`)).toHaveAttribute('data-selected', 'true');
}

/**
 * Sam's side of the conversation, with a switch on it.
 *
 * Nothing Sam sends leaves his browser while the wire is held — the frames queue here, in the
 * order they were sent — while everything the room says still arrives. That is the one thing a
 * test needs to make two people's changes overlap on purpose: a delete that is sitting in the
 * wire while somebody else draws to the same shape.
 */
function stoppedWire() {
  let held = false;
  let queue: (string | Buffer)[] = [];
  let toServer: ((message: string | Buffer) => void) | null = null;

  return {
    async install(context: BrowserContext): Promise<void> {
      await context.routeWebSocket(/\/api\/rooms\//, async (socket: WebSocketRoute) => {
        const server = await socket.connectToServer();
        toServer = (message) => server.send(message);
        // What the room says goes straight through: stopping it would stop the board arriving,
        // and then the test would be about a disconnection rather than about a race.
        server.onMessage((message) => socket.send(message));
        socket.onMessage((message) => {
          if (!held) {
            server.send(message);
            return;
          }
          queue.push(message);
        });
      });
    },
    hold(): void {
      held = true;
    },
    release(): void {
      held = false;
      const pending = queue;
      queue = [];
      for (const message of pending) toServer?.(message);
    }
  };
}

