import { expect, test, type Page } from '@playwright/test';

import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_FONT_PX,
  SHAPE_STROKE_COLORS,
} from '../../src/shared/config';
import { setCamera, startBoard } from './helpers/live';

/**
 * Story 10 e2e (TC-23, TC-24): shapes drawn with real pointer input in a real
 * browser, at real zoom levels, with real fonts wrapping the label.
 */

const PIN = { x: 0, y: 0, zoom: 1 };

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function shapeIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="shape-object-"]')].map((element) =>
      String(element.getAttribute('data-testid')).slice('shape-object-'.length),
    ),
  );
}

/** Draw a shape by dragging, and return the id of the shape that appeared. */
async function dragShape(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { key?: string; shift?: boolean } = {},
): Promise<string> {
  const before = new Set(await shapeIds(page));
  if (options.key === undefined) {
    await page.keyboard.press('s');
  }
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  if (options.shift === true) await page.keyboard.down('Shift');
  await page.mouse.up();
  if (options.shift === true) await page.keyboard.up('Shift');

  let id = '';
  await expect
    .poll(async () => {
      id = (await shapeIds(page)).find((candidate) => !before.has(candidate)) ?? '';
      return id;
    })
    .not.toBe('');
  return id;
}

async function boxOf(page: Page, testId: string): Promise<Box> {
  const box = await page.locator(`[data-testid="${testId}"]`).boundingBox();
  if (box === null) throw new Error(`${testId} is not on screen`);
  return box;
}

const shapeBox = (page: Page, id: string): Promise<Box> => boxOf(page, `shape-object-${id}`);

