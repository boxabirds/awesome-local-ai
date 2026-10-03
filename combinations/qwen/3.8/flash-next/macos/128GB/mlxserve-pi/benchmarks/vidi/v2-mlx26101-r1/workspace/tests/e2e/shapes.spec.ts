// Story 10 e2e: draw shapes with the Shape tool.
//
// The whole story happens on the layer the tool puts over the board while its letter is held:
// a drag there draws exactly the box it covered, a click there draws the default shape, and
// neither press is ever a press on the object underneath. The assertions are made in *world*
// units by converting the screen points through the live board's own camera, because world
// units are what the document stores and what another person's screen will draw. At the board's
// starting 100% zoom the two sets of numbers are the same, which is what makes a 200x120 drag a
// 200x120 shape (shape.drag).
//
// Component tests (tests/component/ShapeTool.test.tsx) cover the tool's every branch in a fast
// loop; these two are the real-browser proof that the tool's layer is really on top, that the
// keyboard letter really arms it, and that the shape that arrives in the document is the box
// the mouse made.

import { expect, test } from '@playwright/test';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
} from '../../src/shared/config';
import { gotoBoard } from './helpers/board';
import { cameraCenteringOrigin, dragHandle, readZoom, setCamera } from './helpers/sticky';
import {
  chooseShapeKind,
  chosenShapeKind,
  clickShape,
  dragScreenPoints,
  pressTool,
  shapeCenter,
  shapeOf,
  shapePaintedLabel,
  shapePaintedLabelCenter,
  shapePaintedLabelLines,
  shapesOn,
  toolLayer,
  toolPressedState,
  waitForNewShape,
  worldOf,
} from './helpers/shape';

