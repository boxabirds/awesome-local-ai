import { expect, test, type Browser, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { shapeBox, type FlowIds } from '../fixtures/checkout-flow';
import { openBoard, setCamera, settle } from './helpers/board';
import { Cast, logLatency, measureChange, type Person } from './helpers/participants';
import { seedCheckoutFlow } from './helpers/room-client';
import {
  dragHandleBy,
  dragObjectBy,
  outlineIds,
  screenOf,
} from './helpers/selection';
import {
  armShape,
  armTool,
  arrowIds,
  arrowState,
  type ArrowState,
  beginArrow,
  clickNearArrow,
  clickShape,
  connectorPreview,
  DEFAULT_SHAPE_SIDE,
  drawnBox,
  drawArrow,
  drawShape,
  finishArrow,
  labelBox,
  labelLines,
  openLabelEditor,
  pressDelete,
  selectById,
  shapeIds,
  shapeState,
  stopLabelEditing,
  waitForArrow,
  waitForArrowCount,
  waitForShapeCount,
  waitForShapeGone,
} from './helpers/shapes';

/// <reference path="../../src/client/testHooks.ts" />

/**
 * Story 10, end to end: shapes drawn with a mouse, arrows pulled between them, and arrows that go
 * where their shapes go - in a browser, and in two of them at once.
 *
 * What a browser is the only witness to: that a drag really produces a shape the box the mouse swept
 * out; that text laid out at 200% inside a shape of a given width breaks into lines and is drawn
 * centred, before and after a resize by handle; that an arrow's *drawn* ends are where the shapes they
 * are fastened to now are, on a second screen a moment later; that a click five pixels off a line
 * selects it and seven does not, at two zooms; and that a delete racing an arrow in mid-air leaves an
 * arrow on both boards and nothing in either console.
 *
 * Where a test needs a shape by name it asks the fixture where that shape is; wherever it needs an
 * arrow it asks the arrow - the element on the screen - because the story is about what the drawing
 * does, not about which fields the document happens to hold.
 */

/** The design's tolerance: the board is right to within a pixel of where it says it is. */
const PX = 1;

/** A board two people are looking at, with the checkout flow drawn on it. */
async function flowBoard(browser: Browser): Promise<{ cast: Cast; ids: FlowIds }> {
  const cast = await Cast.open(browser, 'Dana', 'Sam');
  // The flow arrives over the room, the way anybody else's drawing would: both people were already
  // looking at the board, so it comes to them as an update rather than as a page load.
  const first = cast.people[0];
  if (first === undefined) {
    throw new Error('a board with nobody on it is not a test of collaboration');
  }
  const ids = await seedCheckoutFlow(await roomSocket(first.page, cast.boardId));
  for (const person of cast.people) {
    await waitForShapeCount(person.page, 4);
    await waitForArrowCount(person.page, 4);
  }
  return { cast, ids };
}

/** The room's address for a board, in the form the browser in front of it is using. */
async function roomSocket(page: Page, boardId: string): Promise<string> {
  const origin = await page.evaluate(() => window.location.origin);
  return `${origin.replace(/^http/, 'ws')}/api/rooms/${boardId}`;
}

/** Point the camera at a board point, at a zoom, and wait for the board to have redrawn. */
async function aimCamera(page: Page, world: { x: number; y: number }, zoom: number): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  await setCamera(page, {
    x: world.x - viewport.width / 2 / zoom,
    y: world.y - viewport.height / 2 / zoom,
    zoom,
  });
  await settle(page);
}

/** The two people of a cast, spelled out so no test has a `[0]` that might not be there. */
function danaAndSam(cast: Cast): { dana: Person; sam: Person } {
  return { dana: cast.by('Dana'), sam: cast.by('Sam') };
}

