/**
 * Shapes, drawn by a person at a screen.
 *
 * The two things story 10 asks of the Shape tool are both decided by the shape of a gesture rather than by
 * a menu: a drag makes a shape of the size dragged, a click makes a shape of the size the board has
 * decided on. Both are tested here with a real mouse — press, move, release — because the tool's whole job
 * is to read those two gestures apart, and a test that handed the board a finished shape would be testing
 * the document and not the tool.
 *
 * What is compared is what a person would compare: where the box is on the screen, how big it is, whether
 * the board's pointer went back to Select afterwards, whether the words written on it are wrapped and
 * centred inside it. Where the drags are drawn avoids the toolbar down the left of the screen and the zoom
 * controls in its corner, because the Shape tool deliberately leaves its clicks to the board's own controls
 * — which is why a drag started on a button draws nothing.
 *
 * Design matrix: TC-23 (drag, kind, Shift) and TC-24 (click, label, resize).
 */
import { expect, test } from '@playwright/test';

import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_LABEL_FONT_SIZE_WORLD,
  TEXT_LINE_HEIGHT,
} from '../../src/shared/config';
import { openBoard, handleScreen, objectWorld, waitForObjectAtRest } from './helpers/board';
import {
  expectTool,
  drawShapeByClick,
  drawShapeByDrag,
  enterTool,
  expectShapeCount,
  labelBox,
  pickShapeKind,
  previewBox,
  shape,
  shapeEditor,
  shapeKindOnScreen,
  shapeScreenBox,
  shapeText,
  shapeToolbar,
  shapeWorld,
} from './helpers/shapes';

/** A label long enough that a 160-unit shape cannot hold it on one line. */
const LONG_LABEL =
  'Draw a box, write in it what the box is for, and then find out what the board does with the words that did not fit.';

