// Story 10 end-to-end, connectors: join two shapes with an arrow by dragging from
// one onto the other, move a shape and watch the arrow follow, delete a shape and
// watch the arrow stay, re-point an end with its handle, and click an arrow to
// select it at two zooms - in a real browser, against the real room.
//
// TC-25 and TC-26 of the design, plus the zoom half of the click rule, which is the
// one thing a jsdom test can only approximate.
//
// The arrow is read two ways, deliberately:
//  * `data-from-end` / `data-to-end` - the KIND the model stored, which says whether
//    the board remembered an object or a coordinate;
//  * `data-from-x/y`, `data-to-x/y` on the drawn line - where the board resolved the
//    ends on this frame, which is the arrow a person sees.
// An arrow that follows a moved shape while its stored ends stay untouched is the
// whole requirement, measured.
//
// Layout: the board's world (0,0) is the middle of the screen at the camera the page
// opens with; every point used is placed clear of the tool column (left), the zoom
// controls (bottom right) and the share button (top right).
import { test, expect, type Page } from '@playwright/test';
import { gotoBoard, getCamera, setCamera, type Cam } from './helpers/sticky.ts';

interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Ends {
  /** where the board is drawing each end, in world units */
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** what the model stored for each end */
  fromKind: string;
  toKind: string;
  selected: string;
}

const screenOf = (cam: Cam, p: { x: number; y: number }) => ({
  x: (p.x - cam.x) * cam.zoom,
  y: (p.y - cam.y) * cam.zoom,
});

const shapeEls = (page: Page) => page.locator('[data-testid^="shape-"][data-shape-kind]');
const connectorEls = (page: Page) => page.locator('[data-testid^="connector-"][data-object-id]');

/** One shape's identity, box and all, as the world layer painted it. */
async function shapeBox(page: Page, nth = 0): Promise<Box> {
  return shapeEls(page).nth(nth).evaluate((e) => ({
    id: (e as HTMLElement).dataset.objectId ?? '',
    x: parseFloat((e as HTMLElement).style.left),
    y: parseFloat((e as HTMLElement).style.top),
    width: parseFloat((e as HTMLElement).style.width),
    height: parseFloat((e as HTMLElement).style.height),
  }));
}

async function centerOf(page: Page, box: Box): Promise<{ x: number; y: number }> {
  return screenOf(await getCamera(page), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

/** Press S and drag out a shape. */
async function drawShape(page: Page, fromWorld: { x: number; y: number }, toWorld: { x: number; y: number }): Promise<void> {
  const cam = await getCamera(page);
  const a = screenOf(cam, fromWorld);
  const b = screenOf(cam, toWorld);
  await page.keyboard.press('s');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
  }
  await page.mouse.up();
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
}

/** Press L and drag an arrow from one world point to another. */
async function drawConnector(page: Page, fromWorld: { x: number; y: number }, toWorld: { x: number; y: number }): Promise<void> {
  const cam = await getCamera(page);
  const a = screenOf(cam, fromWorld);
  const b = screenOf(cam, toWorld);
  await page.keyboard.press('l');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
  }
  await page.mouse.up();
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
}

/** Let go of the selection, so no style bar is floating over the next drag. */
async function deselect(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('selection-bar')).toHaveCount(0);
}

/** What the board draws for one arrow, and what it stored. */
async function ends(page: Page, nth = 0): Promise<Ends> {
  return connectorEls(page).nth(nth).evaluate((e) => {
    const line = e.querySelector('[data-testid^="connector-line-"]') as HTMLElement;
    return {
      from: { x: parseFloat(line.dataset.fromX ?? ''), y: parseFloat(line.dataset.fromY ?? '') },
      to: { x: parseFloat(line.dataset.toX ?? ''), y: parseFloat(line.dataset.toY ?? '') },
      fromKind: (e as HTMLElement).dataset.fromEnd ?? '',
      toKind: (e as HTMLElement).dataset.toEnd ?? '',
      selected: (e as HTMLElement).dataset.selected ?? '',
    };
  });
}

