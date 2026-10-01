import { expect, test, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, CONNECTOR_HIT_TOLERANCE_PX } from '../../src/shared/config';
import { buildCheckoutFlow } from '../fixtures/checkout-flow';
import { settled } from './helpers/board';
import { createBoardVia } from './helpers/create';
import { drag, expectEventually, openParticipants, type Participant } from './helpers/participants';
import { seedBoard } from './helpers/seed';

const EVENTUALLY = { timeout: E2E_EVENTUAL_TIMEOUT_MS };
// 1280x800 viewport, camera starts with the world origin in the centre: screen = world + (640, 400).
const arrows = (page: Page) => page.locator('[data-connector]');
const shapes = (page: Page) => page.locator('[data-shape]');

async function ends(page: Page): Promise<number[]> {
  return arrows(page).first().evaluate((el) => ['from-x', 'from-y', 'to-x', 'to-y'].map((k) => Math.round(Number(el.getAttribute(`data-${k}`)))));
}

async function drawShape(page: Page, from: [number, number], to: [number, number]) {
  await page.keyboard.press('s');
  await drag(page, { x: from[0], y: from[1] }, to[0] - from[0], to[1] - from[1]);
  await page.keyboard.press('Escape'); // keeps the shape selected; makes sure the Select tool is active
}

async function twoShapesBoard(browser: Parameters<typeof openParticipants>[0]) {
  const creator = await browser.newContext();
  const id = await createBoardVia(creator.request);
  await creator.close();
  const [dana, sam] = await openParticipants(browser, ['Dana', 'Sam'], id);
  await drawShape(dana.page, [300, 300], [400, 400]); // A: world (-340,-100)
  await drawShape(dana.page, [700, 300], [800, 400]); // B: world (60,-100)
  await expect(shapes(sam.page)).toHaveCount(2, EVENTUALLY);
  return { id, dana, sam };
}

async function connect(page: Page, from: [number, number], to: [number, number]) {
  await page.keyboard.press('l');
  await drag(page, { x: from[0], y: from[1] }, to[0] - from[0], to[1] - from[1]);
}

const free = (p: Participant) => p.errors.filter((e) => !/favicon/i.test(e));

test('TC-25 an arrow follows a shape that Dana drags past the other end, on Sam\'s screen too', async ({ browser }) => {
  const { dana, sam } = await twoShapesBoard(browser);
  await connect(dana.page, [350, 350], [750, 350]);
  await expect(arrows(dana.page)).toHaveCount(1);
  await expect(arrows(dana.page)).toHaveAttribute('data-selected', 'true');
  await expect(arrows(sam.page)).toHaveCount(1, EVENTUALLY);
  expect(await ends(dana.page)).toEqual([-240, -50, 60, -50]);
  await expectEventually('arrow attached to B on Sam', () => ends(sam.page), [-240, -50, 60, -50]);

  // Drag B to the left of A: the arrow switches to A's left side and B's right side.
  await dana.page.keyboard.press('v');
  await dana.page.keyboard.press('Escape');
  await drag(dana.page, { x: 750, y: 380 }, -600, 0);
  const expected = [-340, -50, -440, -50];
  await expect.poll(() => ends(dana.page), EVENTUALLY).toEqual(expected);
  await expectEventually('arrow follows remote move', () => ends(sam.page), expected);
  expect(free(dana)).toEqual([]);
  expect(free(sam)).toEqual([]);
  await dana.context.close();
  await sam.context.close();
});

test('TC-26 when Sam deletes the target shape the arrow stays with a free end where its side was', async ({ browser }) => {
  const { dana, sam } = await twoShapesBoard(browser);
  await connect(dana.page, [350, 350], [750, 350]);
  await expect(arrows(sam.page)).toHaveCount(1, EVENTUALLY);
  const before = await ends(dana.page);
  await sam.page.mouse.click(780, 380); // B, away from the arrow
  await sam.page.keyboard.press('Delete');
  await expect(shapes(sam.page)).toHaveCount(1);
  await expect(shapes(dana.page)).toHaveCount(1, EVENTUALLY);
  await expect(arrows(sam.page)).toHaveCount(1);
  await expect(arrows(dana.page)).toHaveCount(1);
  expect(await ends(sam.page)).toEqual(before);
  await expectEventually('detached end on Dana', () => ends(dana.page), before);
  // The free end no longer follows anything: moving A leaves it where it was.
  await drag(dana.page, { x: 330, y: 330 }, 0, 150);
  await expect.poll(async () => (await ends(dana.page))[1], EVENTUALLY).not.toBe(before[1]);
  expect((await ends(dana.page))[2]).toBe(before[2]);
  expect((await ends(dana.page))[3]).toBe(before[3]);
  await dana.context.close();
  await sam.context.close();
});

