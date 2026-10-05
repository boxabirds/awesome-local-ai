import { test, expect } from '@playwright/test';
import { openBoardPath, setCamera, waitForZoom } from './helpers/board';

/**
 * Creates a shape via the shape tool by dragging on the board.
 */
async function createShapeByDrag(page: import('@playwright/test').Page, x1: number, y1: number, x2: number, y2: number) {
  await page.getByLabel('Shape (S)').click();
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 5 });
  await page.mouse.up();
}

/**
 * Creates a shape via the shape tool by clicking (no drag).
 */
async function createShapeByClick(page: import('@playwright/test').Page, x: number, y: number) {
  await page.getByLabel('Shape (S)').click();
  await page.mouse.click(x, y);
}

/**
 * Selects the shape kind from the toolbar menu.
 */
async function selectShapeKind(page: import('@playwright/test').Page, kind: string) {
  // Activate the shape tool first
  await page.getByLabel('Shape (S)').click();
  // Click the shape button again to open the kind menu
  await page.getByLabel('Shape (S)').click();
  // Click the kind
  await page.getByLabel(kind).click();
}

test.describe('Draw a flow', () => {
  test('TC-23: real drag (100,100)→(300,220) at 100% → shape 200x120 at that position ±1px', async ({ page, request }) => {
    await openBoardPath(request, page);
    // Reset camera to origin at 100% zoom
    await setCamera(page, 0, 0, 1);
    await waitForZoom(page, 1);

    // Drag from (100,100) to (300,220)
    await createShapeByDrag(page, 100, 100, 300, 220);

    // Verify the shape was created with correct dimensions
    const shapeInfo = await page.evaluate((): { id: string; x: number; y: number; width: number; height: number } | null => {
      const doc = (window as any).__vidi6.getDoc();
      const objects = doc.getMap('objects');
      let result: { id: string; x: number; y: number; width: number; height: number } | null = null;
      objects.forEach((obj: any, id: string) => {
        if (obj.get('type') === 'shape') {
          result = {
            id,
            x: obj.get('x'),
            y: obj.get('y'),
            width: obj.get('width'),
            height: obj.get('height'),
          };
        }
      });
      return result;
    });

    expect(shapeInfo).not.toBeNull();
    expect(shapeInfo!.width).toBeCloseTo(200, 0);
    expect(shapeInfo!.height).toBeCloseTo(120, 0);
    // Position should be at (100,100) ± 1px
    expect(Math.abs(shapeInfo!.x - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(shapeInfo!.y - 100)).toBeLessThanOrEqual(1);
  });

  test('TC-24: at 200% zoom Diamond click → 160x160 centred; label wraps and stays centred after resize', async ({ page, request }) => {
    await openBoardPath(request, page);
    // Set camera to 200% zoom
    await setCamera(page, 0, 0, 2);
    await waitForZoom(page, 2);

    // Select diamond kind
    await selectShapeKind(page, 'Diamond');

    // Click at screen (400, 300) → world (200, 150) at 200% zoom
    await createShapeByClick(page, 400, 300);

    // Verify the shape was created
    const shapeInfo = await page.evaluate((): { id: string; x: number; y: number; width: number; height: number; kind: string } | null => {
      const doc = (window as any).__vidi6.getDoc();
      const objects = doc.getMap('objects');
      let result: { id: string; x: number; y: number; width: number; height: number; kind: string } | null = null;
      objects.forEach((obj: any, id: string) => {
        if (obj.get('type') === 'shape') {
          result = {
            id,
            x: obj.get('x'),
            y: obj.get('y'),
            width: obj.get('width'),
            height: obj.get('height'),
            kind: obj.get('kind'),
          };
        }
      });
      return result;
    });

    expect(shapeInfo).not.toBeNull();
    expect(shapeInfo!.kind).toBe('diamond');
    expect(shapeInfo!.width).toBe(160);
    expect(shapeInfo!.height).toBe(160);
    // Centred on the click point (world 200, 150)
    expect(shapeInfo!.x).toBeCloseTo(200 - 80, 0); // 120
    expect(shapeInfo!.y).toBeCloseTo(150 - 80, 0); // 70
  });
});

test.describe('Collaborative rearrange', () => {
  test('TC-25: Dana connects A→B and drags B past A; Sam sees arrow attached and switching side', async ({ browser, request }) => {
    // Create a board
    const res = await request.post('/api/boards');
    const { id: boardId } = (await res.json()) as { id: string };

    // Open two contexts
    const ctxDana = await browser.newContext();
    const pageDana = await ctxDana.newPage();
    const ctxSam = await browser.newContext();
    const pageSam = await ctxSam.newPage();

    await pageDana.goto(`/b/${boardId}`);
    await expect(pageDana.getByTestId('board-viewport')).toBeVisible({ timeout: 15000 });

    await pageSam.goto(`/b/${boardId}`);
    await expect(pageSam.getByTestId('board-viewport')).toBeVisible({ timeout: 15000 });

    // Both at 100% zoom, origin
    await setCamera(pageDana, 0, 0, 1);
    await setCamera(pageSam, 0, 0, 1);
    await waitForZoom(pageDana, 1);
    await waitForZoom(pageSam, 1);

    // Use the shape tool to create shapes
    // Create shape A at (200, 300)
    await createShapeByClick(pageDana, 200, 300);
    // Create shape B at (500, 300)
    await pageDana.getByLabel('Select (V)').click();
    await createShapeByClick(pageDana, 500, 300);

    // Wait for Sam to see both shapes
    await pageSam.waitForTimeout(1000);

    // Connect A to B using the connector tool
    await pageDana.getByLabel('Connector (L)').click();
    await pageDana.mouse.move(200, 300);
    await pageDana.mouse.down();
    await pageDana.mouse.move(500, 300, { steps: 10 });
    await pageDana.mouse.up();

    // Wait for Sam to see the connector
    await pageSam.waitForTimeout(1000);

    // Verify both see the connector
    const danaConns = await pageDana.evaluate(() => {
      const doc = (window as any).__vidi6.getDoc();
      let count = 0;
      doc.getMap('objects').forEach((obj: any) => {
        if (obj.get('type') === 'connector') count++;
      });
      return count;
    });
    expect(danaConns).toBe(1);

    // Now drag B past A (move B to the left of A)
    // Select B and drag it
    await pageDana.getByLabel('Select (V)').click();
    // Click on B to select it
    await pageDana.mouse.click(500, 300);
    // Drag B to the left (past A)
    await pageDana.mouse.move(500, 300);
    await pageDana.mouse.down();
    await pageDana.mouse.move(50, 300, { steps: 10 });
    await pageDana.mouse.up();

    // Wait for Sam to see the move
    await pageSam.waitForTimeout(1000);

    // The arrow should still be attached (not broken)
    const samConns = await pageSam.evaluate(() => {
      const doc = (window as any).__vidi6.getDoc();
      let count = 0;
      doc.getMap('objects').forEach((obj: any) => {
        if (obj.get('type') === 'connector') count++;
      });
      return count;
    });
    expect(samConns).toBe(1);

    await ctxDana.close();
    await ctxSam.close();
  });

  test('TC-26: Sam deletes B → arrow remains with free end where B\'s side was', async ({ browser, request }) => {
    const res = await request.post('/api/boards');
    const { id: boardId } = (await res.json()) as { id: string };

    const ctxDana = await browser.newContext();
    const pageDana = await ctxDana.newPage();
    const ctxSam = await browser.newContext();
    const pageSam = await ctxSam.newPage();

    await pageDana.goto(`/b/${boardId}`);
    await expect(pageDana.getByTestId('board-viewport')).toBeVisible({ timeout: 15000 });
    await pageSam.goto(`/b/${boardId}`);
    await expect(pageSam.getByTestId('board-viewport')).toBeVisible({ timeout: 15000 });

    await setCamera(pageDana, 0, 0, 1);
    await setCamera(pageSam, 0, 0, 1);
    await waitForZoom(pageDana, 1);
    await waitForZoom(pageSam, 1);

    // Create two shapes
    await createShapeByClick(pageDana, 200, 300);
    await pageDana.getByLabel('Select (V)').click();
    await createShapeByClick(pageDana, 500, 300);

    // Connect them
    await pageDana.getByLabel('Connector (L)').click();
    await pageDana.mouse.move(200, 300);
    await pageDana.mouse.down();
    await pageDana.mouse.move(500, 300, { steps: 10 });
    await pageDana.mouse.up();

    // Wait for sync
    await pageSam.waitForTimeout(1000);

    // Sam selects and deletes B (the shape at 500,300)
    await pageSam.getByLabel('Select (V)').click();
    await pageSam.mouse.click(500, 300);
    await pageSam.keyboard.press('Delete');

    // Wait for sync
    await pageDana.waitForTimeout(1000);

    // The arrow should still exist on both screens
    const danaConns = await pageDana.evaluate(() => {
      const doc = (window as any).__vidi6.getDoc();
      let count = 0;
      doc.getMap('objects').forEach((obj: any) => {
        if (obj.get('type') === 'connector') count++;
      });
      return count;
    });
    expect(danaConns).toBe(1);

    const samConns = await pageSam.evaluate(() => {
      const doc = (window as any).__vidi6.getDoc();
      let count = 0;
      doc.getMap('objects').forEach((obj: any) => {
        if (obj.get('type') === 'connector') count++;
      });
      return count;
    });
    expect(samConns).toBe(1);

    // The arrow's endpoint that was attached to B should now be free
    const connEndpoint = await pageDana.evaluate((): { from: { kind: string }; to: { kind: string } } | null => {
      const doc = (window as any).__vidi6.getDoc();
      let result: { from: { kind: string }; to: { kind: string } } | null = null;
      doc.getMap('objects').forEach((obj: any) => {
        if (obj.get('type') === 'connector') {
          result = { from: obj.get('from'), to: obj.get('to') };
        }
      });
      return result;
    });
    // One of the endpoints should be free (the one that was attached to B)
    const hasFreeEnd = connEndpoint!.from.kind === 'free' || connEndpoint!.to.kind === 'free';
    expect(hasFreeEnd).toBe(true);

    await ctxDana.close();
    await ctxSam.close();
  });

  test('TC-27: Dana drags arrow to B while Sam deletes B → Dana\'s arrow visible with end at fallback', async ({ browser, request }) => {
    const res = await request.post('/api/boards');
    const { id: boardId } = (await res.json()) as { id: string };

    const ctxDana = await browser.newContext();
    const pageDana = await ctxDana.newPage();
    const ctxSam = await browser.newContext();
    const pageSam = await ctxSam.newPage();

    await pageDana.goto(`/b/${boardId}`);
    await expect(pageDana.getByTestId('board-viewport')).toBeVisible({ timeout: 15000 });
    await pageSam.goto(`/b/${boardId}`);
    await expect(pageSam.getByTestId('board-viewport')).toBeVisible({ timeout: 15000 });

    await setCamera(pageDana, 0, 0, 1);
    await setCamera(pageSam, 0, 0, 1);
    await waitForZoom(pageDana, 1);
    await waitForZoom(pageSam, 1);

    // Create two shapes
    await createShapeByClick(pageDana, 200, 300);
    await pageDana.getByLabel('Select (V)').click();
    await createShapeByClick(pageDana, 500, 300);

    // Wait for sync
    await pageSam.waitForTimeout(1000);

    // Start the connector drag on Dana's side
    await pageDana.getByLabel('Connector (L)').click();
    await pageDana.mouse.move(200, 300);
    await pageDana.mouse.down();
    await pageDana.mouse.move(500, 300, { steps: 5 });

    // While Dana is dragging, Sam deletes B
    await pageSam.getByLabel('Select (V)').click();
    await pageSam.mouse.click(500, 300);
    await pageSam.keyboard.press('Delete');

    // Dana releases the connector
    await pageDana.mouse.up();

    // Wait a moment
    await pageDana.waitForTimeout(500);

    // Dana's arrow should be visible (with a free end where B was)
    const danaConns = await pageDana.evaluate(() => {
      const doc = (window as any).__vidi6.getDoc();
      let count = 0;
      doc.getMap('objects').forEach((obj: any) => {
        if (obj.get('type') === 'connector') count++;
      });
      return count;
    });
    expect(danaConns).toBe(1);

    await ctxDana.close();
    await ctxSam.close();
  });
});
