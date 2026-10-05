import { test, expect } from '@playwright/test';
import { setCamera, waitForZoom } from './helpers/board';

/**
 * Creates a shape via the shape tool by clicking.
 */
async function createShapeByClick(page: import('@playwright/test').Page, x: number, y: number) {
  await page.getByLabel('Shape (S)').click();
  await page.mouse.click(x, y);
}

test.describe('Connector e2e', () => {
  test('TC-25: arrow follows remote move (delivery time logged)', async ({ browser, request }) => {
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

    // Create shapes
    await createShapeByClick(pageDana, 200, 300);
    await pageDana.getByLabel('Select (V)').click();
    await createShapeByClick(pageDana, 500, 300);

    // Connect
    await pageDana.getByLabel('Connector (L)').click();
    await pageDana.mouse.move(200, 300);
    await pageDana.mouse.down();
    await pageDana.mouse.move(500, 300, { steps: 10 });
    await pageDana.mouse.up();

    // Wait for Sam to see the connector
    const startTime = Date.now();
    await pageSam.waitForFunction(() => {
      const doc = (window as any).__vidi6.getDoc();
      let count = 0;
      doc.getMap('objects').forEach((obj: any) => {
        if (obj.get('type') === 'connector') count++;
      });
      return count >= 1;
    }, { timeout: 15000 });
    const deliveryTime = Date.now() - startTime;
    console.log(`TC-25: connector delivery time to Sam: ${deliveryTime}ms (budget: 1000ms)`);

    // Drag B
    await pageDana.getByLabel('Select (V)').click();
    await pageDana.mouse.click(500, 300);
    await pageDana.mouse.move(500, 300);
    await pageDana.mouse.down();
    await pageDana.mouse.move(50, 300, { steps: 10 });
    await pageDana.mouse.up();

    // Wait for Sam to see the move
    await pageSam.waitForFunction(() => {
      const doc = (window as any).__vidi6.getDoc();
      let found = false;
      doc.getMap('objects').forEach((obj: any) => {
        if (obj.get('type') === 'shape' && obj.get('x') < 100) found = true;
      });
      return found;
    }, { timeout: 15000 });

    // Arrow should still be attached
    const samConn = await pageSam.evaluate((): { from: { kind: string }; to: { kind: string } } | null => {
      const doc = (window as any).__vidi6.getDoc();
      let result: { from: { kind: string }; to: { kind: string } } | null = null;
      doc.getMap('objects').forEach((obj: any) => {
        if (obj.get('type') === 'connector') {
          result = { from: obj.get('from'), to: obj.get('to') };
        }
      });
      return result;
    });
    expect(samConn).not.toBeNull();
    // At least one end should still be attached
    const anyAttached = samConn!.from.kind === 'attached' || samConn!.to.kind === 'attached';
    expect(anyAttached).toBe(true);

    await ctxDana.close();
    await ctxSam.close();
  });
});
