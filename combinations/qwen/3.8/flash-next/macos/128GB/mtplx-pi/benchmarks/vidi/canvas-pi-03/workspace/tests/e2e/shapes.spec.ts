// Story 10 — draw shapes and connect them with arrows that follow, in a real
// browser.
//
// What the story is about only exists in the browser: a drag that becomes a
// shape of the dragged size, an arrow that stays welded to a box while that box
// is dragged across the board, and a second person watching the same arrows move
// at the same time. So every gesture here is a real Playwright pointer sequence
// on the real board; the document is only read back afterwards through the
// test-only window.__vidi6 hook, which is how a test can say "the arrow's end
// moved by exactly the box's move" instead of "the picture changed".
//
// Seeds are placed by SCREEN point and converted to world coordinates through
// the live camera, so nothing depends on where the default camera happens to
// put the origin: what a test aims at is what it sees.

import { expect, test, type Page } from '@playwright/test';
import {
  connectorByld,
  connectorEnds,
  connectors,
  createBoard,
  mouseDrag,
  objectBox,
  objectCenter,
  openBoard,
  screenToWorld,
  seedConnector,
  seedShape,
  shapes,
  toolState,
} from './helpers/board';
import { openRoom, waitConverged } from './helpers/live';
import { SHAPE_DEFAULT_SIZE_WORLD } from '../../src/shared/config';

type Spot = { x: number; y: number };

/** Seed a shape at a PAGE point (CSS pixels), wherever the camera looks. */
async function seedShapeAt(page: Page, spot: Spot, kind?: string, label?: string): Promise<string> {
  const world = await screenToWorld(page, spot);
  const id = await seedShape(page, world.x, world.y, kind, label);
  if (id === null) throw new Error('seedShape created nothing');
  await expect
    .poll(() => page.evaluate((i) => document.querySelector(`[data-shape-id="${i}"]`) !== null, id), { timeout: 5_000 })
    .toBe(true);
  return id;
}

/** Seed an arrow between two ids. */
async function seedArrow(page: Page, from: string, to: string): Promise<string> {
  const id = await seedConnector(page, from, to);
  if (id === null) throw new Error('seedConnector created nothing');
  await expect
    .poll(() => page.evaluate((i) => document.querySelector(`[data-connector-id="${i}"]`) !== null, id), {
      timeout: 5_000,
    })
    .toBe(true);
  return id;
}

/** An arrow's two drawn ends, in world units. */
async function arrowEnds(page: Page, id: string) {
  const ends = await connectorEnds(page, id);
  if (!ends) throw new Error(`connector ${id} is gone`);
  return ends;
}

/** Drag from one page point to another. */
async function drag(page: Page, from: Spot, to: Spot): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test('TC-41 the Shape tool draws the kind the palette shows, and spends itself', async ({ page }) => {
  await openBoard(page);

  // S arms the Shape tool: the palette's Shape button reads as pressed and a
  // full-board layer takes the pointer.
  await page.keyboard.press('s');
  await expect.poll(() => toolState(page)).toBe('shape');
  await expect(page.getByTestId('tool-shape')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('shape-kind-menu')).toBeVisible();

  // A drag draws a rectangle of the dragged size — not a sticky note, and not
  // a marquee: the tool owns the press.
  await drag(page, { x: 420, y: 260 }, { x: 600, y: 420 });

  await expect.poll(() => toolState(page)).toBe('select');
  await expect.poll(() => shapes(page).then((s) => s.length), { timeout: 5_000 }).toBe(1);
  const drawn = (await shapes(page))[0];
  expect(drawn.kind).toBe('rect');

  // The released rectangle became the shape: at zoom 1 a 180x160 px drag is a
  // 180x160 box.
  const cam = await page.evaluate(() => window.__vidi6!.getCamera());
  expect(drawn.width).toBeCloseTo(180 / cam.zoom, 0);
  expect(drawn.height).toBeCloseTo(160 / cam.zoom, 0);

  // Re-arming and picking Ellipse changes what the next drag draws: the Shape
  // tool is one tool with three modes, and the kind survives between shapes.
  await page.keyboard.press('s');
  await page.getByTestId('shape-kind-ellipse').click();
  await expect(page.getByTestId('shape-kind-ellipse')).toHaveAttribute('aria-pressed', 'true');
  await drag(page, { x: 700, y: 200 }, { x: 860, y: 340 });
  await expect.poll(() => shapes(page).then((s) => s.length), { timeout: 5_000 }).toBe(2);
  expect((await shapes(page)).map((s) => s.kind)).toEqual(['rect', 'ellipse']);
  expect(await toolState(page)).toBe('select');
});

