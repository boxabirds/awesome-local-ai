import { expect, test, type Page } from '@playwright/test';
import type { WebSocketRoute } from '@playwright/test';
import { createBoard, dragBy } from './helpers/board';
import { LatencyRecorder, openParticipants } from './helpers/participants';

interface ShapeState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface EndState {
  kind: string;
  objectId?: string;
  x?: number;
  y?: number;
}

interface ConnectorState {
  id: string;
  from: EndState;
  to: EndState;
  resolved: { from: { x: number; y: number }; to: { x: number; y: number } };
  orphaned: { from: boolean; to: boolean };
}

async function getShapes(page: Page): Promise<ShapeState[]> {
  return page.evaluate(() => {
    const hook = window.__vidi6;
    if (!hook) throw new Error('window.__vidi6 missing; run the test build (MODE=test)');
    return hook.getShapes().map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      width: s.width ?? 0,
      height: s.height ?? 0
    }));
  });
}

async function getConnectors(page: Page): Promise<ConnectorState[]> {
  return page.evaluate(() => {
    const hook = window.__vidi6;
    if (!hook) throw new Error('window.__vidi6 missing; run the test build (MODE=test)');
    return hook.getConnectors().map((c) => ({
      id: c.id,
      from: c.from as unknown as EndState,
      to: c.to as unknown as EndState,
      resolved: { from: { ...c.resolved.from }, to: { ...c.resolved.to } },
      orphaned: { ...c.orphaned }
    }));
  });
}

// Default camera in the 1280x800 participant viewport: world (0,0) centred.
const CAM = { x: -640, y: -400, zoom: 1 };

function worldToScreen(p: { x: number; y: number }): { x: number; y: number } {
  return { x: (p.x - CAM.x) * CAM.zoom, y: (p.y - CAM.y) * CAM.zoom };
}

// Creates A (rect at -400..-200) and B (rect at 100..300) plus a connector
// from A's right side to the free point (100,0). Returns the created ids.
async function seedArrow(
  page: Page,
  attachTo: 'none' | 'B'
): Promise<{ a: ShapeState; b: ShapeState; connectorId: string }> {
  const aId = await page.evaluate(() =>
    window.__vidi6?.createShapeAt({ kind: 'rect', x: -300, y: -50, width: 200, height: 100 }) ?? null
  );
  const bId = await page.evaluate(() =>
    window.__vidi6?.createShapeAt({ kind: 'rect', x: 200, y: -50, width: 200, height: 100 }) ?? null
  );
  if (aId === null || bId === null) throw new Error('seed failed');
  const connectorId = await page.evaluate(
    ([a, b, mode]) =>
      window.__vidi6?.createConnectorEnds(
        { kind: 'attached', objectId: a as string, fallback: { x: -100, y: 0 } },
        mode === 'B'
          ? { kind: 'attached', objectId: b as string, fallback: { x: 200, y: 0 } }
          : { kind: 'free', x: 200, y: 0 }
      ) ?? null,
    [aId, bId, attachTo]
  );
  if (connectorId === null) throw new Error('connector seed failed');
  const shapes = await getShapes(page);
  const a = shapes.find((s) => s.id === aId) as ShapeState;
  const b = shapes.find((s) => s.id === bId) as ShapeState;
  return { a, b, connectorId };
}

function centreOf(s: ShapeState): { x: number; y: number } {
  return worldToScreen({ x: s.x + s.width / 2, y: s.y + s.height / 2 });
}

