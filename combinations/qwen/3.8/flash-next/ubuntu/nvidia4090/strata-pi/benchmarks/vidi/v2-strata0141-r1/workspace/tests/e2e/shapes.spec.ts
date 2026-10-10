import { expect, test } from '@playwright/test';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { near, openBoard } from './helpers/board';
import { dragHandle, setFlatCamera, setZoomCamera } from './helpers/selection';
import {
  clickShapeKind,
  clickShapeCreate,
  clickShapeSwatch,
  dragShapeCreate,
  drawnLabel,
  drawnLabelLineCount,
  drawnShapeGeometry,
  pressShapeTool,
  shapeAttribute,
  shapeBox,
  shapeCard,
  shapeEditor,
  shapeOf,
  waitForShapeCount,
  waitForShapeSelected,
  editShapeLabel,
} from './helpers/shapes';

/**
 * Story 10 - shapes drawn with the Shape tool, in real browsers (task 15).
 *
 * Anchors: `shape.tool` (the tool, its shortcut, its return to Select),
 * `shape.kind` (Rectangle, Ellipse, Diamond), `shape.size` (drag a box, click the
 * default, Shift for a square) and `shape.label` (a label that stays centred in the
 * shape it is written on). TC-23 and TC-24.
 *
 * Every measurement is taken twice on purpose: once from the document, which is
 * what the board agreed on, and once from the box the browser painted, which is
 * what a person is looking at. A shape stored at 200x120 and drawn at 190x130 would
 * pass one of those and fail the other.
 */

const LABEL = 'Arrows follow the shapes they join';