test('TC-42 a press that never becomes a drag still places a shape', async ({ page }) => {
  await openBoard(page);
  await page.keyboard.press('s');

  // A click is a shape too: the default box, centred on the point it started
  // at.
  await page.mouse.click(500, 300);
  await expect.poll(() => shapes(page).then((s) => s.length), { timeout: 5_000 }).toBe(1);
  const click = (await shapes(page))[0];
  expect(click.width).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD / (await page.evaluate(() => window.__vidi6!.getCamera())).zoom, 0);
  expect(click.height).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD, 0);

  // Shift squares the drag up: both sides take the longer one.
  await page.keyboard.press('s');
  await page.keyboard.down('Shift');
  await page.mouse.move(760, 420);
  await page.mouse.down();
  await page.mouse.move(900, 470, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(() => shapes(page).then((s) => s.length), { timeout: 5_000 }).toBe(2);
  const squared = (await shapes(page))[1];
  expect(Math.abs(squared.width - squared.height)).toBeLessThan(2);
});

test('TC-45 an arrow is drawn from a shape to a shape and sticks to both', async ({ page }) => {
  await openBoard(page);
  const spotA = { x: 420, y: 300 };
  const spotB = { x: 800, y: 360 };

  const a = await seedShapeAt(page, spotA);
  const b = await seedShapeAt(page, spotB);

  await page.keyboard.press('l');
  await expect.poll(() => toolState(page)).toBe('connector');
  await expect(page.getByTestId('connector-tool-layer')).toBeVisible();

  // Hovering a shape shows its four side midpoints: the arrow will pick one.
  await page.mouse.move(spotA.x, spotA.y);
  await expect(page.getByTestId('connector-dot')).toHaveCount(4);

  // Drag from A to B: both ends attach.
  await drag(page, spotA, spotB);
  await expect.poll(() => connectors(page).then((c) => c.length), { timeout: 5_000 }).toBe(1);
  const arrow = (await connectors(page))[0];
  expect(arrow.from?.kind).toBe('attached');
  expect(arrow.to?.kind).toBe('attached');
  expect(arrow.from?.objectId).toBe(a);
  expect(arrow.to?.objectId).toBe(b);
  expect(await toolState(page)).toBe('select');

  // The arrow is drawn between the two boxes, not between their centres.
  await expect(connectorByld(page, arrow.id)).toBeVisible();
});

test('TC-55 a moved shape takes its arrows with it, for both people', async ({ page, browser }) => {
  const room = await createBoard(page.request);
  await openRoom(page, room);

  const a = await seedShapeAt(page, { x: 380, y: 300 }, 'rect', 'Discovery');
  const b = await seedShapeAt(page, { x: 820, y: 340 });
  const arrow = await seedArrow(page, a, b);

  // A second person on the same board, before anything moves.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const other = await ctx.newPage();
  await openRoom(other, room);
  await expect.poll(() => connectors(other).then((c) => c.length), { timeout: 10_000 }).toBe(1);
  await expect.poll(() => shapes(other).then((s) => s.length), { timeout: 10_000 }).toBe(2);

  const startEnds = await arrowEnds(page, arrow);
  const boxA = await objectBox(page, a);

  // Drag A down-right with a real pointer gesture. Its arrow must follow.
  await mouseDrag(page, boxA.x + boxA.width / 2, boxA.y + boxA.height / 2, 140, 90);
  await waitConverged([page, other]);

  const endEnds = await arrowEnds(page, arrow);
  const cam = await page.evaluate(() => window.__vidi6!.getCamera());
  // The end welded to A moved with it (the anchor may switch to another side,
  // so the tolerance is generous — what must not happen is standing still).
  expect(Math.abs(endEnds.from.x - startEnds.from.x - 140 / cam.zoom)).toBeLessThan(40);
  expect(Math.abs(endEnds.from.y - startEnds.from.y - 90 / cam.zoom)).toBeLessThan(40);
  // The far end did not move: only A moved.
  expect(Math.abs(endEnds.to.x - startEnds.to.x)).toBeLessThan(1);
  expect(Math.abs(endEnds.to.y - startEnds.to.y)).toBeLessThan(1);

  // The other person's arrows moved with it: one board, not two drawings.
  expect(await arrowEnds(other, arrow)).toEqual(endEnds);

  // And it is still the same arrow after a reload, welded to the same boxes.
  await page.reload();
  await expect.poll(() => connectors(page).then((c) => c.length), { timeout: 10_000 }).toBe(1);
  expect((await connectors(page))[0].from?.objectId).toBe(a);
  await ctx.close();
});

test('TC-46 a selected shape gets its colours, and they persist', async ({ page }) => {
  await openBoard(page);
  const id = await seedShapeAt(page, { x: 500, y: 300 });

  // One click selects it, and the style bar appears above it.
  const center = await objectCenter(page, id);
  await page.mouse.click(center.x, center.y);
  const bar = page.getByTestId('shape-toolbar');
  await expect(bar).toBeVisible({ timeout: 5_000 });
  await expect(bar.getByRole('button', { name: 'Blue fill' })).toBeVisible();

  // The current fill is marked, the new one takes over on click, and the
  // document holds the change.
  await expect(bar.getByRole('button', { name: 'White fill' })).toHaveAttribute('aria-pressed', 'true');
  await bar.getByRole('button', { name: 'Blue fill' }).click();
  await expect(bar.getByRole('button', { name: 'Blue fill' })).toHaveAttribute('aria-pressed', 'true');
  expect((await shapes(page)).find((s) => s.id === id)?.fill).toBe('blue');

  // An outline change is the same kind of edit, and both survive a reload.
  await bar.getByRole('button', { name: 'Red outline' }).click();
  expect((await shapes(page)).find((s) => s.id === id)?.stroke).toBe('red');

  await page.reload();
  await expect
    .poll(() => shapes(page).then((s) => s.find((o) => o.id === id)?.fill), { timeout: 10_000 })
    .toBe('blue');
  expect((await shapes(page)).find((s) => s.id === id)?.stroke).toBe('red');
});

