// Story 10 — connectors, between two real clients. Playwright e2e (TC-25, TC-26, TC-27).
//
// These are the cases the story is really about: an arrow is not a picture of a line but
// a rule — "this end hangs off that shape" — which a *second* browser has to re-discover
// for itself from the shapes it already has. So the assertions are made on the other
// person's screen, in board units read off the drawn line, and the most interesting ones
// are the moments when the two screens have not agreed yet.
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { openSharedBoard } from './helpers/board.ts';
import { newBoardId } from '../../src/shared/board-id.ts';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config.ts';
import {
  arrowById,
  arrowCount,
  arrowsOn,
  armTool,
  buildFlowBoard,
  connect,
  drawShape,
  moveShape,
  openFlowBoard,
  screenOf,
  selectShape,
  settle,
  shapeCount,
  shapesOn,
  sideOfPoint,
  type Point,
  type ShapeBox,
} from '../fixtures/checkout-flow.ts';

/** How far a drawn end may sit from the point it belongs on, in board units. */
const ON_POINT = 1.5;

const closeTo = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) <= ON_POINT && Math.abs(a.y - b.y) <= ON_POINT;

/**
 * How long a message from Sam is held up in TC-27. Long enough that Dana can start an
 * arrow, and let go, while Sam's delete is still on the wire.
 */
const WS_DELAY_MS = 2500;

const BOX_A = { x: 450, y: 150, width: 200, height: 120 };
const BOX_B = { x: 800, y: 150, width: 200, height: 120 };
/** Where B goes to get to the far side of A: same row, clear of everything else. */
const B_PAST_A = { x: 250, y: 210 };

/** Two clients on one board, both connected, both at the identity camera. */
async function twoClients(context: BrowserContext) {
  const id = newBoardId();
  const dana = await context.newPage();
  const sam = await context.newPage();
  await openSharedBoard(dana, id);
  await openSharedBoard(sam, id);
  await openFlowBoard(dana);
  await openFlowBoard(sam);
  return { id, dana, sam };
}

/** The shape with this id, from a list read off one screen. */
function find(shapes: ShapeBox[], id: string): ShapeBox {
  const s = shapes.find((x) => x.id === id);
  if (!s) throw new Error(`shape ${id} is not on this screen`);
  return s;
}

/** Which end of this arrow sits on this shape's border, if either. */
function endOnShape(arrow: { from: Point; to: Point }, box: ShapeBox) {
  const from = sideOfPoint(arrow.from, box);
  if (from !== 'off') return { end: 'from' as const, at: arrow.from, side: from };
  const to = sideOfPoint(arrow.to, box);
  if (to !== 'off') return { end: 'to' as const, at: arrow.to, side: to };
  return null;
}

/** Is this point on the border of this box (board units)? */
function onBorderOfBox(p: Point, box: { x: number; y: number; width: number; height: number }) {
  const inY = p.y >= box.y - ON_POINT && p.y <= box.y + box.height + ON_POINT;
  const inX = p.x >= box.x - ON_POINT && p.x <= box.x + box.width + ON_POINT;
  return (
    (Math.abs(p.x - box.x) <= ON_POINT && inY) ||
    (Math.abs(p.x - (box.x + box.width)) <= ON_POINT && inY) ||
    (Math.abs(p.y - box.y) <= ON_POINT && inX) ||
    (Math.abs(p.y - (box.y + box.height)) <= ON_POINT && inX)
  );
}

/**
 * Collect what a page complains about. Browser resource noise (a missing favicon, a
 * closed socket) is not the app misbehaving and is not what the story's
 * "nothing lands in the console" is about, so it is filtered out by name.
 */
function watchForErrors(page: Page, name: string): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${name}: uncaught ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/Failed to load resource|favicon|WebSocket is closed/i.test(text)) return;
    errors.push(`${name}: ${text}`);
  });
  return errors;
}

/** Select an arrow by clicking the middle of its line. */
async function selectArrow(page: Page, arrow: { from: Point; to: Point }): Promise<void> {
  await armTool(page, 'v');
  const mid = await screenOf(page, {
    x: (arrow.from.x + arrow.to.x) / 2,
    y: (arrow.from.y + arrow.to.y) / 2,
  });
  await page.mouse.click(mid.x, mid.y);
  await settle(page);
}

