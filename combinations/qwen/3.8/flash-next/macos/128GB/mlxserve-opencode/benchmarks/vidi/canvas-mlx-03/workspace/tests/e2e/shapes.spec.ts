// Story 10 — draw shapes. Playwright e2e (TC-23, TC-24), workflow "Draw a flow".
//
// These are the two shape cases that only a real browser can answer: that a real
// pointer drag creates a shape of exactly the box that was dragged, and that a real font
// really wraps a label inside a shape and keeps it centred when the shape is resized.
// Everything is asserted in *world* units, read back off the DOM, so the numbers mean the
// board's geometry rather than a particular screen.
import { test, expect, type Page } from '@playwright/test';
import { openBoard, setCamera } from './helpers/board.ts';
import {
  armTool,
  clickShape,
  drawShape,
  dragTo,
  labelShape,
  screenOf,
  shapesOn,
  shapeCount,
  worldOfScreen,
  type LabelMetrics,
} from '../fixtures/checkout-flow.ts';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
} from '../../src/shared/config.ts';

const settle = (page: Page, ms = 90) => page.waitForTimeout(ms);

/** The screen point a shape's east resize handle sits on. */
async function eastHandle(page: Page, id: string) {
  const box = await page.locator('[data-handle="e"]').first().boundingBox();
  if (!box) throw new Error(`no east handle for ${id}: is the shape selected?`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** What the label looks like: how many lines it took, and whether it is centred. */
async function labelMetrics(page: Page, id: string): Promise<LabelMetrics> {
  return page.evaluate((sid) => {
    const shape = document.querySelector(`[data-shape-id="${sid}"]`) as HTMLElement;
    const label = shape.querySelector('[data-testid="shape-label-text"]') as HTMLElement;
    const sr = shape.getBoundingClientRect();
    const lr = label.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(label).lineHeight) || 0;
    return {
      text: (label.textContent ?? '').trim(),
      lines: lineHeight > 0 ? Math.max(1, Math.round(lr.height / lineHeight)) : 1,
      /** How far the label's centre is from the shape's centre, in screen pixels. */
      offCentreX: lr.x + lr.width / 2 - (sr.x + sr.width / 2),
      offCentreY: lr.y + lr.height / 2 - (sr.y + sr.height / 2),
      labelWidth: lr.width,
      labelHeight: lr.height,
      shapeWidth: sr.width,
      shapeHeight: sr.height,
      fontPx: parseFloat(getComputedStyle(label).fontSize),
    } as LabelMetrics;
  }, id);
}

/** The centre of a world box, in world units. */
const centre = (b: { x: number; y: number; width: number; height: number }) => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});

