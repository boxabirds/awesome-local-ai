// Story 10 — arrows that follow when moved, for everyone on the board
// (workflows "Collaborative rearrange", TC-25 → TC-26, and "Delete race", TC-27).
import { expect, test, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';
import { checkoutFlow } from '../fixtures/checkout-flow';
import { setCamera, viewport } from './helpers/board';
import {
  closeAll,
  openParticipant,
  openParticipants,
  printLatencyReport,
  recordLatency,
  type Participant,
} from './helpers/participants';
import { seedBoard } from './helpers/seed';
import { createBoardId } from './helpers/server';

const CAMERA = { x: -400, y: -100, zoom: 1 };

let participants: Participant[] = [];
test.afterEach(async () => {
  await closeAll(participants);
  participants = [];
});
test.afterAll(() => printLatencyReport('story 10 connectors'));

async function seeded(baseURL: string) {
  const boardId = await createBoardId(baseURL);
  const fixture = checkoutFlow();
  await seedBoard(baseURL, boardId, fixture.doc);
  return { boardId, shapes: fixture.shapes };
}

async function ready(page: Page) {
  await expect(page.locator('[data-shape-id]')).toHaveCount(4, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await expect(page.locator('[data-connector-id]')).toHaveCount(4, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await setCamera(page, CAMERA);
}

/** Viewport pixel of a world point. */
async function toScreen(page: Page, p: { x: number; y: number }) {
  const box = (await viewport(page).boundingBox())!;
  return { x: box.x + (p.x - CAMERA.x) * CAMERA.zoom, y: box.y + (p.y - CAMERA.y) * CAMERA.zoom };
}

interface ArrowOnScreen {
  id: string;
  fromObject?: string;
  toObject?: string;
  fromKind: string;
  toKind: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

async function arrows(page: Page): Promise<ArrowOnScreen[]> {
  return page.locator('[data-connector-id]').evaluateAll((els) =>
    els.map((el) => {
      const d = (el as HTMLElement).dataset;
      return {
        id: d.connectorId!,
        fromObject: d.fromObject,
        toObject: d.toObject,
        fromKind: d.fromKind!,
        toKind: d.toKind!,
        from: { x: Number(d.fromX), y: Number(d.fromY) },
        to: { x: Number(d.toX), y: Number(d.toY) },
      };
    }),
  );
}

async function arrowBetween(page: Page, from: string, to: string): Promise<ArrowOnScreen | undefined> {
  return (await arrows(page)).find((a) => a.fromObject === from && a.toObject === to);
}

async function arrowById(page: Page, id: string): Promise<ArrowOnScreen | undefined> {
  return (await arrows(page)).find((a) => a.id === id);
}

async function dragMouse(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

const near = (a: { x: number; y: number }, b: { x: number; y: number }, tol = 0.5) =>
  Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;

test.describe('Workflow: collaborative rearrange', () => {
  test('TC-25 → TC-26 an arrow follows a moved shape on both screens and survives its deletion', async ({ browser, baseURL }) => {
    const { boardId, shapes } = await seeded(baseURL!);
    participants = await openParticipants(browser, ['dana', 'sam'], boardId);
    const [dana, sam] = participants;
    await ready(dana.page);
    await ready(sam.page);

    // Dana connects Cart (100,100 160x100) to Retry payment (400,350 160x100).
    await dana.page.keyboard.press('l');
    const hover = await toScreen(dana.page, { x: 180, y: 150 });
    await dana.page.mouse.move(hover.x, hover.y);
    await expect(dana.page.getByTestId('connection-dot')).toHaveCount(4);
    await dana.page.mouse.down();
    const over = await toScreen(dana.page, { x: 480, y: 400 });
    await dana.page.mouse.move(over.x, over.y, { steps: 8 });
    await expect(dana.page.locator('[data-testid="connection-dot"][data-highlighted="true"]')).toHaveAttribute('data-side', 'top');
    await dana.page.mouse.up();
    await expect(dana.page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
    const created = await arrowBetween(dana.page, shapes.cart, shapes.retry);
    expect(created).toBeDefined();
    expect(created!.from).toEqual({ x: 180, y: 200 }); // Cart's bottom
    expect(created!.to).toEqual({ x: 480, y: 350 }); // Retry's top
    await expect.poll(() => arrowById(sam.page, created!.id), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBeDefined();

    // Dana drags Retry payment past Cart, to its left: both ends switch sides.
    const start = await toScreen(dana.page, { x: 480, y: 400 });
    const end = await toScreen(dana.page, { x: -120, y: 150 });
    await dragMouse(dana.page, start, end);
    const t0 = Date.now();
    const followed = (a: ArrowOnScreen | undefined) =>
      a !== undefined && a.toKind === 'attached' && near(a.from, { x: 100, y: 150 }) && near(a.to, { x: -40, y: 150 });
    await expect.poll(async () => followed(await arrowById(dana.page, created!.id))).toBe(true);
    await expect
      .poll(async () => followed(await arrowById(sam.page, created!.id)), { timeout: E2E_EVENTUAL_TIMEOUT_MS, intervals: [20, 50, 100] })
      .toBe(true);
    const ms = Date.now() - t0;
    recordLatency('TC-25 arrow follows a remote move', ms);
    console.log(`TC-25 arrow follow delivered to Sam in ${ms} ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms, not asserted)`);

    // TC-26: Sam deletes Retry payment; the arrow stays with a free end where its side was.
    const retryOnSam = await toScreen(sam.page, { x: -120, y: 150 });
    await sam.page.mouse.click(retryOnSam.x, retryOnSam.y);
    await expect(sam.page.locator(`[data-shape-id="${shapes.retry}"]`)).toHaveAttribute('data-selected', 'true');
    await sam.page.keyboard.press('Delete');
    for (const p of [sam.page, dana.page]) {
      await expect(p.locator(`[data-shape-id="${shapes.retry}"]`)).toHaveCount(0, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
      await expect
        .poll(async () => {
          const a = await arrowById(p, created!.id);
          return a !== undefined && a.toKind === 'free' && near(a.to, { x: -40, y: 150 }) && near(a.from, { x: 100, y: 150 });
        }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(true);
    }
    expect(dana.consoleErrors).toEqual([]);
    expect(sam.consoleErrors).toEqual([]);
  });
});

test.describe('Workflow: delete race', () => {
  test('TC-27 an arrow drawn to a shape someone deletes at the same moment is shown at its fallback point', async ({
    browser,
    baseURL,
  }) => {
    const { boardId, shapes } = await seeded(baseURL!);
    const dana = await openParticipant(browser, 'dana', boardId);
    // Sam's outgoing WebSocket traffic can be held back to force the overlap.
    let delayMs = 0;
    const sam = await openParticipant(browser, 'sam', boardId, async (page) => {
      await page.routeWebSocket(/\/api\/rooms\//, (ws) => {
        const server = ws.connectToServer();
        ws.onMessage((m) => {
          if (delayMs > 0) setTimeout(() => server.send(m), delayMs);
          else server.send(m);
        });
        server.onMessage((m) => ws.send(m));
      });
    });
    participants = [dana, sam];
    await ready(dana.page);
    await ready(sam.page);

    // Sam deletes Receipt (700,100 160x100); the delete reaches the server late.
    delayMs = 2500;
    const receipt = await toScreen(sam.page, { x: 780, y: 150 });
    await sam.page.mouse.click(receipt.x, receipt.y);
    await sam.page.keyboard.press('Delete');
    await expect(sam.page.locator(`[data-shape-id="${shapes.receipt}"]`)).toHaveCount(0);

    // Meanwhile Dana, who still sees Receipt, draws an arrow from Cart to it.
    await dana.page.keyboard.press('l');
    const from = await toScreen(dana.page, { x: 180, y: 180 });
    const to = await toScreen(dana.page, { x: 780, y: 180 });
    await dragMouse(dana.page, from, to);
    const created = await arrowBetween(dana.page, shapes.cart, shapes.receipt);
    expect(created).toBeDefined();
    const fallback = created!.to; // Receipt's side facing Cart when attached
    expect(fallback).toEqual({ x: 700, y: 150 });

    // Sam's delete lands: Receipt disappears for Dana, the new arrow stays, drawn at its fallback.
    await expect(dana.page.locator(`[data-shape-id="${shapes.receipt}"]`)).toHaveCount(0, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    delayMs = 0;
    for (const p of [dana.page, sam.page]) {
      await expect
        .poll(async () => {
          const a = await arrowById(p, created!.id);
          return a !== undefined && near(a.to, fallback) && near(a.from, { x: 260, y: 150 });
        }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(true);
      await expect(p.locator(`[data-connector-id="${created!.id}"]`)).toBeVisible();
    }
    expect(dana.consoleErrors).toEqual([]);
    expect(sam.consoleErrors).toEqual([]);
  });
});
