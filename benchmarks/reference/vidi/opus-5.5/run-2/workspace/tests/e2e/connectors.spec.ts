/**
 * Story 10 e2e (TC-25 to TC-27): arrows follow remote moves, survive deletes and render
 * safely when their target is deleted concurrently, between real browser contexts and the
 * real `wrangler dev` BoardRoom. Cameras are at 100% on the origin, so screen pixels are
 * world units.
 */
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import type { Camera, Point } from '../../src/client/canvas/camera';
import { buildCheckoutFlow } from '../fixtures/checkout-flow';
import { isConnectorSnap } from '../../src/shared/objects/connector';
import { snapshotObjects } from '../../src/shared/board-model';
import { setCamera } from './helpers/board';
import { closeAll, expectWithin, openParticipants, waitConnected, type Participant } from './helpers/participants';
import { createBoard, seedBoard } from './helpers/seed';
import { E2E_BASE_URL } from './helpers/server';

const CAM: Camera = { x: 0, y: 0, zoom: 1 };
const MULTI_CONTEXT_TIMEOUT_MS = 120_000;
/** Sam's messages to the server are held this long in TC-27 so Dana attaches to B first. */
const SAM_UPLINK_DELAY_MS = 3000;

interface RenderedArrow {
  id: string;
  fromKind: string;
  toKind: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function arrows(page: Page): Locator {
  return page.locator('.connector-object');
}

function shapes(page: Page): Locator {
  return page.locator('.shape-object');
}

async function renderedArrows(page: Page): Promise<RenderedArrow[]> {
  return arrows(page).evaluateAll((els) =>
    els.map((el) => {
      const h = el as HTMLElement;
      return {
        id: h.dataset.id ?? '',
        fromKind: h.dataset.fromKind ?? '',
        toKind: h.dataset.toKind ?? '',
        x1: Number(h.dataset.x1),
        y1: Number(h.dataset.y1),
        x2: Number(h.dataset.x2),
        y2: Number(h.dataset.y2),
      };
    }),
  );
}

async function onlyArrowEnds(page: Page): Promise<string> {
  const list = await renderedArrows(page);
  if (list.length !== 1) return `${list.length} arrows`;
  const a = list[0]!;
  return `${a.fromKind}:${Math.round(a.x1)},${Math.round(a.y1)} → ${a.toKind}:${Math.round(a.x2)},${Math.round(a.y2)}`;
}

async function drag(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

/** S, drag a rectangle from `a` to `b`; returns the new shape's id. */
async function drawRect(page: Page, a: Point, b: Point): Promise<string> {
  const before = await shapes(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id));
  await page.keyboard.press('s');
  await drag(page, a, b);
  await expect(shapes(page)).toHaveCount(before.length + 1);
  return shapes(page).evaluateAll(
    (els, known) => els.map((e) => (e as HTMLElement).dataset.id!).find((id) => !known.includes(id))!,
    before,
  );
}

/** L, drag from `a` to `b`. */
async function connect(page: Page, a: Point, b: Point): Promise<void> {
  await page.keyboard.press('l');
  await expect(page.getByRole('button', { name: 'Connector (L)' })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(a.x, a.y);
  await expect(page.getByTestId('connection-dot')).toHaveCount(4); // hover dots on the start object
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await expect(page.locator('[data-testid="connection-dot"][data-highlighted="true"]')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
}

let people: Participant[] = [];

test.afterEach(async () => {
  await closeAll(people);
  people = [];
});

test.describe('connector.ui', () => {
  test('TC-25/TC-26 collaborative rearrange: the arrow follows Dana’s move on both screens, then survives Sam’s delete', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'multi-context scenario runs in chromium');
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    people = await openParticipants(browser, ['Dana', 'Sam']);
    const [dana, sam] = people as [Participant, Participant];
    for (const p of people) await setCamera(p.page, CAM);

    // Drawn from its bottom-right corner: the open Shape kind menu covers (200, 300) since the
    // story 12 Image button made the Tools toolbar taller. Same rectangle.
    await drawRect(dana.page, { x: 300, y: 400 }, { x: 200, y: 300 }); // A, centre (250, 350)
    await drawRect(dana.page, { x: 620, y: 300 }, { x: 780, y: 400 }); // B, centre (700, 350)
    await connect(dana.page, { x: 250, y: 350 }, { x: 700, y: 350 });
    const joined = 'attached:300,350 → attached:620,350'; // A's right side → B's left side
    await expect.poll(() => onlyArrowEnds(dana.page)).toBe(joined);
    await expectWithin(() => onlyArrowEnds(sam.page)).toBe(joined);

    // Dana drags B below and to the left of A: the arrow switches to A's bottom and B's top.
    await drag(dana.page, { x: 700, y: 330 }, { x: 150, y: 580 });
    const moved = 'attached:250,400 → attached:150,550';
    await expect.poll(() => onlyArrowEnds(dana.page)).toBe(moved);
    await expectWithin(() => onlyArrowEnds(sam.page)).toBe(moved);

    // TC-26: Sam deletes B; the arrow stays, its end free where B's top side was.
    await sam.page.mouse.click(150, 600);
    await expect(sam.page.locator('.shape-object[data-selected="true"]')).toHaveCount(1);
    await sam.page.keyboard.press('Delete');
    const detached = 'attached:250,400 → free:150,550';
    await expect.poll(() => onlyArrowEnds(sam.page)).toBe(detached);
    await expectWithin(() => onlyArrowEnds(dana.page)).toBe(detached);
    await expect(shapes(dana.page)).toHaveCount(1);
    for (const p of people) expect(p.errors).toEqual([]);
  });

  test('TC-27 delete race: Dana attaches to B while Sam deletes it; the arrow shows at the fallback, no errors', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'multi-context scenario runs in chromium');
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    const boardId = await createBoard(E2E_BASE_URL);
    people = await openParticipants(browser, ['Dana'], boardId);
    const dana = people[0]!;
    const sam = await openDelayedParticipant(browser, boardId, 'Sam');
    people.push(sam);
    for (const p of people) await setCamera(p.page, CAM);

    await drawRect(dana.page, { x: 300, y: 400 }, { x: 200, y: 300 }); // A (from its bottom-right, see TC-25)
    await drawRect(dana.page, { x: 620, y: 300 }, { x: 780, y: 400 }); // B
    await expect(shapes(sam.page)).toHaveCount(2);

    // Sam deletes B; the delete reaches the server only SAM_UPLINK_DELAY_MS later...
    await sam.page.mouse.click(700, 350);
    await expect(sam.page.locator('.shape-object[data-selected="true"]')).toHaveCount(1);
    await sam.page.keyboard.press('Delete');
    await expect(shapes(sam.page)).toHaveCount(1);
    // ...meanwhile Dana, who still sees B, connects A to it.
    await connect(dana.page, { x: 250, y: 350 }, { x: 700, y: 350 });
    const attached = 'attached:300,350 → attached:620,350';
    expect(await onlyArrowEnds(dana.page)).toBe(attached);

    // B disappears for Dana; the arrow stays, drawn at the fallback where B's side was.
    await expect(shapes(dana.page)).toHaveCount(1, { timeout: SAM_UPLINK_DELAY_MS * 3 });
    await expect.poll(() => onlyArrowEnds(dana.page)).toBe(attached);
    await expect.poll(() => onlyArrowEnds(sam.page), { timeout: SAM_UPLINK_DELAY_MS * 3 }).toBe(attached);
    await expect(arrows(dana.page)).toBeVisible();
    await expect(arrows(sam.page)).toBeVisible();
    for (const p of people) expect(p.errors).toEqual([]);
  });

