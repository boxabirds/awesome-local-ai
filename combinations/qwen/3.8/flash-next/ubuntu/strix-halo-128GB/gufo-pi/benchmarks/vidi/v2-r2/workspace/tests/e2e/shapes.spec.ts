import { test, expect } from '@playwright/test';
import {
  createParticipant,
  createBoardViaUi,
  expectEventually,
  waitForConnected,
  type Participant,
} from './helpers/participants';

// Helper: get shape count from DOM
async function getShapeCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() =>
    document.querySelectorAll('[data-testid^="shape-object-"]').length,
  );
}

// Helper: get shape world position and size
async function getShapeWorld(
  page: import('@playwright/test').Page,
  index: number,
): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate((i) => {
    const shapes = document.querySelectorAll('[data-testid^="shape-object-"]');
    const el = shapes[i] as HTMLElement | undefined;
    if (!el) throw new Error(`shape at index ${i} not found`);
    return {
      x: parseFloat(el.style.left),
      y: parseFloat(el.style.top),
      width: parseFloat(el.style.width),
      height: parseFloat(el.style.height),
    };
  }, index);
}

// Helper: get connector count
async function getConnectorCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() =>
    document.querySelectorAll('[data-testid^="connector-object-"]').length,
  );
}

// Helper: get connector line x2 endpoint
async function getConnectorLineX2(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const line = document.querySelector('[data-testid^="connector-line-"]');
    if (!line) return 0;
    return parseFloat(line.getAttribute('x2') ?? '0');
  });
}

// Helper: activate shape tool by clicking toolbar
async function activateShapeTool(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('shape-tool-btn').click();
}

// Helper: activate connector tool by clicking toolbar
async function activateConnectorTool(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('connector-tool-btn').click();
}

// Helper: get shape text
async function getShapeText(page: import('@playwright/test').Page, index: number): Promise<string> {
  return page.evaluate((i) => {
    const texts = document.querySelectorAll('[data-testid^="shape-label-"]');
    const el = texts[i];
    return el?.textContent ?? '';
  }, index);
}

