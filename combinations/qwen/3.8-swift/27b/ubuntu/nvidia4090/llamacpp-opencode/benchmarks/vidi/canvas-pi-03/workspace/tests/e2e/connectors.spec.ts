import { test, expect, type Page } from '@playwright/test';
import { openParticipants, within, BUDGET } from './helpers/participants';
import { setCamera } from './helpers/board';

/**
 * Story 10 e2e — connector.ui (TC-25, TC-26, TC-27): arrows follow remote
 * moves (and switch sides), survive their target's deletion (end becomes
 * free at the fallback), and an orphaned-by-a-race arrow renders safely on
 * both screens with no console errors.
 *
 * Viewport: Desktop Chrome 1280x720; default camera: world (0,0) at screen
 * (640,360), screen = world + (640,360) at zoom 1.
 */

interface DocConnector {
  id: string;
  from: { kind: string; objectId?: string; x?: number; y?: number };
  to: { kind: string; objectId?: string; x?: number; y?: number };
}

/** Read the connectors (with their raw endpoints) from a page's doc. */
async function getConnectors(page: Page): Promise<DocConnector[]> {
  return page.evaluate(() => {
    const objects = (window as any).__vidi6.doc.getMap('objects');
    return [...objects.keys()]
      .map((key: string) => {
        const o: any = objects.get(key);
        if (o.get('type') !== 'connector') return null;
        const ep = (e: any) =>
          e && e.kind === 'free'
            ? { kind: 'free', x: e.x, y: e.y }
            : { kind: 'attached', objectId: e.objectId };
        return { id: key, from: ep(o.get('from')), to: ep(o.get('to')) };
      })
      .filter((c): c is DocConnector => c !== null);
  });
}

/**
 * The rendered world coordinates (x1,y1)-(x2,y2) of the connector's line.
 * Pass `connectorId` when the board holds several connectors.
 */
async function lineCoords(
  page: Page,
  connectorId?: string,
): Promise<{ x1: number; y1: number; x2: number; y2: number }> {
  const locator = connectorId
    ? page.locator(`[data-connector-id="${connectorId}"] [data-testid="connector-line"]`)
    : page.locator('[data-testid="connector-line"]');
  // An SVG <line> has a degenerate (zero-area) bounding box, so Playwright
  // counts it as "hidden"; wait for attachment instead.
  await locator.first().waitFor({ state: 'attached', timeout: 5000 });
  const line = locator.first();
  return {
    x1: Number(await line.getAttribute('x1')),
    y1: Number(await line.getAttribute('y1')),
    x2: Number(await line.getAttribute('x2')),
    y2: Number(await line.getAttribute('y2')),
  };
}

async function shapeIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const objects = (window as any).__vidi6.doc.getMap('objects');
    return [...objects.keys()].filter((key: string) => {
      const o: any = objects.get(key);
      return o.get('type') === 'shape';
    });
  });
}

/**
 * Dana creates A at world (-300,0) and B at world (300,0) (160x160 click
 * shapes) and connects A→B with the L tool. Returns the ids in creation
 * order [A, B].
 */
async function seedTwoConnectedShapes(dana: { page: Page }): Promise<[string, string]> {
  const { page } = dana;
  await page.keyboard.press('s');
  await page.mouse.click(640 - 300, 360); // A at world (-300,0)
  await page.keyboard.press('s');
  await page.mouse.click(640 + 300, 360); // B at world (300,0)
  const ids = await shapeIds(page);
  expect(ids).toHaveLength(2);

  await page.keyboard.press('l');
  await page.mouse.move(640 - 300, 360);
  await page.mouse.down();
  await page.mouse.move(640 + 300, 360, { steps: 8 });
  await page.mouse.up();

  const connectors = await getConnectors(page);
  expect(connectors).toHaveLength(1);
  return ids;
}