  test('checkout-flow fixture renders every arrow at its resolved ends', async ({ page }) => {
    const flow = buildCheckoutFlow();
    const boardId = await createBoard(E2E_BASE_URL);
    await seedBoard(E2E_BASE_URL, boardId, flow.doc);
    await page.goto(`/b/${boardId}`);
    await page.waitForFunction(() => window.__vidi6 !== undefined);
    await setCamera(page, CAM);
    await expect(shapes(page)).toHaveCount(4);
    await expect(arrows(page)).toHaveCount(4);
    await expect(page.getByRole('group', { name: 'Arrow from Checkout to Paid?' })).toBeVisible();
    const expected = snapshotObjects(flow.doc)
      .filter(isConnectorSnap)
      .map((c) => ({ id: c.id, x1: c.fromPoint.x, y1: c.fromPoint.y, x2: c.toPoint.x, y2: c.toPoint.y }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const rendered = (await renderedArrows(page))
      .map(({ id, x1, y1, x2, y2 }) => ({ id, x1, y1, x2, y2 }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(rendered).toEqual(expected);
  });
});

/** A participant whose messages to the server are delayed (TC-27 race). */
async function openDelayedParticipant(browser: Browser, boardId: string, name: string): Promise<Participant> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.routeWebSocket(/\/api\/rooms\//, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      setTimeout(() => server.send(m), SAM_UPLINK_DELAY_MS);
    });
    server.onMessage((m) => ws.send(m));
    ws.onClose((code, reason) => void server.close({ code, reason }));
    server.onClose((code, reason) => void ws.close({ code, reason }));
  });
  const page = await context.newPage();
  const p: Participant = { name, context, page, errors: [], dialogs: [], setOnline: async () => undefined };
  page.on('console', (m) => {
    if (m.type() === 'error') p.errors.push(m.text());
  });
  page.on('pageerror', (e) => p.errors.push(e.message));
  await page.goto(`/b/${boardId}`);
  await waitConnected(page, SAM_UPLINK_DELAY_MS * 5);
  return p;
}

