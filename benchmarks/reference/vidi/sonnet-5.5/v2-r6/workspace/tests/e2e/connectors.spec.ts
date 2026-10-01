import { expect, test, type Locator, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { checkoutFlow } from '../fixtures/checkout-flow';
import { nextFrames, setCamera } from './helpers/board';
import { createBoardId, E2E_ORIGIN } from './helpers/create';
import { expectEventually, openParticipants, type Participant } from './helpers/participants';
import { seedBoard } from './helpers/seed';

const shapes = (page: Page): Locator => page.locator('[data-shape-object]');
const arrows = (page: Page): Locator => page.locator('[data-connector]');

async function dragMouse(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(...to, { steps: 4 });
  await page.mouse.up();
  await nextFrames(page);
}

/** Draws a rectangle with the Shape tool. */
async function drawRect(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.keyboard.press('s');
  await dragMouse(page, from, to);
}

/** Connects the objects under two screen points with the Connector tool. */
async function connect(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.keyboard.press('l');
  await dragMouse(page, from, to);
}

type Line = [number, number, number, number];
/** The arrow's exact line ends, in board units (the invisible hit line spans the whole arrow). */
const lineOf = (page: Page): Promise<Line> => page.getByTestId('connector-hit').first().evaluate((el) => (
  ['x1', 'y1', 'x2', 'y2'].map((a) => parseFloat(el.getAttribute(a) ?? 'NaN')) as Line));
const sameLine = (a: Line, b: Line) => a.every((v, i) => Math.abs(v - b[i]) <= 0.5);

async function twoShapes(dana: Participant, sam: Participant): Promise<void> {
  await drawRect(dana.page, [100, 150], [250, 250]);
  await drawRect(dana.page, [600, 150], [750, 250]);
  await expect(shapes(sam.page)).toHaveCount(2, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
}

test.describe('Collaborative rearrange', () => {
  test('the checkout-flow fixture renders four shapes and four arrows', async ({ browser }) => {
    const flow = checkoutFlow();
    const id = await createBoardId();
    await seedBoard(E2E_ORIGIN, id, flow.updates, flow.objectCount);
    const [dana] = await openParticipants(browser, 1, id);
    await expect(shapes(dana.page)).toHaveCount(4);
    await expect(arrows(dana.page)).toHaveCount(4);
    await expect(dana.page.getByRole('group', { name: 'Diamond: Paid?' })).toBeVisible();
    expect(dana.errors).toEqual([]);
    await dana.context.close();
  });

  test('TC-25 an arrow follows a shape dragged past its other end, for the other person too', async ({ browser }) => {
    const [dana, sam] = await openParticipants(browser, 2);
    await twoShapes(dana, sam);
    await connect(dana.page, [175, 200], [675, 200]);
    await expect(arrows(dana.page)).toHaveCount(1);
    await expect(arrows(dana.page).first()).toHaveAttribute('data-selected', 'true');
    expect(sameLine(await lineOf(dana.page), [250, 200, 600, 200])).toBe(true);
    await expectEventually('arrow created', () => lineOf(sam.page), (l: Line) => sameLine(l, [250, 200, 600, 200]));

    // B moves below A: the arrow leaves A's bottom and enters B's top.
    await dana.page.keyboard.press('v');
    const sent = Date.now();
    await dragMouse(dana.page, [675, 200], [175, 500]);
    const expected: Line = [175, 250, 175, 450];
    await expectEventually('arrow follows move', () => lineOf(dana.page), (l: Line) => sameLine(l, expected), sent);
    await expectEventually('arrow follows move (remote)', () => lineOf(sam.page), (l: Line) => sameLine(l, expected), sent);
    expect(dana.errors).toEqual([]);
    expect(sam.errors).toEqual([]);
    await dana.context.close();
    await sam.context.close();
  });

  test('TC-26 deleting a connected shape keeps the arrow, with its end where the side was', async ({ browser }) => {
    const [dana, sam] = await openParticipants(browser, 2);
    await twoShapes(dana, sam);
    await connect(dana.page, [175, 200], [675, 200]);
    await expectEventually('arrow created', () => lineOf(sam.page), (l: Line) => sameLine(l, [250, 200, 600, 200]));

    await sam.page.mouse.click(675, 200);
    await sam.page.keyboard.press('Delete');
    await expect(shapes(sam.page)).toHaveCount(1);
    await expect(shapes(dana.page)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    for (const p of [sam.page, dana.page]) {
      await expect(arrows(p)).toHaveCount(1);
      await expectEventually('free end', () => lineOf(p), (l: Line) => sameLine(l, [250, 200, 600, 200]));
    }
    expect(dana.errors).toEqual([]);
    expect(sam.errors).toEqual([]);
    await dana.context.close();
    await sam.context.close();
  });
});

test.describe('Delete race', () => {
  test('TC-27 an arrow drawn to a shape that is deleted at the same moment still shows', async ({ browser }) => {
    const id = await createBoardId();
    const [dana] = await openParticipants(browser, 1, id);

    // Sam's outgoing traffic is held back once `delay` is raised, so his delete reaches Dana late.
    let delay = 0;
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const samPage = await context.newPage();
    const samErrors: string[] = [];
    samPage.on('console', (m) => { if (m.type() === 'error') samErrors.push(m.text()); });
    samPage.on('pageerror', (e) => samErrors.push(e.message));
    await samPage.routeWebSocket(/\/api\/rooms\//, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => { setTimeout(() => server.send(m), delay); });
      server.onMessage((m) => ws.send(m));
    });
    await samPage.goto(`/b/${id}`);
    await expect.poll(() => samPage.evaluate(() => window.__vidi6?.connectionState), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe('connected');
    await setCamera(samPage, 0, 0, 1);

    await drawRect(dana.page, [100, 150], [250, 250]);
    await drawRect(dana.page, [600, 150], [750, 250]);
    await expect(shapes(samPage)).toHaveCount(2, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    delay = 1500;
    await samPage.mouse.click(675, 200);
    await samPage.keyboard.press('Delete');
    await expect(shapes(samPage)).toHaveCount(1);
    // Dana still sees B, so her arrow attaches to it.
    await expect(shapes(dana.page)).toHaveCount(2);
    await connect(dana.page, [175, 200], [675, 200]);
    await expect(arrows(dana.page)).toHaveCount(1);

    // Once Sam's delete arrives Dana's shape is gone, the arrow stays and is drawn at its fallback point.
    await expect(shapes(dana.page)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(arrows(dana.page)).toHaveCount(1);
    expect(sameLine(await lineOf(dana.page), [250, 200, 600, 200])).toBe(true);
    await expect(arrows(samPage)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    expect(sameLine(await lineOf(samPage), [250, 200, 600, 200])).toBe(true);
    expect(dana.errors).toEqual([]);
    expect(samErrors).toEqual([]);
    await dana.context.close();
    await context.close();
  });
});
