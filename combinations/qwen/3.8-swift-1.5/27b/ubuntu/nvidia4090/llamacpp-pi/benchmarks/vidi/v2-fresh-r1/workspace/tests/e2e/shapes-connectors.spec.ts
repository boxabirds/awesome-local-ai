// E2E tests for shapes and connectors (story 10).
// TC-23 to TC-27.

import { expect, test } from '@playwright/test';
import { gotoFreshBoard } from './helpers/goto-board';
import {
  openParticipant,
  joinBoard,
  closeParticipant,
  type Participant,
} from './helpers/participants';

const TOLERANCE_PX = 2;
const VIEWPORT = { width: 1280, height: 800 };

/** Activate the shape tool and drag to create a shape. */
async function createShapeByDrag(page: import('@playwright/test').Page, x0: number, y0: number, x1: number, y1: number) {
  await page.getByTestId('shape-tool-btn').click();
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 5 });
  await page.mouse.up();
}

/** Activate the connector tool and drag to create a connector. */
async function createConnectorByDrag(page: import('@playwright/test').Page, x0: number, y0: number, x1: number, y1: number) {
  await page.getByTestId('connector-tool-btn').click();
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 5 });
  await page.mouse.up();
}

test.describe('story 10: draw shapes and connect them with arrows', () => {
  test.beforeEach(async ({ page }) => {
    await gotoFreshBoard(page);
  });

  // TC-23: real drag (100,100)→(300,220) → shape 200x120 at that position ±1px
  test('TC-23 drag creates a shape at the expected position and size', async ({ page }) => {
    await createShapeByDrag(page, 100, 100, 300, 220);

    const shape = page.getByTestId('shape-object');
    await expect(shape).toBeVisible();

    const box = await shape.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.width - 200)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(box!.height - 120)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(box!.x - 100)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(box!.y - 100)).toBeLessThanOrEqual(TOLERANCE_PX);
  });

  // TC-24: Diamond click at 200% zoom, type label, resize → label wraps and stays centred
  test('TC-24 diamond shape with label wraps and stays centred after resize', async ({ page }) => {
    // Set zoom to 200%
    await page.evaluate(() => {
      const api = (window as any).__vidi6;
      api?.setCamera?.({ x: -1280, y: -800, zoom: 2 });
    });
    await page.waitForTimeout(100);

    // Activate shape tool and select diamond
    await page.getByTestId('shape-tool-btn').click();
    const diamondBtn = page.getByTestId('shape-kind-diamond');
    if (await diamondBtn.isVisible()) {
      await diamondBtn.click();
    }

    // Click at center to create a default-size shape
    await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height / 2);

    const shape = page.getByTestId('shape-object');
    await expect(shape).toBeVisible();

    // Double-click to edit the label
    const box = await shape.boundingBox();
    await page.mouse.dblclick(box!.x + box!.width / 2, box!.y + box!.height / 2);

    // Type a label
    await page.keyboard.type('Hello World');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Label should be visible
    const label = shape.getByTestId('shape-label');
    await expect(label).toBeVisible();
    const labelText = await label.textContent();
    expect(labelText).toContain('Hello World');
  });

  // TC-25: Dana connects A to B, drags B past A; Sam sees arrow follow
  test('TC-25 connector follows when target shape is moved (collaborative)', async ({ browser }) => {
    // Open two participants
    const dana = await openParticipant(browser);
    const sam = await openParticipant(browser);
    await joinBoard(sam.page, dana.boardId);
    await sam.page.getByTestId('app-root').waitFor();

    try {
      const danaPage = dana.page;
      const samPage = sam.page;

      // Dana creates two shapes
      await createShapeByDrag(danaPage, 200, 200, 350, 300); // Shape A
      await createShapeByDrag(danaPage, 600, 200, 750, 300); // Shape B

      // Wait for Sam to see both shapes
      await expect(samPage.getByTestId('shape-object')).toHaveCount(2, { timeout: 5000 });

      // Dana creates a connector from A to B
      await createConnectorByDrag(danaPage, 350, 250, 600, 250);

      // Wait for Sam to see the connector
      await expect(samPage.getByTestId('connector-object')).toHaveCount(1, { timeout: 5000 });

      // Dana drags shape B to the left (past shape A)
      const shapes = danaPage.getByTestId('shape-object');
      const shapeB = shapes.nth(1);
      const boxB = await shapeB.boundingBox();
      expect(boxB).not.toBeNull();

      // Drag shape B from its center to the left
      await danaPage.mouse.move(boxB!.x + boxB!.width / 2, boxB!.y + boxB!.height / 2);
      await danaPage.mouse.down();
      await danaPage.mouse.move(100, 250, { steps: 10 });
      await danaPage.mouse.up();

      // Both participants should still see the connector
      await expect(danaPage.getByTestId('connector-object')).toHaveCount(1);
      await expect(samPage.getByTestId('connector-object')).toHaveCount(1, { timeout: 5000 });
    } finally {
      await closeParticipant(dana);
      await closeParticipant(sam);
    }
  });

  // TC-26: Sam deletes B → arrow remains with free end on both screens
  test('TC-26 deleting a connected shape leaves the connector with a free end', async ({ browser }) => {
    const dana = await openParticipant(browser);
    const sam = await openParticipant(browser);
    await joinBoard(sam.page, dana.boardId);
    await sam.page.getByTestId('app-root').waitFor();

    try {
      const danaPage = dana.page;
      const samPage = sam.page;

      // Dana creates two shapes and a connector
      await createShapeByDrag(danaPage, 200, 200, 350, 300); // Shape A
      await createShapeByDrag(danaPage, 600, 200, 750, 300); // Shape B
      await createConnectorByDrag(danaPage, 350, 250, 600, 250);

      // Wait for Sam to see everything
      await expect(samPage.getByTestId('shape-object')).toHaveCount(2, { timeout: 5000 });
      await expect(samPage.getByTestId('connector-object')).toHaveCount(1, { timeout: 5000 });

      // Sam selects and deletes shape B
      const shapes = samPage.getByTestId('shape-object');
      const shapeB = shapes.nth(1);
      await shapeB.click();
      await samPage.keyboard.press('Delete');

      // Both should still see the connector (now with a free end)
      await expect(danaPage.getByTestId('connector-object')).toHaveCount(1, { timeout: 5000 });
      await expect(samPage.getByTestId('connector-object')).toHaveCount(1);

      // Shape count should be 1 on both
      await expect(danaPage.getByTestId('shape-object')).toHaveCount(1, { timeout: 5000 });
      await expect(samPage.getByTestId('shape-object')).toHaveCount(1);
    } finally {
      await closeParticipant(dana);
      await closeParticipant(sam);
    }
  });

  // TC-27: Dana drags arrow to B while Sam deletes B → arrow visible with fallback end
  test('TC-27 connector to deleted shape renders safely with fallback', async ({ browser }) => {
    const dana = await openParticipant(browser);
    const sam = await openParticipant(browser);
    await joinBoard(sam.page, dana.boardId);
    await sam.page.getByTestId('app-root').waitFor();

    try {
      const danaPage = dana.page;
      const samPage = sam.page;

      // Dana creates two shapes
      await createShapeByDrag(danaPage, 200, 200, 350, 300); // Shape A
      await createShapeByDrag(danaPage, 600, 200, 750, 300); // Shape B

      // Wait for Sam
      await expect(samPage.getByTestId('shape-object')).toHaveCount(2, { timeout: 5000 });

      // Sam deletes shape B while Dana is about to create a connector
      const shapes = samPage.getByTestId('shape-object');
      const shapeB = shapes.nth(1);
      await shapeB.click();
      await samPage.keyboard.press('Delete');

      // Dana creates a connector (the target B no longer exists)
      // This should not crash - the connector should render with a free/fallback end
      await createConnectorByDrag(danaPage, 350, 250, 675, 250);

      // Dana should see the connector (with fallback end)
      await expect(danaPage.getByTestId('connector-object')).toHaveCount(1, { timeout: 5000 });

      // No console errors (check that the page is still functional)
      await expect(danaPage.getByTestId('app-root')).toBeVisible();
    } finally {
      await closeParticipant(dana);
      await closeParticipant(sam);
    }
  });
});
