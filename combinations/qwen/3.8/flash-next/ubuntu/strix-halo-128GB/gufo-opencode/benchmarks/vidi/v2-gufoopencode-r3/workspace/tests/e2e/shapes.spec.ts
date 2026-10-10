import { expect, test, type Page } from '@playwright/test';
import { createBoard, dragBy, setCamera } from './helpers/board';

interface ShapeState {
  id: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

async function getShapes(page: Page): Promise<ShapeState[]> {
  return page.evaluate(() => {
    const hook = window.__vidi6;
    if (!hook) throw new Error('window.__vidi6 missing; run the test build (MODE=test)');
    return hook.getShapes().map((s) => ({
      id: s.id,
      kind: s.kind as string,
      x: s.x,
      y: s.y,
      width: s.width ?? 0,
      height: s.height ?? 0,
      label: s.label
    }));
  });
}

function shapeLocator(page: Page, id: string) {
  return page.locator(`[data-testid="shape-object"][data-id="${id}"]`);
}

async function clickShapeTool(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Shape (S)' }).click();
}

async function selectKind(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click();
}

const EMPTY = { x: 1200, y: 760 };

test.describe('shapes (story 10)', () => {
  test('TC-23 drag with the shape tool creates an exactly-sized rect', async ({ page }) => {
    const id = await createBoard(page.request);
    await page.goto(`/b/${id}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible();

    const cam = { x: -640, y: -400, zoom: 1 };
    await setCamera(page, cam);
    await clickShapeTool(page);

    const from = { x: 100, y: 100 };
    const to = { x: 300, y: 220 };
    await dragBy(page, from, to.x - from.x, to.y - from.y);

    const shapes = await getShapes(page);
    expect(shapes).toHaveLength(1);
    const worldFrom = { x: from.x / cam.zoom + cam.x, y: from.y / cam.zoom + cam.y };
    const s = shapes[0];
    expect(s.kind).toBe('rect');
    expect(Math.abs(s.x - worldFrom.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(s.y - worldFrom.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(s.width - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(s.height - 120)).toBeLessThanOrEqual(1);

    // Tool returns to Select after creating.
    await expect(page.getByRole('button', { name: 'Shape (S)' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  test('TC-24 clicking with the diamond tool creates a centred 160x160; label wraps and stays centred after resize', async ({
    page
  }) => {
    const id = await createBoard(page.request);
    await page.goto(`/b/${id}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible();

    const cam = { x: -320, y: -200, zoom: 2 };
    await setCamera(page, cam);

    await clickShapeTool(page);
    await selectKind(page, 'Diamond');

    const click = { x: 640, y: 300 };
    await page.mouse.click(click.x, click.y);

    const shapes = await getShapes(page);
    expect(shapes).toHaveLength(1);
    const s0 = shapes[0];
    expect(s0.kind).toBe('diamond');
    expect(Math.abs(s0.width - 160)).toBeLessThanOrEqual(1);
    expect(Math.abs(s0.height - 160)).toBeLessThanOrEqual(1);
    const centre = { x: click.x / cam.zoom + cam.x, y: click.y / cam.zoom + cam.y };
    expect(Math.abs(s0.x + s0.width / 2 - centre.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(s0.y + s0.height / 2 - centre.y)).toBeLessThanOrEqual(1);

    // Long label that must wrap inside the diamond.
    await page.mouse.dblclick(click.x, click.y);
    const editor = page.getByTestId('shape-label-editor');
    await expect(editor).toBeVisible();
    const longLabel = 'payment captured and order queued for fulfilment by the warehouse team';
    await page.keyboard.type(longLabel);

    await page.mouse.click(EMPTY.x, EMPTY.y);

    // The label renders centred and wrapped on the shape.
    const labelBox = shapeLocator(page, s0.id).locator('.shape-label');
    await expect(labelBox).toHaveText(longLabel);
    const centreAfterLabel = await labelBox.evaluate((el: HTMLElement) => {
      const node = el.childNodes[el.childNodes.length - 1] ?? el.firstChild;
      const range = document.createRange();
      if (node !== null) range.selectNodeContents(node);
      const rects = range.getClientRects();
      let lineCount = 0;
      let lastTop = -1;
      for (const r of rects) {
        if (Math.abs(r.top - lastTop) > 1) lineCount += 1;
        lastTop = r.top;
      }
      const box = el.getBoundingClientRect();
      return { lines: lineCount, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
    });
    expect(centreAfterLabel.lines).toBeGreaterThan(1);

    // Resize via the bottom-right handle; the label stays centred.
    await page.mouse.click(click.x, click.y);
    const handle = page.getByLabel('Resize bottom-right');
    const handleBox = await handle.boundingBox();
    if (handleBox === null) throw new Error('resize handle has no box');
    await dragBy(page, { x: handleBox.x + 4, y: handleBox.y + 4 }, 80, 80);
    await page.mouse.click(EMPTY.x, EMPTY.y);

    const s1 = (await getShapes(page))[0];
    expect(s1.width).toBeGreaterThan(s0.width + 50);
    const shapeBox = await shapeLocator(page, s0.id).boundingBox();
    const labelBox2 = await shapeLocator(page, s0.id).locator('.shape-label').boundingBox();
    if (shapeBox === null || labelBox2 === null) throw new Error('boxes missing');
    const dx = Math.abs(shapeBox.x + shapeBox.width / 2 - (labelBox2.x + labelBox2.width / 2));
    const dy = Math.abs(shapeBox.y + shapeBox.height / 2 - (labelBox2.y + labelBox2.height / 2));
    expect(dx).toBeLessThanOrEqual(2);
    expect(dy).toBeLessThanOrEqual(2);
    expect((await getShapes(page))[0].label).toBe(longLabel);
  });
});