test.describe('shapes: drawing', () => {
  // TC-23 (shape.drag, zoom.100): a held S turns the board into a drawing surface. A drag
  // across it — (100,100) to (300,220) on screen — becomes a shape whose stored box is exactly
  // that box in world units: 200 wide, 120 tall, at the top-left corner of the drag. Nothing
  // about it is a guess at what the person meant: the only rounding is the size that was too
  // small to have been a drag at all, and this drag is not that.
  test('TC-23 a drag draws a shape of exactly the box it covered, in world units', async ({
    page,
  }) => {
    await gotoBoard(page);
    expect(await readZoom(page), 'the board starts at 100%').toBe(1);

    await pressTool(page, 'S');
    await expect(toolLayer(page, 'shape-tool-layer')).toBeVisible();
    expect(await toolPressedState(page, 'Shape (S)')).toBe(true);

    const before = await shapesOn(page);
    await dragScreenPoints(page, { x: 100, y: 100 }, { x: 300, y: 220 });

    const made = await waitForNewShape(page, before);
    const id = made.id;

    // The same two screen points, read as world points through the live camera.
    const from = await worldOf(page, { x: 100, y: 100 });
    const to = await worldOf(page, { x: 300, y: 220 });
    const shape = await shapeOf(page, id);
    expect(shape.width, 'the shape is as wide as the drag').toBeCloseTo(
      Math.abs(to.x - from.x),
      0,
    );
    expect(shape.height, 'and as tall').toBeCloseTo(Math.abs(to.y - from.y), 0);
    expect(shape.x, 'at the corner the drag started').toBeCloseTo(
      Math.min(from.x, to.x),
      0,
    );
    expect(shape.y).toBeCloseTo(Math.min(from.y, to.y), 0);

    // And it is drawn there: the painted box is the stored box times the zoom.
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(120);

    // The tool keeps the pointer while it is held, so the press that made the shape is not
    // also a press on the board underneath: nothing else was created by releasing.
    expect(await shapesOn(page)).toHaveLength(before.length + 1);
  });

  // TC-24 (shape.click, shape.style): a click makes a shape of the default size centred on the
  // point that was clicked, in the kind the menu has chosen; its label takes words up to its
  // cap, wraps inside the box, and stays in the middle of the box when the box is dragged wider
  // — centring and wrapping are properties of the label, not of the size it happened to be
  // drawn at.
  test('TC-24 a click makes the chosen kind at its default size, and its label wraps and stays centred', async ({
    page,
  }) => {
    await gotoBoard(page);

    await pressTool(page, 'S');
    expect(await chosenShapeKind(page), 'a fresh board starts on Rectangle').toBe('Rectangle');
    await chooseShapeKind(page, 'Diamond');

    const before = await shapesOn(page);
    const click = { x: 620, y: 400 };
    await dragScreenPoints(page, click, click, 1); // a click is a drag that went nowhere
    const shape = await waitForNewShape(page, before);
    const id = shape.id;
    expect(shape.kind).toBe('diamond');
    const at = await worldOf(page, click);
    expect(shape.width, 'the default size, not a dot').toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape.x + shape.width / 2, 'centred on the point clicked').toBeCloseTo(at.x, 0);
    expect(shape.y + shape.height / 2).toBeCloseTo(at.y, 0);

    // The label is edited in place: double-click the shape and type. A word longer than the box
    // is the only kind of word that can prove a label wraps.
    await pressTool(page, 'V'); // Select, so the press reaches the shape rather than drawing
    await clickShape(page, id);
    await page.getByTestId(`shape-${id}`).dblclick();
    await expect(page.getByTestId('text-editor')).toBeVisible();
    const words = 'square';
    const long = 'extraordinarilylonglabelthatcannotfitononelineofthisshapeatall';
    expect(long.length, 'the label has to be long enough to have to wrap').toBeGreaterThan(
      50,
    );
    expect(long.length).toBeLessThanOrEqual(SHAPE_LABEL_MAX_CHARS);
    await page.keyboard.insertText(`${words} ${long}`);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('text-editor')).toHaveCount(0);

    const label = await shapePaintedLabel(page, id);
    expect(label).toBe(`${words} ${long}`);
    expect(await shapePaintedLabelLines(page, id), 'the label wraps inside the box').toBeGreaterThanOrEqual(
      2,
    );

    // Centred in the box it is drawn in: the label's own painted centre is the shape's.
    const centre = await shapeCenter(page, id);
    let at_label = await shapePaintedLabelCenter(page, id);
    expect(Math.abs(at_label.x - centre.x), 'the label is in the middle of the box').toBeLessThan(
      2,
    );

    // Drag the box wider. The shape does not grow around its words; the words stay put in the
    // middle of whatever box they are in (shape.label).
    await dragHandle(page, 'se', 160, 40);
    const wider = await shapeOf(page, id);
    expect(wider.width, 'the box got wider').toBeGreaterThan(shape.width + 100);
    expect(await shapePaintedLabel(page, id), 'and the words are the same words').toBe(label);
    centre.x = (await shapeCenter(page, id)).x;
    centre.y = (await shapeCenter(page, id)).y;
    at_label = await shapePaintedLabelCenter(page, id);
    expect(Math.abs(at_label.x - centre.x), 'still in the middle after the resize').toBeLessThan(2);
    expect(Math.abs(at_label.y - centre.y)).toBeLessThan(2);
  });

  // The box a shape keeps is the box it was drawn, in world units: zooming the board changes
  // the picture of it and nothing in it, and a drag made at another zoom is stored divided by
  // that zoom, which is the only reason a 100-point drag at 50% is a 200-unit box. An arrow
  // joins to that box, so it stays joined at every zoom (zoom.100, shape.drag).
  test('the box a shape is drawn at is in world units, whatever the zoom', async ({ page }) => {
    await gotoBoard(page);
    await pressTool(page, 'S');
    await dragScreenPoints(page, { x: 300, y: 200 }, { x: 500, y: 320 });
    const drawn = await waitForNewShape(page, []);
    expect(drawn.width, 'at 100% a 200-point drag is a 200-unit box').toBe(200);
    expect(drawn.height).toBe(120);

    // Half the zoom, around the middle of the window the board opened on.
    await setCamera(page, cameraCenteringOrigin(page, 0.5));
    const still = await shapeOf(page, drawn.id);
    expect(still, 'the stored box did not change').toEqual(drawn);
    // The picture is waited for, not assumed: what a camera change has to do is repaint, and a
    // test that reads the paint before the board has painted is a test of timing.
    await expect
      .poll(
        async () => (await page.getByTestId(`shape-${drawn.id}`).boundingBox())?.width ?? 0,
        { message: 'the painted picture never became half the box' },
      )
      .toBeCloseTo(100, 1);

    // And a drag made at this zoom is stored divided by it: 160 screen points are 320 world
    // units at 50%, so the shape lands the size the person dragged it on screen.
    await pressTool(page, 'S');
    await dragScreenPoints(page, { x: 200, y: 500 }, { x: 360, y: 580 });
    const shapes = await shapesOn(page);
    const second = shapes.find((s) => s.id !== drawn.id)!;
    expect(second.width, 'a 160-point drag at 50% is a 320-unit box').toBeCloseTo(320, 1);
    expect(second.height).toBeCloseTo(160, 1);
  });
});
