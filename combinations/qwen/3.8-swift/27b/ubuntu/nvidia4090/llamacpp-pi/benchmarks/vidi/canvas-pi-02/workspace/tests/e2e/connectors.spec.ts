// E2E tests for story 10 connectors (conn.follow, conn.race): TC-25 (arrows
// follow their shapes) and TC-27 (concurrent delete + reattach). Runs
// against the `dev:test` server (Vite --mode test), which exposes the
// window.__vidi6 hooks.

import { expect, test } from '@playwright/test';
import { openBoard, setCamera } from './helpers/board';
import {
  collectErrors,
  connectParticipants,
  disposeAll,
  expectWithin,
  newBoard,
  type Participant,
} from './helpers/participants';
import { seedCheckoutFlow } from '../fixtures/checkout-flow';

type ShapeInfo = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: string;
  fill: string;
  stroke: string;
  label: string;
  z: number;
};

type Endpoint =
  | { kind: 'attached'; objectId: string }
  | { kind: 'free'; x: number; y: number };

type ConnectorInfo = {
  id: string;
  z: number;
  from: Endpoint;
  to: Endpoint;
  fromPoint: { x: number; y: number };
  toPoint: { x: number; y: number };
};

async function getShapes(page: import('@playwright/test').Page): Promise<ShapeInfo[]> {
  return page.evaluate(() => window.__vidi6?.getShapes() ?? []);
}

async function getConnectors(page: import('@playwright/test').Page): Promise<ConnectorInfo[]> {
  return page.evaluate(() => window.__vidi6?.getConnectors() ?? []);
}

/** The (id, endpoints) projection — order-independent convergence check. */
async function endpoints(page: import('@playwright/test').Page): Promise<
  Array<{ id: string; from: Endpoint; to: Endpoint }>
> {
  const conns = await getConnectors(page);
  return conns
    .map((c) => ({ id: c.id, from: c.from, to: c.to }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

test('TC-25: moving the MIDDLE shape re-resolves both adjacent arrows', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, 0, 0, 1);
  const flow = await seedCheckoutFlow(page);
  expect(flow).not.toBeNull();
  const [cart, paid, verify] = flow!.shapes;
  const [c1, c2] = flow!.connectors;

  // Before: c1 Cart(160,80) → Paid(300,80); c2 Paid(460,80) → Verify(600,80).
  let conns = await getConnectors(page);
  expect(conns.find((c) => c.id === c1)!.fromPoint).toEqual({ x: 160, y: 80 });
  expect(conns.find((c) => c.id === c1)!.toPoint).toEqual({ x: 300, y: 80 });
  expect(conns.find((c) => c.id === c2)!.fromPoint).toEqual({ x: 460, y: 80 });
  expect(conns.find((c) => c.id === c2)!.toPoint).toEqual({ x: 600, y: 80 });

  // Drag Paid (centre 380,80) straight down to (380,300): rect (300,220)–(460,380).
  await page.mouse.move(380, 80);
  await page.mouse.down();
  await page.mouse.move(380, 300, { steps: 8 });
  await page.mouse.up();

  const moved = (await getShapes(page)).find((s) => s.id === paid)!;
  expect(moved.x).toBe(300);
  expect(moved.y).toBe(220);

  // c1: Cart's nearest side to Paid' (centre 380,300) is RIGHT → (160,80);
  // Paid's nearest side to Cart is LEFT → (300,300).
  // c2: Paid's nearest side to Verify (centre 680,80) is RIGHT → (460,300);
  // Verify's nearest side to Paid' is LEFT → (600,80).
  conns = await getConnectors(page);
  const n1 = conns.find((c) => c.id === c1)!;
  expect(n1.from).toEqual({ kind: 'attached', objectId: cart });
  expect(n1.to).toEqual({ kind: 'attached', objectId: paid });
  expect(n1.fromPoint).toEqual({ x: 160, y: 80 });
  expect(n1.toPoint).toEqual({ x: 300, y: 300 });
  const n2 = conns.find((c) => c.id === c2)!;
  expect(n2.from).toEqual({ kind: 'attached', objectId: paid });
  expect(n2.to).toEqual({ kind: 'attached', objectId: verify });
  expect(n2.fromPoint).toEqual({ x: 460, y: 300 });
  expect(n2.toPoint).toEqual({ x: 600, y: 80 });
});

test('TC-27: concurrent delete + reattach — no crash, the document converges', async ({ browser }) => {
  const boardId = newBoard();
  const participants = await connectParticipants(browser, boardId, 2);
  const [a, b] = participants;
  const aErrors = collectErrors(a.page);
  const bErrors = collectErrors(b.page);

  // Seed the fixture on a (b sees it propagate).
  await setCamera(a.page, 0, 0, 1);
  const flow = await seedCheckoutFlow(a.page);
  expect(flow).not.toBeNull();
  const [, paid, , shipped] = flow!.shapes;
  const [c1, c2, c3, c4] = flow!.connectors;
  void c1;
  void c2;
  void c3;
  // Wait until b sees all 4 connectors.
  await expectWithin(async () => (await getConnectors(b.page)).length).toBe(4);

  // THE RACE: a deletes Shipped (the target of c4's attached end) while b
  // reattaches c4's free end to Paid — fired back-to-back with no awaits.
  await Promise.all([
    (async () => {
      const el = a.page.locator(`[data-testid="shape-object"][data-id="${shipped}"]`);
      await el.click();
      await a.page.keyboard.press('Delete');
    })(),
    (async () => {
      await b.page.evaluate(
        ([id, target]) => window.__vidi6?.reattachConnectorEnd(id, 'to', target, 680, 80),
        [c4, paid] as [string, string],
      );
    })(),
  ]);

  // Neither client crashed.
  expect(aErrors()).toEqual([]);
  expect(bErrors()).toEqual([]);

  // The document converges: c4 keeps a FREE Shipped-derived end AND b's
  // reattachment of the other end to Paid. The free end's exact point is
  // order-dependent (the detach anchor is the Shipped side nearest the
  // OTHER end: (1060,80) right when delete wins, (900,80) left when the
  // reattach to Paid wins), so assert the invariants, not the point.
  const wantCheck = async (p: Participant) => {
    const c = (await endpoints(p.page)).find((x) => x.id === c4);
    if (c === undefined) return false;
    const ends: Endpoint[] = [c.from, c.to];
    const free = ends.find((e) => e.kind === 'free') as { kind: 'free'; x: number; y: number } | undefined;
    // Mid-race states (delete not applied yet, or reattach not applied)
    // simply keep polling.
    return (
      free !== undefined &&
      free.y === 80 &&
      (free.x === 1060 || free.x === 900) &&
      ends.some((e) => e.kind === 'attached' && e.objectId === paid)
    );
  };
  await expectWithin(async () => wantCheck(a)).toBe(true);
  await expectWithin(async () => wantCheck(b)).toBe(true);

  // Both participants see the same full board.
  await expectWithin(async () => JSON.stringify(await endpoints(a.page))).toBe(
    JSON.stringify(await endpoints(b.page)),
  );

  await disposeAll(participants);
});