test.describe('story 10 connectors', () => {
  test('TC-25 an arrow follows a shape a colleague moved, and changes side', async ({
    context,
  }) => {
    test.setTimeout(60000);
    const { dana, sam } = await twoClients(context);

    // Dana draws two boxes and one arrow between them.
    const a = await drawShape(dana, BOX_A);
    const b = await drawShape(dana, BOX_B);
    const arrow = await connect(dana, a, b);

    // Sam sees one arrow too, drawn between the same two points.
    await expect.poll(() => arrowCount(sam), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS }).toBe(1);
    const onDana = await arrowById(dana, arrow);
    const onSam = await arrowById(sam, arrow);
    expect(onDana && onSam && closeTo(onDana.to, onSam.to)).toBe(true);
    expect(sideOfPoint(onSam!.to, find(await shapesOn(sam), b))).toBe('left');
    // Dana drags B along the row, past A.
    await moveShape(dana, b, B_PAST_A);

    // On Sam's screen the end is still welded to B — exactly on its border — and has
    // switched to the side that now faces A, within the live update budget.
    await expect
      .poll(
        async () => {
          const shapes = await shapesOn(sam);
          const moved = find(shapes, b);
          const other = find(shapes, a);
          if (moved.x + moved.w / 2 >= other.x + other.w / 2) return 'B has not passed A yet';
          const arrowNow = await arrowById(sam, arrow);
          return arrowNow ? sideOfPoint(arrowNow.to, moved) : 'no arrow at all';
        },
        { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS },
      )
      .toBe('right');

    // Dana's screen agrees, the other end followed A as well, and nothing was
    // duplicated on the way through the wire.
    const samShapes = await shapesOn(sam);
    const finalDana = await arrowById(dana, arrow);
    const finalSam = await arrowById(sam, arrow);
    expect(finalDana && finalSam && closeTo(finalDana.to, finalSam.to)).toBe(true);
    expect(finalDana && finalSam && closeTo(finalDana.from, finalSam.from)).toBe(true);
    expect(sideOfPoint(finalSam!.to, find(samShapes, b))).toBe('right');
    expect(sideOfPoint(finalSam!.from, find(samShapes, a))).toBe('left');
    expect(await arrowCount(sam)).toBe(1);
    expect(await shapeCount(sam)).toBe(2);
  });

  test('TC-26 deleting the shape an arrow hangs off leaves a free end on both screens', async ({
    context,
  }) => {
    test.setTimeout(120000);
    const { dana, sam } = await twoClients(context);

    // The checkout-flow fixture, drawn by hand on Dana's screen: four labelled shapes,
    // three arrows attached at both ends and one with a free end.
    const flow = await buildFlowBoard(dana);
    await expect.poll(() => arrowCount(sam), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS }).toBe(4);
    await expect.poll(async () => (await shapesOn(sam)).filter((s) => s.label).length).toBe(4);
    expect(await shapeCount(sam)).toBe(4);
    expect(find(await shapesOn(sam), flow.inStock).kind).toBe('diamond');

    // Three arrows hang off <In stock?>. Note the exact point each of them is drawn at:
    // that is the point each end has to fall back to once the shape is gone.
    const box = find(await shapesOn(sam), flow.inStock);
    const freed = (await arrowsOn(sam))
      .map((arrow) => {
        const hit = endOnShape(arrow, box);
        return hit ? { id: arrow.id, ...hit } : null;
      })
      .filter((x): x is { id: string; end: 'from' | 'to'; at: Point; side: string } => x !== null)
      .sort((x, y) => x.id.localeCompare(y.id));
    expect(freed.length).toBe(3);

    // Sam deletes the diamond.
    await selectShape(sam, flow.inStock);
    await sam.keyboard.press('Delete');
    await settle(sam);
    await expect.poll(() => shapeCount(sam)).toBe(3);
    await expect.poll(() => shapeCount(dana), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS }).toBe(3);

    // On both screens: no arrow disappeared, and the three freed ends did not move.
    for (const page of [sam, dana]) {
      await expect
        .poll(
          async () => {
            const arrows = await arrowsOn(page);
            const kept = freed.filter((f) => {
              const arrow = arrows.find((a) => a.id === f.id);
              return arrow ? closeTo(f.end === 'from' ? arrow.from : arrow.to, f.at) : false;
            }).length;
            return `${arrows.length} arrows / ${kept} ends unmoved`;
          },
          { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS },
        )
        .toBe('4 arrows / 3 ends unmoved');
    }

    // A freed end stays put when a shape that *is* still there moves — it is a point on
    // the board now, not a follower. (connector.free_end + connector.reattach semantics.)
    const freedArrow = freed.find((f) => f.id === flow.attached[0]!) ?? freed[0]!;
    const before = (await arrowById(dana, freedArrow.id))![freedArrow.end];
    await moveShape(dana, flow.backorder, { x: 700, y: 620 });
    await settle(dana, 200);
    expect(closeTo((await arrowById(dana, freedArrow.id))![freedArrow.end], before)).toBe(true);

    // And the arrow can be selected and re-attached: clicking it shows its two handles.
    const arrowNow = await arrowById(dana, freedArrow.id);
    await selectArrow(dana, arrowNow!);
    await expect(dana.getByTestId('connector-handle-from')).toHaveCount(1);
    await expect(dana.getByTestId('connector-handle-to')).toHaveCount(1);
  });

  test('TC-27 letting go on a shape a colleague is deleting leaves a good arrow', async ({
    context,
  }) => {
    test.setTimeout(90000);
    const { id, dana, sam } = await twoClients(context);
    const danaErrors = watchForErrors(dana, 'dana');
    const samErrors = watchForErrors(sam, 'sam');

    const a = await drawShape(dana, BOX_A);
    const b = await drawShape(dana, BOX_B);
    await expect.poll(() => shapeCount(sam), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS }).toBe(2);

    // Hold everything Sam sends to the room for WS_DELAY_MS: his delete is immediate
    // for him and invisible to everyone else for a moment. That window is the race.
    //
    // It has to be installed before Sam's room socket exists, because interception only
    // covers sockets opened after it — so Sam reloads, and every message he writes from
    // now on is late. Dana's socket is untouched.
    await sam.routeWebSocket('**/api/rooms/**', (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((message) => {
        setTimeout(() => {
          try {
            server.send(message);
          } catch {
            /* the socket closed while this was waiting; there is nothing to deliver */
          }
        }, WS_DELAY_MS);
      });
      server.onMessage((message) => {
        try {
          ws.send(message);
        } catch {
          /* Sam's page went away mid-delivery */
        }
      });
    });
    await openSharedBoard(sam, id);
    await openFlowBoard(sam);
    await expect.poll(() => shapeCount(sam), { timeout: 20000 }).toBe(2);

    // Dana starts an arrow from A towards B, and holds it there.
    await armTool(dana, 'l');
    const start = await screenOf(dana, { x: 550, y: 210 });
    const end = await screenOf(dana, { x: 900, y: 210 });
    await dana.mouse.move(start.x, start.y);
    await dana.mouse.down();
    await dana.mouse.move((start.x + end.x) / 2, start.y, { steps: 6 });
    await dana.mouse.move(end.x, end.y, { steps: 6 });
    await expect(dana.getByTestId('connector-preview')).toHaveCount(1);

    // While the arrow is in the air, Sam deletes B.
    await selectShape(sam, b);
    await sam.keyboard.press('Delete');
    await settle(sam);

    // The delete has not reached Dana yet — that is the overlap this test exists to
    // create, not a coincidence to tidy away.
    expect(await shapeCount(dana)).toBe(2);

    // Dana lets go, over where B still is on Dana's screen.
    await dana.mouse.up();
    await settle(dana);

    // Dana has an arrow attached to B. Sam receives that same arrow even though his own
    // B is already gone: it is drawn from the end's fallback point, so it is not missing,
    // not zero-length and not an error — it is just attached to something that isn't here.
    await expect.poll(() => arrowCount(dana), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS }).toBe(1);
    await expect.poll(() => arrowCount(sam), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS }).toBe(1);
    const onDana = (await arrowsOn(dana))[0]!;
    const onSam = (await arrowsOn(sam))[0]!;
    expect(onSam.id).toBe(onDana.id);
    expect(onBorderOfBox(onSam.to, BOX_B)).toBe(true);

    // Sam's delete finally reaches Dana. The arrow stays, and its end becomes a free end
    // at the very point both screens were already drawing — no snap to the origin, no
    // arrow chasing a shape that no longer exists.
    await expect.poll(() => shapeCount(dana), { timeout: WS_DELAY_MS + 15000 }).toBe(1);
    const after = await arrowsOn(dana);
    expect(after.length).toBe(1);
    expect(closeTo(after[0]!.to, onDana.to)).toBe(true);
    expect(await arrowCount(sam)).toBe(1);
    expect(await shapeCount(sam)).toBe(1);
    // The shape that survives on both screens is A: the arrow never chased B out of the
    // way, and it never swallowed the shape it started from.
    expect((await shapesOn(dana))[0]!.id).toBe(a);
    expect((await shapesOn(sam))[0]!.id).toBe(a);
    expect([...danaErrors, ...samErrors]).toEqual([]);
  });
});