test.describe('drawing shapes with the mouse (TC-23)', () => {
  test('a drag draws a shape exactly the box the mouse swept out (TC-23)', async ({ page }) => {
    await openBoard(page);

    // The design's own numbers, read as board coordinates. In screen pixels the top-left of that box
    // is where the toolbar is bolted, and a test whose drag started on a button would be a test about
    // a mouse landing on a button; what is measured - that the shape is the drag - does not care which
    // patch of board it happens on.
    const from = { x: 100, y: 100 };
    const to = { x: 300, y: 220 };
    await armShape(page, 'rect');
    const id = await drawShape(page, await screenOf(page, from), await screenOf(page, to));

    const shape = await shapeState(page, id);
    expect(shape.kind).toBe('rect');
    expect(shape.x).toBeCloseTo(from.x, 0);
    expect(shape.y).toBeCloseTo(from.y, 0);
    expect(shape.width).toBeCloseTo(to.x - from.x, 0);
    expect(shape.height).toBeCloseTo(to.y - from.y, 0);

    // And the same box as it stands on the screen, which is the half of the claim no unit test can
    // make: that what the board holds is what the board shows.
    const drawn = await drawnBox(page, id);
    const expected = await screenOf(page, from);
    expect(Math.abs(drawn.x - expected.x)).toBeLessThanOrEqual(PX);
    expect(Math.abs(drawn.y - expected.y)).toBeLessThanOrEqual(PX);
    expect(Math.abs(drawn.width - (to.x - from.x))).toBeLessThanOrEqual(PX);
    expect(Math.abs(drawn.height - (to.y - from.y))).toBeLessThanOrEqual(PX);

    // The shape comes back as the whole selection, and the tool steps aside - as a sticky note does.
    await expect.poll(() => outlineIds(page)).toEqual([id]);

    // One press of undo is one shape: the drawing was one thing that happened.
    await page.getByTestId('undo').click();
    await settle(page);
    await waitForShapeCount(page, 0);
  });

  test('the box being drawn is on the board while the mouse is down, and nothing is written yet', async ({
    page,
  }) => {
    await openBoard(page);
    await armShape(page, 'rect');

    const from = await screenOf(page, { x: -200, y: -200 });
    const to = await screenOf(page, { x: 0, y: -60 });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });

    const preview = await drawnPreviewBox(page);
    expect(preview.width).toBeGreaterThan(1);
    expect(preview.height).toBeGreaterThan(1);
    expect(Math.abs(preview.width - (to.x - from.x))).toBeLessThanOrEqual(PX);
    expect(await shapeIds(page)).toHaveLength(0);

    // A double-click is the board's way of making a sticky note, and the Shape tool is the reason it
    // does not: a shape in progress is not a note, whatever the mouse did in the middle of it.
    // Let go, and the shape is drawn; the tool steps aside, and has to be put up again for the next one.
    await page.mouse.up();
    await armShape(page, 'rect');
    const at = await screenOf(page, { x: 400, y: 200 });
    await page.mouse.dblclick(at.x, at.y);
    await settle(page);
    expect(await page.locator('[data-testid="sticky-note"]').count()).toBe(0);
  });

  test('Shift holds the shape square, from the corner the drag started at (TC-23, TC-04)', async ({
    page,
  }) => {
    await openBoard(page);
    await armShape(page, 'rect');

    const from = { x: 40, y: -60 };
    const to = { x: 240, y: 40 }; // 200 x 100 swept out, of which the square keeps the 200
    const id = await drawShape(page, await screenOf(page, from), await screenOf(page, to), {
      shift: true,
    });

    const shape = await shapeState(page, id);
    expect(shape.width).toBeCloseTo(200, 0);
    expect(shape.height).toBeCloseTo(200, 0);
    expect(shape.x).toBeCloseTo(from.x, 0);
    expect(shape.y).toBeCloseTo(from.y, 0);
  });

  test('a press that never drags makes the default shape, centred on the point (TC-23, TC-05)', async ({
    page,
  }) => {
    await openBoard(page);
    await armShape(page, 'ellipse');

    const at = { x: 60, y: 40 };
    const id = await clickShape(page, await screenOf(page, at));

    const shape = await shapeState(page, id);
    expect(shape.kind).toBe('ellipse');
    expect(shape.width).toBeCloseTo(DEFAULT_SHAPE_SIDE, 0);
    expect(shape.height).toBeCloseTo(DEFAULT_SHAPE_SIDE, 0);
    expect(shape.x).toBeCloseTo(at.x - DEFAULT_SHAPE_SIDE / 2, 0);
    expect(shape.y).toBeCloseTo(at.y - DEFAULT_SHAPE_SIDE / 2, 0);

    // The drawing is where the pencil goes: at 50% the same default shape is drawn half as big on the
    // screen and is the same size on the board.
    await aimCamera(page, at, 0.5);
    const small = await drawnBox(page, id);
    expect(Math.abs(small.width - DEFAULT_SHAPE_SIDE * 0.5)).toBeLessThanOrEqual(PX);
    expect((await shapeState(page, id)).width).toBeCloseTo(DEFAULT_SHAPE_SIDE, 0);
  });

  test('a shape too small to be one becomes the default shape where the pointer was', async ({
    page,
  }) => {
    await openBoard(page);
    await armShape(page, 'rect');

    // A drag of three screen pixels, which is a mouse that slipped rather than a shape being drawn.
    const at = await screenOf(page, { x: -100, y: 100 });
    const id = await drawShape(page, at, { x: at.x + 3, y: at.y + 3 });
    const shape = await shapeState(page, id);
    expect(shape.width).toBeCloseTo(DEFAULT_SHAPE_SIDE, 0);
    expect(shape.height).toBeCloseTo(DEFAULT_SHAPE_SIDE, 0);
  });
});

