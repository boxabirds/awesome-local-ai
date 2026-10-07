/**
 * Drawing a shape (`tests/component/ShapeTool.test.tsx`).
 *
 * `shape.ui` as a person meets it: press `S`, drag, and a shape is on the board
 * where the drag was; double-click it and type; click a colour and the shape
 * changes colour. Everything below goes through the interface - the tool layer,
 * the shape's own element, the swatch buttons - and reads the answer out of the
 * shared document, because a shape that only exists in React state would be a
 * shape nobody else can see.
 *
 * The third file in this story's unit tests already proved what `createShape` does
 * with a rectangle; what is proved here is the road to it: one drag, one shape,
 * the shape selected, the tool put back, and - the part a tool layer exists for -
 * the thing underneath the drag left exactly where it was.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  board,
  boardDoc,
  clickTool,
  createNote,
  docNotes,
  doubleClick,
  flushFrames,
  keydown,
  noteData,
  pointerDown,
  pointerMove,
  pointerUp,
  pressedShapeFill,
  pressedShapeStroke,
  pressedShapeKind,
  pressedTool,
  renderBoard,
  screenOf,
  selectedObjectIds,
  shapeData,
  shapeEditor,
  shapeElement,
  shapeElements,
  shapeFillButton,
  shapeKindButtons,
  shapeKindMenu,
  shapeLabel,
  shapePreview,
  shapeScreenCentre,
  shapeStrokeButton,
  shapeSurface,
  shapeToolbarElement,
  shapes,
  toolSurfaceExists,
  typeShapeText,
  worldOfScreen,
} from './helpers.js';
import { fireEvent } from './tl.js';

import { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config.js';
import { objectBounds } from '../../src/shared/board-model.js';
import { getShapeLabel } from '../../src/shared/objects/shape.js';

beforeEach(() => {
  renderBoard();
});

/** Press the Shape tool button (the same button the `S` shortcut presses). */
const shapeTool = (): void => clickTool('shape');

/**
 * Draw a shape by dragging the tool layer from one screen point to another.
 * Each drag ends with the tool back on Select, so a test that draws twice says so
 * twice - which is what the person does, pressing `S` again between the two.
 */
function drawShape(from: { x: number; y: number }, to: { x: number; y: number }): void {
  if (pressedTool() !== 'shape') clickTool('shape');
  pointerDown(from, shapeSurface());
  pointerMove({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, shapeSurface());
  pointerMove(to, shapeSurface());
  pointerUp(to, shapeSurface());
}

/** The 200 x 120 shape the story's own example drags, at the middle of the view. */
function drawDefaultShape(): void {
  drawShape({ x: 440, y: 340 }, { x: 640, y: 460 });
}

/** A swatch of one palette, or nothing at all if that palette has no such colour. */
function swatch(kind: 'fill' | 'stroke', colour: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-testid="shape-${kind}-button"][data-color="${colour}"]`,
  );
}

/** The colours one palette offers, in the order the toolbar shows them. */
function swatchColours(kind: 'fill' | 'stroke'): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="shape-${kind}-button"]`)).map(
    (button) => button.getAttribute('data-color') ?? '',
  );
}

/** Shift-drag over the whole board: the marquee (`sel.marquee`). */
function marqueeAll(): void {
  const surface = board();
  const sweep = (type: string, at: { x: number; y: number }, buttons: number): void => {
    fireEvent[type as 'pointerDown'](surface, {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: type === 'pointerUp' ? 0 : undefined,
      buttons,
      shiftKey: true,
      clientX: at.x,
      clientY: at.y,
    });
    flushFrames();
  };
  sweep('pointerDown', { x: 60, y: 60 }, 1);
  sweep('pointerMove', { x: 446, y: 286 }, 1);
  sweep('pointerMove', { x: 833, y: 513 }, 1);
  sweep('pointerUp', { x: 1220, y: 740 }, 0);
}

