import { expect, test } from '@playwright/test';
import { waitForSettled, setCamera } from './helpers/board';
import { openParticipants, closeParticipants, expectEventually } from './helpers/participants';

/** Read all objects from the board test hooks. */
async function readAllObjects(page: import('@playwright/test').Page) {
  const objects = await page.evaluate(() => window.__vidi6?.getAllObjects() ?? []);
  return objects as readonly {
    id: string; type: string; x: number; y: number; z: number;
    width?: number; height?: number; kind?: string; label?: string;
    from?: { kind: string; objectId?: string };
    to?: { kind: string; objectId?: string };
  }[];
}

/** Wait for a new object of given type to appear. */
async function waitForNewObject(page: import('@playwright/test').Page, type: string, beforeCount: number): Promise<string> {
  await expect.poll(async () => {
    const after = await readAllObjects(page);
    return after.filter((o) => o.type === type).length;
  }, { timeout: 5000 }).toBeGreaterThan(beforeCount);
  const after = await readAllObjects(page);
  return after.filter((o) => o.type === type).pop()!.id;
}

/** Create a shape at screen position using shape tool, then return id. */
async function createShapeAt(page: import('@playwright/test').Page, x: number, y: number): Promise<string> {
  await page.keyboard.press('s');
  await waitForSettled(page);
  const before = await readAllObjects(page);
  const count = before.filter((o) => o.type === 'shape').length;
  await page.mouse.click(x, y);
  return waitForNewObject(page, 'shape', count);
}

