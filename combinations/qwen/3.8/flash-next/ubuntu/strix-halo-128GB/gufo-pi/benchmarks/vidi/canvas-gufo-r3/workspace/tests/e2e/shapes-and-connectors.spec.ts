import { test, expect } from '@playwright/test';
import { createAndGotoBoard } from './helpers/create-board';
import {
  createShapeByClick,
  getShapeIds,
  createShapeByDrag,
  labelShape,
  getShapes,
  getShapeText,
  getShapeDocState,
  getShapeToolOverlay,
  getConnectorWrappers,
  seedShape,
  seedConnector,
  getConnectorDocState,
  connectByDrag,
  dragShapeBy,
} from './helpers/shape';

const within = (ms = 6000) => ({ timeout: ms });

test.describe('Draw shapes and connect them with arrows', () => {
  test('TC-23: draw a rectangle, ellipse and diamond each with a distinct label', async ({ page }) => {
    await createAndGotoBoard(page);

    const r = await createShapeByDrag(page, 'rect', 200, 200, 380, 320);
    await labelShape(page, r, 'Start');
    const e = await createShapeByDrag(page, 'ellipse', 500, 200, 680, 320);
    await labelShape(page, e, 'Process');
    const d = await createShapeByDrag(page, 'diamond', 800, 200, 980, 340);
    await labelShape(page, d, 'Decision');

    await expect(getShapes(page)).toHaveCount(3, within());
    await expect(getShapeText(page, r)).toHaveText('Start');
    await expect(getShapeText(page, e)).toHaveText('Process');
    await expect(getShapeText(page, d)).toHaveText('Decision');

    expect((await getShapeDocState(page, r))!.kind).toBe('rect');
    expect((await getShapeDocState(page, e))!.kind).toBe('ellipse');
    expect((await getShapeDocState(page, d))!.kind).toBe('diamond');

    // At 100% zoom, a drag of 180x120 screen px yields a ~180x120 world shape (±1px)
    const rs = (await getShapeDocState(page, r))!;
    expect(Math.abs(rs.width - 180)).toBeLessThanOrEqual(1);
    expect(Math.abs(rs.height - 120)).toBeLessThanOrEqual(1);
  });

  test('TC-24b: a Diamond click at 200% zoom creates a default 160 world shape centred on the click', async ({ page }) => {
    await createAndGotoBoard(page);
    // Zoom to 200% and place the world origin back at the viewport centre.
    await page.evaluate(() => (window as any).__vidi6!.setCamera({ x: -640, y: -400, zoom: 2 }));

    const before = await getShapeIds(page);
    await page.locator('[data-testid="tool-shape"]').click();
    await page.locator('[data-testid="shape-kind-diamond"]').click();
    await page.mouse.click(640, 400); // viewport centre
    await page.waitForFunction(
      (prev) => document.querySelectorAll('[data-testid="shape-object"]').length > prev,
      before.length,
    );
    const d = (await getShapeIds(page)).find((id) => !before.includes(id))!;
    const st = (await getShapeDocState(page, d))!;
    expect(st.kind).toBe('diamond');
    expect(st.width).toBeCloseTo(160);
    expect(st.height).toBeCloseTo(160);

    // The rendered box is the default world size scaled by 2 -> ~320 screen px.
    const box = await page.locator(`[data-testid="shape-wrapper"][data-shape-id="${d}"]`).boundingBox();
    expect(Math.abs(box!.width - 320)).toBeLessThanOrEqual(2);
    expect(Math.abs(box!.height - 320)).toBeLessThanOrEqual(2);
    // Centred on the click point (viewport centre 640,400)
    expect(Math.abs(box!.x + box!.width / 2 - 640)).toBeLessThanOrEqual(2);
    expect(Math.abs(box!.y + box!.height / 2 - 400)).toBeLessThanOrEqual(2);
  });

  test('TC-24: click creates a default shape and connects two shapes with an attached arrow', async ({ page }) => {
    await createAndGotoBoard(page);

    const a = await createShapeByClick(page, 300, 300);
    const b = await createShapeByClick(page, 800, 500);
    const conn = await connectByDrag(page, a, b);

    await expect(getConnectorWrappers(page)).toHaveCount(1, within());
    const state = await getConnectorDocState(page, conn);
    expect(state!.from.kind).toBe('attached');
    expect(state!.to.kind).toBe('attached');
    const ids = new Set([
      state!.from.kind === 'attached' ? state!.from.objectId : '',
      state!.to.kind === 'attached' ? state!.to.objectId : '',
    ]);
    expect(ids.has(a) && ids.has(b)).toBe(true);
  });

  test('TC-25: arrows follow objects as they move', async ({ page }) => {
    await createAndGotoBoard(page);

    const a = await seedShape(page, 'rect', { x: 0, y: 0, width: 160, height: 120 });
    const b = await seedShape(page, 'rect', { x: 500, y: 0, width: 160, height: 120 });
    await seedConnector(page, { kind: 'attached', objectId: a, fallback: { x: 160, y: 60 } }, { kind: 'attached', objectId: b, fallback: { x: 500, y: 60 } });

    const line = page.locator('[data-testid="connector-line"]');
    const before = await line.evaluate((el) => ({
      x1: +el.getAttribute('x1')!,
      y1: +el.getAttribute('y1')!,
      x2: +el.getAttribute('x2')!,
      y2: +el.getAttribute('y2')!,
    }));

    // Move B down and right by 300 world units
    await dragShapeBy(page, b, 300, 300);

    const after = await line.evaluate((el) => ({
      x1: +el.getAttribute('x1')!,
      y1: +el.getAttribute('y1')!,
      x2: +el.getAttribute('x2')!,
      y2: +el.getAttribute('y2')!,
    }));
    // The connected endpoint moved; the other stayed put.
    expect(Math.abs(after.x2 - before.x2) + Math.abs(after.y2 - before.y2)).toBeGreaterThan(50);
    expect(Math.abs(after.x1 - before.x1)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.y1 - before.y1)).toBeLessThanOrEqual(2);
  });

  test('TC-26: deleting a connected object detaches the arrow end but keeps the arrow', async ({ page }) => {
    await createAndGotoBoard(page);

    const a = await seedShape(page, 'rect', { x: 0, y: 0, width: 160, height: 120 });
    const b = await seedShape(page, 'rect', { x: 500, y: 0, width: 160, height: 120 });
    const conn = await seedConnector(page, { kind: 'attached', objectId: a, fallback: { x: 160, y: 60 } }, { kind: 'attached', objectId: b, fallback: { x: 500, y: 60 } });

    // Select B and delete it
    const bBox = await page.locator(`[data-testid="shape-wrapper"][data-shape-id="${b}"]`).boundingBox();
    await page.mouse.click(bBox!.x + bBox!.width / 2, bBox!.y + bBox!.height / 2);
    await page.keyboard.press('Delete');

    await expect(getShapes(page)).toHaveCount(1, within());
    await expect(getConnectorWrappers(page)).toHaveCount(1);
    const state = await getConnectorDocState(page, conn);
    expect(state!.from.kind).toBe('attached'); // still attached to A
    expect(state!.to.kind).toBe('free'); // detached from deleted B
  });

  test('TC-27: two participants see the same shapes and connectors', async ({ page, browser }) => {
    const boardId = await createAndGotoBoard(page);
    const a = await seedShape(page, 'rect', { x: 0, y: 0, width: 160, height: 120 });
    const b = await seedShape(page, 'ellipse', { x: 500, y: 100, width: 160, height: 120 });
    await seedConnector(page, { kind: 'attached', objectId: a, fallback: { x: 160, y: 60 } }, { kind: 'attached', objectId: b, fallback: { x: 500, y: 160 } });

    const page2 = await browser.newPage();
    await page2.goto(`/b/${boardId}`);
    await page2.waitForFunction(
      () => {
        const s = (window as any).__vidi6?.connectionState;
        return s === 'connected' || s === 'confirmed';
      },
      undefined,
      { timeout: 15000 },
    );

    await expect(page2.locator('[data-testid="shape-object"]')).toHaveCount(2, within());
    await expect(page2.locator('[data-testid="connector-wrapper"]')).toHaveCount(1, within());
    // Shapes visible on both
    await expect(page.locator('[data-testid="shape-object"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="connector-wrapper"]')).toHaveCount(1);

    await page2.close();
  });

  test('TC-28: a shape-tool drag starting over an existing shape does not move that shape', async ({ page }) => {
    await createAndGotoBoard(page);
    const s = await seedShape(page, 'rect', { x: 0, y: 0, width: 160, height: 120 });
    const before = await getShapeDocState(page, s);

    await page.locator('[data-testid="tool-shape"]').click();
    const box = await page.locator(`[data-testid="shape-wrapper"][data-shape-id="${s}"]`).boundingBox();
    await getShapeToolOverlay(page).waitFor({ state: 'attached' });
    // Start drag on the existing shape and drag out
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 260, box!.y + box!.height / 2 + 200, { steps: 6 });
    await page.mouse.up();

    const after = await getShapeDocState(page, s);
    expect(after!.x).toBe(before!.x);
    expect(after!.y).toBe(before!.y);
    // A second shape was created by the drag
    await expect(getShapes(page)).toHaveCount(2, within());
  });
});