test.describe('a label inside a shape, laid out by a browser (TC-24)', () => {
  test('at 200% a click makes a 160 x 160 diamond, its label wraps and is centred, and stays centred when resized (TC-24)', async ({
    page,
  }) => {
    await openBoard(page);
    await aimCamera(page, { x: 0, y: 0 }, 2);

    const at = { x: 40, y: -30 };
    await armShape(page, 'diamond');
    const id = await clickShape(page, await screenOf(page, at));

    // The world side is the default whatever the zoom, and the drawn side is that doubled.
    const shape = await shapeState(page, id);
    expect(shape.kind).toBe('diamond');
    expect(shape.width).toBeCloseTo(DEFAULT_SHAPE_SIDE, 0);
    expect(shape.height).toBeCloseTo(DEFAULT_SHAPE_SIDE, 0);
    expect(shape.x).toBeCloseTo(at.x - DEFAULT_SHAPE_SIDE / 2, 0);
    expect(shape.y).toBeCloseTo(at.y - DEFAULT_SHAPE_SIDE / 2, 0);
    const drawn = await drawnBox(page, id);
    expect(Math.abs(drawn.width - DEFAULT_SHAPE_SIDE * 2)).toBeLessThanOrEqual(PX);

    // A label longer than the shape is wide, in words rather than newlines: every line break in it is
    // one the browser made.
    const words = 'ask the cashier at the counter to reprint it';
    await openLabelEditor(page, id);
    await page.keyboard.type(words);
    await stopLabelEditing(page);
    expect((await shapeState(page, id)).label).toBe(words);

    const wrapped = await labelLines(page, id);
    expect(
      wrapped.length,
      'a label longer than the shape is drawn as more than one line',
    ).toBeGreaterThan(1);
    await expectLinesCentred(page, id);

    // Resize it by a handle, through the board's own selection. The words are the same words, they
    // are still broken into lines, and they are still down the middle of the shape.
    await dragHandleBy(page, 'se', { x: 120, y: 120 });
    await settle(page);
    const grown = await shapeState(page, id);
    expect(grown.width).toBeGreaterThan(shape.width + 100);
    expect((await shapeState(page, id)).label).toBe(words);

    const reflowed = await labelLines(page, id);
    expect(
      reflowed.length,
      'the label is still drawn as more than one line after the resize',
    ).toBeGreaterThan(1);
    expect(
      reflowed.length,
      'a wider shape fits more in a line, so the same words take the same number of lines or fewer',
    ).toBeLessThanOrEqual(wrapped.length);
    expect(
      widest(reflowed),
      'and the lines it does take are drawn wider, which is what a re-layout looks like',
    ).toBeGreaterThanOrEqual(widest(wrapped));
    await expectLinesCentred(page, id);
  });
});

