// Story 10 e2e (TC-23, TC-24): draw a flow — a shape created by dragging at
// 100%, and a diamond created by clicking at 200% whose long label wraps and
// stays centred through a handle resize.

import { test, expect, type Page } from '@playwright/test';
import { getShapes, gotoBoard, setCamera } from './helpers/board';

async function dragFromTo(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(to[0], to[1], { steps: 4 });
  await page.mouse.up();
}

test('TC-23: dragging with the Shape tool creates a rect of the dragged size at that position', async ({
  page,
}) => {
  await gotoBoard(page);
  await setCamera(page, { x: 0, y: 0, zoom: 1 });

  await page.keyboard.press('s');
  await expect(page.getByTestId('shape-tool-catcher')).toBeVisible();
  await dragFromTo(page, [100, 100], [300, 220]);

  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
  const shapes = await getShapes(page);
  expect(shapes).toHaveLength(1);
  const [shape] = shapes;
  expect(shape.kind).toBe('rect');
  expect(Math.abs(shape.x - 100)).toBeLessThanOrEqual(1);
  expect(Math.abs(shape.y - 100)).toBeLessThanOrEqual(1);
  expect(Math.abs(shape.width - 200)).toBeLessThanOrEqual(1);
  expect(Math.abs(shape.height - 120)).toBeLessThanOrEqual(1);

  // The rendered element sits on the same rect on screen (camera is identity).
  const box = await page.getByTestId('shape-object').boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box!.x - 100)).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.width - 200)).toBeLessThanOrEqual(1);
});

test('TC-24: a click with the Shape tool at 200% drops a centred 160x160 diamond; its long label wraps and re-centres after a handle resize', async ({
  page,
}) => {
  await gotoBoard(page);
  await setCamera(page, { x: 0, y: 0, zoom: 2 });

  await page.keyboard.press('s');
  await page.getByTestId('shape-kind-diamond').click();
  await expect(page.getByTestId('shape-tool-catcher')).toBeVisible();
  await page.mouse.click(400, 400); // world (200, 200)

  const shapes = await getShapes(page);
  expect(shapes).toHaveLength(1);
  const [shape] = shapes;
  expect(shape.kind).toBe('diamond');
  expect(Math.abs(shape.width - 160)).toBeLessThanOrEqual(1);
  expect(Math.abs(shape.height - 160)).toBeLessThanOrEqual(1);
  expect(Math.abs(shape.x - 120)).toBeLessThanOrEqual(1);
  expect(Math.abs(shape.y - 120)).toBeLessThanOrEqual(1);

  // Long label: double-click enters editing, the text wraps into multiple lines.
  const label = 'story ten diamond label text that is definitely longer than one hundred sixty world units wide';
  await page.mouse.dblclick(400, 400);
  await expect(page.getByTestId('shape-label')).toBeVisible();
  await page.keyboard.insertText(label);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('shape-label-text')).toHaveText(label);

  const labelBox = await page.getByTestId('shape-label-text').boundingBox();
  expect(labelBox).not.toBeNull();
  // Wrapped: at least two lines of 16 world px * 1.3 line-height * zoom 2.
  expect(labelBox!.height).toBeGreaterThanOrEqual(16 * 1.3 * 2 * 2 - 2);

  // Resize through the southeast handle; the label stays centred in the shape.
  await page.mouse.click(400, 500); // select the diamond
  await expect(page.getByTestId('selection-overlay')).toBeVisible();
  const se = page.getByTestId('handle-se');
  await expect(se).toBeVisible();
  const seBox = await se.boundingBox();
  expect(seBox).not.toBeNull();
  await dragFromTo(
    page,
    [seBox!.x + seBox!.width / 2, seBox!.y + seBox!.height / 2],
    [seBox!.x + seBox!.width / 2 + 300, seBox!.y + seBox!.height / 2 + 300],
  );

  const grown = (await getShapes(page))[0];
  expect(grown.width).toBeGreaterThan(shape.width + 100);
  const shapeBox2 = await page.getByTestId('shape-object').boundingBox();
  const labelBox2 = await page.getByTestId('shape-label-text').boundingBox();
  expect(shapeBox2).not.toBeNull();
  expect(labelBox2).not.toBeNull();
  const cx1 = shapeBox2!.x + shapeBox2!.width / 2;
  const cy1 = shapeBox2!.y + shapeBox2!.height / 2;
  const lx = labelBox2!.x + labelBox2!.width / 2;
  const ly = labelBox2!.y + labelBox2!.height / 2;
  expect(Math.abs(lx - cx1)).toBeLessThanOrEqual(2);
  expect(Math.abs(ly - cy1)).toBeLessThanOrEqual(2);
  await expect(page.getByTestId('shape-label-text')).toHaveText(label);
});
