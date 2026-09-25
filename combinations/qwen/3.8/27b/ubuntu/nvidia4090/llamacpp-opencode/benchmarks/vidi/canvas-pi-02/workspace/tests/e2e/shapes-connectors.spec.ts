/**
 * Story 10 e2e tests: shapes and connectors (TC-23 to TC-27).
 *
 * Tests the full user flow:
 *  - Shape tool: S key activates, click/drag creates shapes
 *  - Connector tool: L key activates, drag creates connectors
 *  - Arrow follows when object moves
 *  - Delete detaches connector
 *  - Shape toolbar appears when a shape is selected
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { setCamera } from './helpers/board';
import { createBoard } from './helpers/participants';

const HOME_CAMERA = { x: -640, y: -400, zoom: 1 };

/** Read all board objects (shapes, connectors, notes) via the test hook. */
function getObjects(page: Page): Promise<any[]> {
  return page.evaluate(() => {
    const hook = (window as any).__vidi6;
    return hook?.getNotes() ?? [];
  });
}

/** The shape elements on the board. */
const shapes = (page: Page) => page.locator('svg rect, svg ellipse, svg polygon');
/** The connector elements on the board. */
const connectors = (page: Page) => page.locator('[data-testid="connector-object"]');

test.beforeEach(async ({ page, request }) => {
  const boardId = await createBoard(request);
  await page.goto(`/b/${boardId}`);
  await expect
    .poll(
      () => page.evaluate(() => (window as any).__vidi6?.connectionState ?? null),
      { timeout: 15_000, intervals: [50], message: 'client should reach the connected state' },
    )
    .toBe('connected');
  await setCamera(page, HOME_CAMERA);
});

test.describe('Story 10: shapes and connectors', () => {
  test('TC-23 S key activates shape tool; click creates default 160x160 shape', async ({ page }) => {
    // Press S to activate the shape tool.
    await page.keyboard.press('s');

    // The shape tool button should be active.
    const shapeBtn = page.locator('[aria-label^="Shape:"]');
    await expect(shapeBtn).toHaveAttribute('aria-pressed', 'true');

    // Click on the board to create a shape at the screen centre.
    // With HOME_CAMERA: world (0,0) → screen (640, 400)
    await page.mouse.click(640, 400);

    // A shape should be created.
    const objects = await getObjects(page);
    const shapeObjs = objects.filter((o) => o.type === 'shape');
    expect(shapeObjs.length).toBe(1);
    expect(shapeObjs[0].width).toBe(160);
    expect(shapeObjs[0].height).toBe(160);

    // The tool should switch back to select after creation.
    const selectBtn = page.locator('[aria-label="Select (V)"]');
    await expect(selectBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('TC-23b shape tool drag creates shape at drag rect', async ({ page }) => {
    await page.keyboard.press('s');

    // Drag from world (0,0) to world (200,100).
    // Screen: (640,400) → (840,500)
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(840, 500, { steps: 10 });
    await page.mouse.up();

    const objects = await getObjects(page);
    const shapeObjs = objects.filter((o) => o.type === 'shape');
    expect(shapeObjs.length).toBe(1);
    expect(shapeObjs[0].width).toBe(200);
    expect(shapeObjs[0].height).toBe(100);
  });

  test('TC-24 L key activates connector tool; drag creates connector between shapes', async ({ page }) => {
    // Create two shapes.
    await page.keyboard.press('s');
    await page.mouse.click(540, 400); // Shape A at world (-100, 0)
    await page.keyboard.press('v');
    await page.keyboard.press('s');
    await page.mouse.click(840, 400); // Shape B at world (200, 0)

    // Switch to connector tool.
    await page.keyboard.press('l');
    const connectorBtn = page.locator('[aria-label="Connector (L)"]');
    await expect(connectorBtn).toHaveAttribute('aria-pressed', 'true');

    // Drag from shape A's right side to shape B's left side.
    // Shape A centre: world (-100,0) → screen (540, 400)
    // Shape A right edge: world (0,0) → screen (640, 400)
    // Shape B left edge: world (120,0) → screen (760, 400)
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(760, 400, { steps: 10 });
    await page.mouse.up();

    // A connector should be created.
    const objects = await getObjects(page);
    const connObjs = objects.filter((o) => o.type === 'connector');
    expect(connObjs.length).toBe(1);
  });

  test('TC-25 arrow follows when connected object moves', async ({ page }) => {
    // Create two shapes.
    await page.keyboard.press('s');
    await page.mouse.click(540, 400); // Shape A
    await page.keyboard.press('v');
    await page.keyboard.press('s');
    await page.mouse.click(840, 400); // Shape B

    // Create a connector.
    await page.keyboard.press('l');
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(760, 400, { steps: 10 });
    await page.mouse.up();

    // Switch to select tool.
    await page.keyboard.press('v');

    // Get the connector's initial `to` position.
    let objects = await getObjects(page);
    let conn = objects.find((o) => o.type === 'connector');
    expect(conn).toBeDefined();
    const initialToX = conn.x + conn.width; // right edge of the connector bbox

    // Drag shape B to the right by 100px.
    // Shape B is at world (200, 0), screen (840, 400).
    await page.mouse.move(840, 400);
    await page.mouse.down();
    await page.mouse.move(940, 400, { steps: 10 });
    await page.mouse.up();

    // The connector's bbox should have grown (to endpoint moved right).
    objects = await getObjects(page);
    conn = objects.find((o) => o.type === 'connector');
    expect(conn).toBeDefined();
    // The connector width should have increased.
    expect(conn.width).toBeGreaterThan(initialToX - (conn.x));
  });

  test('TC-26 delete detaches connector', async ({ page }) => {
    // Create two shapes.
    await page.keyboard.press('s');
    await page.mouse.click(540, 400); // Shape A
    await page.keyboard.press('v');
    await page.keyboard.press('s');
    await page.mouse.click(840, 400); // Shape B

    // Create a connector.
    await page.keyboard.press('l');
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(760, 400, { steps: 10 });
    await page.mouse.up();

    // Switch to select tool.
    await page.keyboard.press('v');

    // Select shape A and delete it.
    await page.mouse.click(540, 400);
    await page.keyboard.press('Delete');

    // The connector should still exist with a free endpoint.
    const objects = await getObjects(page);
    const connObjs = objects.filter((o) => o.type === 'connector');
    expect(connObjs.length).toBe(1);
    expect(connObjs[0].from.kind).toBe('free');
  });

  test('TC-27 shape toolbar appears when a shape is selected', async ({ page }) => {
    // Create a shape.
    await page.keyboard.press('s');
    await page.mouse.click(640, 400);

    // The shape toolbar should appear.
    const toolbar = page.locator('[data-testid="shape-toolbar"]');
    await expect(toolbar).toBeVisible({ timeout: 3000 });

    // Click the blue fill swatch.
    const blueFill = page.locator('[data-testid="fill-blue"]');
    await blueFill.click();

    // Verify the fill changed.
    const objects = await getObjects(page);
    const shapeObjs = objects.filter((o) => o.type === 'shape');
    expect(shapeObjs.length).toBe(1);
    expect(shapeObjs[0].fill).toBe('blue');
  });
});