test.describe('an arrow is clicked on, not aimed at (TC-20)', () => {
  test('five pixels from the line is a click on the arrow and seven is not, at 50% and at 200%', async ({
    page,
  }) => {
    await openBoard(page);
    await armShape(page, 'rect');
    const left = await drawShape(
      page,
      await screenOf(page, { x: -260, y: -60 }),
      await screenOf(page, { x: -60, y: 60 }),
    );
    // A drawn shape puts the Select tool back up, exactly as a dropped sticky note does, so the second
    // shape is drawn by a tool that has to be asked for again.
    await armShape(page, 'rect');
    const right = await drawShape(
      page,
      await screenOf(page, { x: 140, y: -60 }),
      await screenOf(page, { x: 340, y: 60 }),
    );

    await armTool(page, 'connector');
    const arrow = await drawArrow(
      page,
      await screenOf(page, { x: -100, y: 0 }),
      await screenOf(page, { x: 180, y: 0 }),
    );

    // The arrow is fastened to the two shapes, and drawn between the sides of them that face each
    // other: which is the claim about the drawing that the rest of this test's clicks depend on.
    const drawn = await arrowState(page, arrow);
    expect(drawn).toMatchObject({ fromEnd: 'attached', toEnd: 'attached', fromTarget: left, toTarget: right });
    expect(drawn.fromX).toBeCloseTo(-60, 0);
    expect(drawn.toX).toBeCloseTo(140, 0);

    for (const zoom of [0.5, 2]) {
      await aimCamera(page, { x: 40, y: 0 }, zoom);
      for (const [pixels, chosen] of [
        [5, true],
        [7, false],
      ] as const) {
        const taken = await clickNearArrow(page, arrow, pixels, { x: 40, y: -120 });
        expect(
          taken,
          `a click ${String(pixels)} pixels off the line, at ${String(zoom * 100)}% zoom, should ${
            chosen ? '' : 'not '
          }take the arrow`,
        ).toBe(chosen);
      }
    }
  });
});

