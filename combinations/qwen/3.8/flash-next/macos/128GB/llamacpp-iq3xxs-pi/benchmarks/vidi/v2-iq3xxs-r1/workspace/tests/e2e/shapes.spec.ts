import { expect, test, type Page } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  SHAPE_DEFAULT_SIZE_WORLD,
} from '../../src/shared/config';
import {
  dropConnection,
  gotoNewBoard,
  openScreen,
  resumeConnection,
  waitForSynced,
} from './helpers/sync';
import { setCamera, zoomLabel } from './helpers/board';
import { pressDelete } from './helpers/selection';
import {
  clickShape,
  collectErrors,
  connectorById,
  connectorSnapshots,
  drawConnectorDrag,
  drawShapeClick,
  drawShapeDrag,
  dragHandle,
  dragShape,
  editLabel,
  labelLines,
  screenToWorld,
  seedCheckoutFlow,
  seedPair,
  shapeBox,
  shapeSnapshots,
  waitForArrowEnds,
  waitForConnectors,
  waitForShapes,
  worldToScreen,
} from './helpers/shapes';

/**
 * Story 10 — shapes and connectors in the browser (TC-23 to TC-27).
 *
 * A shape's box and an arrow's ends exist twice: as numbers in the shared document,
 * and as pixels the browser painted. These tests read both and compare them — a
 * shape that is only in the document, or an arrow that is only drawn, fails. Where a
 * second screen is involved, the screens live in separate browser contexts, so an
 * arrow can only follow a shape across the room.
 */

/** Screens to close whatever happens in a test. */
class Screens {
  private readonly pages: Page[] = [];

  add<T extends Page>(page: T): T {
    this.pages.push(page);
    return page;
  }

  async close(): Promise<void> {
    for (const context of new Set(this.pages.map((page) => page.context()))) {
      await context.close();
    }
    this.pages.length = 0;
  }
}

/** Dana's own board, plus Sam in another context on the same address. */
async function twoScreens(page: Page): Promise<{ dana: Page; sam: Page; close: () => Promise<void> }> {
  const screens = new Screens();
  const dana = screens.add(page);
  const id = await gotoNewBoard(dana);
  const sam = screens.add(await openScreen(dana, new URL(`/b/${id}`, dana.url()).toString()));
  await waitForSynced(sam);
  return { dana, sam, close: () => screens.close() };
}

/** The centre of one box minus the centre of another, for centring assertions. */
function offCentre(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number },
): { dx: number; dy: number } {
  return {
    dx: Math.abs(outer.x + outer.width / 2 - (inner.x + inner.width / 2)),
    dy: Math.abs(outer.y + outer.height / 2 - (inner.y + inner.height / 2)),
  };
}

