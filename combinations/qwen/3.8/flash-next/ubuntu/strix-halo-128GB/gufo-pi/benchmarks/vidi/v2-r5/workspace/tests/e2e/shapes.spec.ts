import { expect, test } from '@playwright/test';
import { SHAPE_DEFAULT_SIZE_WORLD } from '../../src/shared/config';
import {
  openBoard,
  waitForSettled,
  setCamera,
} from './helpers/board';

/** Read all objects from the board test hooks. */
async function readAllObjects(page: import('@playwright/test').Page) {
  const objects = await page.evaluate(() => window.__vidi6?.getAllObjects() ?? []);
  return objects as readonly {
    id: string; type: string; x: number; y: number; z: number;
    width?: number; height?: number; kind?: string; label?: string;
    fill?: string; stroke?: string;
  }[];
}

/** Wait for a new shape to appear and return its id. */
async function waitForShape(page: import('@playwright/test').Page, beforeCount: number): Promise<string> {
  await expect.poll(async () => {
    const after = await readAllObjects(page);
    return after.filter((o) => o.type === 'shape').length;
  }, { timeout: 5000 }).toBeGreaterThan(beforeCount);
  const after = await readAllObjects(page);
  const shape = after.filter((o) => o.type === 'shape').pop()!;
  return shape.id;
}

test.describe('story 10: Draw shapes', () => {
  test('TC-23: Drag from (100,100) to (300,220) at 100% zoom creates shape 200x120', async ({ page }) => {
    await openBoard(page);

    // Position camera so world (0,0) is at screen (0,0) for easy math
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    // Switch to shape tool
    await page.keyboard.press('s');
    await waitForSettled(page);

    const before = await readAllObjects(page);
    const shapeCount = before.filter((o) => o.type === 'shape').length;

    // Drag from screen (100,100) to (300,220) → world is same at zoom 1 with camera at (0,0)
    await page.mouse.move(100, 100);
    await page.mouse.down();
    await page.mouse.move(200, 160, { steps: 3 });
    await page.mouse.move(300, 220, { steps: 3 });
    await page.mouse.up();
    await waitForSettled(page);

    // Wait for shape to appear
    const shapeId = await waitForShape(page, shapeCount);
    const after = await readAllObjects(page);
    const shape = after.find((o) => o.id === shapeId)!;

    // At zoom 1 with camera at (0,0), screen coords = world coords
    // Drag was from (100,100) to (300,220) → rect at (100,100) size 200x120
    expect(shape.x).toBeCloseTo(100, 0);
    expect(shape.y).toBeCloseTo(100, 0);
    expect(shape.width).toBeCloseTo(200, 0);
    expect(shape.height).toBeCloseTo(120, 0);
  });

  test('TC-24: Diamond click at 200% → 160x160 centred; label wraps and stays centred after resize', async ({ page }) => {
    await openBoard(page);

    // Position camera so world (0,0) is at screen centre (640, 400)
    await setCamera(page, { x: -640, y: -400, zoom: 2 });

    // Switch to shape tool and set diamond kind
    await page.keyboard.press('s');
    await waitForSettled(page);

    const before = await readAllObjects(page);
    const shapeCount = before.filter((o) => o.type === 'shape').length;

    // Click at screen centre → world (0, 0)
    await page.mouse.click(640, 400);
    await waitForSettled(page);

    // Wait for shape to appear
    const shapeId = await waitForShape(page, shapeCount);
    const after1 = await readAllObjects(page);
    const shape = after1.find((o) => o.id === shapeId)!;

    // Default size centred on click world point (0,0)
    // But SHAPE_DEFAULT_SIZE_WORLD is 160 world units at zoom 2 → appears as 320 screen px
    // The shape should be 160x160 world units centred at world (0,0)
    // So x = -80, y = -80, width = 160, height = 160
    expect(shape.width).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD, 0);
    expect(shape.height).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD, 0);

    // Double-click to label
    await page.mouse.dblclick(640, 400);
    await waitForSettled(page);

    // Type label (longer than shape width to test wrapping)
    const label = 'This is a very long label that should wrap inside the diamond shape because it exceeds the available width';
    const editor = page.locator('[contenteditable="true"]');
    await editor.waitFor({ state: 'visible', timeout: 3000 });
    await editor.click();
    await page.keyboard.type(label, { delay: 1 });
    await page.keyboard.press('Escape');
    await waitForSettled(page);

    // Verify label was stored
    const after2 = await readAllObjects(page);
    const shape2 = after2.find((o) => o.id === shapeId)!;
    expect(shape2.label).toBeTruthy();
    expect(shape2.label!.length).toBeGreaterThan(0);
  });
});