test.describe('two people rearranging the flow (TC-25, TC-26)', () => {
  test('an arrow follows the shape it is fastened to, and changes side when that shape passes the other end (TC-25)', async ({
    browser,
  }) => {
    const { cast, ids } = await flowBoard(browser);
    const { dana, sam } = danaAndSam(cast);

    // Dana pulls an arrow from one shape to another, with her own mouse.
    await armTool(dana.page, 'connector');
    const arrow = await drawArrow(
      dana.page,
      await screenOf(dana.page, { x: shapeBox('reason').x + 40, y: shapeBox('reason').y + 40 }),
      await screenOf(dana.page, {
        x: shapeBox('receipt').x + shapeBox('receipt').width - 40,
        y: shapeBox('receipt').y + 40,
      }),
    );

    // Sam sees the arrow, fastened to both shapes - which is the drawing arriving, not the document
    // being read.
    const onSam = await waitForArrow(sam.page, arrow);
    expect(onSam).toMatchObject({
      fromEnd: 'attached',
      toEnd: 'attached',
      fromTarget: ids.shapes.reason,
      toTarget: ids.shapes.receipt,
    });

    // Fastened to a *side*: the end on the receipt is drawn on the side of it that faces the other
    // shape, which is the top edge, because the reason is above and to the right of it.
    const receipt = shapeBox('receipt');
    expect(
      onSam.toY,
      'the end of an arrow is drawn on the side of the shape that faces the other end',
    ).toBeCloseTo(receipt.y, 0);

    // Dana drags the receipt across and above the reason, past the end the arrow came from. Sam's
    // arrow goes with it, and its end comes round to the side of the shape that now faces the reason.
    const facing = { x: receipt.x + 640, y: receipt.y - 300 + receipt.height / 2 };
    await measureChange(
      'an arrow end following its shape onto a second screen',
      async () => {
        await dragObjectBy(dana.page, ids.shapes.receipt, { x: 640, y: -300 });
      },
      async () => {
        const now = await arrowState(sam.page, arrow);
        return Math.abs(now.toX - facing.x) <= 0.51 && Math.abs(now.toY - facing.y) <= 0.51;
      },
    );

    const after = await arrowState(sam.page, arrow);
    expect(after.toEnd).toBe('attached');
    expect(after.toTarget).toBe(ids.shapes.receipt);
    // The end is on the left of the moved shape, at its middle height: the side, not the corner and
    // not the centre of the box.
    expect(after.toX).toBeCloseTo(receipt.x + 640, 0);
    expect(after.toY).toBeCloseTo(receipt.y - 300 + receipt.height / 2, 0);

    // Both screens are drawing the same arrow, and Dana's arrow that was already on the board when
    // the fixture arrived followed along too.
    expect(await arrowEndsAgree(dana.page, sam.page, arrow)).toBe(true);
    expect(await arrowEndsAgree(sam.page, dana.page, ids.connectors.approved)).toBe(true);
    const fixture = await arrowState(sam.page, ids.connectors.approved);
    expect(fixture).toMatchObject({ fromEnd: 'attached', toEnd: 'attached' });
    expect(await arrowIds(sam.page)).toHaveLength(5);
  });

  test('deleting a shape leaves its arrows behind, with the end let go where that shape’s side was (TC-26)', async ({
    browser,
  }) => {
    const { cast, ids } = await flowBoard(browser);
    const { dana, sam } = danaAndSam(cast);
    const declined = shapeBox('declined');

    // The three arrows fastened to the shape that is about to go, and the one that was never near it.
    const attached = [ids.connectors.toAsk, ids.connectors.approved, ids.connectors.declinedAgain];
    for (const id of attached) {
      const before = await arrowState(sam.page, id);
      expect(before).toMatchObject({ fromEnd: 'attached', toEnd: 'attached' });
    }

    // Sam deletes the shape. The arrows are not asked about, and they do not go.
    await selectById(sam.page, ids.shapes.declined);
    await pressDelete(sam.page);
    for (const person of cast.people) {
      await waitForShapeGone(person.page, ids.shapes.declined);
      await waitForArrowCount(person.page, 4);
    }

    for (const person of cast.people) {
      for (const id of attached) {
        const arrow = await arrowState(person.page, id);
        const end = arrow.fromTarget === '' ? 'from' : 'to';
        const kept = await endPoint(arrow, end === 'from' ? 'from' : 'to');
        expect(
          near(kept, declinedAnchor(declined, kept)),
          `on ${person.name}'s screen, arrow ${id} keeps the end it had on the deleted shape's side, ` +
            `found at ${JSON.stringify(kept)} and expected at ${JSON.stringify(
              declinedAnchor(declined, kept),
            )}`,
        ).toBe(true);
        // The other end is still fastened to the shape it was fastened to: the arrow did not come
        // unglued at both ends, it lost one.
        expect(await otherTarget(arrow, end === 'from' ? 'to' : 'from')).not.toBe('');
      }
      // The arrow that was fastened to nothing on one end is still fastened to nothing there.
      const unfinished = await arrowState(person.page, ids.connectors.unfinished);
      expect(unfinished.toEnd).toBe('free');
      expect(unfinished.fromTarget).toBe(ids.shapes.receipt);
    }

    // And it cost Dana nothing: her board shows the same four arrows at the same points.
    for (const id of attached) {
      expect(await arrowEndsAgree(dana.page, sam.page, id)).toBe(true);
    }
  });

  test('a shape deleted while an arrow is being drawn to it leaves an arrow with an end at a point (TC-27)', async ({
    browser,
  }) => {
    const { cast, ids } = await flowBoard(browser);
    const { dana, sam } = danaAndSam(cast);
    const cart = shapeBox('cart');
    const declined = shapeBox('declined');

    // Dana puts her pointer on the basket, drags an arrow out over the declined shape, and holds it
    // there: her pointer is still down, so the arrow is a preview and nothing in the document.
    await armTool(dana.page, 'connector');
    // The board is framed on the basket first. Where a board opens with its camera, the top-left of this
    // flow lies under the toolbar down the left of the window - which is one button taller than it was when
    // this test was written - and a press on a shape that is behind a button is a press on the button.
    // `beginArrow` notices and says so; framing the board is the answer it gives for the moving camera.
    await aimCamera(dana.page, { x: cart.x + cart.width / 2, y: cart.y + cart.height / 2 }, 1);
    const start = await screenOf(dana.page, {
      x: cart.x + 40,
      y: cart.y + 40,
    });
    const overDeclined = await screenOf(dana.page, {
      x: declined.x + declined.width / 2,
      y: declined.y + declined.height / 2,
    });
    await beginArrow(dana.page, start, overDeclined);
    await expect(connectorPreview(dana.page)).toBeVisible();

    // While she is holding, Sam deletes the shape she is pointing at - and her board's word for that
    // reaches Dana's board before Dana lets go, which is one of the two orders this race can land in.
    await selectById(sam.page, ids.shapes.declined);
    await pressDelete(sam.page);
    await waitForShapeGone(dana.page, ids.shapes.declined);

    await finishArrow(dana.page, overDeclined);

    // Dana's arrow is on the board. It was drawn against a shape that is no longer there, and the
    // board kept it, with its far end a point on the board rather than a stranger's shape.
    const arrows = await arrowIds(dana.page);
    expect(arrows).toHaveLength(5);
    const drawn = await waitForArrowAtLeast(dana.page, 5);
    const arrow = drawn[drawn.length - 1];
    if (arrow === undefined) {
      throw new Error('the board drew no arrow');
    }
    const state = await waitForArrow(dana.page, arrow);
    expect(state).toMatchObject({ fromEnd: 'attached', toEnd: 'free', fromTarget: ids.shapes.cart });
    expect(
      near(
        { x: state.toX, y: state.toY },
        { x: declined.x + declined.width / 2, y: declined.y + declined.height / 2 },
      ),
      'the end of an arrow whose shape went away is left where the pointer was let go',
    ).toBe(true);

    // Sam sees the same arrow, and neither board complained about any of it.
    await waitForArrow(sam.page, arrow);
    expect(await arrowEndsAgree(dana.page, sam.page, arrow)).toBe(true);
    for (const person of cast.people) {
      expect(
        person.problems,
        `nobody should have had to log anything about a shape deleted mid-arrow: ${person.problems.join(
          '; ',
        )}`,
      ).toEqual([]);
    }
  });

  test('a shape deleted just after an arrow was fastened to it leaves that arrow an end where the side was (TC-27)', async ({
    browser,
  }) => {
    const { cast, ids } = await flowBoard(browser);
    const { dana, sam } = danaAndSam(cast);
    const declined = shapeBox('declined');

    // Dana draws an arrow from the basket to the declined shape, and it reaches Sam's screen.
    await armTool(dana.page, 'connector');
    const arrow = await drawArrow(
      dana.page,
      // The right-hand end of the basket shape: the left-hand end is where the toolbar is bolted to the
      // window, and a press there is the toolbar's rather than the board's.
      await screenOf(dana.page, { x: shapeBox('cart').x + 140, y: shapeBox('cart').y + 40 }),
      await screenOf(dana.page, { x: declined.x + 40, y: declined.y + 20 }),
    );
    await waitForArrow(sam.page, arrow);
    const fastened = await arrowState(sam.page, arrow);
    const anchor = { x: fastened.toX, y: fastened.toY };

    // Sam deletes the shape now: after the arrow was fastened to it.
    await selectById(sam.page, ids.shapes.declined);
    await pressDelete(sam.page);

    // On both screens the arrow is still there, still fastened to the basket at one end, and with the
    // other end let go at the anchor on the side of the shape that used to be there.
    for (const person of cast.people) {
      const after = await waitForEnd(
        person.page,
        arrow,
        'to',
        'free',
        declinedAnchor(declined, anchor),
      );
      expect(after.fromEnd).toBe('attached');
      expect(after.fromTarget).toBe(ids.shapes.cart);
    }
    expect(await arrowEndsAgree(dana.page, sam.page, arrow)).toBe(true);
    for (const person of cast.people) {
      expect(person.problems).toEqual([]);
    }
  });
});