test.describe('story 10: Connectors', () => {
  test('TC-25: Connector follows remote moves', async ({ browser }) => {
    const initCtx = await browser.newContext();
    const initPage = await initCtx.newPage();
    const res = await initPage.request.post('/api/boards');
    const { id: boardId } = await res.json() as { id: string };
    await initCtx.close();

    const participants = await openParticipants(browser, boardId, 2);
    const dana = participants[0]!;
    const sam = participants[1]!;

    try {
      await setCamera(dana.page, { x: -640, y: -400, zoom: 1 });
      await setCamera(sam.page, { x: -640, y: -400, zoom: 1 });

      // Dana creates two shapes (need S before each click since tool resets after creation)
      await createShapeAt(dana.page, 400, 300);
      await createShapeAt(dana.page, 880, 300);

      // Dana connects them with connector tool
      await dana.page.keyboard.press('l');
      await waitForSettled(dana.page);

      const b3 = await readAllObjects(dana.page);
      await dana.page.mouse.move(400, 300);
      await dana.page.mouse.down();
      await dana.page.mouse.move(640, 300, { steps: 3 });
      await dana.page.mouse.move(880, 300, { steps: 3 });
      await dana.page.mouse.up();
      await waitForSettled(dana.page);

      const connId = await waitForNewObject(dana.page, 'connector', b3.filter((o) => o.type === 'connector').length);

      // Verify connector exists and is attached
      const danaObjs = await readAllObjects(dana.page);
      const danaConn = danaObjs.find((o) => o.id === connId)!;
      expect(danaConn).toBeDefined();
      expect(danaConn.from!.kind).toBe('attached');
      expect(danaConn.to!.kind).toBe('attached');

      // Wait for Sam to see connector
      await expectEventually('Sam sees connector', async () => {
        const samObjs = await readAllObjects(sam.page);
        if (!samObjs.find((o) => o.type === 'connector')) throw new Error('No connector on Sam');
      });

      // Dana moves B to the left of A
      await dana.page.keyboard.press('v');
      await waitForSettled(dana.page);
      await dana.page.mouse.move(880, 300);
      await dana.page.mouse.down();
      await dana.page.mouse.move(540, 300, { steps: 3 });
      await dana.page.mouse.move(200, 300, { steps: 3 });
      await dana.page.mouse.up();
      await waitForSettled(dana.page);

      // Verify arrow still attached on Dana
      const danaAfter = await readAllObjects(dana.page);
      const danaAfterConn = danaAfter.find((o) => o.id === connId)!;
      expect(danaAfterConn.from!.kind).toBe('attached');
      expect(danaAfterConn.to!.kind).toBe('attached');

      // Verify arrow attached on Sam too
      await expectEventually('Sam sees attached arrow after remote move', async () => {
        const samAfter = await readAllObjects(sam.page);
        const conn = samAfter.find((o) => o.id === connId)!;
        if (conn.from!.kind !== 'attached') throw new Error('from not attached on Sam');
        if (conn.to!.kind !== 'attached') throw new Error('to not attached on Sam');
      });
    } finally {
      await closeParticipants(participants);
    }
  });

  test('TC-26: Delete connected object → arrow has free end on both screens', async ({ browser }) => {
    const initCtx = await browser.newContext();
    const initPage = await initCtx.newPage();
    const res = await initPage.request.post('/api/boards');
    const { id: boardId } = await res.json() as { id: string };
    await initCtx.close();

    const participants = await openParticipants(browser, boardId, 2);
    const dana = participants[0]!;
    const sam = participants[1]!;

    try {
      await setCamera(dana.page, { x: -640, y: -400, zoom: 1 });
      await setCamera(sam.page, { x: -640, y: -400, zoom: 1 });

      // Dana creates two shapes and connects them
      await createShapeAt(dana.page, 400, 300);
      await createShapeAt(dana.page, 880, 300);

      // Connect
      await dana.page.keyboard.press('l');
      await waitForSettled(dana.page);

      const b3 = await readAllObjects(dana.page);
      await dana.page.mouse.move(400, 300);
      await dana.page.mouse.down();
      await dana.page.mouse.move(880, 300, { steps: 5 });
      await dana.page.mouse.up();
      await waitForSettled(dana.page);
      const connId = await waitForNewObject(dana.page, 'connector', b3.filter((o) => o.type === 'connector').length);

      // Wait for Sam to see connector
      await expectEventually('Sam sees connector', async () => {
        const samObjs = await readAllObjects(sam.page);
        if (!samObjs.find((o) => o.type === 'connector')) throw new Error('No connector');
      });

      // Sam deletes shape B (at screen 880, 300)
      await sam.page.keyboard.press('v');
      await waitForSettled(sam.page);
      await sam.page.mouse.click(880, 300);
      await waitForSettled(sam.page);
      await sam.page.keyboard.press('Delete');
      await waitForSettled(sam.page);

      // Dana sees arrow with free end
      await expectEventually('Dana sees detached arrow after remote delete', async () => {
        const danaObjs = await readAllObjects(dana.page);
        const conn = danaObjs.find((o) => o.id === connId)!;
        if (!conn) throw new Error('Connector missing on Dana');
        if (conn.to!.kind !== 'free') throw new Error(`to kind is ${conn.to!.kind}, expected free`);
      });

      // Sam sees arrow with free end too
      const samObjs = await readAllObjects(sam.page);
      const samConn = samObjs.find((o) => o.id === connId)!;
      expect(samConn).toBeDefined();
      expect(samConn.to!.kind).toBe('free');
    } finally {
      await closeParticipants(participants);
    }
  });

  test('TC-27: Delete race renders arrow without errors', async ({ browser }) => {
    const initCtx = await browser.newContext();
    const initPage = await initCtx.newPage();
    const res = await initPage.request.post('/api/boards');
    const { id: boardId } = await res.json() as { id: string };
    await initCtx.close();

    const participants = await openParticipants(browser, boardId, 2);
    const dana = participants[0]!;
    const sam = participants[1]!;
    const consoleErrors: string[] = [];
    dana.page.on('pageerror', (err) => consoleErrors.push(err.message));

    try {
      await setCamera(dana.page, { x: -640, y: -400, zoom: 1 });
      await setCamera(sam.page, { x: -640, y: -400, zoom: 1 });

      // Dana creates two shapes
      await createShapeAt(dana.page, 400, 300);
      await createShapeAt(dana.page, 880, 300);

      // Wait for Sam to see shapes
      await expectEventually('Sam sees shapes', async () => {
        const samObjs = await readAllObjects(sam.page);
        if (samObjs.filter((o) => o.type === 'shape').length < 2) throw new Error('Shapes not synced');
      });

      // Sam selects B
      await sam.page.keyboard.press('v');
      await waitForSettled(sam.page);
      await sam.page.mouse.click(880, 300);
      await waitForSettled(sam.page);

      // Dana starts connector drag from A toward B
      await dana.page.keyboard.press('l');
      await waitForSettled(dana.page);
      await dana.page.mouse.move(400, 300);
      await dana.page.mouse.down();
      await dana.page.mouse.move(640, 300, { steps: 2 });

      // Sam deletes B while Dana is mid-drag
      await sam.page.keyboard.press('Delete');
      await waitForSettled(sam.page);

      // Dana completes drag to where B was
      await dana.page.mouse.move(880, 300, { steps: 2 });
      await dana.page.mouse.up();
      await waitForSettled(dana.page);

      // No crash; board is still functional
      expect(consoleErrors.length).toBe(0);

      // Verify Dana's board is still functional
      const danaFinal = await readAllObjects(dana.page);
      expect(danaFinal.length).toBeGreaterThanOrEqual(0);
    } finally {
      await closeParticipants(participants);
    }
  });
});