/** Press on a world point and move it by screen pixels: dragging one object. */
async function dragWorldBy(page: Page, fromWorld: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  const a = screenOf(await getCamera(page), fromWorld);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(a.x + (dx * i) / 8, a.y + (dy * i) / 8);
  }
  await page.mouse.up();
  await page.waitForTimeout(80);
}

/** Drag from one screen point to another, held down the whole way. */
async function dragScreen(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  await page.mouse.up();
  await page.waitForTimeout(80);
}

/** Two shapes with 200 units of clear board between them, ready to be joined. */
async function twoShapes(page: Page): Promise<{ a: Box; b: Box }> {
  await drawShape(page, { x: 0, y: 0 }, { x: 200, y: 200 });
  await deselect(page);
  await drawShape(page, { x: 400, y: 0 }, { x: 600, y: 200 });
  await deselect(page);
  return { a: await shapeBox(page, 0), b: await shapeBox(page, 1) };
}

/** The screen point of wherever an arrow's end is being drawn. */
async function endScreen(page: Page, end: 'from' | 'to', nth = 0): Promise<{ x: number; y: number }> {
  const e = await ends(page, nth);
  return screenOf(await getCamera(page), e[end]);
}

// TC-25: the arrow joins two shapes and follows one of them when it moves, without
// its stored ends being rewritten.
test('TC-25 joins two shapes and follows a shape that moves', async ({ page }) => {
  await gotoBoard(page);
  const { a, b } = await twoShapes(page);

  await drawConnector(page, { x: a.x + a.width / 2, y: a.y + a.height / 2 }, { x: b.x + b.width / 2, y: b.y + b.height / 2 });

  await expect(connectorEls(page)).toHaveCount(1);
  let drawn = await ends(page);
  // An arrow between two objects, not between two coordinates it remembered.
  expect(drawn.fromKind).toBe('attached');
  expect(drawn.toKind).toBe('attached');
  // It leaves the facing sides: A's right edge, B's left edge, each at its middle.
  expect(drawn.from.x).toBeCloseTo(200, 0);
  expect(drawn.from.y).toBeCloseTo(100, 0);
  expect(drawn.to.x).toBeCloseTo(400, 0);
  expect(drawn.to.y).toBeCloseTo(100, 0);
  // It has an arrowhead, and it is the thing that is selected - which the board
  // settles on the render after the one that made it, so it is waited for.
  await expect(page.locator('[data-testid^="connector-arrow-"]')).toHaveCount(1);
  await expect(async () => {
    expect((await ends(page)).selected).toBe('true');
  }).toPass();

  // Move A. The arrow goes with it; nothing about the arrow was written.
  await dragWorldBy(page, { x: a.x + a.width / 2, y: a.y + a.height / 2 }, 60, 40);

  drawn = await ends(page);
  expect(drawn.fromKind).toBe('attached'); // still the object, not a place
  expect(drawn.from.x).toBeCloseTo(260, 0); // A's right edge, where A now is
  expect(drawn.from.y).toBeCloseTo(140, 0);
  expect(drawn.to.x).toBeCloseTo(400, 0); // B never moved
  expect(drawn.to.y).toBeCloseTo(100, 0);

  // Move B below A as well: the arrow turns to the sides that face each other now.
  await dragWorldBy(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, 0, 250);
  drawn = await ends(page);
  expect(drawn.toKind).toBe('attached');
  expect(drawn.to.x).toBeCloseTo(400, 0); // B's left, the side that faces A
  expect(drawn.to.y).toBeCloseTo(350, 0);

  // And after the page is reloaded the board still means "these two objects".
  await page.reload();
  await page.waitForSelector('[data-testid="viewport"]');
  await expect(connectorEls(page)).toHaveCount(1);
  drawn = await ends(page);
  expect(drawn.fromKind).toBe('attached');
  expect(drawn.toKind).toBe('attached');
  expect(drawn.from.x).toBeCloseTo(260, 0);
  expect(drawn.to.y).toBeCloseTo(350, 0);
});

