/**
 * E2E tests for shape creation (story 10).
 * TC-23, TC-24.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { setCamera, openBoard } from './helpers/board';
import { SHAPE_DEFAULT_SIZE_WORLD } from '../../src/shared/config';

interface ShapeSnap {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: string;
  fill: string;
  stroke: string;
  label: string;
  z: number;
}

async function boardSnapshot(page: Page): Promise<readonly ShapeSnap[]> {
  return page.evaluate(() => (window as any).__vidi6?.snapshot?.() ?? []);
}

test.describe('shape creation (e2e)', () => {
  test('TC-23: drag from (100,100) to (300,220) → shape 200x120 at that position ±1px', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await openBoard(page);
    await setCamera(page, -640, -400, 1);

    // Switch to the shape tool (press S)
    await page.keyboard.press('s');

    // Drag from screen (100,100) to (300,220)
    const vp = page.getByTestId('board-viewport');
    const box = await vp.boundingBox();
    if (!box) throw new Error('viewport not found');

    const startX = box.x + 100;
    const startY = box.y + 100;
    const endX = box.x + 300;
    const endY = box.y + 220;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.up();

    // Verify the shape was created
    const snap = await boardSnapshot(page);
    const shape = snap.find((s) => s.type === 'shape');
    expect(shape).toBeDefined();
    expect(shape!.width).toBe(200);
    expect(shape!.height).toBe(120);
    // Position: world = screen / zoom + cam → (100/1 + (-640), 100/1 + (-400)) = (-540, -300)
    expect(shape!.x).toBeCloseTo(-540, 0);
    expect(shape!.y).toBeCloseTo(-300, 0);

    await context.close();
  });

  test('TC-24: Diamond click → 160x160 centred; type label → label stored', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await openBoard(page);
    await setCamera(page, -640, -400, 2);

    // Switch to the shape tool
    await page.keyboard.press('s');
    // Select diamond kind via the shape kind buttons in the toolbar
    // The toolbar shows kind buttons when shape tool is active
    const diamondBtn = page.getByRole('button', { name: 'Diamond' });
    await diamondBtn.click();

    // Click at screen centre (740, 460) in a 1480x920 viewport
    const vp = page.getByTestId('board-viewport');
    const box = await vp.boundingBox();
    if (!box) throw new Error('viewport not found');

    const clickX = box.x + box.width / 2;
    const clickY = box.y + box.height / 2;

    await page.mouse.click(clickX, clickY);

    // Verify shape was created
    const snap = await boardSnapshot(page);
    const shape = snap.find((s) => s.type === 'shape');
    expect(shape).toBeDefined();
    expect(shape!.kind).toBe('diamond');
    expect(shape!.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape!.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);

    // The shape should be centred at the click point
    // World click point: (clickX/2 + (-640), clickY/2 + (-400))
    // Shape x = clickWorld.x - 80 (half of 160)
    const clickWorldX = (clickX) / 2 + (-640);
    const clickWorldY = (clickY) / 2 + (-400);
    expect(shape!.x).toBeCloseTo(clickWorldX - SHAPE_DEFAULT_SIZE_WORLD / 2, 0);
    expect(shape!.y).toBeCloseTo(clickWorldY - SHAPE_DEFAULT_SIZE_WORLD / 2, 0);

    // Double-click to edit the label
    // The shape is now selected; find it in the viewport and double-click
    const shapeEl = page.locator(`[data-shape-id="${shape!.id}"]`);
    await shapeEl.dblclick();

    // Type a label
    await page.keyboard.type('Hello World');

    // Click elsewhere to deselect
    await page.mouse.click(box.x + 50, box.y + 50);

    // Verify label
    const snap2 = await boardSnapshot(page);
    const shape2 = snap2.find((s) => s.id === shape!.id);
    expect(shape2!.label).toBe('Hello World');

    await context.close();
  });
});