/* ---------------------------------------------------------------------------- the readings */

/** Wait for an arrow to be drawn, on a board that is expected to have at least this many on it. */
async function waitForArrowAtLeast(page: Page, atLeast: number): Promise<string[]> {
  await expect
    .poll(() => arrowIds(page).then((ids) => ids.length), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      intervals: [10, 25, 50],
    })
    .toBeGreaterThanOrEqual(atLeast);
  return arrowIds(page);
}

/** Where an arrow's named end is drawn. */
async function endPoint(
  arrow: ArrowState,
  end: 'from' | 'to',
): Promise<{ x: number; y: number }> {
  return end === 'from' ? { x: arrow.fromX, y: arrow.fromY } : { x: arrow.toX, y: arrow.toY };
}

/** Which shape an arrow's named end is fastened to, as the board draws it. */
async function otherTarget(arrow: ArrowState, end: 'from' | 'to'): Promise<string> {
  return end === 'from' ? arrow.fromTarget : arrow.toTarget;
}

/**
 * Wait for an arrow's end to be of a kind and to be drawn at a point.
 *
 * The wait is the room's budget and the message says what it was waiting for, because when this fails
 * the thing worth reading is which end of which arrow stayed as it was.
 */
async function waitForEnd(
  page: Page,
  id: string,
  end: 'from' | 'to',
  kind: 'attached' | 'free',
  at: { x: number; y: number },
): Promise<ArrowState> {
  let last: ArrowState | undefined;
  const started = Date.now();
  await expect
    .poll(
      async () => {
        const read = await arrowState(page, id);
        last = read;
        const point = await endPoint(read, end);
        return (
          (end === 'from' ? read.fromEnd : read.toEnd) === kind &&
          Math.abs(point.x - at.x) <= 0.51 &&
          Math.abs(point.y - at.y) <= 0.51
        );
      },
      { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [10, 25, 50] },
    )
    .toBe(true);
  logLatency(`arrow ${end} end settling on ${page.url().slice(-8)}`, started);
  if (last === undefined) {
    throw new Error(`arrow ${id} was never read`);
  }
  return last;
}

