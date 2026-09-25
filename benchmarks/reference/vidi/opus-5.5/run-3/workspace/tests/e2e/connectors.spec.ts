// Story 10 in real browsers against wrangler dev: arrows follow moves by anyone, survive deletes, and render
// safely when their object is deleted by someone else at the same moment.
import { expect, test, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { setCamera, settle } from './helpers/board';
import { createBoardAt } from './helpers/boards-api';
import { dragBy } from './helpers/notes';
import { closeAll, expectWithin, openParticipants, waitConnected, type Participant } from './helpers/participants';
import { seedBoard } from './helpers/selection';
import { centreOfShape, connectors, drawnEnds, mouseDrag, shapeById, shapes } from './helpers/shapes';
import { recordBoard } from '../fixtures/boards';
import { CHECKOUT_AUTHOR } from '../fixtures/checkout-flow';
import { createShape } from '../../src/shared/objects/shape';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';

const CAM = { x: -700, y: -300, zoom: 1 };

/** A board with rectangle A at (0,0) and rectangle B at (400,0), both 160 x 100. */
function twoShapes(): { doc: Y.Doc; a: string; b: string } {
  let a = '';
  let b = '';
  const { doc } = recordBoard((d) => {
    a = createShape(d, { kind: 'rect', rect: { x: 0, y: 0, width: 160, height: 100 }, at: { x: 0, y: 0 } }, CHECKOUT_AUTHOR)!;
    b = createShape(d, { kind: 'rect', rect: { x: 400, y: 0, width: 160, height: 100 }, at: { x: 0, y: 0 } }, CHECKOUT_AUTHOR)!;
  });
  return { doc, a, b };
}

async function view(page: Page) {
  await page.waitForFunction(() => window.__vidi6?.setCamera !== undefined);
  await setCamera(page, CAM);
  await settle(page);
}

/** Presses L and drags an arrow from the centre of shape `from` to the centre of shape `to`; returns its id. */
async function connect(page: Page, from: string, to: string): Promise<string> {
  await page.keyboard.press('l');
  await expect(page.getByRole('button', { name: 'Connector (L)' })).toHaveAttribute('aria-pressed', 'true');
  const start = await centreOfShape(page, from);
  const end = await centreOfShape(page, to);
  await page.mouse.move(start.x, start.y);
  await expect(page.getByTestId('connection-dot')).toHaveCount(4);
  await mouseDrag(page, start, end);
  await expect.poll(async () => (await connectors(page)).length).toBe(1);
  await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
  return (await connectors(page))[0].id;
}

test.describe('Workflow "Collaborative rearrange"', () => {
  test('TC-25 the arrow follows B as Dana drags it past A, switching sides on both screens; TC-26 Sam deletes B and the arrow stays', async ({
    browser,
  }) => {
    const board = twoShapes();
    const boardId = await createBoardAt();
    await seedBoard(boardId, board.doc);
    const { people } = await openParticipants(browser, ['Dana', 'Sam'], boardId);
    const [dana, sam] = people;
    try {
      for (const p of people) {
        await expect(p.page.locator('[data-shape-id]')).toHaveCount(2);
        await view(p.page);
      }
      const id = await connect(dana.page, board.a, board.b);
      const attached = { from: { x: 160, y: 50 }, to: { x: 400, y: 50 } };
      expect(await drawnEnds(dana.page, id)).toEqual(attached);
      await expectWithin(() => drawnEnds(sam.page, id)).toEqual(attached);

      // Dana drags B to the other side of A: the arrow now leaves A's left side and reaches B's right side.
      await dragBy(dana.page, await centreOfShape(dana.page, board.b), -800, 0);
      await expect.poll(async () => (await shapes(dana.page)).find((s) => s.id === board.b)!.x).toBe(-400);
      const switched = { from: { x: 0, y: 50 }, to: { x: -240, y: 50 } };
      expect(await drawnEnds(dana.page, id)).toEqual(switched);
      await expectWithin(() => drawnEnds(sam.page, id)).toEqual(switched);

      // TC-26: Sam deletes B; the arrow stays on both screens with its end free where B's side was.
      await sam.page.mouse.click((await centreOfShape(sam.page, board.b)).x, (await centreOfShape(sam.page, board.b)).y);
      await sam.page.keyboard.press('Delete');
      await expect(shapeById(sam.page, board.b)).toHaveCount(0);
      await expectWithin(() => shapeById(dana.page, board.b).count()).toBe(0);
      for (const p of people) {
        expect(await drawnEnds(p.page, id)).toEqual(switched);
        const [c] = await connectors(p.page);
        expect(c.to).toEqual({ kind: 'free', x: -240, y: 50 });
        expect(c.from).toMatchObject({ kind: 'attached', objectId: board.a });
      }
      for (const p of people) expect(p.errors).toEqual([]);
    } finally {
      await closeAll(people);
    }
  });
});

test.describe('Workflow "Delete race"', () => {
  test('TC-27 Dana draws an arrow to B while Sam deletes B: the arrow shows with its end at the fallback on both screens', async ({
    browser,
  }) => {
    const board = twoShapes();
    const boardId = await createBoardAt();
    await seedBoard(boardId, board.doc);
    const { people } = await openParticipants(browser, ['Dana'], boardId);
    const [dana] = people;

    // Sam's messages to the server are held back while `delaying`, so Sam's delete reaches Dana only after Dana has
    // drawn her arrow to B.
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const sam: Participant = { name: 'Sam', context, page, errors: [] };
    page.on('console', (m) => {
      if (m.type() === 'error') sam.errors.push(m.text());
    });
    page.on('pageerror', (e) => sam.errors.push(e.message));
    let delaying = false;
    const HOLD_MS = 2 * LIVE_UPDATE_LATENCY_BUDGET_MS;
    await page.routeWebSocket(/\/api\/rooms\//, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => {
        if (delaying) setTimeout(() => server.send(m), HOLD_MS);
        else server.send(m);
      });
      server.onMessage((m) => ws.send(m));
    });
    await page.goto(`/b/${boardId}`);
    await waitConnected(page);
    const everyone = [dana, sam];
    try {
      for (const p of everyone) {
        await expect(p.page.locator('[data-shape-id]')).toHaveCount(2);
        await view(p.page);
      }
      delaying = true;
      await page.mouse.click((await centreOfShape(page, board.b)).x, (await centreOfShape(page, board.b)).y);
      await page.keyboard.press('Delete');
      await expect(shapeById(page, board.b)).toHaveCount(0);

      const id = await connect(dana.page, board.a, board.b);
      const [created] = await connectors(dana.page);
      expect(created.to).toMatchObject({ kind: 'attached', objectId: board.b, fallback: { x: 400, y: 50 } });

      // Sam's delete arrives: B disappears for Dana, the arrow stays with its end at the fallback point.
      await expect(shapeById(dana.page, board.b)).toHaveCount(0, { timeout: HOLD_MS + 5000 });
      const expected = { from: { x: 160, y: 50 }, to: { x: 400, y: 50 } };
      await expect.poll(() => drawnEnds(dana.page, id)).toEqual(expected);
      await expect.poll(() => drawnEnds(page, id), { timeout: HOLD_MS + 5000 }).toEqual(expected);
      await expect(dana.page.locator('.connector-object__svg')).toBeVisible();
      await expect(page.locator('.connector-object__svg')).toBeVisible();
      for (const p of everyone) expect(p.errors).toEqual([]);
    } finally {
      await closeAll(everyone);
    }
  });
});

