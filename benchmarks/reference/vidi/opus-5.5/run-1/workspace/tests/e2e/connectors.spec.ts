import { expect, test, type Browser, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { nearestSide, rectCentre as geoCentre, sideAnchor } from '../../src/shared/geometry/connector-geometry';
import { CHECKOUT_SHAPES, checkoutFlow } from '../fixtures/checkout-flow';
import { nextFrames, setCamera } from './helpers/board';
import {
  boardUrl,
  closeParticipants,
  expectWithin,
  openParticipants,
  waitConnected,
  type Participant,
} from './helpers/participants';
import { seedBoard } from './helpers/seed';
import {
  arrows,
  centreOf,
  chooseTool,
  dragBetween,
  drawnArrow,
  rectCentre,
  shapeLocator,
  shapes,
  worldToPage,
  type RectState,
} from './helpers/shapes';

/**
 * Story 10 e2e (connector.ui) against the real sync server with two people: arrows follow
 * moves on both screens (TC-25), survive deletes (TC-26), and an arrow attached while its
 * target is being deleted still renders (TC-27).
 */

const MULTI_CONTEXT_TIMEOUT_MS = 120_000;
/** How far (screen px) Dana drags B: from right of A to well left of it. */
const DRAG_B_BY = { x: -700, y: 250 } as const;

async function rectOf(page: Page, id: string): Promise<RectState> {
  const s = (await shapes(page)).find((x) => x.id === id);
  if (!s) throw new Error(`shape ${id} missing`);
  return s;
}

/** Where an arrow between rects a and b is drawn (both ends attached). */
function expectedEnds(a: RectState, b: RectState) {
  return {
    from: sideAnchor(a, nearestSide(a, geoCentre(b))),
    to: sideAnchor(b, nearestSide(b, geoCentre(a))),
  };
}

test.describe('connector.ui: collaborative rearrange', () => {
  let people: Participant[] = [];
  test.afterEach(async () => {
    await closeParticipants(people);
    people = [];
  });

  test('TC-25 + TC-26 Dana connects A to B and drags B past A: the arrow follows and switches sides on both screens; Sam deletes B: the arrow stays with a free end', async ({
    browser,
  }) => {
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    people = await openParticipants(browser, ['Dana', 'Sam']);
    const [dana, sam] = people as [Participant, Participant];

    // Two shapes by dragging.
    await chooseTool(dana.page, 's', 'Shape (S)');
    await dragBetween(dana.page, { x: 300, y: 250 }, { x: 460, y: 350 });
    await chooseTool(dana.page, 's', 'Shape (S)');
    await dragBetween(dana.page, { x: 800, y: 250 }, { x: 960, y: 350 });
    await expect.poll(async () => (await shapes(dana.page)).length).toBe(2);
    const sorted = (await shapes(dana.page)).sort((p, q) => p.x - q.x);
    const a = sorted[0]!;
    const b = sorted[1]!;

    // L, hover A: four dots; drag to B: B's left dot highlighted; release: an arrow.
    await chooseTool(dana.page, 'l', 'Connector (L)');
    const aCentre = await centreOf(shapeLocator(dana.page, a.id));
    const bCentre = await centreOf(shapeLocator(dana.page, b.id));
    await dana.page.mouse.move(aCentre.x, aCentre.y);
    await expect(dana.page.getByTestId('connection-dot')).toHaveCount(4);
    await dana.page.mouse.down();
    await dana.page.mouse.move(bCentre.x, bCentre.y, { steps: 10 });
    await expect(dana.page.locator('[data-testid="connection-dot"][data-highlighted="true"]')).toHaveAttribute(
      'data-side',
      'left',
    );
    await dana.page.mouse.up();
    await expect.poll(async () => (await arrows(dana.page)).length).toBe(1);
    const [arrow] = await arrows(dana.page);
    expect(arrow!.from).toMatchObject({ kind: 'attached', objectId: a.id });
    expect(arrow!.to).toMatchObject({ kind: 'attached', objectId: b.id });
    await expect(dana.page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
    await expectWithin(() => drawnArrow(sam.page, arrow!.id)).toEqual(expectedEnds(a, b));

    // Dana drags B past A (down and to the left): B's arrow end moves to B's other side.
    await dragBetween(dana.page, bCentre, { x: bCentre.x + DRAG_B_BY.x, y: bCentre.y + DRAG_B_BY.y });
    const movedB = await rectOf(dana.page, b.id);
    expect(movedB.x).toBeLessThan(a.x);
    const ends = expectedEnds(a, movedB);
    expect(ends.to).not.toEqual(expectedEnds(a, b).to);
    await expectWithin(() => drawnArrow(dana.page, arrow!.id)).toEqual(ends);
    await expectWithin(() => drawnArrow(sam.page, arrow!.id), "arrow follows on Sam's screen").toEqual(ends);

    // TC-26: Sam deletes B. The arrow stays, its end free where B's side was, on both screens.
    const onSam = await worldToPage(sam.page, rectCentre(movedB));
    await sam.page.mouse.click(onSam.x, onSam.y);
    await expect(shapeLocator(sam.page, b.id)).toHaveAttribute('data-selected', 'true');
    await sam.page.keyboard.press('Delete');
    await expectWithin(async () => (await shapes(dana.page)).length).toBe(1);
    for (const p of [dana, sam]) {
      await expectWithin(async () => (await arrows(p.page)).map((x) => x.to)).toEqual([
        { kind: 'free', x: ends.to.x, y: ends.to.y },
      ]);
      expect(await drawnArrow(p.page, arrow!.id)).toEqual(ends);
    }
    expect(dana.errors).toEqual([]);
    expect(sam.errors).toEqual([]);
  });
});

/**
 * Opens one person on a board with their outgoing socket traffic routed through Playwright,
 * so the test can hold it back (Sam's delete reaches the room only when released).
 */
async function openHeldParticipant(browser: Browser, boardId: string, name: string) {
  const { baseURL, viewport } = test.info().project.use;
  const context = await browser.newContext({ baseURL, viewport });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  let holding = false;
  const held: (string | Buffer)[] = [];
  let forward: ((m: string | Buffer) => void) | null = null;
  await page.routeWebSocket(/\/api\/rooms\//, (ws) => {
    const server = ws.connectToServer();
    forward = (m) => server.send(m);
    ws.onMessage((m) => {
      if (holding) held.push(m);
      else server.send(m);
    });
    server.onMessage((m) => ws.send(m));
  });
  await page.goto(boardUrl(boardId));
  await waitConnected(page);
  const participant: Participant = { name, context, page, errors, dialogs: [] };
  return {
    participant,
    hold: () => {
      holding = true;
    },
    release: () => {
      holding = false;
      for (const m of held.splice(0)) forward?.(m);
    },
  };
}

test.describe('connector.ui: delete race', () => {
  let people: Participant[] = [];
  test.afterEach(async () => {
    await closeParticipants(people);
    people = [];
  });

  test("TC-27 Dana attaches an arrow to Receipt while Sam deletes it: Dana's arrow shows with its end at the fallback, no errors", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    const boardId = newBoardId();
    const flow = checkoutFlow();
    await seedBoard(baseURL!, boardId, flow.doc);
    const sam = await openHeldParticipant(browser, boardId, 'Sam');
    people.push(sam.participant);
    const [dana] = await openParticipants(browser, ['Dana'], boardId);
    people.push(dana!);
    const camera = { x: -150, y: -300, zoom: 1 };
    for (const p of [dana!.page, sam.participant.page]) {
      await setCamera(p, camera);
      await nextFrames(p);
    }

    // Sam deletes Receipt; his change is held back from the room.
    sam.hold();
    const receiptOnSam = await centreOf(shapeLocator(sam.participant.page, flow.ids.receipt));
    await sam.participant.page.mouse.click(receiptOnSam.x, receiptOnSam.y);
    await sam.participant.page.keyboard.press('Delete');
    await expect(shapeLocator(sam.participant.page, flow.ids.receipt)).toHaveCount(0);

    // Dana still sees Receipt and draws an arrow from Checkout to it.
    await chooseTool(dana!.page, 'l', 'Connector (L)');
    const from = await centreOf(shapeLocator(dana!.page, flow.ids.checkout));
    const to = await centreOf(shapeLocator(dana!.page, flow.ids.receipt));
    await dragBetween(dana!.page, from, { x: to.x, y: to.y + 20 });
    await expect.poll(async () => (await arrows(dana!.page)).length).toBe(5);
    const created = (await arrows(dana!.page)).find((x) => !flow.arrows.includes(x.id))!;
    expect(created.to).toMatchObject({ kind: 'attached', objectId: flow.ids.receipt });
    const fallback = sideAnchor(CHECKOUT_SHAPES.receipt.rect, 'left');
    expect(created.to.fallback).toEqual(fallback);

    // Now Sam's delete reaches the room (and Dana).
    sam.release();
    await expect.poll(async () => (await shapes(dana!.page)).some((s) => s.id === flow.ids.receipt)).toBe(false);
    for (const p of [dana!.page, sam.participant.page]) {
      await expect
        .poll(() => drawnArrow(p, created.id))
        .toEqual({
          from: sideAnchor(CHECKOUT_SHAPES.checkout.rect, 'right'),
          to: fallback,
        });
      await expect(
        p.locator(`[data-testid="connector-object"][data-id="${created.id}"] [data-testid="connector-arrowhead"]`),
      ).toBeVisible();
    }
    // The arrow Paid? → Receipt was detached by Sam's delete: a free end where Receipt's side was.
    await expect
      .poll(async () => (await arrows(dana!.page)).find((x) => x.id === flow.arrows[1])?.to)
      .toEqual({ kind: 'free', ...sideAnchor(CHECKOUT_SHAPES.receipt.rect, 'left') });
    expect(dana!.errors).toEqual([]);
    expect(sam.participant.errors).toEqual([]);
  });
});