test.describe('connectors (story 10)', () => {
  test('TC-25 an arrow follows a remote move and switches sides on both screens', async ({
    browser
  }) => {
    const [dana, sam] = await openParticipants(browser, ['Dana', 'Sam']);
    const { b } = await seedArrow(dana.page, 'B');

    await expect
      .poll(() => getConnectors(sam.page).then((cs) => cs.length))
      .toBe(1);
    const before = (await getConnectors(dana.page))[0];
    expect(before.resolved.from.x).toBeCloseTo(-100, 5); // A's right side

    // Dana drags B left, past A. Sam's view must follow and re-side.
    const recorder = new LatencyRecorder();
    const bCentre = centreOf(b);
    await recorder.measure(
      'TC-25 B dragged past A reaches Sam',
      () => dragBy(dana.page, bCentre, -750, 0),
      async () => {
        const cs = await getConnectors(sam.page);
        return cs.length === 1 && cs[0].resolved.from.x < -250;
      }
    );
    recorder.report('TC-25');

    for (const p of [dana, sam]) {
      const cs = await getConnectors(p.page);
      expect(cs).toHaveLength(1);
      const c = cs[0];
      expect(c.from.kind).toBe('attached');
      expect(c.to.kind).toBe('attached');
      expect(c.orphaned.from).toBe(false);
      expect(c.orphaned.to).toBe(false);
      // The arrow switched to A's left side and B's right side.
      expect(c.resolved.from.x).toBeCloseTo(-300, 5);
      expect(c.resolved.to.x).toBeCloseTo(-350, 5);
    }
  });

  test('TC-26 deleting the attached object frees that end on both screens', async ({
    browser
  }) => {
    const [dana, sam] = await openParticipants(browser, ['Dana', 'Sam']);
    const { b } = await seedArrow(dana.page, 'B');
    await expect
      .poll(() => getConnectors(sam.page).then((cs) => cs.length))
      .toBe(1);

    const bCentre = centreOf(b);
    await sam.page.mouse.click(bCentre.x, bCentre.y);
    await sam.page.keyboard.press('Delete');

    for (const p of [sam, dana]) {
      await expect
        .poll(async () => (await getConnectors(p.page))[0]?.to.kind, { timeout: 10_000 })
        .toBe('free');
      const c = (await getConnectors(p.page))[0];
      expect(c.to.x).toBeCloseTo(200, 5); // where B's left side was
      expect(c.to.y).toBeCloseTo(0, 5);
      expect(c.from.kind).toBe('attached');
      expect((await getShapes(p.page)).length).toBe(1);
      await expect(
        p.page.locator(`[data-testid="connector-object"][data-id="${c.id}"]`)
      ).toBeVisible();
    }
  });

  test('TC-27 attaching a handle to an object a peer deletes mid-flight renders safely', async ({
    browser
  }) => {
    const bootstrap = await browser.newContext();
    const boardId = await createBoard(bootstrap.request);
    await bootstrap.close();

    const samContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const sam = await samContext.newPage();
    await sam.goto(`/b/${boardId}`);
    await expect(sam.getByTestId('board-viewport')).toBeVisible();
    const { b } = await seedArrow(sam, 'none');
    await expect
      .poll(() => sam.evaluate(() => window.__vidi6?.getConnectors().length ?? 0))
      .toBe(1);

    // Dana joins through an intercepting WebSocket route; after the initial
    // sync every server->Dana frame is held so her edit overlaps Sam's delete.
    let hold = false;
    const held: (Buffer | string)[] = [];
    let danaRoute: WebSocketRoute | null = null;
    const danaContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const dana = await danaContext.newPage();
    const errors: Error[] = [];
    dana.on('pageerror', (e) => errors.push(e));
    await dana.routeWebSocket('**/api/rooms**', (route) => {
      danaRoute = route;
      const server = route.connectToServer();
      // Page -> server keeps flowing automatically; server -> page is held.
      server.onMessage((data: string | Buffer) => {
        if (hold) held.push(data);
        else route.send(data);
      });
      server.onClose(() => void route.close());
      route.onClose(() => server.close());
    });
    await dana.goto(`/b/${boardId}`);
    await expect
      .poll(() => dana.evaluate(() => window.__vidi6?.getShapes().length ?? 0))
      .toBe(2);
    await expect
      .poll(() => dana.evaluate(() => window.__vidi6?.getConnectors().length ?? 0))
      .toBe(1);
    hold = true;

    // Sam deletes B; the update is processed by the server but invisible to Dana.
    const bCentre = centreOf(b);
    await sam.mouse.click(bCentre.x, bCentre.y);
    await sam.keyboard.press('Delete');
    await expect.poll(() => getShapes(sam).then((ss) => ss.length)).toBe(1);

    // Dana selects the arrow and drags its free end onto B (still visible).
    const mid = worldToScreen({ x: 50, y: 0 }); // on the arrow line
    await dana.mouse.click(mid.x, mid.y);
    const handle = dana.locator('[data-testid="connector-handle-to"]');
    await expect(handle).toBeVisible();
    const handleBox = await handle.boundingBox();
    if (handleBox === null) throw new Error('to-handle has no box');
    await dragBy(
      dana,
      { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 },
      bCentre.x - (handleBox.x + handleBox.width / 2),
      bCentre.y - (handleBox.y + handleBox.height / 2)
    );

    // Release the held frames: the delete lands on Dana on top of her attach.
    hold = false;
    const route = danaRoute as WebSocketRoute | null;
    if (route !== null) {
      for (const frame of held.splice(0, held.length)) await route.send(frame);
    }

    await expect
      .poll(() => dana.evaluate(() => window.__vidi6?.getShapes().length ?? 0))
      .toBe(1);
    await expect
      .poll(async () => {
        const cs = await getConnectors(dana);
        return cs.length === 1 && (cs[0].to.kind === 'free' || cs[0].orphaned.to);
      })
      .toBe(true);
    const c = (await getConnectors(dana))[0];
    expect(Number.isFinite(c.resolved.to.x)).toBe(true);
    expect(Number.isFinite(c.resolved.to.y)).toBe(true);
    await expect(
      dana.locator(`[data-testid="connector-object"][data-id="${c.id}"]`)
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});