test.describe('connector.ui (e2e)', () => {
  test('TC-25: Dana drags B past A — the arrow stays attached and switches side on BOTH screens within the budget', async ({ browser }) => {
    const [dana, sam] = await openParticipants(browser, 2);

    const [a, b] = await seedTwoConnectedShapes(dana);

    // Before the move: A's RIGHT anchor (-220,0) → B's LEFT anchor (220,0).
    const before = await lineCoords(dana.page);
    expect(before.x1).toBeCloseTo(-220, 0);
    expect(before.x2).toBeCloseTo(220, 0);

    // Dana drags B (centre world (300,0) → screen (940,360)) left past A,
    // to world (-440,0) (screen (200,360)).
    await dana.page.mouse.move(940, 360);
    await dana.page.mouse.down();
    await dana.page.mouse.move(200, 360, { steps: 12 });
    await dana.page.mouse.up();

    // Both screens: the arrow stays attached to A and B ...
    const attachedOn = (page: Page) =>
      (async () => {
        const [c] = await getConnectors(page);
        return c.from.kind === 'attached' && c.from.objectId === a && c.to.kind === 'attached' && c.to.objectId === b;
      })();
    await within(BUDGET, () => attachedOn(dana.page));
    await within(BUDGET, () => attachedOn(sam.page));

    // ... and both screens show the sides switched: A's LEFT anchor
    // (-380,0) → B's RIGHT anchor (-360,0).
    const switchedOn = (page: Page) =>
      (async () => {
        const l = await lineCoords(page);
        return Math.abs(l.x1 - -380) <= 1 && Math.abs(l.x2 - -360) <= 1;
      })();
    await within(BUDGET, () => switchedOn(dana.page));
    await within(BUDGET, () => switchedOn(sam.page));
  });

  test('TC-26: Sam deletes B — the arrow remains with its end FREE where B side was, on both screens', async ({ browser }) => {
    const [dana, sam] = await openParticipants(browser, 2);

    const [a, b] = await seedTwoConnectedShapes(dana);

    // Sam selects B and deletes it.
    await sam.page.mouse.click(940, 360);
    await sam.page.keyboard.press('Delete');

    // B is gone on both screens ...
    await within(BUDGET, async () => (await shapeIds(sam.page)).length === 1);
    await within(BUDGET, async () => (await shapeIds(dana.page)).length === 1);

    // ... and the arrow remains on both, with the B end free at B's left
    // anchor (220,0) and the A end still attached.
    const assertFreeEnd = (page: Page) =>
      (async () => {
        const [c] = await getConnectors(page);
        return (
          c.from.kind === 'attached' &&
          c.from.objectId === a &&
          c.to.kind === 'free' &&
          c.to.x === 220 &&
          c.to.y === 0
        );
      })();
    await within(BUDGET, () => assertFreeEnd(sam.page));
    await within(BUDGET, () => assertFreeEnd(dana.page));

    // Both screens render the free end at (220,0).
    const renderedOn = (page: Page) =>
      (async () => {
        const l = await lineCoords(page);
        return Math.abs(l.x2 - 220) <= 1 && Math.abs(l.y2) <= 1;
      })();
    await within(BUDGET, () => renderedOn(dana.page));
    await within(BUDGET, () => renderedOn(sam.page));
  });

  test('TC-27: Dana drags the arrow end onto B while Sam deletes B — the arrow renders with its end at the fallback on both screens, no console errors', async ({ browser }) => {
    // Socket resume + re-sync makes this one the slowest in the file.
    test.setTimeout(90_000);
    const [dana, sam] = await openParticipants(browser, 2);

    // Collect console errors on BOTH screens for the whole test.
    const errors: string[] = [];
    for (const p of [dana, sam]) {
      p.page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      p.page.on('pageerror', (err) => errors.push(String(err)));
    }

    // Dana seeds the checkout flow (4 shapes + 3 attached connectors + the
    // Payment→free connector whose free end sits at world (1000,420)).
    const seeded = await dana.page.evaluate(() =>
      (window as any).__vidi6.seedCheckoutFlow() as string[],
    );
    expect(seeded).toHaveLength(4);
    const confirmation = seeded[3];

    // Both cameras: centre world (650,260) at zoom 50%.
    for (const p of [dana, sam]) {
      await setCamera(p.page, -630, -460, 0.5);
    }

    // Sam goes offline (flaky Wi-Fi) and deletes Confirmation locally:
    // the delete will NOT sync to Dana until the socket resumes.
    await sam.page.evaluate(() => (window as any).__vidi6.dropSocket());
    await sam.page.mouse.click(555, 410); // Confirmation centre (screen)
    await sam.page.keyboard.press('Delete');

    // Dana (who still has Confirmation) selects the free-ended arrow —
    // click its midpoint (screen (780,375)) — and drags the free end
    // (screen (815,440)) onto Confirmation's centre (screen (555,410)).
    await dana.page.mouse.click(780, 375);
    const freeEnd = async () => {
      const connectors = await getConnectors(dana.page);
      return connectors.find((c) => c.to.kind === 'free')!.id;
    };
    await dana.page.locator(`[data-connector-id="${await freeEnd()}"] [data-testid="connector-handle-to"]`).waitFor({ timeout: 5000 });
    await dana.page.mouse.move(815, 440);
    await dana.page.mouse.down();
    await dana.page.mouse.move(555, 410, { steps: 8 });
    await dana.page.mouse.up();

    // On Dana's screen the end is attached to Confirmation ...
    await within(BUDGET, async () => {
      const connectors = await getConnectors(dana.page);
      const c = connectors.find((cc) => cc.from.objectId === seeded[2])!;
      return c.to.kind === 'attached' && c.to.objectId === confirmation;
    });

    // Sam comes back online: the delete syncs to Dana and detaches the
    // end (free at the fallback — Confirmation's right anchor (560,360));
    // the attach syncs to Sam, where the target is gone (renders at the
    // same fallback). Wait for BOTH to be reconnected (re-sync complete),
    // then assert within the live-update budget.
    await sam.page.evaluate(() => (window as any).__vidi6.resumeSocket());
    await dana.page.waitForFunction(
      () => (window as any).__vidi6?.connectionState === 'connected',
      null,
      { timeout: 20_000 },
    );
    await sam.page.waitForFunction(
      () => (window as any).__vidi6?.connectionState === 'connected',
      null,
      { timeout: 20_000 },
    );

    // Both screens render the arrow's end at the fallback (560,360).
    const fallbackOn = (page: Page, id: string) =>
      (async () => {
        const l = await lineCoords(page, id);
        return Math.abs(l.x2 - 560) <= 1 && Math.abs(l.y2 - 360) <= 1;
      })();
    const id = await freeEnd();
    await within(BUDGET, () => fallbackOn(dana.page, id));
    await within(BUDGET, () => fallbackOn(sam.page, id));

    // The arrow is still rendered on both screens ...
    await expect(dana.page.locator(`[data-connector-id="${id}"] [data-testid="connector-line"]`)).toBeAttached();
    await expect(sam.page.locator(`[data-connector-id="${id}"] [data-testid="connector-line"]`)).toBeAttached();

    // ... and no console errors surfaced on either screen.
    expect(errors).toHaveLength(0);
  });
});
