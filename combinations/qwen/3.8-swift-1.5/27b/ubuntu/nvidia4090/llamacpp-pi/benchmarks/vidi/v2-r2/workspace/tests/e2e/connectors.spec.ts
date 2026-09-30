/**
 * E2E tests for connectors (story 10).
 * TC-25, TC-26, TC-27.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { setCamera } from './helpers/board';
import { createParticipants, expectEventually } from './helpers/participants';

interface BoardObj {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  kind?: string;
  from?: { kind: string; objectId?: string; x?: number; y?: number };
  to?: { kind: string; objectId?: string; x?: number; y?: number };
  z: number;
}

async function boardSnapshot(page: Page): Promise<readonly BoardObj[]> {
  return page.evaluate(() => (window as any).__vidi6?.snapshot?.() ?? []);
}

/** Create a shape at world position using the __vidi6 hook. */
async function createShapeAt(page: Page, x: number, y: number, kind: string = 'rect'): Promise<string> {
  return page.evaluate(({ x, y, kind }) => {
    return (window as any).__vidi6?.createShape?.(x, y, kind) ?? null;
  }, { x, y, kind });
}

/** Switch to a tool by pressing a key. */
async function switchToTool(page: Page, key: string) {
  await page.keyboard.press(key);
}

test.describe('connectors (e2e)', () => {
  test('TC-25: Dana connects A to B, drags B past A; Sam sees arrow follow', async ({ browser }) => {
    const participants = await createParticipants(browser, 2, 'http://localhost:8787');
    const [dana, sam] = participants;

    await setCamera(dana.page, -640, -400, 1);
    await setCamera(sam.page, -640, -400, 1);

    // Create two shapes
    const aId = await createShapeAt(dana.page, 0, 0, 'rect');
    const bId = await createShapeAt(dana.page, 400, 0, 'rect');
    expect(aId).not.toBeNull();
    expect(bId).not.toBeNull();

    // Wait for Sam to see both shapes
    await expectEventually(
      async () => {
        const snap = await boardSnapshot(sam.page);
        return snap.length >= 2;
      },
      'Sam sees both shapes'
    );

    // Dana: switch to connector tool and drag from A to B
    await switchToTool(dana.page, 'l');

    const vpBox = await dana.page.getByTestId('board-viewport').boundingBox();
    if (!vpBox) throw new Error('viewport not found');

    // Screen position of A center: world (80,80) → screen (80+640, 80+400) = (720, 480)
    // Screen position of B center: world (480,80) → screen (480+640, 80+400) = (1120, 480)
    const aScreenX = vpBox.x + 720;
    const aScreenY = vpBox.y + 480;
    const bScreenX = vpBox.x + 1120;
    const bScreenY = vpBox.y + 480;

    await dana.page.mouse.move(aScreenX, aScreenY);
    await dana.page.mouse.down();
    await dana.page.mouse.move(bScreenX, bScreenY, { steps: 10 });
    await dana.page.mouse.up();

    // Wait for the connector to appear
    await expectEventually(
      async () => {
        const snap = await boardSnapshot(sam.page);
        return snap.find((s) => s.type === 'connector');
      },
      'Sam sees the connector'
    );

    // Dana: switch to select tool and drag B past A
    await switchToTool(dana.page, 'v');

    // Select B and drag it
    // B is at world (400, 0, 160, 160) → center at (480, 80) → screen (1120, 480)
    await dana.page.mouse.click(vpBox.x + 1120, vpBox.y + 480);
    await dana.page.mouse.down();
    // Drag B to world (-200, 0) → screen (-200+640, 80+400) = (440, 480)
    await dana.page.mouse.move(vpBox.x + 440, vpBox.y + 480, { steps: 10 });
    await dana.page.mouse.up();

    // Wait for Sam to see B moved and the connector still attached
    await expectEventually(
      async () => {
        const snap = await boardSnapshot(sam.page);
        const b = snap.find((s) => s.id === bId);
        const conn = snap.find((s) => s.type === 'connector');
        if (!b || !conn) return false;
        // B should have moved (x changed from 400)
        // Connector should still be attached to B
        return b.x !== 400 && conn.to?.objectId === bId;
      },
      'Sam sees B moved and connector still attached'
    );

    for (const p of participants) await p.context.close();
  });

  test('TC-26: Sam deletes B → arrow remains with free end', async ({ browser }) => {
    const participants = await createParticipants(browser, 2, 'http://localhost:8787');
    const [dana, sam] = participants;

    await setCamera(dana.page, -640, -400, 1);
    await setCamera(sam.page, -640, -400, 1);

    // Create shapes and a connector
    const aId = await createShapeAt(dana.page, 0, 0, 'rect');
    const bId = await createShapeAt(dana.page, 400, 0, 'rect');
    expect(aId).not.toBeNull();
    expect(bId).not.toBeNull();

    // Create connector using the __vidi6 hook (programmatic)
    await dana.page.evaluate(({ aId, bId }) => {
      const conn = (window as any).__vidi6?.createConnector?.(aId, bId);
      return conn;
    }, { aId, bId });

    // Wait for Sam to see the connector
    await expectEventually(
      async () => {
        const snap = await boardSnapshot(sam.page);
        return snap.find((s) => s.type === 'connector');
      },
      'Sam sees the connector'
    );

    // Sam: select B and delete it
    const vpBox = await sam.page.getByTestId('board-viewport').boundingBox();
    if (!vpBox) throw new Error('viewport not found');

    // B center at world (480, 80) → screen (1120, 480)
    await sam.page.mouse.click(vpBox.x + 1120, vpBox.y + 480);
    await sam.page.keyboard.press('Backspace');

    // Wait for the connector to have a free end
    await expectEventually(
      async () => {
        const snap = await boardSnapshot(sam.page);
        const conn = snap.find((s) => s.type === 'connector');
        if (!conn) return false;
        // The 'to' endpoint should now be free
        return conn.to?.kind === 'free';
      },
      'Connector has free end after B deleted'
    );

    // Dana should also see the update
    await expectEventually(
      async () => {
        const snap = await boardSnapshot(dana.page);
        const conn = snap.find((s) => s.type === 'connector');
        return conn?.to?.kind === 'free';
      },
      'Dana sees free end too'
    );

    for (const p of participants) await p.context.close();
  });

  test('TC-27: Dana drags arrow to B while Sam deletes B → orphaned arrow renders', async ({ browser }) => {
    const participants = await createParticipants(browser, 2, 'http://localhost:8787');
    const [dana, sam] = participants;

    await setCamera(dana.page, -640, -400, 1);
    await setCamera(sam.page, -640, -400, 1);

    // Create shapes A and B
    const aId = await createShapeAt(dana.page, 0, 0, 'rect');
    const bId = await createShapeAt(dana.page, 400, 0, 'rect');
    expect(aId).not.toBeNull();
    expect(bId).not.toBeNull();

    // Sam deletes B
    const vpBox = await sam.page.getByTestId('board-viewport').boundingBox();
    if (!vpBox) throw new Error('viewport not found');
    await sam.page.mouse.click(vpBox.x + 1120, vpBox.y + 480);
    await sam.page.keyboard.press('Backspace');

    // Dana: create a connector to B (which no longer exists)
    // Use the connector tool
    await switchToTool(dana.page, 'l');

    const danaVpBox = await dana.page.getByTestId('board-viewport').boundingBox();
    if (!danaVpBox) throw new Error('viewport not found');

    // Drag from A center to where B was
    await dana.page.mouse.move(danaVpBox.x + 720, danaVpBox.y + 480);
    await dana.page.mouse.down();
    await dana.page.mouse.move(danaVpBox.x + 1120, danaVpBox.y + 480, { steps: 10 });
    await dana.page.mouse.up();

    // Verify: no console errors on Dana's page
    const errors: string[] = [];
    dana.page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    // The connector should exist (either attached with fallback or free)
    await expectEventually(
      async () => {
        const snap = await boardSnapshot(dana.page);
        return snap.find((s) => s.type === 'connector');
      },
      'Dana has a connector'
    );

    // No critical errors (filter out expected network errors)
    const criticalErrors = errors.filter((e) => !e.includes('404') && !e.includes('network'));
    expect(criticalErrors).toHaveLength(0);

    for (const p of participants) await p.context.close();
  });
});
