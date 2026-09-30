// Story 10 e2e: arrows between shapes with two people on one board, against the real sync
// service (wrangler dev). Workflows "Collaborative rearrange" (TC-25, TC-26) and "Delete race"
// (TC-27). Delivery times are logged against LIVE_UPDATE_LATENCY_BUDGET_MS, not asserted.
import { type Page, type TestInfo, expect, test } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { checkoutFlow } from '../fixtures/checkout-flow';
import { getCamera, setCamera, waitForFrame } from './helpers/board';
import { LatencyLog, type Participant, openParticipants } from './helpers/participants';
import { createBoardViaApi, seedBoard } from './helpers/seed';

// 100% zoom with world (0, 0) at page (0, 0): page pixels are world units.
const CAMERA = { x: 0, y: 0, zoom: 1 };

interface Point {
  x: number;
  y: number;
}
type Endpoint = { kind: 'attached'; objectId: string; fallback: Point } | { kind: 'free'; x: number; y: number };
interface Obj {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  from?: Endpoint;
  to?: Endpoint;
  ends?: { from: Point; to: Point };
}

test.beforeEach(({ browserName }) => {
  test.skip(browserName !== 'chromium', 'Chromium only (design)');
});

async function showCamera(page: Page) {
  await setCamera(page, CAMERA);
  await expect.poll(() => getCamera(page)).toEqual(CAMERA);
  await waitForFrame(page);
}

async function objects(page: Page): Promise<Obj[]> {
  return page.evaluate(() => window.__vidi6!.getObjects!() as unknown as Obj[]);
}

/** The drawn ends of arrow `id` on a page, read from its rendered element. */
async function drawnEnds(page: Page, id: string): Promise<{ from: Point; to: Point } | null> {
  return page.evaluate((arrowId) => {
    const el = document.querySelector<HTMLElement>(`[data-connector-id="${arrowId}"]`);
    if (!el) return null;
    const point = (v: string) => {
      const [x, y] = v.split(',').map(Number);
      return { x, y };
    };
    return { from: point(el.dataset.from!), to: point(el.dataset.to!) };
  }, id);
}

async function dragBy(page: Page, from: Point, to: Point) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await waitForFrame(page);
}

async function drawShape(page: Page, from: Point, to: Point) {
  await page.keyboard.press('s');
  await dragBy(page, from, to);
  await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
}

function expectNoProblems(...people: Participant[]) {
  for (const p of people) expect(p.problems, `${p.name} console/page errors`).toEqual([]);
}