/** Are two screens drawing this arrow's ends at the same points, of the same kinds? */
async function arrowEndsAgree(a: Page, b: Page, id: string): Promise<boolean> {
  const first = await arrowState(a, id);
  const second = await arrowState(b, id);
  return (
    first.fromEnd === second.fromEnd &&
    first.toEnd === second.toEnd &&
    first.fromTarget === second.fromTarget &&
    first.toTarget === second.toTarget &&
    near(await endPoint(first, 'from'), await endPoint(second, 'from')) &&
    near(await endPoint(first, 'to'), await endPoint(second, 'to'))
  );
}

/**
 * The point on the deleted shape's side that an end was hanging from.
 *
 * Which of the four sides it was is read off the point itself: an end drawn at the shape's x is on its
 * left, at x + width on its right, and so on. The alternative - assuming which side the fixture's
 * arrow used - would have the test assert its own guess about where an arrow fastens.
 */
function declinedAnchor(
  declined: { x: number; y: number; width: number; height: number },
  at: { x: number; y: number },
): { x: number; y: number } {
  if (nearX(at.x, declined.x)) {
    return { x: declined.x, y: declined.y + declined.height / 2 };
  }
  if (nearX(at.x, declined.x + declined.width)) {
    return { x: declined.x + declined.width, y: declined.y + declined.height / 2 };
  }
  if (nearX(at.y, declined.y)) {
    return { x: declined.x + declined.width / 2, y: declined.y };
  }
  return { x: declined.x + declined.width / 2, y: declined.y + declined.height };
}

/** Two points being the same point, to within a device-independent pixel. */
function near(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return nearX(a.x, b.x) && nearX(a.y, b.y);
}

function nearX(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.51;
}

/** Each drawn line of a shape's label sits down the middle of the label's box. */
async function expectLinesCentred(page: Page, id: string): Promise<void> {
  const box = await labelBox(page, id);
  const middle = box.x + box.width / 2;
  for (const line of await labelLines(page, id)) {
    expect(
      Math.abs(line.centre - middle),
      `a line of the label is drawn ${String(
        Math.round(line.centre - middle),
      )} pixels off the middle of the shape`,
    ).toBeLessThanOrEqual(1.5);
  }
}

/**
 * The box the Shape tool is drawing while the mouse is being dragged.
 *
 * Read off the rectangle's own geometry rather than off its painted box, because the painted box
 * includes the dashes drawn on top of the outline: a box that measures a pixel and a half too big
 * because the stroke is one and a half wide is not a preview that is a pixel and a half wrong.
 */
async function drawnPreviewBox(page: Page): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  const box = await page
    .getByTestId('shape-preview-rect')
    .evaluate((element) => ({
      x: Number.parseFloat(element.getAttribute('x') ?? 'NaN'),
      y: Number.parseFloat(element.getAttribute('y') ?? 'NaN'),
      width: Number.parseFloat(element.getAttribute('width') ?? 'NaN'),
      height: Number.parseFloat(element.getAttribute('height') ?? 'NaN'),
    }));
  if (!Number.isFinite(box.width)) {
    throw new Error('the Shape tool drew no preview while the mouse was down');
  }
  return box;
}

/** The widest of a set of drawn lines, in pixels. */
function widest(lines: readonly { width: number }[]): number {
  return lines.reduce((widest_, line) => Math.max(widest_, line.width), 0);
}