test.describe('shapes drawn on the board', () => {
  test('TC-23: a drag draws a rectangle the size of the drag, where the drag was', async ({
    page,
  }) => {
    await openBoard(page);
    await setFlatCamera(page); // world units and screen pixels are the same numbers

    await pressShapeTool(page);

    // A real drag: press at one corner, move to the opposite one, release.
    await dragShapeCreate(page, { x: 100, y: 100 }, 200, 120);

    const shapes = await waitForShapeCount(page, 1);
    const shape = shapes[0]!;

    // The document's box: 200x120, with the drag start as its top-left.
    expect(near(shape.width, 200, 1)).toBe(true);
    expect(near(shape.height, 120, 1)).toBe(true);
    expect(near(shape.x, 100, 1)).toBe(true);
    expect(near(shape.y, 100, 1)).toBe(true);

    // The box the browser painted, at 100%.
    const box = await shapeBox(page, shape.id);
    expect(near(box.x, 100, 1)).toBe(true);
    expect(near(box.y, 100, 1)).toBe(true);
    expect(near(box.width, 200, 1)).toBe(true);
    expect(near(box.height, 120, 1)).toBe(true);

    // `tool.return_to_select`: the tool is put away and the new shape is the selection.
    await expect(page.locator('[data-testid="board"]')).toHaveAttribute('data-tool', 'select');
    await waitForShapeSelected(page, shape.id);

    // `shape.kind`: the Shape tool's default kind is a rectangle, and a rectangle is
    // what its SVG drew.
    expect(shape.kind).toBe('rect');
    expect(await drawnShapeGeometry(page, shape.id)).toBe('rect');
    expect(await shapeAttribute(page, shape.id, 'data-fill')).toBe('white');
    expect(await shapeAttribute(page, shape.id, 'data-stroke')).toBe('dark');
  });

  test('TC-24: a Diamond click makes the default square, and its label re-wraps and stays centred when the shape is resized', async ({
    page,
  }) => {
    await openBoard(page);
    await setZoomCamera(page, 2); // 200%: one world unit is two screen pixels

    await pressShapeTool(page);
    await clickShapeKind(page, 'diamond');

    // `shape.size`: a click is a shape too - the default box, centred on the click.
    const click = { x: 640, y: 400 };
    await clickShapeCreate(page, click);

    const shapes = await waitForShapeCount(page, 1);
    const shape = shapes[0]!;
    const side = SHAPE_DEFAULT_SIZE_WORLD;

    expect(shape.kind).toBe('diamond');
    expect(near(shape.width, side, 1)).toBe(true);
    expect(near(shape.height, side, 1)).toBe(true);
    expect(near(shape.x, click.x / 2 - side / 2, 1)).toBe(true);
    expect(near(shape.y, click.y / 2 - side / 2, 1)).toBe(true);

    // The drawn diamond: 160 world units is 320 screen pixels at 200%, centred on
    // the click, and it is the four-point geometry the menu asked for.
    const before = await shapeBox(page, shape.id);
    expect(near(before.x, click.x - side, 1)).toBe(true);
    expect(near(before.y, click.y - side, 1)).toBe(true);
    expect(near(before.width, side * 2, 1)).toBe(true);
    expect(near(before.height, side * 2, 1)).toBe(true);
    expect(await drawnShapeGeometry(page, shape.id)).toBe('polygon');
    const points = (await shapeCard(page, shape.id).locator('polygon').getAttribute('points')) ?? '';
    expect(points.split(/\s+/).filter((point) => point.includes(',')).length).toBe(4);

    // A label longer than the shape's width.
    await editShapeLabel(page, shape.id, LABEL);
    expect(await shapeEditor(page, shape.id).count()).toBe(0);
    expect((await shapeCard(page, shape.id).locator('[data-testid^="shape-label-"]').textContent()) ?? '').toBe(
      LABEL,
    );

    const drawnBefore = await drawnLabel(page, shape.id);
    expect(drawnBefore.text).toBe(LABEL);
    // Longer than the box means more than one drawn line (`shape.label`).
    expect(await drawnLabelLineCount(page, shape.id)).toBeGreaterThan(1);
    expect(drawnBefore.lines.length).toBeGreaterThan(1);
    // The lines are centred in the shape, on both axes.
    expect(near(drawnBefore.bounds.x + drawnBefore.bounds.width / 2, before.x + before.width / 2, 3)).toBe(
      true,
    );
    expect(near(drawnBefore.bounds.y + drawnBefore.bounds.height / 2, before.y + before.height / 2, 3)).toBe(
      true,
    );
    for (const line of drawnBefore.lines) {
      expect(near(line.x + line.width / 2, before.x + before.width / 2, 3)).toBe(true);
    }

    // Resize by dragging the east handle wider, and the label follows the box rather
    // than being redrawn by hand: re-wrapped, still centred, still inside.
    await waitForShapeSelected(page, shape.id);
    await dragHandle(page, 'e', 140, 0);

    const grown = await shapeOf(page, shape.id);
    const after = await shapeBox(page, shape.id);
    expect(near(after.width, before.width + 140, 2)).toBe(true);
    expect(near(after.height, before.height, 2)).toBe(true);
    expect(near(grown.width, side + 70, 2)).toBe(true);

    const drawnAfter = await drawnLabel(page, shape.id);
    expect(drawnAfter.text).toBe(LABEL);
    expect(await drawnLabelLineCount(page, shape.id)).toBeGreaterThan(1);
    expect(near(drawnAfter.bounds.x + drawnAfter.bounds.width / 2, after.x + after.width / 2, 3)).toBe(
      true,
    );
    expect(near(drawnAfter.bounds.y + drawnAfter.bounds.height / 2, after.y + after.height / 2, 3)).toBe(
      true,
    );
    for (const line of drawnAfter.lines) {
      expect(near(line.x + line.width / 2, after.x + after.width / 2, 3)).toBe(true);
    }

    // Nothing of the label spilled out of the shape it belongs to.
    expect(drawnAfter.bounds.x >= after.x - 2).toBe(true);
    expect(drawnAfter.bounds.x + drawnAfter.bounds.width <= after.x + after.width + 2).toBe(true);
    expect(drawnAfter.bounds.y >= after.y - 2).toBe(true);
    expect(drawnAfter.bounds.y + drawnAfter.bounds.height <= after.y + after.height + 2).toBe(true);
  });

  test('TC-23 boundary: the smallest shape the board accepts is the size it names, and the toolbar repaints it', async ({
    page,
  }) => {
    await openBoard(page);
    await setFlatCamera(page);

    await pressShapeTool(page, 'toolbar');
    await dragShapeCreate(page, { x: 300, y: 300 }, SHAPE_MIN_SIZE_WORLD, SHAPE_MIN_SIZE_WORLD);
    const [shape] = await waitForShapeCount(page, 1);
    expect(near(shape!.width, SHAPE_MIN_SIZE_WORLD, 1)).toBe(true);
    expect(near(shape!.height, SHAPE_MIN_SIZE_WORLD, 1)).toBe(true);

    // `shape.colours`: the toolbar's swatches are named colours, applied in place.
    await clickShapeSwatch(page, 'fill', 'blue');
    await clickShapeSwatch(page, 'outline', 'red');
    expect(await shapeAttribute(page, shape!.id, 'data-fill')).toBe('blue');
    expect(await shapeAttribute(page, shape!.id, 'data-stroke')).toBe('red');
    await waitForShapeSelected(page, shape!.id);

    // The label limit is the product's, not the browser's: 500 characters, no more.
    await editShapeLabel(page, shape!.id, 'x'.repeat(SHAPE_LABEL_MAX_CHARS + 100));
    const label = (await shapeCard(page, shape!.id).locator('[data-testid^="shape-label-"]').textContent()) ?? '';
    expect(label.length).toBeLessThanOrEqual(SHAPE_LABEL_MAX_CHARS);
    expect(label.length).toBeGreaterThan(0);
  });
});
