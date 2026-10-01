import { test, expect } from '@playwright/test';
import { setCamera } from './helpers/board';

test.describe('Story 10: Draw shapes and connect them with arrows E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="board-viewport"]');
  });

  // TC-23: Select shape tool → click empty board → square appears at click point
  test('TC-23: shape tool click creates a shape at click point', async ({ page }) => {
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    // Click the shape tool button in the toolbar
    await page.click('button[aria-label="Shape (S)"]');

    // Click on the board to create a shape
    await page.click('[data-testid="board-viewport"]', { position: { x: 400, y: 300 } });

    // A shape should appear
    const shape = page.locator('[data-testid="shape-object"]');
    await expect(shape).toHaveCount(1);
  });

  // TC-24: Drag shape tool → rectangle drawn from drag start to end
  test('TC-24: drag shape tool draws a rectangle', async ({ page }) => {
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    // Click the shape tool button
    await page.click('button[aria-label="Shape (S)"]');

    // Drag to create a shape
    await page.mouse.move(300, 200);
    await page.mouse.down();
    await page.mouse.move(500, 350, { steps: 5 });
    await page.mouse.up();

    // A shape should appear
    const shape = page.locator('[data-testid="shape-object"]');
    await expect(shape).toHaveCount(1);
  });

  // TC-25: Select connector tool, drag from shape A to shape B → arrow appears
  test('TC-25: connector tool drag creates an arrow between shapes', async ({ page }) => {
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    // Create two shapes first
    await page.click('button[aria-label="Shape (S)"]');
    await page.click('[data-testid="board-viewport"]', { position: { x: 200, y: 300 } });

    // Create second shape
    await page.click('button[aria-label="Shape (S)"]');
    await page.click('[data-testid="board-viewport"]', { position: { x: 500, y: 300 } });

    // Now select connector tool
    await page.click('button[aria-label="Connector (L)"]');

    // Drag from first shape to second shape
    // Get the positions of the shapes
    const shapes = page.locator('[data-testid="shape-object"]');
    const count = await shapes.count();
    expect(count).toBe(2);

    const box1 = await shapes.nth(0).boundingBox();
    const box2 = await shapes.nth(1).boundingBox();

    if (box1 && box2) {
      const fromX = box1.x + box1.width / 2;
      const fromY = box1.y + box1.height / 2;
      const toX = box2.x + box2.width / 2;
      const toY = box2.y + box2.height / 2;

      await page.mouse.move(fromX, fromY);
      await page.mouse.down();
      await page.mouse.move(toX, toY, { steps: 5 });
      await page.mouse.up();
    }

    // A connector should appear
    const connector = page.locator('[data-testid="connector-object"]');
    await expect(connector).toHaveCount(1);
  });

  // TC-26: Move shape A → attached arrow end follows in real time
  test('TC-26: moving a shape moves attached connector endpoint', async ({ page }) => {
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    // Create two shapes
    await page.click('button[aria-label="Shape (S)"]');
    await page.click('[data-testid="board-viewport"]', { position: { x: 200, y: 300 } });

    await page.click('button[aria-label="Shape (S)"]');
    await page.click('[data-testid="board-viewport"]', { position: { x: 500, y: 300 } });

    // Create a connector between them
    await page.click('button[aria-label="Connector (L)"]');

    const shapes = page.locator('[data-testid="shape-object"]');
    const box1 = await shapes.nth(0).boundingBox();
    const box2 = await shapes.nth(1).boundingBox();

    if (box1 && box2) {
      await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
      await page.mouse.down();
      await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2, { steps: 5 });
      await page.mouse.up();
    }

    // Verify connector exists
    const connector = page.locator('[data-testid="connector-object"]');
    await expect(connector).toHaveCount(1);

    // Get initial connector position
    const connBox1 = await connector.boundingBox();

    // Switch to select tool and move the first shape
    await page.click('button[aria-label="Select (V)"]');

    // Click on the first shape to select it
    const shape1 = page.locator('[data-testid="shape-object"]').nth(0);
    await shape1.click();

    // Drag the shape
    const newBox1 = await shape1.boundingBox();
    if (newBox1) {
      await page.mouse.move(newBox1.x + newBox1.width / 2, newBox1.y + newBox1.height / 2);
      await page.mouse.down();
      await page.mouse.move(newBox1.x + newBox1.width / 2 + 80, newBox1.y + newBox1.height / 2 + 60, { steps: 5 });
      await page.mouse.up();
    }

    // The connector should have moved (its bounding box should be different)
    const connBox2 = await connector.boundingBox();
    if (connBox1 && connBox2) {
      // The connector position should have changed
      const dx = Math.abs(connBox2.x - connBox1.x);
      const dy = Math.abs(connBox2.y - connBox1.y);
      expect(dx + dy).toBeGreaterThan(0);
    }
  });

  // TC-27: Two tabs: tab 1 moves shape → tab 2 sees arrow follow
  test('TC-27: live collaboration - arrow follows for all users', async ({ browser }) => {
    const context = await browser.newContext();
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    // Both pages load the same board
    await page1.goto('/');
    await page1.waitForSelector('[data-testid="board-viewport"]');
    await setCamera(page1, { x: 0, y: 0, zoom: 1 });

    await page2.goto('/');
    await page2.waitForSelector('[data-testid="board-viewport"]');
    await setCamera(page2, { x: 0, y: 0, zoom: 1 });

    // Create shapes on page1
    await page1.click('button[aria-label="Shape (S)"]');
    await page1.click('[data-testid="board-viewport"]', { position: { x: 200, y: 300 } });

    await page1.click('button[aria-label="Shape (S)"]');
    await page1.click('[data-testid="board-viewport"]', { position: { x: 500, y: 300 } });

    // Wait for page2 to see the shapes
    await page2.waitForSelector('[data-testid="shape-object"]');
    await expect(page2.locator('[data-testid="shape-object"]')).toHaveCount(2);

    // Create connector on page1
    await page1.click('button[aria-label="Connector (L)"]');

    const shapes1 = page1.locator('[data-testid="shape-object"]');
    const box1 = await shapes1.nth(0).boundingBox();
    const box2 = await shapes1.nth(1).boundingBox();

    if (box1 && box2) {
      await page1.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
      await page1.mouse.down();
      await page1.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2, { steps: 5 });
      await page1.mouse.up();
    }

    // Wait for page2 to see the connector
    await page2.waitForSelector('[data-testid="connector-object"]');
    await expect(page2.locator('[data-testid="connector-object"]')).toHaveCount(1);

    // Get initial connector position on page2
    const connOnPage2 = page2.locator('[data-testid="connector-object"]');
    const initialConnBox = await connOnPage2.boundingBox();

    // Move shape on page1
    await page1.click('button[aria-label="Select (V)"]');
    const shape1 = page1.locator('[data-testid="shape-object"]').nth(0);
    const sBox = await shape1.boundingBox();
    if (sBox) {
      await page1.mouse.move(sBox.x + sBox.width / 2, sBox.y + sBox.height / 2);
      await page1.mouse.down();
      await page1.mouse.move(sBox.x + sBox.width / 2 + 100, sBox.y + sBox.height / 2 + 80, { steps: 5 });
      await page1.mouse.up();
    }

    // Wait for page2 to see the updated connector
    await page2.waitForTimeout(500);
    const updatedConnBox = await connOnPage2.boundingBox();

    if (initialConnBox && updatedConnBox) {
      const dx = Math.abs(updatedConnBox.x - initialConnBox.x);
      const dy = Math.abs(updatedConnBox.y - initialConnBox.y);
      expect(dx + dy).toBeGreaterThan(0);
    }

    await context.close();
  });
});