test('TC-27 an arrow dragged to a shape Sam deletes at the same moment still shows, drawn at its fallback', async ({ browser, baseURL }) => {
  const creator = await browser.newContext();
  const id = await createBoardVia(creator.request);
  await creator.close();
  await seedBoard(baseURL!, id, (doc) => {
    // Two shapes only: build via the checkout fixture and keep A and B by id.
    const flow = buildCheckoutFlow(doc);
    doc.getMap('objects').delete(flow.connectors[0]);
    doc.getMap('objects').delete(flow.connectors[1]);
    doc.getMap('objects').delete(flow.connectors[2]);
    doc.getMap('objects').delete(flow.connectors[3]);
  });
  const [dana, sam] = await openParticipants(browser, ['Dana', 'Sam'], id);
  // Dana's incoming traffic is held while the race plays out.
  let hold = false;
  const queued: Array<string | Buffer> = [];
  let release = () => {};
  await dana.page.routeWebSocket(/\/api\/rooms\//, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => { if (hold) queued.push(m); else ws.send(m); });
    release = () => { hold = false; queued.splice(0).forEach((m) => ws.send(m)); };
  });
  await dana.page.reload();
  await expect(shapes(dana.page)).toHaveCount(4, EVENTUALLY);
  await settled(dana.page);
  // Fixture shapes: Cart world (-500,-50) 160x100, Paid? (-200,-50): screen = world + (640, 400).
  const cart = { x: -500 + 640 + 80, y: -50 + 400 + 50 };
  const paid = { x: -200 + 640 + 80, y: -50 + 400 + 50 };
  await dana.page.keyboard.press('l');
  await dana.page.mouse.move(cart.x, cart.y);
  await dana.page.mouse.down();
  await dana.page.mouse.move(paid.x, paid.y, { steps: 6 });
  await expect(dana.page.locator('[data-testid="connection-dot"][data-highlighted="true"]')).toHaveCount(1);
  hold = true;
  await sam.page.mouse.click(paid.x, paid.y);
  await sam.page.keyboard.press('Delete');
  await expect(shapes(sam.page)).toHaveCount(3);
  await sam.page.waitForTimeout(500);
  await expect(shapes(dana.page)).toHaveCount(4); // Dana has not heard about it yet
  await dana.page.mouse.up();
  await expect(arrows(dana.page)).toHaveCount(1);
  release();
  await expect(shapes(dana.page)).toHaveCount(3, EVENTUALLY);
  await expect(arrows(dana.page)).toHaveCount(1);
  await expect(arrows(dana.page)).toBeVisible();
  const [fx, fy, tx, ty] = await ends(dana.page);
  expect([fx, fy]).toEqual([-340, 0]); // Cart's right side
  expect(Math.abs(tx - -200)).toBeLessThanOrEqual(1); // Paid?'s left side, kept as the stored fallback
  expect(ty).toBe(0);
  await expect(arrows(sam.page)).toHaveCount(1, EVENTUALLY);
  expect(free(dana)).toEqual([]);
  expect(free(sam)).toEqual([]);
  await dana.context.close();
  await sam.context.close();
});

test('TC-20 a click 5 px from the line selects the arrow and one 7 px away does not', async ({ page, request }) => {
  const id = await createBoardVia(request);
  await page.goto(`/b/${id}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible(EVENTUALLY);
  await settled(page);
  await connect(page, [300, 300], [700, 300]);
  await expect(arrows(page)).toHaveCount(1);
  await page.keyboard.press('Escape'); // clears the selection kept after creation
  await expect(arrows(page)).toHaveAttribute('data-selected', 'false');
  await page.mouse.click(500, 300 + CONNECTOR_HIT_TOLERANCE_PX + 1);
  await expect(arrows(page)).toHaveAttribute('data-selected', 'false');
  await page.mouse.click(500, 300 + CONNECTOR_HIT_TOLERANCE_PX - 1);
  await expect(arrows(page)).toHaveAttribute('data-selected', 'true');
});

test('the checkout flow fixture renders four labelled shapes and four arrows', async ({ page, request, baseURL }) => {
  const id = await createBoardVia(request);
  await seedBoard(baseURL!, id, (doc) => { buildCheckoutFlow(doc); });
  await page.goto(`/b/${id}`);
  await expect(shapes(page)).toHaveCount(4, EVENTUALLY);
  await expect(arrows(page)).toHaveCount(4);
  await expect(page.getByRole('group', { name: 'Diamond: Paid?' })).toBeVisible();
});