test.describe('story 10 shapes', () => {
  test('TC-23 a real drag creates exactly the box that was dragged', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });
    await settle(page);
    const start = await worldOfScreen(page, { x: 100, y: 100 });

    await armTool(page, 's');
    await dragTo(page, { x: 100, y: 100 }, { x: 300, y: 220 });

    const shapes = await shapesOn(page);
    expect(shapes.length).toBe(1);
    const shape = shapes[0]!;
    // 200x120 screen pixels at 100% zoom are 200x120 board units, within a pixel.
    expect(Math.abs(shape.w - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(shape.h - 120)).toBeLessThanOrEqual(1);
    expect(Math.abs(shape.x - start.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(shape.y - start.y)).toBeLessThanOrEqual(1);
    // A plain drag makes the default rectangle, empty, with the default paint.
    expect(shape.kind).toBe('rect');
    expect(shape.label).toBe('');
    await expect(page.locator(`[data-shape-id="${shape.id}"] [data-testid="shape-rect"]`)).toHaveAttribute('fill', SHAPE_FILL_COLORS.white);
    await expect(page.locator(`[data-shape-id="${shape.id}"] [data-testid="shape-rect"]`)).toHaveAttribute('stroke', SHAPE_STROKE_COLORS.dark);
    // The new shape is the selected one, and the board is back on Select.
    expect(shape.selected).toBe(true);
    await expect(page.getByTestId('select-tool')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('shape-tool')).toHaveAttribute('aria-pressed', 'false');
    // A handle set is offered, so it can be resized like any other object.
    await expect(page.locator('[data-handle="e"]')).toHaveCount(1);
  });

  test('TC-23 a click, and a drag under the minimum size, both give the default box', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });
    await settle(page);

    // A click creates the default size, centred on the point that was clicked.
    const clicked = await clickShape(page, { x: 600, y: 300 });
    const a = (await shapesOn(page)).find((s) => s.id === clicked)!;
    expect(Math.abs(a.w - SHAPE_DEFAULT_SIZE_WORLD)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.h - SHAPE_DEFAULT_SIZE_WORLD)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.x + a.w / 2 - 600)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.y + a.h / 2 - 300)).toBeLessThanOrEqual(1);

    // A drag smaller than the minimum size is a click too: the same default box,
    // centred where the pointer came up.
    const small = await drawShape(page, { x: 100, y: 620, width: 10, height: 19 });
    const b = (await shapesOn(page)).find((s) => s.id === small)!;
    expect(b.w).toBeGreaterThanOrEqual(SHAPE_MIN_SIZE_WORLD);
    expect(Math.abs(b.w - SHAPE_DEFAULT_SIZE_WORLD)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.h - SHAPE_DEFAULT_SIZE_WORLD)).toBeLessThanOrEqual(1);
    expect(await shapeCount(page)).toBe(2);
  });

  test('TC-24 at 200% zoom a Diamond click, a long label and a resize keep it centred', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 2 });
    await settle(page);

    // The kind is chosen from the Shape tool's own menu, then one click draws it:
    // 160x160 board units — 320x320 pixels on this screen — centred on the click.
    const at = { x: 200, y: 120 };
    const id = await clickShape(page, at, 'diamond');
    const shape = (await shapesOn(page)).find((s) => s.id === id)!;
    expect(shape.kind).toBe('diamond');
    expect(Math.abs(shape.w - SHAPE_DEFAULT_SIZE_WORLD)).toBeLessThanOrEqual(1);
    expect(Math.abs(shape.h - SHAPE_DEFAULT_SIZE_WORLD)).toBeLessThanOrEqual(1);
    expect(Math.abs(shape.x + shape.w / 2 - at.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(shape.y + shape.h / 2 - at.y)).toBeLessThanOrEqual(1);
    await expect(page.locator(`[data-shape-id="${id}"] [data-testid="shape-diamond"]`)).toBeVisible();

    // A label longer than the shape's width wraps into several lines, and the block of
    // lines stays in the middle of the shape.
    const sentence = 'Does the warehouse still have one left before the next delivery?';
    await labelShape(page, id, sentence);
    const wide = await labelMetrics(page, id);
    expect(wide.text).toBe(sentence);
    expect(wide.lines).toBeGreaterThanOrEqual(2);
    expect(Math.abs(wide.offCentreX)).toBeLessThanOrEqual(1);
    expect(Math.abs(wide.offCentreY)).toBeLessThanOrEqual(1);

    // Drag the east handle inwards: the shape gets narrower, the label re-wraps into
    // more lines and is still centred in it.
    const handle = await eastHandle(page, id);
    await dragTo(page, handle, { x: handle.x - 200, y: handle.y });
    const narrow = await labelMetrics(page, id);
    const now = (await shapesOn(page)).find((s) => s.id === id)!;
    expect(now.w).toBeLessThan(shape.w - 80);
    expect(now.w).toBeGreaterThanOrEqual(SHAPE_MIN_SIZE_WORLD);
    expect(narrow.text).toBe(sentence); // nothing was lost by resizing
    expect(narrow.lines).toBeGreaterThan(wide.lines);
    expect(Math.abs(narrow.offCentreX)).toBeLessThanOrEqual(1);
    expect(Math.abs(narrow.offCentreY)).toBeLessThanOrEqual(1);
    // The label's font still fits the box: it never spills out of the shape.
    expect(narrow.labelWidth).toBeLessThanOrEqual(narrow.shapeWidth + 1);
    expect(narrow.labelHeight).toBeLessThanOrEqual(narrow.shapeHeight + 1);
  });

  test('a label is fitted to its shape, and undo takes the whole shape away', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });
    await settle(page);

    // A big shape gets a big label; a small shape with the same words gets a small one:
    // the text is fitted to its box rather than left at one fixed size.
    const words = 'Decision needed before the next delivery window opens';
    const big = await drawShape(page, { x: 200, y: 60, width: 400, height: 240 });
    await labelShape(page, big, words);
    const small = await drawShape(page, { x: 200, y: 400, width: 200, height: 70 });
    await labelShape(page, small, words);
    const bigLabel = await labelMetrics(page, big);
    const smallLabel = await labelMetrics(page, small);
    expect(bigLabel.text).toBe(words);
    expect(smallLabel.text).toBe(words);
    expect(smallLabel.fontPx).toBeLessThan(bigLabel.fontPx);
    // Fitted, never dropped: both stay inside their shape and in the middle of it.
    for (const label of [bigLabel, smallLabel]) {
      expect(Math.abs(label.offCentreX)).toBeLessThanOrEqual(1);
      expect(Math.abs(label.offCentreY)).toBeLessThanOrEqual(1);
      expect(label.labelWidth).toBeLessThanOrEqual(label.shapeWidth + 1);
      expect(label.labelHeight).toBeLessThanOrEqual(label.shapeHeight + 1);
    }

    // Deleting the shape is one undo step: undo brings the shape and its label back.
    const target = await screenOf(page, centre({ x: 200, y: 60, width: 400, height: 240 }));
    await page.mouse.click(target.x, target.y);
    await settle(page);
    await page.keyboard.press('Delete');
    await settle(page);
    expect(await shapeCount(page)).toBe(1);
    await page.keyboard.press('Control+z');
    await settle(page);
    expect(await shapeCount(page)).toBe(2);
    expect((await labelMetrics(page, big)).text).toBe(words);
  });
});