/** The rendered rectangle of a shape's label text (not the box it sits in). */
async function labelTextRect(page: Page, id: string): Promise<Box> {
  const rect = await page.evaluate((labelId) => {
    const element = document.querySelector(`[data-testid="shape-label-${labelId}"]`);
    if (element === null) return null;
    const range = document.createRange();
    range.selectNodeContents(element);
    const r = range.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, id);
  if (rect === null) throw new Error(`label ${id} is not on screen`);
  return rect;
}

/** Assert two boxes are the same to within a pixel, naming both on failure. */
function expectSameBox(actual: Box, expected: Box): void {
  const quantised = (box: Box): Box => ({
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  });
  expect(quantised(actual), `box moved: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`).toEqual(
    quantised(expected),
  );
}

const centre = (box: Box): { x: number; y: number } => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

test.describe('Shapes e2e', () => {
  test('TC-23: a real drag makes a shape of exactly the dragged area', async ({ page }) => {
    await startBoard(page);
    await setCamera(page, PIN);

    const id = await dragShape(page, { x: 100, y: 100 }, { x: 300, y: 220 });

    const box = await shapeBox(page, id);
    expect(Math.abs(box.x - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - 120)).toBeLessThanOrEqual(1);

    // One shape, selected, and the tool is back to Select.
    expect(await shapeIds(page)).toHaveLength(1);
    await expect(page.locator(`[data-testid="shape-object-${id}"]`)).toHaveAttribute(
      'data-selected',
      'true',
    );
    await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
    expect(page.getByTestId('shape-tool-layer')).toHaveCount(0);
  });

  test('TC-23: a click makes the standard size, centred on the point', async ({ page }) => {
    await startBoard(page);
    await setCamera(page, PIN);

    const id = await dragShape(page, { x: 500, y: 180 }, { x: 500, y: 180 });
    const box = await shapeBox(page, id);
    const expected = SHAPE_DEFAULT_SIZE_WORLD;
    expect(Math.abs(box.width - expected)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - expected)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre(box).x - 500)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre(box).y - 180)).toBeLessThanOrEqual(1);
  });

  test('TC-24: a Diamond at 200%, labelled, wrapped and resized', async ({ page }) => {
    await startBoard(page);
    const zoom = 2;
    await setCamera(page, { x: 0, y: 0, zoom });

    // Choose the Diamond kind from the Shape menu.
    await page.getByTestId('tool-shape').click();
    await expect(page.getByTestId('shape-kind-menu')).toBeVisible();
    await page.getByTestId('shape-kind-diamond').click();
    await page.mouse.click(560, 420);

    let id = '';
    await expect
      .poll(async () => {
        id = ((await shapeIds(page))[0] ?? '') as string;
        return id;
      })
      .not.toBe('');

    // 160 world units across is 320 device px at 200%, centred on the click.
    const box = await shapeBox(page, id);
    expect(Math.abs(box.width - SHAPE_DEFAULT_SIZE_WORLD * zoom)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - SHAPE_DEFAULT_SIZE_WORLD * zoom)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre(box).x - 560)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre(box).y - 420)).toBeLessThanOrEqual(1);
    await expect(page.locator(`[data-testid="shape-object-${id}"]`)).toHaveAttribute(
      'data-kind',
      'diamond',
    );
    expect(await page.locator(`[data-testid="shape-object-${id}"] polygon`).count()).toBe(1);

    // A label longer than the shape wraps, and stays in the middle.
    const sentence = 'Retro board review for the whole team every Friday afternoon';
    await page.mouse.dblclick(centre(box).x, centre(box).y);
    await expect(page.locator(`[data-testid="shape-textarea-${id}"]`).first()).toBeVisible();
    await page.keyboard.type(sentence, { delay: 0 });
    await page.keyboard.press('Escape');
    await expect(page.locator(`[data-testid="shape-object-${id}"]`)).toContainText(sentence);

    const line = SHAPE_LABEL_FONT_PX * zoom * 1.25;
    const wrapped = await labelTextRect(page, id);
    expect(wrapped.height).toBeGreaterThanOrEqual(2 * line);
    expect(Math.abs(centre(wrapped).x - centre(box).x)).toBeLessThanOrEqual(3);
    expect(Math.abs(centre(wrapped).y - centre(box).y)).toBeLessThanOrEqual(3);

    // Resize it narrower through the east handle: it re-wraps, still centred.
    // (Still selected: Escape only closed the label editor.)
    await expect(page.getByTestId('shape-toolbar')).toBeVisible();
    const east = page.locator('[data-testid="resize-handle-e"]');
    await expect(east).toHaveCount(1);
    const eastBox = await east.boundingBox();
    if (eastBox === null) throw new Error('no east resize handle');
    await page.mouse.move(eastBox.x + eastBox.width / 2, eastBox.y + eastBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(eastBox.x + eastBox.width / 2 - 80, eastBox.y + eastBox.height / 2, {
      steps: 8,
    });
    await page.mouse.up();

    const narrower = await shapeBox(page, id);
    expect(Math.abs(narrower.width - (box.width - 80))).toBeLessThanOrEqual(2);
    const stillWrapped = await labelTextRect(page, id);
    expect(stillWrapped.height).toBeGreaterThan(wrapped.height);
    expect(Math.abs(centre(stillWrapped).x - centre(narrower).x)).toBeLessThanOrEqual(3);
    expect(Math.abs(centre(stillWrapped).y - centre(narrower).y)).toBeLessThanOrEqual(3);

    // Colours still work at this zoom, and nothing went wrong in the console.
    await page.getByTestId('shape-fill-blue').click();
    await expect(page.locator(`[data-testid="shape-object-${id}"] [data-part="shape-body"]`)).toHaveAttribute(
      'fill',
      SHAPE_FILL_COLORS.blue,
    );
    await page.getByTestId('shape-stroke-red').click();
    await expect(page.locator(`[data-testid="shape-object-${id}"] [data-part="shape-body"]`)).toHaveAttribute(
      'stroke',
      SHAPE_STROKE_COLORS.red,
    );
    // Colours are style only: the shape did not move, resize or lose its label.
    expectSameBox(await shapeBox(page, id), narrower);
    expectSameBox(await labelTextRect(page, id), stillWrapped);
    await expect(page.locator(`[data-testid="shape-object-${id}"]`)).toContainText(sentence);
  });
});
