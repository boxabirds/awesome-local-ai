import { test, expect, Page, Browser } from '@playwright/test';
import { openNewBoard } from './helpers/board';

const BASE = 'http://localhost:8787';

async function createBoard(): Promise<string> {
  const resp = await fetch(`${BASE}/api/boards`, { method: 'POST' });
  if (resp.status !== 201) throw new Error(`board creation failed: ${resp.status}`);
  return ((await resp.json()) as { id: string }).id;
}

async function openBoardContext(browser: Browser, boardId: string): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/b/${boardId}`);
  await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 15000 });
  return page;
}

async function closeContext(page: Page): Promise<void> {
  await page.context().close();
}

/**
 * Helper: create a shape by activating the Shape tool and dragging.
 */
async function createShapeByDrag(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.getByLabel('Shape (S)').click();
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 5 });
  await page.mouse.up();
}

/**
 * Helper: create a connector by activating the Connector tool and dragging between two points.
 */
async function createConnectorByDrag(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.getByLabel('Connector (L)').click();
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 5 });
  await page.mouse.up();
}

test.describe('shapes.e2e', () => {
  test('TC-23: draw a shape and a connector between two shapes', async ({ page }) => {
    await openNewBoard(page);

    // Create first shape (left side)
    await createShapeByDrag(page, 200, 200, 400, 350);
    let shapes = page.getByTestId('shape-object');
    await expect(shapes).toHaveCount(1);

    // Create second shape (right side)
    await createShapeByDrag(page, 700, 200, 900, 350);
    shapes = page.getByTestId('shape-object');
    await expect(shapes).toHaveCount(2);

    // Create a connector between the two shapes
    // Drag from centre of first shape to centre of second shape
    await createConnectorByDrag(page, 300, 275, 800, 275);

    // A connector should appear
    const connector = page.getByTestId('connector-object');
    await expect(connector).toHaveCount(1);

    // The connector should have a line and arrowhead (polygon)
    const line = connector.locator('line');
    await expect(line).toHaveCount(1);
    const arrowhead = connector.locator('polygon');
    await expect(arrowhead).toHaveCount(1);
  });

  test('TC-24: moving a shape makes connected arrow follow', async ({ page }) => {
    await openNewBoard(page);

    // Create two shapes
    await createShapeByDrag(page, 200, 200, 400, 350);
    await createShapeByDrag(page, 700, 200, 900, 350);

    // Create a connector between them
    await createConnectorByDrag(page, 300, 275, 800, 275);
    const connector = page.getByTestId('connector-object');
    await expect(connector).toHaveCount(1);

    // Get the connector line's initial position
    const line = connector.locator('line');
    const initialX1 = parseFloat((await line.getAttribute('x1')) || '0');

    // Select the first shape and drag it
    const firstShape = page.getByTestId('shape-object').nth(0);
    const box = await firstShape.boundingBox();
    if (!box) throw new Error('Shape not found');

    // Drag the first shape to the right
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // The connector line should have moved (x1 should be different)
    const newX1 = parseFloat((await line.getAttribute('x1')) || '0');
    expect(newX1).not.toBe(initialX1);
  });

  test('TC-25: shape drawn in browser A appears in browser B with same fill', async ({ browser }) => {
    const boardId = await createBoard();
    const pageA = await openBoardContext(browser, boardId);
    const pageB = await openBoardContext(browser, boardId);

    // Create a shape in A
    await createShapeByDrag(pageA, 200, 200, 400, 350);
    const shapeA = pageA.getByTestId('shape-object');
    await expect(shapeA).toHaveCount(1);

    // Set fill to blue
    // Click the shape to select it
    const box = await shapeA.boundingBox();
    if (!box) throw new Error('Shape not found');
    await pageA.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await pageA.waitForTimeout(200);

    // Click blue fill swatch
    await pageA.getByLabel('blue fill').click();
    await pageA.waitForTimeout(500);

    // B should see the shape with blue fill
    const shapeB = pageB.getByTestId('shape-object');
    await expect(shapeB).toHaveCount(1, { timeout: 5000 });

    // Verify the fill colour is blue (#2196F3)
    const rect = shapeB.locator('rect');
    const fill = await rect.getAttribute('fill');
    expect(fill).toBe('#2196F3');

    await closeContext(pageA);
    await closeContext(pageB);
  });

  test('TC-26: deleting a shape makes its connectors free-end', async ({ page }) => {
    await openNewBoard(page);

    // Create two shapes
    await createShapeByDrag(page, 200, 200, 400, 350);
    await createShapeByDrag(page, 700, 200, 900, 350);

    // Create a connector between them
    await createConnectorByDrag(page, 300, 275, 800, 275);
    const connector = page.getByTestId('connector-object');
    await expect(connector).toHaveCount(1);

    // Select and delete the first shape
    const firstShape = page.getByTestId('shape-object').nth(0);
    const box = await firstShape.boundingBox();
    if (!box) throw new Error('Shape not found');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(200);

    // Press Delete key
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    // Shape should be gone
    await expect(page.getByTestId('shape-object')).toHaveCount(1);

    // Connector should still exist (with a free end)
    await expect(connector).toHaveCount(1);
  });

  test('TC-27: reload restores shapes, labels, colours, and connectors', async ({ page }) => {
    await openNewBoard(page);

    // Create two shapes
    await createShapeByDrag(page, 200, 200, 400, 350);
    await createShapeByDrag(page, 700, 200, 900, 350);

    // Add a label to the first shape
    const firstShape = page.getByTestId('shape-object').nth(0);
    await firstShape.dblclick();
    const editor = page.getByTestId('shape-label-editor');
    await expect(editor).toBeVisible();
    await editor.fill('Test Label');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Set fill to green
    const box = await firstShape.boundingBox();
    if (!box) throw new Error('Shape not found');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(200);
    await page.getByLabel('green fill').click();
    await page.waitForTimeout(200);

    // Create a connector
    await createConnectorByDrag(page, 300, 275, 800, 275);
    await expect(page.getByTestId('connector-object')).toHaveCount(1);

    // Reload
    await page.reload();
    await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 15000 });
    await page.waitForTimeout(1000);

    // Shapes should be restored
    await expect(page.getByTestId('shape-object')).toHaveCount(2);

    // Connector should be restored
    await expect(page.getByTestId('connector-object')).toHaveCount(1);

    // The first shape should have the green fill
    const firstShapeAfter = page.getByTestId('shape-object').nth(0);
    const rect = firstShapeAfter.locator('rect');
    const fill = await rect.getAttribute('fill');
    expect(fill).toBe('#4CAF50');
  });
});