test('a click 5 px from an arrow selects it, 7 px away does not; dragging its end handle to empty space frees it (real hit testing)', async ({
  page,
}) => {
  const board = twoShapes();
  const boardId = await createBoardAt();
  await seedBoard(boardId, board.doc);
  await page.goto(`/b/${boardId}`);
  await expect(page.locator('[data-shape-id]')).toHaveCount(2);
  await view(page);
  const id = await connect(page, board.a, board.b);
  await page.keyboard.press('Escape'); // clears the selection
  await expect.poll(() => page.evaluate(() => window.__vidi6!.selection!())).toEqual([]);
  // The arrow runs from world (160,50) to (400,50): screen y = 50 - CAM.y.
  const y = 50 - CAM.y;
  const x = 280 - CAM.x;
  await page.mouse.click(x, y + 7);
  expect(await page.evaluate(() => window.__vidi6!.selection!())).toEqual([]);
  await page.mouse.click(x, y - 5);
  await expect.poll(() => page.evaluate(() => window.__vidi6!.selection!())).toEqual([id]);
  // Drag the end handle to empty space below: the end is freed there.
  const handle = (await page.getByRole('button', { name: 'Arrow end' }).boundingBox())!;
  await mouseDrag(page, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, { x: 400 - CAM.x, y: 300 - CAM.y });
  await expect.poll(async () => (await connectors(page))[0].to).toEqual({ kind: 'free', x: 400, y: 300 });
});