test('TC-44 a shape and an arrow drawn here are the same shape and arrow there', async ({ page, browser }) => {
  const room = await createBoard(page.request);
  await openRoom(page, room);

  // Draw a rectangle and connect it to a seeded diamond, with real pointers.
  await page.keyboard.press('s');
  await drag(page, { x: 360, y: 220 }, { x: 500, y: 330 });
  await expect.poll(() => shapes(page).then((s) => s.length), { timeout: 5_000 }).toBe(1);

  const diamond = await seedShapeAt(page, { x: 880, y: 360 }, 'diamond');
  await page.keyboard.press('l');
  const first = await objectCenter(page, (await shapes(page))[0].id);
  const second = await objectCenter(page, diamond);
  await drag(page, first, second);
  await expect.poll(() => connectors(page).then((c) => c.length), { timeout: 5_000 }).toBe(1);

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const other = await ctx.newPage();
  await openRoom(other, room);
  await expect.poll(() => shapes(other).then((s) => s.length), { timeout: 10_000 }).toBe(2);
  await expect.poll(() => connectors(other).then((c) => c.length), { timeout: 10_000 }).toBe(1);

  // Same ids, same kinds, same anchor.
  const here = await shapes(page);
  const there = await shapes(other);
  expect(there.map((s) => [s.id, s.kind])).toEqual(here.map((s) => [s.id, s.kind]));
  const arrow = (await connectors(other))[0];
  expect(arrow.from?.kind).toBe('attached');
  expect(arrow.to?.objectId).toBe(diamond);

  // Move the diamond here: the arrow there follows the same box.
  const before = await arrowEnds(other, arrow.id);
  const box = await objectBox(page, diamond);
  await mouseDrag(page, box.x + box.width / 2, box.y + box.height / 2, -120, 40);
  await waitConverged([page, other]);
  const after = await arrowEnds(other, arrow.id);
  expect(Math.abs(after.to.x - before.to.x + 120)).toBeGreaterThan(20);
  await ctx.close();
});

test('TC-47 an arrow can be picked and deleted, and Escape leaves the tool', async ({ page }) => {
  await openBoard(page);
  const a = await seedShapeAt(page, { x: 360, y: 280 });
  const b = await seedShapeAt(page, { x: 820, y: 380 });
  const arrow = await seedArrow(page, a, b);

  // The line is pickable where it is drawn, not only inside its box.
  const ends = await connectorEnds(page, arrow);
  const mid = { x: (ends.from.x + ends.to.x) / 2, y: (ends.from.y + ends.to.y) / 2 };
  const midScreen = await page.evaluate((p) => window.__vidi6!.worldToScreen(p), mid);
  await page.mouse.click(midScreen.x, midScreen.y);
  await expect
    .poll(() => page.evaluate(() => window.__vidi6!.selection()), { timeout: 5_000 })
    .toEqual([arrow]);

  await page.keyboard.press('Delete');
  await expect.poll(() => connectors(page).then((c) => c.length), { timeout: 5_000 }).toBe(0);
  // The shapes it joined are untouched.
  expect((await shapes(page)).length).toBe(2);

  // Escape leaves the Connector tool without drawing anything.
  await page.keyboard.press('l');
  await expect.poll(() => toolState(page)).toBe('connector');
  await page.keyboard.press('Escape');
  await expect.poll(() => toolState(page)).toBe('select');
  const world = await page.evaluate(() => window.__vidi6!.worldToScreen({ x: 100, y: 100 }));
  await page.mouse.click(world.x, world.y);
  expect((await connectors(page)).length).toBe(0);
});

test('TC-48 deleting a shape takes the arrows attached to it', async ({ page }) => {
  await openBoard(page);
  const a = await seedShapeAt(page, { x: 380, y: 300 });
  const b = await seedShapeAt(page, { x: 820, y: 360 });
  await seedArrow(page, a, b);
  await expect.poll(() => connectors(page).then((c) => c.length), { timeout: 5_000 }).toBe(1);

  const center = await objectCenter(page, a);
  await page.mouse.click(center.x, center.y);
  await page.keyboard.press('Delete');

  await expect.poll(() => shapes(page).then((s) => s.length), { timeout: 5_000 }).toBe(1);
  // The arrow hung on the deleted box goes with it: an arrow with one end in
  // the air would hang off nothing.
  await expect.poll(() => connectors(page).then((c) => c.length), { timeout: 5_000 }).toBe(0);
});