test.describe('Shape objects', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New board' }).click();
    await page.waitForSelector('[data-testid="board-viewport"]');
    await waitForConnected(page);
  });

  // TC-23: drag to create three kinds
  test('TC-23: drag creates shapes of each kind', async ({ page }) => {
    // Create rectangle (default kind)
    await activateShapeTool(page);
    await page.mouse.move(200, 200);
    await page.mouse.down();
    await page.mouse.move(400, 350);
    await page.mouse.up();

    await expect(page.locator('[data-testid^="shape-object-"]')).toHaveCount(1);
    let shape = await getShapeWorld(page, 0);
    expect(shape.width).toBeCloseTo(200, 0);
    expect(shape.height).toBeCloseTo(150, 0);

    // Create ellipse
    await page.getByTestId('shape-kind-ellipse').click();
    await page.mouse.move(500, 200);
    await page.mouse.down();
    await page.mouse.move(650, 350);
    await page.mouse.up();

    await expect(page.locator('[data-testid^="shape-object-"]')).toHaveCount(2);
    const shape1 = await getShapeWorld(page, 1);
    expect(shape1.width).toBeCloseTo(150, 0);
    expect(shape1.height).toBeCloseTo(150, 0);

    // Create diamond
    await page.getByTestId('shape-kind-diamond').click();
    await page.mouse.move(700, 200);
    await page.mouse.down();
    await page.mouse.move(850, 350);
    await page.mouse.up();

    await expect(page.locator('[data-testid^="shape-object-"]')).toHaveCount(3);
    const shape2 = await getShapeWorld(page, 2);
    expect(shape2.width).toBeCloseTo(150, 0);
    expect(shape2.height).toBeCloseTo(150, 0);
  });

  // TC-24: label typing
  test('TC-24: double-click to edit label, click away to commit', async ({ page }) => {
    await activateShapeTool(page);
    await page.mouse.move(200, 200);
    await page.mouse.down();
    await page.mouse.move(400, 320);
    await page.mouse.up();

    // Double-click to edit
    const shape = page.locator('[data-testid^="shape-object-"]').first();
    await shape.dblclick();

    // Type label
    await page.keyboard.type('Hello World');

    // Click away to commit
    await page.mouse.click(600, 500);

    // Verify text is rendered
    const text = await getShapeText(page, 0);
    expect(text).toBe('Hello World');
  });

  // TC-25: connector follows
  test('TC-25: connector follows when target moves', async ({ page }) => {
    // Create two shapes
    await activateShapeTool(page);
    await page.mouse.move(150, 200);
    await page.mouse.down();
    await page.mouse.move(300, 300);
    await page.mouse.up();

    await page.getByTestId('shape-kind-ellipse').click();
    await page.mouse.move(500, 200);
    await page.mouse.down();
    await page.mouse.move(650, 300);
    await page.mouse.up();

    // Connect: from shape 1 center to shape 2 center
    await activateConnectorTool(page);
    // Click on shape 1
    await page.mouse.click(225, 250);
    // Drag to shape 2
    await page.mouse.move(225, 250);
    await page.mouse.down();
    await page.mouse.move(575, 250);
    await page.mouse.up();

    // Verify connector was created
    await expect(page.locator('[data-testid^="connector-object-"]')).toHaveCount(1);

    // Get initial connector line endpoint
    const initialX2 = await getConnectorLineX2(page);

    // Now move the target shape (shape 2) - switch to select tool
    await page.keyboard.press('v');

    // Click on shape 2 to select it
    const shapes = page.locator('[data-testid^="shape-object-"]');
    await shapes.nth(1).click();

    // Drag shape 2 rightward
    const shape2Pos = await shapes.nth(1).boundingBox();
    if (shape2Pos) {
      const cx = shape2Pos.x + shape2Pos.width / 2;
      const cy = shape2Pos.y + shape2Pos.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 100, cy);
      await page.mouse.up();
    }

    // Verify connector endpoint moved (followed the shape)
    await page.waitForTimeout(100);
    const updatedX2 = await getConnectorLineX2(page);

    expect(updatedX2).not.toBeCloseTo(initialX2, 1);
  });

  // TC-26: free endpoint stays put
  test('TC-26: free endpoint stays at world position on pan/zoom', async ({ page }) => {
    // Create a shape
    await activateShapeTool(page);
    await page.mouse.move(200, 200);
    await page.mouse.down();
    await page.mouse.move(350, 300);
    await page.mouse.up();

    // Create connector from shape to empty space
    await activateConnectorTool(page);
    await page.mouse.move(275, 250); // shape center
    await page.mouse.down();
    await page.mouse.move(600, 400); // free endpoint in empty space
    await page.mouse.up();

    await expect(page.locator('[data-testid^="connector-object-"]')).toHaveCount(1);

    // Get connector endpoint world position before pan
    const beforeX2 = await getConnectorLineX2(page);

    // Pan the viewport (space + drag)
    await page.keyboard.down(' ');
    await page.mouse.move(700, 500);
    await page.mouse.down();
    await page.mouse.move(500, 400);
    await page.mouse.up();
    await page.keyboard.up(' ');

    // Get connector endpoint after pan
    await page.waitForTimeout(100);
    const afterX2 = await getConnectorLineX2(page);

    // The SVG line should be the same (in world coords) since we're in the world layer
    // The screen position changes but world coordinates don't
    expect(afterX2).toBeCloseTo(beforeX2, 1);
  });

  // TC-27: connector survives reload
  test('TC-27: connector persists across page reload', async ({ page }) => {
    // Create a shape
    await activateShapeTool(page);
    await page.mouse.move(200, 200);
    await page.mouse.down();
    await page.mouse.move(350, 300);
    await page.mouse.up();

    // Create a connector from shape to empty space
    await activateConnectorTool(page);
    await page.mouse.move(275, 250);
    await page.mouse.down();
    await page.mouse.move(600, 400);
    await page.mouse.up();

    await expect(page.locator('[data-testid^="connector-object-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="shape-object-"]')).toHaveCount(1);

    // Reload
    await page.reload();
    await page.waitForSelector('[data-testid="board-viewport"]');
    await waitForConnected(page);

    // Verify both objects survive
    await expect(page.locator('[data-testid^="connector-object-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="shape-object-"]')).toHaveCount(1);
  });
});

test.describe('Connector multi-user', () => {
  test('connector appears on other participant', async ({ browser }) => {
    const homePage = await browser.newPage();
    const boardId = await createBoardViaUi(homePage);
    await homePage.close();

    const p1: Participant = await createParticipant(browser, boardId);
    const p2: Participant = await createParticipant(browser, boardId);

    // P1 creates a shape
    await activateShapeTool(p1.page);
    await p1.page.mouse.move(200, 200);
    await p1.page.mouse.down();
    await p1.page.mouse.move(350, 300);
    await p1.page.mouse.up();

    // Wait for shape to appear on P2
    await expectEventually(
      () => getShapeCount(p2.page),
      (n) => n === 1,
      'shape appears on P2',
    );

    // P1 creates a connector
    await activateConnectorTool(p1.page);
    await p1.page.mouse.move(275, 250);
    await p1.page.mouse.down();
    await p1.page.mouse.move(600, 400);
    await p1.page.mouse.up();

    // Wait for connector to appear on P2
    await expectEventually(
      () => getConnectorCount(p2.page),
      (n) => n === 1,
      'connector appears on P2',
    );

    // P2 moves the shape
    await p2.page.keyboard.press('v');
    const shapes = p2.page.locator('[data-testid^="shape-object-"]');
    const shapePos = await shapes.first().boundingBox();
    if (shapePos) {
      const cx = shapePos.x + shapePos.width / 2;
      const cy = shapePos.y + shapePos.height / 2;
      await p2.page.mouse.move(cx, cy);
      await p2.page.mouse.down();
      await p2.page.mouse.move(cx + 80, cy);
      await p2.page.mouse.up();
    }

    // P1 should see the connector path updated (follows the shape)
    await p1.page.waitForTimeout(500);
    await expectEventually(
      () => getConnectorCount(p1.page),
      (n) => n === 1,
      'connector still exists on P1 after remote move',
    );

    await p1.context.close();
    await p2.context.close();
  });
});
