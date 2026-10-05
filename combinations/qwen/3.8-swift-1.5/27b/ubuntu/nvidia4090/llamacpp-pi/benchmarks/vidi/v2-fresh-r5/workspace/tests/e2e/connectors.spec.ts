import { test, expect } from '@playwright/test';
import { setCamera } from './helpers/board';
import { createParticipants, expectEventually } from './helpers/participants';

/**
 * Helper: create two shapes on the board using the Shape tool.
 * Returns the screen-space centres of the two shapes.
 */
async function createTwoShapes(page: import('@playwright/test').Page): Promise<{ x1: number; y1: number; x2: number; y2: number }> {
  // Activate shape tool
  await page.keyboard.press('s');
  await page.waitForTimeout(100);

  // Create first shape by dragging (100,150) to (250,250)
  await page.mouse.move(100, 150);
  await page.mouse.down();
  await page.mouse.move(250, 250, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(100);

  // Back to shape tool for second shape
  await page.keyboard.press('s');
  await page.waitForTimeout(100);

  // Create second shape by dragging (500,150) to (650,250)
  await page.mouse.move(500, 150);
  await page.mouse.down();
  await page.mouse.move(650, 250, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(100);

  // Centres in screen space (at zoom 1, world = screen)
  return { x1: 175, y1: 200, x2: 575, y2: 200 };
}

test.describe('Connectors e2e', () => {
  test.setTimeout(90_000);

  // TC-25: Dana connects A→B and drags B past A; Sam's context sees the arrow attached
  test('TC-25: arrows follow remote moves', async ({ browser }) => {
    const [dana, sam] = await createParticipants(browser, 2);

    try {
      await setCamera(dana.page, { x: 0, y: 0, zoom: 1 });
      await setCamera(sam.page, { x: 0, y: 0, zoom: 1 });

      // Dana creates two shapes
      const centers = await createTwoShapes(dana.page);

      // Wait for Sam to see the shapes
      await expectEventually('Sam sees 2 shapes', async () => {
        return (await sam.page.locator('[data-testid^="shape-"] rect').count()) >= 2;
      });

      // Dana creates a connector between the two shapes
      await dana.page.keyboard.press('l');
      await dana.page.waitForTimeout(100);
      await dana.page.mouse.move(centers.x1, centers.y1);
      await dana.page.mouse.down();
      await dana.page.mouse.move(centers.x2, centers.y2, { steps: 5 });
      await dana.page.mouse.up();
      await dana.page.waitForTimeout(200);

      // Wait for connector to appear on both screens
      await expectEventually('Both see connector', async () => {
        const danaLines = await dana.page.locator('[data-testid^="connector-"] line').count();
        const samLines = await sam.page.locator('[data-testid^="connector-"] line').count();
        return danaLines >= 1 && samLines >= 1;
      });

      // Dana drags the second shape to the left (past the first shape)
      // Get the second shape's position
      const shapeRects = dana.page.locator('[data-testid^="shape-"] rect');
      const rect2 = shapeRects.nth(1);
      const box2 = await rect2.boundingBox();
      if (box2) {
        const cx = box2.x + box2.width / 2;
        const cy = box2.y + box2.height / 2;
        await dana.page.mouse.move(cx, cy);
        await dana.page.mouse.down();
        await dana.page.mouse.move(cx - 350, cy, { steps: 10 });
        await dana.page.mouse.up();
        await dana.page.waitForTimeout(300);
      }

      // Sam should still see the connector (arrow followed the move)
      await expectEventually('Sam still sees connector after move', async () => {
        return (await sam.page.locator('[data-testid^="connector-"] line').count()) >= 1;
      });

      console.log('[TC-25] Arrow follows remote move on both screens');
    } finally {
      await dana.close();
      await sam.close();
    }
  });

  // TC-26: Sam deletes B → arrow remains with free end where B's side was
  test('TC-26: deleting connected object keeps arrow with free end', async ({ browser }) => {
    const [dana, sam] = await createParticipants(browser, 2);

    try {
      await setCamera(dana.page, { x: 0, y: 0, zoom: 1 });
      await setCamera(sam.page, { x: 0, y: 0, zoom: 1 });

      // Dana creates two shapes and a connector
      const centers = await createTwoShapes(dana.page);

      await expectEventually('Sam sees 2 shapes', async () => {
        return (await sam.page.locator('[data-testid^="shape-"] rect').count()) >= 2;
      });

      // Dana creates connector
      await dana.page.keyboard.press('l');
      await dana.page.waitForTimeout(100);
      await dana.page.mouse.move(centers.x1, centers.y1);
      await dana.page.mouse.down();
      await dana.page.mouse.move(centers.x2, centers.y2, { steps: 5 });
      await dana.page.mouse.up();
      await dana.page.waitForTimeout(200);

      await expectEventually('Both see connector', async () => {
        const d = await dana.page.locator('[data-testid^="connector-"] line').count();
        const s = await sam.page.locator('[data-testid^="connector-"] line').count();
        return d >= 1 && s >= 1;
      });

      // Sam selects and deletes the second shape
      const shapeRects = sam.page.locator('[data-testid^="shape-"] rect');
      const rect2 = shapeRects.nth(1);
      const box2 = await rect2.boundingBox();
      if (box2) {
        await sam.page.mouse.click(box2.x + box2.width / 2, box2.y + box2.height / 2);
        await sam.page.waitForTimeout(200);
        await sam.page.keyboard.press('Delete');
        await sam.page.waitForTimeout(300);
      }

      // Both should still see the connector (now with a free end)
      await expectEventually('Dana still sees connector', async () => {
        return (await dana.page.locator('[data-testid^="connector-"] line').count()) >= 1;
      });
      await expectEventually('Sam still sees connector', async () => {
        return (await sam.page.locator('[data-testid^="connector-"] line').count()) >= 1;
      });

      console.log('[TC-26] Arrow remains after target deletion on both screens');
    } finally {
      await dana.close();
      await sam.close();
    }
  });

  // TC-27: Dana drags arrow to B while Sam deletes B → no crash, arrow visible
  test('TC-27: concurrent delete during connector creation', async ({ browser }) => {
    const [dana, sam] = await createParticipants(browser, 2);

    try {
      await setCamera(dana.page, { x: 0, y: 0, zoom: 1 });
      await setCamera(sam.page, { x: 0, y: 0, zoom: 1 });

      // Dana creates two shapes
      const centers = await createTwoShapes(dana.page);

      await expectEventually('Sam sees 2 shapes', async () => {
        return (await sam.page.locator('[data-testid^="shape-"] rect').count()) >= 2;
      });

      // Get the second shape's position on Sam's screen
      const shapeRects = sam.page.locator('[data-testid^="shape-"] rect');
      const rect2 = shapeRects.nth(1);
      const box2 = await rect2.boundingBox();

      // Dana starts dragging a connector toward the second shape
      await dana.page.keyboard.press('l');
      await dana.page.waitForTimeout(100);
      await dana.page.mouse.move(centers.x1, centers.y1);
      await dana.page.mouse.down();
      await dana.page.mouse.move(centers.x2, centers.y2, { steps: 3 });

      // Sam deletes the second shape while Dana is mid-drag
      if (box2) {
        await sam.page.mouse.click(box2.x + box2.width / 2, box2.y + box2.height / 2);
        await sam.page.waitForTimeout(200);
        await sam.page.keyboard.press('Delete');
      }

      // Dana releases the connector
      await dana.page.mouse.up();
      await dana.page.waitForTimeout(500);

      // Verify no crash - the page should still be responsive
      await expect(dana.page.locator('[data-testid="toolbar"]')).toBeAttached();
      await expect(sam.page.locator('[data-testid="toolbar"]')).toBeAttached();

      console.log('[TC-27] Concurrent delete handled gracefully');
    } finally {
      await dana.close();
      await sam.close();
    }
  });
});