// TC-26: deleting a shape keeps the arrows that pointed at it, with the end left
// exactly where that shape's side was - and that is what the board stored, not a
// frame it happened to be on.
test('TC-26 keeps the arrow and its end where the deleted shape was', async ({ page }) => {
  await gotoBoard(page);
  const { a, b } = await twoShapes(page);
  await drawConnector(page, { x: a.x + a.width / 2, y: a.y + a.height / 2 }, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
  await deselect(page);

  // Delete the shape the arrow was pointing at.
  const target = await centerOf(page, b);
  await page.mouse.click(target.x, target.y);
  await page.keyboard.press('Delete');
  await expect(shapeEls(page)).toHaveCount(1);

  // The arrow is not gone, and its end is where the deleted shape's side was.
  await expect(connectorEls(page)).toHaveCount(1);
  const dropped = await ends(page);
  expect(dropped.toKind).toBe('free'); // it belongs to the board now
  expect(dropped.fromKind).toBe('attached'); // the other end still means the shape
  expect(dropped.to.x).toBeCloseTo(400, 0);
  expect(dropped.to.y).toBeCloseTo(100, 0);

  // A reload is the proof that this is what was stored, not a lucky frame.
  await page.reload();
  await page.waitForSelector('[data-testid="viewport"]');
  await expect(connectorEls(page)).toHaveCount(1);
  const kept = await ends(page);
  expect(kept.toKind).toBe('free');
  expect(kept.fromKind).toBe('attached');
  expect(kept.to.x).toBeCloseTo(400, 0);
  expect(kept.to.y).toBeCloseTo(100, 0);

  // The surviving shape can still be joined afresh: losing a target leaves the
  // board nothing broken to work around.
  await deselect(page);
  await drawConnector(page, { x: a.x + a.width / 2, y: a.y + a.height / 2 }, { x: 500, y: 300 });
  await expect(connectorEls(page)).toHaveCount(2);
});

// Deleting an arrow and undoing that is the story 7 machinery's, because an arrow is
// an object: clicked to select it, deleted, brought back.
test('deletes a selected arrow and brings it back with undo', async ({ page }) => {
  await gotoBoard(page);
  const { a, b } = await twoShapes(page);
  await drawConnector(page, { x: a.x + a.width / 2, y: a.y + a.height / 2 }, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
  await deselect(page);

  // A click on the line itself selects the arrow - not the empty box around it.
  const cam = await getCamera(page);
  const middle = screenOf(cam, { x: 300, y: 100 });
  await page.mouse.click(middle.x, middle.y);
  await expect(async () => {
    expect((await ends(page)).selected).toBe('true');
  }).toPass();

  await page.keyboard.press('Delete');
  await expect(connectorEls(page)).toHaveCount(0);
  await expect(shapeEls(page)).toHaveCount(2); // the shapes it joined are untouched

  await page.keyboard.press('Control+z');
  await expect(async () => {
    await expect(connectorEls(page)).toHaveCount(1);
  }).toPass();
  const back = await ends(page);
  expect(back.fromKind).toBe('attached');
  expect(back.toKind).toBe('attached');
});

// The click rule in a real browser at real zoom levels: what counts as hitting an
// arrow is a fixed distance on the screen, whatever the zoom.
test('is clicked by a fixed screen distance from its line at 50% and at 200%', async ({ page }) => {
  await gotoBoard(page);

  // An arrow pinned to the board in empty space, with nothing else to click.
  await drawConnector(page, { x: 0, y: 0 }, { x: 400, y: 0 });
  await deselect(page);

  for (const zoom of [0.5, 2]) {
    // Put the arrow's middle in the middle of the screen, at this zoom.
    await setCamera(page, { x: 200 - 640 / zoom, y: 0 - 400 / zoom, zoom });
    const cam = await getCamera(page);
    expect(cam.zoom).toBeCloseTo(zoom, 2);
    const middle = screenOf(cam, { x: 200, y: 0 });

    await page.mouse.click(middle.x, middle.y + 200); // far from the line: the board
    await expect(async () => {
      expect((await ends(page)).selected).toBe('false');
    }).toPass();

    // 5 px off the line, on the screen, is a click on the arrow at either zoom.
    await page.mouse.click(middle.x, middle.y + 5);
    await expect(async () => {
      expect((await ends(page)).selected).toBe('true');
    }).toPass();

    // 30 px off it, on the screen, is a click on the board at either zoom - which at
    // 50% is 60 world units and at 200% is 15, and is nothing either way.
    await page.mouse.click(middle.x, middle.y + 30);
    await expect(async () => {
      expect((await ends(page)).selected).toBe('false');
    }).toPass();
  }
});

// An end can be re-pointed at another object, and let go in the air: the handles of
// a selected arrow, dragged.
test('re-points a selected arrow end onto another shape and lets it go', async ({ page }) => {
  await gotoBoard(page);
  const { a } = await twoShapes(page);
  // The third shape sits up and to the left, in the one part of the page that is
  // board and not chrome - the tool column down the left, the share button top
  // right and the zoom controls bottom right all take clicks of their own.
  await drawShape(page, { x: -350, y: -350 }, { x: -150, y: -150 });
  await deselect(page);
  const c = await shapeBox(page, 2);

  await drawConnector(page, { x: a.x + a.width / 2, y: a.y + a.height / 2 }, { x: 500, y: 100 });
  await deselect(page);

  // Select the arrow by clicking its line.
  await page.mouse.click(screenOf(await getCamera(page), { x: 300, y: 100 }).x, screenOf(await getCamera(page), { x: 300, y: 100 }).y);
  await expect(async () => {
    expect((await ends(page)).selected).toBe('true');
  }).toPass();

  // Drag the arrow's end onto the third shape. Halfway there the handle names the
  // object it is over: the board says which shape this end will belong to.
  const start = await endScreen(page, 'to');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const overC = screenOf(await getCamera(page), { x: c.x + c.width / 2, y: c.y + c.height / 2 });
  await page.mouse.move(overC.x, overC.y);
  // Halfway there the handle names the shape this end is about to belong to.
  await expect(page.getByTestId('connector-handle-to')).toHaveAttribute('data-target', c.id);
  await page.mouse.up();

  await expect(async () => {
    const moved = await ends(page);
    expect(moved.toKind).toBe('attached');
    // It leaves C's right side, the one facing the shape at the other end.
    expect(moved.to.x).toBeCloseTo(-150, 0);
    expect(moved.to.y).toBeCloseTo(-250, 0);
  }).toPass();

  // The other end was never touched, and is still the shape it was joined to - but
  // it has turned to face where the arrow now goes: an arrow between two shapes
  // leaves the sides that look at each other, so pointing an end up and to the left
  // sends the other end out of the shape's left edge rather than its right one.
  const after = await ends(page);
  expect(after.fromKind).toBe('attached');
  expect(after.from.x).toBeCloseTo(0, 0);
  expect(after.from.y).toBeCloseTo(100, 0);

  // Now let it go on empty board, well clear of every object.
  const grab = await endScreen(page, 'to');
  await dragScreen(page, grab, screenOf(await getCamera(page), { x: -450, y: 250 }));

  await expect(async () => {
    const released = await ends(page);
    expect(released.toKind).toBe('free');
    expect(released.to.x).toBeCloseTo(-450, 0);
    expect(released.to.y).toBeCloseTo(250, 0);
    expect(released.fromKind).toBe('attached'); // the other end is still an object
  }).toPass();
});