test.describe('drawing shapes', () => {
  // TC-23: a drag makes a shape of exactly the rectangle dragged, and the pointer comes back to Select.
  test('a drag of (100, 100) to (300, 220) makes a 200 × 120 shape there and hands the pointer back', async ({
    page,
  }) => {
    await openBoard(page);

    // The Shape tool is entered with its letter, and the board says so on its own element.
    await enterTool(page, 'shape');

    // A drag from (100, 100) to (300, 220). The board's camera starts with the world's origin at the middle
    // of this 1280 × 800 screen, so those screen pixels are the world units (-540, -300) to (-340, -180) —
    // and the shape that comes out is asked for below in world units, which is the same rectangle said in
    // the other space.
    const id = await drawShapeByDrag(page, { x: 100, y: 100 }, { x: 300, y: 220 }, {
      // While the button is down: a rubber band over the rectangle being dragged, on the screen, in screen
      // pixels, which is the only space a preview can be drawn in.
      whileDown: async () => {
        const during = await previewBox(page);
        expect(during, 'the preview is drawn while the button is down').not.toBeNull();
        expect(during!.x).toBeCloseTo(100, 0);
        expect(during!.y).toBeCloseTo(100, 0);
        expect(during!.width).toBeCloseTo(100, 0);
        expect(during!.height).toBeCloseTo(60, 0);
      },
    });

    // The shape is the rectangle dragged, to the pixel, and it is a rectangle: the kind the tool was born
    // set to, because nobody asked for another one.
    const world = await shapeWorld(page, id);
    expect(world.x).toBeCloseTo(-540, 0);
    expect(world.y).toBeCloseTo(-300, 0);
    expect(world.width).toBeCloseTo(200, 0);
    expect(world.height).toBeCloseTo(120, 0);
    expect(world.kind).toBe('rect');
    expect(world.text, 'a shape drawn out of thin air has no words on it').toBe('');

    // It is drawn where it was drawn, and it is the thing this person is now holding.
    const box = await shapeScreenBox(page, id);
    expect(box.x).toBeCloseTo(100, 0);
    expect(box.y).toBeCloseTo(100, 0);
    expect(box.width).toBeCloseTo(200, 0);
    expect(box.height).toBeCloseTo(120, 0);
    expect(world.interaction).toBe('selected');

    // And the tool is done with: a shape that has just been drawn wants moving or colouring, which is what
    // the selecting pointer does. One shape on the board, one tool that could have made it, and the palette
    // of the shape that is the whole selection is out — with nothing chosen beyond the two colours the
    // shape was born with.
    await expectShapeCount(page, 1);
    await expectTool(page, 'select');
    await expect(shapeToolbar(page)).toBeVisible();
    expect(world.fill).toBe('white');
    expect(world.stroke).toBe('dark');
    // The preview went away with the gesture that drew it.
    expect(await previewBox(page)).toBeNull();
  });

  // TC-23 again, in the other two kinds, in the kind the tool remembers, and with Shift holding the sides equal.
  test('the kind picked from the toolbar is the kind drawn, and is still picked next time', async ({
    page,
  }) => {
    await openBoard(page);
    await enterTool(page, 'shape');

    await pickShapeKind(page, 'ellipse');
    const ellipse = await drawShapeByDrag(page, { x: 400, y: 500 }, { x: 580, y: 640 });
    expect((await shapeWorld(page, ellipse)).kind).toBe('ellipse');

    // The tool went back to Select with the ellipse in its hand, and going back into the Shape tool finds
    // the kind where it was left: the kind belongs to the tool, not to the shape now sitting on the board.
    await enterTool(page, 'shape');
    expect(await shapeKindOnScreen(page)).toBe('ellipse');

    await pickShapeKind(page, 'diamond');
    const diamond = await drawShapeByDrag(page, { x: 900, y: 150 }, { x: 1080, y: 330 });
    expect((await shapeWorld(page, diamond)).kind).toBe('diamond');
    expect((await shapeWorld(page, ellipse)).kind).toBe('ellipse');
    await expectShapeCount(page, 2);

    // Shift squares the drag while it is being dragged, which is what the rubber band says it is doing.
    await enterTool(page, 'shape');
    await pickShapeKind(page, 'rect');
    const constrained = await drawShapeByDrag(page, { x: 600, y: 120 }, { x: 800, y: 240 }, {
      shift: true,
      whileDown: async () => {
        const square = await previewBox(page);
        expect(square).not.toBeNull();
        // (200, 120) dragged so far is (100, 60) of it: the longer side wins, and both sides become it.
        expect(square!.width).toBeCloseTo(100, 0);
        expect(square!.height).toBeCloseTo(100, 0);
      },
    });

    // 200 × 200, from the corner the pointer went down at: the constraint changes the far corner, not the
    // one a person is holding.
    const drawn = await shapeWorld(page, constrained);
    expect(drawn.width).toBeCloseTo(200, 0);
    expect(drawn.height).toBeCloseTo(200, 0);
    expect(drawn.x).toBeCloseTo(-40, 0);
    expect(drawn.y).toBeCloseTo(-280, 0);
    await expectShapeCount(page, 3);
  });

  // TC-24: a click makes the standard shape centred on the click; a label wraps inside it, and a resize
  // re-wraps it without putting it anywhere other than the middle.
  test('a click makes a 160 × 160 diamond centred on the click, and its label stays centred through a resize', async ({
    page,
  }) => {
    await openBoard(page);
    await enterTool(page, 'shape');

    // A press and a release with nothing in between: not a drag, so the shape is the standard size, and it
    // is centred on the point that was clicked rather than starting there.
    const id = await drawShapeByClick(page, { x: 640, y: 400 }, { kind: 'diamond' });
    const made = await shapeWorld(page, id);
    expect(made.kind).toBe('diamond');
    expect(made.width).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD, 0);
    expect(made.height).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD, 0);
    expect(made.x + made.width / 2).toBeCloseTo(0, 0);
    expect(made.y + made.height / 2).toBeCloseTo(0, 0);
    await expectTool(page, 'select');

    // Double-clicking the shape opens the editor story 2 built, in the middle of this shape, and the words
    // go into the shape's own shared text — so a person on the other side of the board reads them too.
    await shape(page, id).dblclick();
    await expect(shapeEditor(page)).toBeVisible();
    await page.keyboard.type(LONG_LABEL);
    await shapeEditor(page).press('Escape');
    await expect(shapeEditor(page)).toHaveCount(0);

    expect(await shapeText(page, id)).toBe(LONG_LABEL);
    expect((await shapeWorld(page, id)).text).toBe(LONG_LABEL);

    // The words are drawn at the size the board sets for a shape's label, and they wrapped: this shape is
    // 160 units wide, and that is not enough for a sentence on one line.
    const before = await labelBox(page, id);
    expect(before.linePx).toBeCloseTo(SHAPE_LABEL_FONT_SIZE_WORLD * TEXT_LINE_HEIGHT, 0);
    expect(before.lines, 'a sentence does not fit in 160 units on one line').toBeGreaterThan(1);

    // And they are centred in the shape: not hanging from its top-left corner, which is where a label that
    // had merely been placed would hang.
    const shapeBefore = await shapeScreenBox(page, id);
    expect(before.cx).toBeCloseTo(shapeBefore.cx, 0);
    expect(before.cy).toBeCloseTo(shapeBefore.cy, 0);

    // The shape is made wider by its eastern handle: 200 screen pixels.
    await page.mouse.click(640, 400);
    const east = await handleScreen(page, 'e');
    await page.mouse.move(east.x, east.y);
    await page.mouse.down();
    await page.mouse.move(east.x + 100, east.y + 20, { steps: 4 });
    await page.mouse.move(east.x + 200, east.y, { steps: 4 });
    await page.mouse.up();
    const resized = await waitForObjectAtRest(page, id);
    expect(resized.width).toBeCloseTo(made.width + 200, 1);

    // The label is the same words in a wider box: still the same words, still centred, and now needing
    // fewer lines. That is a re-wrap, not a re-place.
    const after = await labelBox(page, id);
    expect(after.lines).toBeGreaterThan(1);
    expect(after.lines).toBeLessThan(before.lines);
    const shapeAfter = await shapeScreenBox(page, id);
    expect(after.cx).toBeCloseTo(shapeAfter.cx, 0);
    expect(after.cy).toBeCloseTo(shapeAfter.cy, 0);
    expect(await shapeText(page, id)).toBe(LONG_LABEL);

    // And the shape itself was resized, not moved: the west edge is where it always was, and the world
    // numbers say so in world units.
    const moved = await objectWorld(page, id);
    expect(moved.x).toBeCloseTo(made.x, 1);
    expect(moved.y).toBeCloseTo(made.y, 1);
  });
});