describe('shape.ui: drawing a shape by dragging', () => {
  it('TC-15 shows a preview while dragging and creates one selected shape on release', () => {
    keydown('s');
    expect(pressedTool()).toBe('shape');
    expect(toolSurfaceExists('shape')).toBe(true);

    const from = { x: 440, y: 340 };
    const to = { x: 640, y: 460 };
    pointerDown(from, shapeSurface());
    pointerMove({ x: 540, y: 400 }, shapeSurface());

    // The outline of the shape, where the drag has reached so far.
    const preview = shapePreview();
    expect(preview).not.toBeNull();
    expect(preview?.style.left).toBe('440px');
    expect(preview?.style.top).toBe('340px');
    expect(preview?.style.width).toBe('100px');
    expect(preview?.style.height).toBe('60px');
    // Nothing has been written to the board yet: the shape arrives with the release.
    expect(shapes()).toHaveLength(0);

    pointerUp(to, shapeSurface());

    const start = worldOfScreen(from);
    const end = worldOfScreen(to);
    const shape = shapeData(0);
    expect(shape.x).toBeCloseTo(start.x, 6);
    expect(shape.y).toBeCloseTo(start.y, 6);
    expect(shape.width).toBeCloseTo(end.x - start.x, 6);
    expect(shape.height).toBeCloseTo(end.y - start.y, 6);
    // One drag, one shape - the release is not allowed to write twice.
    expect(shapes()).toHaveLength(1);
    // And the tool's business is over: the new shape is selected, and the pointer
    // is back to the tool it was before.
    expect(selectedObjectIds()).toEqual([shape.id]);
    expect(pressedTool()).toBe('select');
    expect(toolSurfaceExists('shape')).toBe(false);
    expect(shapePreview()).toBeNull();
  });

  it('TC-15b draws the shape the shape menu chose, and a click makes a shape of the default size', () => {
    shapeTool();
    expect(shapeKindButtons().map((button) => button.getAttribute('data-kind'))).toEqual([
      'rect',
      'ellipse',
      'diamond',
    ]);
    expect(shapeKindMenu()).not.toBeNull();
    fireEvent.click(shapeKindButtons()[1]!);
    // The menu belongs to the tool, so it stays while the tool is up and says which
    // shape the next drag will draw.
    expect(pressedShapeKind()).toBe('ellipse');

    const at = { x: 500, y: 400 };
    pointerDown(at, shapeSurface());
    pointerUp(at, shapeSurface());

    const shape = shapeData(0);
    expect(shape.kind).toBe('ellipse');
    const atWorld = worldOfScreen(at);
    const box = objectBounds(shape);
    expect(box.x + box.width / 2).toBeCloseTo(atWorld.x, 6);
    expect(box.y + box.height / 2).toBeCloseTo(atWorld.y, 6);
    expect(box.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(box.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
  });

  it('TC-28 leaves the note under the drag where it was, and lands the shape on top of it', () => {
    createNote('Standing still');
    const before = noteData(0);

    keydown('s');
    // The drag starts on top of the note and crosses it. The note is never told a
    // pointer went down, so it cannot move.
    const centre = screenOf({ x: before.x, y: before.y });
    drawShape(centre, { x: centre.x + 120, y: centre.y + 80 });

    const after = noteData(0);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.id).toBe(before.id);
    // The shape was still drawn, and is what is selected.
    expect(shapes()).toHaveLength(1);
    expect(selectedObjectIds()).toEqual([shapeData(0).id]);
    expect(pressedTool()).toBe('select');
  });
});

describe('shape.ui: the label of a shape', () => {
  it('TC-16 opens an editor on double-click and keeps only the first label-limit characters', () => {
    shapeTool();
    drawDefaultShape();

    doubleClick(shapeElement(0), shapeScreenCentre(0));

    const editor = shapeEditor(0);
    expect(document.activeElement).toBe(editor);
    // A double-click on a shape writes in the shape: it does not also drop a note
    // on top of it.
    expect(docNotes().filter((object) => object.type === 'sticky')).toHaveLength(0);

    const typed = 'L'.repeat(600);
    expect(typed.length).toBeGreaterThan(SHAPE_LABEL_MAX_CHARS);
    typeShapeText(typed);

    // The label is the text that fits, no more, and it is in the shared document.
    expect(shapeData(0).label.length).toBe(SHAPE_LABEL_MAX_CHARS);
    expect(getShapeLabel(boardDoc(), shapeIdOf(0))?.toString()).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    // The editor still shows what was kept, so nothing silently disappeared.
    expect(shapeEditor(0).value).toHaveLength(SHAPE_LABEL_MAX_CHARS);
  });

  it('TC-16b shows the words it holds, and an empty label is a shape rather than a cursor', () => {
    shapeTool();
    drawDefaultShape();
    doubleClick(shapeElement(0), shapeScreenCentre(0));
    typeShapeText('Weekly planning');
    // Leave editing through the editor, which keeps the shape selected.
    fireEvent.keyDown(shapeEditor(0), { key: 'Escape' });

    expect(shapeLabel(0)).toBe('Weekly planning');
    expect(selectedObjectIds()).toEqual([shapeData(0).id]);

    // A shape with no words in it stays on the board: an empty label is the normal
    // case for a shape, unlike an empty text box.
    drawShape({ x: 200, y: 500 }, { x: 320, y: 580 });
    expect(shapes()).toHaveLength(2);
    expect(shapeLabel(1)).toBe('');
    expect(shapeElements()).toHaveLength(2);
  });
});

describe('shape.ui: the colours of a shape', () => {
  it('TC-17 applies the fill and outline that were clicked and changes nothing else', () => {
    shapeTool();
    drawDefaultShape();
    const before = shapeData(0);
    expect(shapeToolbarElement()).not.toBeNull();

    fireEvent.click(shapeFillButton('blue'));
    fireEvent.click(shapeStrokeButton('red'));

    const after = shapeData(0);
    expect(after.fill).toBe('blue');
    expect(after.stroke).toBe('red');
    // The swatches say which colours the shape has, including the ones it did not
    // get, so a person can see what they are choosing between.
    expect(pressedShapeFill()).toBe('blue');
    expect(pressedShapeStroke()).toBe('red');
    // The two things a colour change has no business touching.
    expect(after.label).toBe(before.label);
    expect(selectedObjectIds()).toEqual([before.id]);
    expect(after.x).toBe(before.x);
    expect(after.width).toBe(before.width);
  });

  it('TC-17b offers no-fill as a colour and no outline colour that is not an outline', () => {
    shapeTool();
    drawDefaultShape();

    expect(swatchColours('fill')).toEqual(['none', 'white', 'blue', 'green', 'yellow', 'pink', 'grey']);
    expect(swatchColours('stroke')).toEqual(['dark', 'blue', 'green', 'orange', 'red', 'grey']);
    expect(swatch('fill', 'none')).not.toBeNull();
    // The two palettes are not one palette: a fill is not an outline colour.
    expect(swatch('fill', 'dark')).toBeNull();
    expect(swatch('stroke', 'none')).toBeNull();
    // The shape starts with the colours a shape starts with, and says so.
    expect(pressedShapeFill()).toBe('white');
    expect(pressedShapeStroke()).toBe('dark');
  });

  it('TC-17c puts its toolbar away as soon as more than one shape is selected', () => {
    shapeTool();
    drawDefaultShape();
    drawShape({ x: 200, y: 500 }, { x: 320, y: 580 });
    const first = shapes()[0]!;
    const second = shapes()[1]!;

    // Story 7's marquee: both shapes selected, so the shape toolbar is not the
    // answer any more.
    marqueeAll();

    expect(selectedObjectIds().length).toBeGreaterThanOrEqual(2);
    expect(selectedObjectIds()).toContain(first.id);
    expect(selectedObjectIds()).toContain(second.id);
    expect(shapeToolbarElement()).toBeNull();
  });
});

/** The id of the nth shape (a label's text lives in the document under it). */
function shapeIdOf(index: number): string {
  return shapeData(index).id;
}