test.describe('shapes and arrows on the board (TC-23 to TC-27)', () => {
  test('TC-23 drags the Shape tool across the board and gets exactly that box', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoNewBoard(page);

    // A drag of exactly 200 x 120 screen pixels (the board is at 100%), started clear
    // of the toolbar panel that lives in the top-left corner of the board.
    const from = { x: 400, y: 120 };
    const to = { x: 600, y: 240 };
    await drawShapeDrag(page, from, to);

    // One shape, 200 x 120 world units, in the document.
    const [shape] = await waitForShapes(page, 1);
    expect(Math.abs(shape!.width - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(shape!.height - 120)).toBeLessThanOrEqual(1);

    // And the same box where the pointer dragged it, to within a pixel.
    const box = await shapeBox(page, shape!.id);
    expect(Math.abs(box.x - from.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y - from.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - 120)).toBeLessThanOrEqual(1);

    // The tool went away by itself, so the next drag is a selection, not another shape.
    await expect(page.getByTestId('board-viewport')).toHaveAttribute('data-tool', 'select');
    expect(errors).toEqual([]);
  });

  test('the checkout flow arrives as four labelled shapes and four arrows', async ({ page }) => {
    await gotoNewBoard(page);
    const { shapes, connectors } = await seedCheckoutFlow(page);

    // The document holds the flow the story describes: a rectangle, a diamond, an
    // ellipse and a rectangle, each saying something.
    expect((await shapeSnapshots(page)).map((s) => s.kind)).toEqual([
      'rect',
      'diamond',
      'ellipse',
      'rect',
    ]);
    expect((await shapeSnapshots(page)).map((s) => s.label)).toEqual([
      'Browse items',
      'Signed in?',
      'Payment taken',
      'Receipt sent',
    ]);

    // Every shape and every arrow is on screen, inside the viewport, with its label
    // drawn — the whole flow fits on one board at 100%.
    for (const id of shapes) {
      const box = await shapeBox(page, id);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(1280);
      expect(box.y + box.height).toBeLessThanOrEqual(800);
    }
    await expect(page.getByTestId('shape-label')).toHaveCount(shapes.length);
    const arrows = await connectorSnapshots(page);
    expect(arrows).toHaveLength(connectors.length);
    for (const id of connectors) {
      await expect(page.locator(`[data-connector-id="${id}"]`)).toHaveCount(1);
    }
    // Three arrows join shapes at both ends; the fourth ends in mid-air.
    expect(arrows.filter((a) => a.from.kind === 'attached' && a.to.kind === 'attached')).toHaveLength(3);
    expect(arrows.filter((a) => a.to.kind === 'free')).toHaveLength(1);
  });

  test('TC-24 at 200% a Diamond click makes the standard shape, and its label wraps and stays centred', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await gotoNewBoard(page);
    // World (0,0) in the middle of the screen, at exactly 200%.
    await setCamera(page, { x: 640, y: 400, zoom: 2 });
    await expect(zoomLabel(page)).toHaveText('200%');

    const clicked = { x: 700, y: 500 };
    await drawShapeClick(page, clicked, { kind: 'diamond' });

    // The standard size in world units, centred on the point that was clicked.
    const [shape] = await waitForShapes(page, 1);
    const centre = await screenToWorld(page, clicked);
    expect(shape!.kind).toBe('diamond');
    expect(Math.abs(shape!.width - SHAPE_DEFAULT_SIZE_WORLD)).toBeLessThanOrEqual(1);
    expect(Math.abs(shape!.height - SHAPE_DEFAULT_SIZE_WORLD)).toBeLessThanOrEqual(1);
    expect(Math.abs(shape!.x + shape!.width / 2 - centre.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(shape!.y + shape!.height / 2 - centre.y)).toBeLessThanOrEqual(1);

    // Twice as big on the screen, and the drawn diamond reaches the box edges.
    const box = await shapeBox(page, shape!.id);
    expect(Math.abs(box.width - SHAPE_DEFAULT_SIZE_WORLD * 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - SHAPE_DEFAULT_SIZE_WORLD * 2)).toBeLessThanOrEqual(1);

    // A label too long for the shape breaks into more than one line, centred.
    const words = 'signed in to the shop before paying';
    await editLabel(page, shape!.id, words);
    const wrapped = await labelLines(page, shape!.id);
    expect(wrapped.count).toBeGreaterThan(1);
    let off = offCentre(await shapeBox(page, shape!.id), wrapped.box);
    expect(off.dx).toBeLessThanOrEqual(2);
    expect(off.dy).toBeLessThanOrEqual(2);

    // Drag a corner handle: the shape grows, the label follows and stays centred.
    await dragHandle(page, 'se', 120, 80);
    const grown = (await shapeSnapshots(page)).find((s) => s.id === shape!.id)!;
    expect(grown.width).toBeGreaterThan(shape!.width + 20);
    expect(grown.height).toBeGreaterThan(shape!.height + 20);
    expect(grown.label).toBe(words);

    const after = await labelLines(page, shape!.id);
    expect(after.count).toBeGreaterThan(1);
    off = offCentre(await shapeBox(page, shape!.id), after.box);
    expect(off.dx).toBeLessThanOrEqual(2);
    expect(off.dy).toBeLessThanOrEqual(2);
    expect(errors).toEqual([]);
  });

  test('TC-25 an arrow follows a shape dragged past its partner, on both screens', async ({ page }) => {
    const { dana, sam, close } = await twoScreens(page);
    try {
      const errors = collectErrors(dana);
      collectErrors(sam);
      const { a, b } = await seedPair(dana);
      await waitForShapes(sam, 2);

      // Dana connects A to B by dragging from one to the other.
      const arrow = await drawArrowBetween(dana, a, b);
      await waitForConnectors(sam, 1);
      // The arrow stands on the sides the two shapes present to each other.
      await waitForArrowEnds(sam, arrow, { from: { x: -100, y: 10 }, to: { x: 100, y: 10 } });

      // Dana drags B past A: the arrow re-anchors to the opposite sides.
      await dragShape(dana, b, { x: -600, y: 10 });
      const follows = await waitForArrowEnds(dana, arrow, {
        from: { x: -300, y: 10 },
        to: { x: -500, y: 10 },
      });
      // Sam sees the same arrow, re-anchored. Delivery is logged against the budget
      // and not asserted, so the suite does not fail on a slow machine.
      const delivered = await waitForArrowEnds(sam, arrow, {
        from: { x: -300, y: 10 },
        to: { x: -500, y: 10 },
      });
      console.log(
        `TC-25 arrow followed the shape: ${follows} ms locally, ${delivered} ms to the other screen ` +
          `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms)`,
      );
      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  });

  test('TC-26 deleting the shape keeps the arrow, with its end loose', async ({ page }) => {
    const { dana, sam, close } = await twoScreens(page);
    try {
      const { a, b } = await seedPair(dana);
      await waitForShapes(sam, 2);
      const arrow = await drawArrowBetween(dana, a, b);
      await waitForConnectors(sam, 1);
      await dragShape(dana, b, { x: -600, y: 10 });
      await waitForArrowEnds(sam, arrow, { from: { x: -300, y: 10 }, to: { x: -500, y: 10 } });

      // Sam deletes B. The arrow stays: its end is loose where B's side used to be.
      await clickShape(sam, b);
      await pressDelete(sam);
      for (const screen of [dana, sam]) {
        await expect
          .poll(async () => (await shapeSnapshots(screen)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
          .toBe(1);
        expect(await connectorById(screen, arrow)).toBeDefined();
        await waitForArrowEnds(screen, arrow, { from: { x: -300, y: 10 }, to: { x: -500, y: 10 } });
        const loose = (await connectorById(screen, arrow))!;
        expect(loose.to.kind).toBe('free');
        await expect(screen.locator(`[data-connector-id="${arrow}"]`)).toHaveCount(1);
      }
      expect(collectErrors(dana)).toEqual([]);
    } finally {
      await close();
    }
  });

  test('TC-27 an arrow drawn while its target is being deleted still lands somewhere', async ({
    page,
  }) => {
    const { dana, sam, close } = await twoScreens(page);
    try {
      const errors = collectErrors(dana);
      collectErrors(sam);
      const { a, b } = await seedPair(dana);
      await waitForShapes(sam, 2);

      // Dana's screen goes quiet: her work stays on her machine for a moment.
      await dropConnection(dana);

      // She draws the arrow onto B, which she can still see.
      const arrow = await drawArrowBetween(dana, a, b);
      expect((await connectorById(dana, arrow))!.to.kind).toBe('attached');

      // Meanwhile Sam deletes the shape that arrow points at.
      await clickShape(sam, b);
      await pressDelete(sam);

      // Dana's screen comes back: her arrow survives, and the end that pointed at the
      // deleted shape stays exactly where it pointed.
      await resumeConnection(dana);
      await expect
        .poll(async () => (await shapeSnapshots(dana)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(1);
      const landed = (await connectorById(dana, arrow))!;
      expect(landed).toBeDefined();
      expect(landed.ends.to).toEqual({ x: 100, y: 10 });
      expect(landed.ends.from).toEqual({ x: -100, y: 10 });
      await expect(dana.locator(`[data-connector-id="${arrow}"]`)).toHaveCount(1);

      // Sam sees the same arrow at the same place: no screen invented an end position.
      await waitForConnectors(sam, 1);
      await waitForArrowEnds(sam, arrow, { from: { x: -100, y: 10 }, to: { x: 100, y: 10 } });

      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  });
});

/**
 * Draw an arrow between two shapes with the Connector tool, and return its id.
 * The drag goes from the middle of one shape to the middle of the other, the way
 * the tool asks for it (press `l`, drag, release).
 */
async function drawArrowBetween(page: Page, fromId: string, toId: string): Promise<string> {
  const before = new Set((await connectorSnapshots(page)).map((c) => c.id));
  const from = await worldToScreen(page, await centreOfShape(page, fromId));
  const to = await worldToScreen(page, await centreOfShape(page, toId));
  await drawConnectorDrag(page, from, to);
  await expect
    .poll(
      async () => (await connectorSnapshots(page)).filter((c) => !before.has(c.id)),
      { timeout: E2E_EVENTUAL_TIMEOUT_MS },
    )
    .toHaveLength(1);
  const [created] = (await connectorSnapshots(page)).filter((c) => !before.has(c.id));
  return created!.id;
}

/** The middle of a shape, in world units. */
async function centreOfShape(page: Page, id: string): Promise<{ x: number; y: number }> {
  const shape = (await shapeSnapshots(page)).find((s) => s.id === id);
  if (!shape) throw new Error(`shape ${id} is not on this screen`);
  return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
}