test.describe('Workflow: Collaborative rearrange', () => {
  test('TC-25 the arrow follows B past A on both screens; TC-26 Sam deletes B and the arrow stays', async ({
    browser,
  }, testInfo: TestInfo) => {
    const session = await openParticipants(browser, testInfo, ['Dana', 'Sam']);
    const [dana, sam] = session.participants;
    const log = new LatencyLog();
    try {
      await showCamera(dana.page);
      await showCamera(sam.page);

      // A at (400,300) 120x80 and B at (800,300) 120x80.
      await drawShape(dana.page, { x: 400, y: 300 }, { x: 520, y: 380 });
      await drawShape(dana.page, { x: 800, y: 300 }, { x: 920, y: 380 });
      await expect.poll(async () => (await objects(dana.page)).length).toBe(2);
      const [a, b] = await objects(dana.page);

      // Hovering A with the Connector tool shows its four dots; the drag highlights B's left dot.
      await dana.page.keyboard.press('l');
      await dana.page.mouse.move(460, 340);
      await expect(dana.page.getByTestId('connector-dot')).toHaveCount(4);
      await dana.page.mouse.down();
      await dana.page.mouse.move(700, 340, { steps: 5 });
      await dana.page.mouse.move(860, 340, { steps: 5 });
      await expect(dana.page.locator('[data-testid="connector-dot"][data-highlighted="true"]')).toHaveAttribute(
        'data-side',
        'left',
      );
      await dana.page.mouse.up();
      await expect.poll(async () => (await objects(dana.page)).filter((o) => o.type === 'connector').length).toBe(1);
      const arrow = (await objects(dana.page)).find((o) => o.type === 'connector')!;
      expect(arrow.from).toMatchObject({ kind: 'attached', objectId: a.id });
      expect(arrow.to).toMatchObject({ kind: 'attached', objectId: b.id });
      const before = { from: { x: 520, y: 340 }, to: { x: 800, y: 340 } };
      expect(await drawnEnds(dana.page, arrow.id)).toEqual(before);
      await log.expectEventually('arrow appears for Sam', async () =>
        JSON.stringify(await drawnEnds(sam.page, arrow.id)) === JSON.stringify(before),
      );

      // Dana drags B to the left of A: the arrow switches to A's left side and B's right side.
      await dana.page.keyboard.press('v');
      await dragBy(dana.page, { x: 860, y: 340 }, { x: 160, y: 340 });
      const after = { from: { x: 400, y: 340 }, to: { x: 220, y: 340 } };
      expect(await drawnEnds(dana.page, arrow.id)).toEqual(after);
      const moved = Date.now();
      await log.expectEventually(
        'arrow follows the move for Sam',
        async () => JSON.stringify(await drawnEnds(sam.page, arrow.id)) === JSON.stringify(after),
        moved,
      );
      // No write to the arrow was needed: its ends are still attached.
      const stored = (await objects(sam.page)).find((o) => o.id === arrow.id)!;
      expect(stored.to).toMatchObject({ kind: 'attached', objectId: b.id });

      // TC-26: Sam deletes B.
      await sam.page.mouse.click(160, 340);
      await expect(sam.page.getByTestId('selection-status')).toHaveText('1 selected');
      await sam.page.keyboard.press('Delete');
      for (const p of [sam, dana]) {
        await log.expectEventually(`B deleted, arrow kept (${p.name})`, async () => {
          const objs = await objects(p.page);
          const c = objs.find((o) => o.id === arrow.id);
          return !objs.some((o) => o.id === b.id) && c?.to?.kind === 'free';
        });
        const c = (await objects(p.page)).find((o) => o.id === arrow.id)!;
        expect(c.to).toEqual({ kind: 'free', x: 220, y: 340 });
        expect(await drawnEnds(p.page, arrow.id)).toEqual(after);
        await expect(p.page.locator(`[data-connector-id="${arrow.id}"] .connector-head`)).toBeVisible();
      }
      expectNoProblems(dana, sam);
    } finally {
      await testInfo.attach('latency', { body: log.report('story 10 collaborative rearrange') });
      await session.close();
    }
  });

  test('a seeded checkout flow shows every shape and arrow; moving a shape redraws its arrows for the other person', async ({
    browser,
    baseURL,
  }, testInfo: TestInfo) => {
    const flow = checkoutFlow(200, 200);
    const boardId = await createBoardViaApi(baseURL!);
    await seedBoard(baseURL!, boardId, flow.updates);
    const session = await openParticipants(browser, testInfo, ['Dana', 'Sam'], boardId);
    const [dana, sam] = session.participants;
    try {
      for (const p of [dana, sam]) {
        await showCamera(p.page);
        await expect(p.page.locator('[data-shape-id]')).toHaveCount(4);
        await expect(p.page.locator('[data-connector-id]')).toHaveCount(4);
        await expect(p.page.getByRole('group', { name: 'Paid?' })).toHaveAttribute('aria-roledescription', 'Diamond');
      }
      // Paid? (diamond at 500,180 120x120) → Order confirmed (rect at 760,200): right side to left side.
      expect(await drawnEnds(sam.page, flow.arrows.paidToDone)).toEqual({
        from: { x: 620, y: 240 },
        to: { x: 760, y: 240 },
      });
      // Dana moves Order confirmed down by 300: the arrow now leaves Paid? from the bottom.
      await dragBy(dana.page, { x: 840, y: 240 }, { x: 840, y: 540 });
      await expect
        .poll(() => drawnEnds(sam.page, flow.arrows.paidToDone), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toEqual({ from: { x: 560, y: 300 }, to: { x: 840, y: 500 } });
      expectNoProblems(dana, sam);
    } finally {
      await session.close();
    }
  });
});

test.describe('Workflow: Delete race', () => {
  test('TC-27 Dana attaches an arrow to B while Sam deletes it: the arrow shows with its end at the fallback', async ({
    browser,
    baseURL,
  }, testInfo: TestInfo) => {
    const flow = checkoutFlow(200, 200);
    const boardId = await createBoardViaApi(baseURL!);
    await seedBoard(baseURL!, boardId, flow.updates);
    // Sam's outgoing messages can be held back, so that Sam's delete reaches the room only after
    // Dana has attached her arrow to the shape (the two changes overlap).
    let holdSam = false;
    const session = await openParticipants(browser, testInfo, ['Dana', 'Sam'], boardId, async (name, page) => {
      if (name !== 'Sam') return;
      await page.routeWebSocket(/\/api\/rooms\//, (ws) => {
        const server = ws.connectToServer();
        let chain = Promise.resolve();
        ws.onMessage((msg) => {
          const held = holdSam;
          chain = chain
            .then(() => (held ? new Promise<void>((r) => setTimeout(r, 2500)) : undefined))
            .then(() => server.send(msg));
        });
      });
    });
    const [dana, sam] = session.participants;
    const { checkout, retry } = flow.shapes;
    try {
      for (const p of [dana, sam]) await showCamera(p.page);
      // Retry payment: ellipse at (480,420) 160x90. Checkout: rect at (200,200) 160x80.
      holdSam = true;
      await sam.page.mouse.click(560, 465);
      await expect(sam.page.getByTestId('selection-status')).toHaveText('1 selected');
      await sam.page.keyboard.press('Delete');
      await expect.poll(async () => (await objects(sam.page)).some((o) => o.id === retry)).toBe(false);

      // Dana still sees Retry payment and connects Checkout to it.
      expect((await objects(dana.page)).some((o) => o.id === retry)).toBe(true);
      const before = new Set((await objects(dana.page)).map((o) => o.id));
      await dana.page.keyboard.press('l');
      await dragBy(dana.page, { x: 280, y: 240 }, { x: 560, y: 465 });
      await expect.poll(async () => (await objects(dana.page)).filter((o) => !before.has(o.id)).length).toBe(1);
      const arrow = (await objects(dana.page)).find((o) => !before.has(o.id))!;
      expect(arrow.from).toMatchObject({ kind: 'attached', objectId: checkout });
      expect(arrow.to).toMatchObject({ kind: 'attached', objectId: retry });
      const fallback = (arrow.to as { fallback: Point }).fallback;
      holdSam = false;

      // Sam's delete arrives: Retry payment disappears for Dana, the arrow stays at its fallback.
      await expect
        .poll(async () => (await objects(dana.page)).some((o) => o.id === retry), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(false);
      for (const p of [dana, sam]) {
        await expect
          .poll(async () => (await drawnEnds(p.page, arrow.id))?.to, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
          .toEqual(fallback);
        await expect(p.page.locator(`[data-connector-id="${arrow.id}"] .connector-head`)).toBeVisible();
      }
      expectNoProblems(dana, sam);
    } finally {
      await session.close();
    }
  });
});
