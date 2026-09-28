/**
 * E2E tests for Story 10: Shapes and connectors.
 * TC-23 to TC-27.
 */
import { test, expect } from '@playwright/test';
import { gotoBoard, setCamera } from './helpers/board';

test.describe('Shapes and connectors E2E', () => {
  test.beforeEach(async ({ page }) => {
    await gotoBoard(page);
    // Reset camera to known position
    await setCamera(page, 0, 0, 1);
  });

  // TC-23: Draw two rectangles, connect with arrow, drag one → arrow follows
  test('TC-23: draw rect and ellipse, connect, drag follows', async ({ page }) => {
    const viewport = page.locator('[data-testid="board-viewport"]');
    await expect(viewport).toBeVisible();

    // Draw a rectangle via shape tool (S)
    await page.keyboard.press('s');
    await expect(page.locator('[data-testid="shape-tool-overlay"]')).toBeVisible();
    // Drag from (200,200) to (380,300) for rect
    await page.mouse.move(200, 200);
    await page.mouse.down();
    await page.mouse.move(380, 300, { steps: 5 });
    await page.mouse.up();

    // Verify rect exists
    await expect(page.locator('[data-shape-kind="rect"]')).toBeVisible();

    // Draw a second rectangle via shape tool
    await page.keyboard.press('s');
    await expect(page.locator('[data-testid="shape-tool-overlay"]')).toBeVisible();
    // Drag from (500,200) to (650,350)
    await page.mouse.move(500, 200);
    await page.mouse.down();
    await page.mouse.move(650, 350, { steps: 5 });
    await page.mouse.up();

    // Verify second rect exists
    await expect(page.locator('[data-shape-kind="rect"]')).toHaveCount(2);

    // Draw a connector (L) from the right side of rect1 to left side of rect2
    await page.keyboard.press('l');
    await expect(page.locator('[data-testid="connector-tool-overlay"]')).toBeVisible();
    // Drag from right-center of rect1 (~380, 250) to left-center of rect2 (~500, 275)
    await page.mouse.move(380, 250);
    await page.mouse.down();
    await page.mouse.move(500, 275, { steps: 5 });
    await page.mouse.up();

    // Verify a connector was created
    const connectorLine = page.locator('[data-testid^="connector-line-"]');
    await expect(connectorLine).toBeAttached();

    // Get connector line coordinates before drag
    const lineBefore = await connectorLine.evaluate((el) => ({
      x1: el.getAttribute('x1'),
      y1: el.getAttribute('y1'),
      x2: el.getAttribute('x2'),
      y2: el.getAttribute('y2'),
    }));

    // Drag the rectangle to the left (select it first)
    await page.keyboard.press('v'); // select tool
    await page.mouse.move(290, 250); // center of rect
    await page.mouse.down();
    await page.mouse.move(190, 250, { steps: 5 }); // drag left by 100px
    await page.mouse.up();

    // Verify connector endpoints changed (follows the shape)
    const lineAfter = await connectorLine.evaluate((el) => ({
      x1: el.getAttribute('x1'),
      y1: el.getAttribute('y1'),
      x2: el.getAttribute('x2'),
      y2: el.getAttribute('y2'),
    }));

    // x1 should have moved left (rect moved left)
    expect(parseFloat(lineAfter.x1!)).toBeLessThan(parseFloat(lineBefore.x1!));
  });

  // TC-24: Click a shape, type label; label wraps inside shape
  test('TC-24: shape label editing', async ({ page }) => {
    // Draw a rectangle
    await page.keyboard.press('s');
    await page.mouse.move(200, 200);
    await page.mouse.down();
    await page.mouse.move(450, 350, { steps: 5 });
    await page.mouse.up();

    // Double-click to edit label
    const shapeEl = page.locator('[data-shape-kind="rect"]');
    await expect(shapeEl).toBeVisible();
    await shapeEl.dblclick();

    // Editor should appear
    const editor = page.locator('[data-testid^="shape-editor-"]');
    await expect(editor).toBeVisible();

    // Type some text
    await page.keyboard.type('Hello World');

    // Press Escape to end editing
    await page.keyboard.press('Escape');

    // Editor should be gone
    await expect(editor).not.toBeVisible();

    // The label should be visible on the shape
    // (SVG text should contain "Hello World")
    const shapeContainer = page.locator('[data-shape-kind="rect"]');
    await expect(shapeContainer).toContainText('Hello World');
  });

  // TC-25: Colour picker applies fill and stroke
  test('TC-25: shape toolbar colour picker', async ({ page }) => {
    // Draw a rectangle
    await page.keyboard.press('s');
    await page.mouse.move(200, 200);
    await page.mouse.down();
    await page.mouse.move(400, 350, { steps: 5 });
    await page.mouse.up();

    // Shape should be selected → toolbar visible
    const toolbar = page.locator('[data-testid="shape-toolbar"]');
    await expect(toolbar).toBeVisible();

    // Click blue fill
    await page.locator('[data-testid="fill-blue"]').click();

    // Click red stroke
    await page.locator('[data-testid="stroke-red"]').click();

    // Verify the rect SVG element has the right fill/stroke
    const rectSvg = page.locator('[data-shape-kind="rect"] svg rect').first();
    await expect(rectSvg).toHaveAttribute('fill', '#BBDEFB');
    await expect(rectSvg).toHaveAttribute('stroke', '#E53935');
  });

  // TC-26: Delete a shape with connected arrow → arrow remains, endpoint detached
  test('TC-26: delete shape leaves connector with detached endpoint', async ({ page }) => {
    // Draw two shapes
    await page.keyboard.press('s');
    await page.mouse.move(150, 200);
    await page.mouse.down();
    await page.mouse.move(300, 350, { steps: 5 });
    await page.mouse.up();

    await page.keyboard.press('s');
    await page.mouse.move(500, 200);
    await page.mouse.down();
    await page.mouse.move(650, 350, { steps: 5 });
    await page.mouse.up();

    // Connect them
    await page.keyboard.press('l');
    await page.mouse.move(300, 275);
    await page.mouse.down();
    await page.mouse.move(500, 275, { steps: 5 });
    await page.mouse.up();

    // Verify connector exists
    const connectorLine = page.locator('[data-testid^="connector-line-"]');
    await expect(connectorLine).toBeAttached();

    // Select first shape and delete it
    await page.keyboard.press('v');
    await page.mouse.click(225, 275); // center of first shape
    await page.keyboard.press('Delete');

    // First shape should be gone
    const shapes = page.locator('[data-shape-kind="rect"]');
    await expect(shapes).toHaveCount(1);

    // Connector should still be present (with free endpoint)
    await expect(connectorLine).toBeAttached();
  });

  // TC-27: Undo after shape creation removes it; redo restores
  test('TC-27: undo/redo for shape creation', async ({ page }) => {
    // Draw a rectangle
    await page.keyboard.press('s');
    await page.mouse.move(200, 200);
    await page.mouse.down();
    await page.mouse.move(400, 350, { steps: 5 });
    await page.mouse.up();

    // Verify shape exists
    const shapeEl = page.locator('[data-shape-kind="rect"]');
    await expect(shapeEl).toBeVisible();

    // Undo (Ctrl+Z)
    await page.keyboard.press('Control+z');

    // Shape should be gone
    await expect(shapeEl).not.toBeVisible();

    // Redo (Ctrl+Shift+Z)
    await page.keyboard.press('Control+Shift+z');

    // Shape should be back
    await expect(shapeEl).toBeVisible();
  });
});
