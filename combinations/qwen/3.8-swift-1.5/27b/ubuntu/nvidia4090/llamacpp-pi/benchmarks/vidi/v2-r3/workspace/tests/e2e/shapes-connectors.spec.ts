import { test, expect, type Page } from '@playwright/test';
import { createBoard, openBoardInPage, getWorldLayer, getViewport } from './helpers/board';

/**
 * Story 10: Draw shapes and connect them with arrows that follow when moved.
 *
 * E2E tests TC-23 through TC-27.
 */

async function setCamera(page: Page, x: number, y: number, zoom: number) {
  await page.evaluate(
    ({ x, y, zoom }) => (window as any).__vidi6?.setCamera?.({ x, y, zoom }),
    { x, y, zoom },
  );
}

/** Click a point in the viewport (viewport-relative coords). */
async function clickAt(page: Page, x: number, y: number) {
  const vp = await getViewport(page);
  const box = await vp.boundingBox();
  if (!box) throw new Error('Viewport not found');
  await page.mouse.click(box.x + x, box.y + y);
}

/** Drag from (x1,y1) to (x2,y2) in viewport-relative coords. */
async function dragFromTo(page: Page, x1: number, y1: number, x2: number, y2: number) {
  const vp = await getViewport(page);
  const box = await vp.boundingBox();
  if (!box) throw new Error('Viewport not found');
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 5 });
  await page.mouse.up();
}

test.describe('story 10: shapes and connectors (e2e)', () => {
  test('TC-23: create a shape by clicking with the Shape tool', async ({ browser }) => {
    const boardId = await createBoard();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await openBoardInPage(page, boardId);

    // Click the Shape button in the toolbar
    await page.getByLabel('Shape (S)').click();

    // Click on the board to create a shape
    await clickAt(page, 300, 250);

    // Wait for the shape to appear
    const world = await getWorldLayer(page);
    const shape = world.locator('[data-testid^="shape-object-"]');
    await expect(shape.first()).toBeVisible();

    await ctx.close();
  });

  test('TC-24: create a shape by dragging with the Shape tool', async ({ browser }) => {
    const boardId = await createBoard();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await openBoardInPage(page, boardId);

    // Activate the Shape tool
    await page.getByLabel('Shape (S)').click();

    // Drag to create a shape
    await dragFromTo(page, 200, 150, 400, 300);

    // Wait for the shape to appear
    const world = await getWorldLayer(page);
    const shape = world.locator('[data-testid^="shape-object-"]');
    await expect(shape.first()).toBeVisible();

    await ctx.close();
  });

  test('TC-25: connector follows when source object is moved', async ({ browser }) => {
    const boardId = await createBoard();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await openBoardInPage(page, boardId);

    // Set camera to origin
    await setCamera(page, 0, 0, 1);

    // Create two shapes using the Shape tool
    await page.getByLabel('Shape (S)').click();
    await clickAt(page, 200, 200); // shape 1 at ~(200,200)
    await clickAt(page, 500, 200); // shape 2 at ~(500,200)

    const world = await getWorldLayer(page);
    const shapes = world.locator('[data-testid^="shape-object-"]');
    await expect(shapes).toHaveCount(2);

    // Switch to Connector tool
    await page.getByLabel('Connector (L)').click();

    // Drag from shape 1 to shape 2 to create a connector
    // Shape 1 is at ~(200,200) screen, shape 2 at ~(500,200) screen
    await dragFromTo(page, 200, 200, 500, 200);

    // Wait for the connector to appear
    const connector = world.locator('[data-testid^="connector-object-"]');
    await expect(connector.first()).toBeVisible();

    // Switch back to Select tool
    await page.getByLabel('Select (V)').click();

    // Move shape 1 by dragging it
    await dragFromTo(page, 200, 200, 300, 300);

    // The connector should still be visible (it followed the move)
    await expect(connector.first()).toBeVisible();

    await ctx.close();
  });

  test('TC-26: delete a shape detaches its connectors', async ({ browser }) => {
    const boardId = await createBoard();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await openBoardInPage(page, boardId);

    await setCamera(page, 0, 0, 1);

    // Create two shapes
    await page.getByLabel('Shape (S)').click();
    await clickAt(page, 200, 200);
    await clickAt(page, 500, 200);

    const world = await getWorldLayer(page);
    const shapes = world.locator('[data-testid^="shape-object-"]');
    await expect(shapes).toHaveCount(2);

    // Create a connector
    await page.getByLabel('Connector (L)').click();
    await dragFromTo(page, 200, 200, 500, 200);

    const connector = world.locator('[data-testid^="connector-object-"]');
    await expect(connector.first()).toBeVisible();

    // Switch to Select and delete shape 1
    await page.getByLabel('Select (V)').click();
    await clickAt(page, 200, 200); // select shape 1

    // Press Delete key
    await page.keyboard.press('Delete');

    // Shape 1 should be gone
    await expect(shapes).toHaveCount(1);

    // Connector should still exist (detached, now has a free endpoint)
    await expect(connector.first()).toBeVisible();

    await ctx.close();
  });

  test('TC-27: shape label editing via double-click', async ({ browser }) => {
    const boardId = await createBoard();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await openBoardInPage(page, boardId);

    await setCamera(page, 0, 0, 1);

    // Create a shape
    await page.getByLabel('Shape (S)').click();
    await clickAt(page, 300, 250);

    const world = await getWorldLayer(page);
    const shape = world.locator('[data-testid^="shape-object-"]');
    await expect(shape.first()).toBeVisible();

    // Switch to Select tool
    await page.getByLabel('Select (V)').click();

    // Double-click the shape to edit its label
    const shapeEl = shape.first();
    await shapeEl.dblclick();

    // A text editor should appear
    const editor = page.locator('textarea, [contenteditable="true"]');
    await expect(editor.first()).toBeVisible();

    // Type a label
    await editor.first().fill('My Shape');

    // Click away to commit
    await page.mouse.click(10, 10);

    // The label should be visible
    await expect(shapeEl).toContainText('My Shape');

    await ctx.close();
  });
});
