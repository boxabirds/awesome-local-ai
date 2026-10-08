import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Board } from '../../src/client/board/Board';
import { screenToWorld, worldToScreen } from '../../src/client/canvas/camera';
import { SHAPE_DEFAULT_SIZE_WORLD } from '../../src/shared/config';
import { dispatchPointer, TEST_BOARD_ID } from './util';
import { getSelection, noteEl, viewportEl } from './stickyUtil';
import { toolState } from './textUtil';
import {
  camera,
  clickShapeSwatch,
  connectorEls,
  seedNotes,
  createShapeByClick,
  dragOn,
  editShapeLabel,
  getShapes,
  previewEl,
  seedShape,
  shapeEl,
  shapeLayer,
  shapeToolEl,
  typeIntoShapeLabel,
} from './shapeUtil';

/**
 * Story 10 — drawing shapes (shape.create_drag, shape.create_click, shape.label,
 * shape.style, shape.consistent).
 *
 * The tool draws on a surface of its own above the board, so the pointer belongs to
 * the tool for the whole gesture: the shape that was drawn is the shape that lands,
 * and nothing that was already there is touched by the drag.
 */
describe('the Shape tool (shape.create_drag, shape.create_click)', () => {
  // TC-15: press S, drag, and the shape lands where the drag was.
  it('TC-15 drags a shape of the dragged size, selects it and returns to Select', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    expect(toolState()).toBe('select');
    expect(shapeToolEl()).toBeNull();

    const layer = shapeLayer();
    expect(toolState()).toBe('shape');
    expect(screen.getByTestId('shape-tool')).not.toBeNull();
    // The board says so under the cursor, too (PRD tools.active_tool).
    expect(viewportEl().style.cursor).toBe('crosshair');

    const cam = camera();
    const from = { x: 100, y: 100 };
    const to = { x: 300, y: 220 };

    // Mid-drag the outline of the shape is being drawn (PRD shape.create_drag).
    dispatchPointer(layer, 'pointerdown', { clientX: from.x, clientY: from.y });
    dispatchPointer(layer, 'pointermove', { clientX: 200, clientY: 160 });
    const preview = previewEl();
    expect(preview).not.toBeNull();
    dispatchPointer(layer, 'pointerup', { clientX: to.x, clientY: to.y });

    const shapes = getShapes();
    expect(shapes).toHaveLength(1);
    const start = screenToWorld(cam, from);
    const end = screenToWorld(cam, to);
    expect(shapes[0]).toMatchObject({
      type: 'shape',
      kind: 'rect',
      x: start.x,
      y: start.y,
      width: end.x - start.x,
      height: end.y - start.y,
      fill: 'white',
      stroke: 'dark',
      label: '',
    });

    // The new shape is the selected thing, and the board is back on Select so it can
    // be moved straight away (PRD tools.return_to_select).
    expect(getSelection().selectedId).toBe(shapes[0]!.id);
    expect(toolState()).toBe('select');
    expect(shapeToolEl()).toBeNull();
    expect(previewEl()).toBeNull();
  });

  // TC-15 boundary: Shift during the drag keeps the drawn shape square.
  it('draws a square while Shift is held and passes the squared box to the model', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const layer = shapeLayer();
    const cam = camera();
    const from = { x: 50, y: 50 };
    const to = { x: 250, y: 130 };
    dragOn(layer, from, to, { shiftKey: true });

    const shapes = getShapes();
    expect(shapes).toHaveLength(1);
    const start = screenToWorld(cam, from);
    const side = (to.x - from.x) / cam.zoom; // the larger dragged dimension
    expect(shapes[0]).toMatchObject({
      x: start.x,
      y: start.y,
      width: side,
      height: side,
    });
  });

  // TC-02's user-facing half: a click makes a standard shape, centred on the click.
  it('clicks a standard shape centred on the point that was clicked', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const cam = camera();
    const at = { x: 400, y: 200 };
    const shape = createShapeByClick(at);
    const centre = screenToWorld(cam, at);
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
    expect(shape).toMatchObject({
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
      x: centre.x - half,
      y: centre.y - half,
    });
  });

  // The kind comes from the Shape menu beside the tool buttons.
  it('draws the kind the Shape menu last chose', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    shapeLayer();
    // Choosing a kind does not leave the tool (PRD shape.create_click).
    const menu = screen.getByTestId('shape-kind-menu');
    clickShapeSwatch('Diamond');
    expect(toolState()).toBe('shape');
    const diamond = screen.getByTestId('tool-shape-kind-diamond') as HTMLButtonElement;
    expect(diamond.getAttribute('aria-pressed')).toBe('true');
    expect(menu).not.toBeNull();

    dragOn(shapeToolEl()!, { x: 20, y: 20 }, { x: 220, y: 180 });
    const shapes = getShapes();
    expect(shapes).toHaveLength(1);
    expect(shapes[0]!.kind).toBe('diamond');
    // A diamond is drawn as a polygon inside the shape's own box.
    const figure = screen.getByTestId('shape-object');
    expect(figure.querySelectorAll('polygon')).toHaveLength(1);
    expect(figure.querySelectorAll('rect')).toHaveLength(0);
  });
});

describe('a shape’s label and colours (shape.label, shape.style)', () => {
  // TC-16: double-click opens the label editor, and typing stops at the limit.
  it('TC-16 edits the label in place and clamps it at 500 characters', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const id = seedShape({ x: 0, y: 0, width: 200, height: 120, label: 'Start' });
    expect(shapeEl().getAttribute('data-kind')).toBe('rect');
    expect(screen.getByTestId('shape-label').textContent).toBe('Start');

    editShapeLabel();
    expect(screen.getByTestId('shape-label-input')).not.toBeNull();
    expect(getSelection().editingId).toBe(id);

    typeIntoShapeLabel('x'.repeat(520));
    // Every keystroke went to the shared label, and only the first 500 characters fit.
    expect(getShapes()[0]!.label).toHaveLength(500); // PRD shape.label limit
    expect((screen.getByTestId('shape-label-input') as HTMLTextAreaElement).value).toHaveLength(
      500,
    );
    expect(getSelection().editingId).toBe(id);
  });

  // TC-17: the toolbar changes the colour and nothing else.
  it('TC-17 recolours the fill and the outline, leaving label, box and selection alone', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const id = seedShape({
      x: 10,
      y: 20,
      width: 200,
      height: 120,
      label: 'Review',
    });
    const before = getShapes()[0]!;
    expect(before.fill).toBe('white');
    expect(before.stroke).toBe('dark');

    // Select it, which brings the toolbar up.
    dispatchPointer(shapeEl(), 'pointerdown', { clientX: 40, clientY: 40 });
    dispatchPointer(shapeEl(), 'pointerup', { clientX: 40, clientY: 40 });
    expect(getSelection().selectedId).toBe(id);
    expect(screen.getByTestId('shape-toolbar')).not.toBeNull();

    clickShapeSwatch('Blue fill');
    clickShapeSwatch('Red outline');

    const after = getShapes()[0]!;
    expect(after.fill).toBe('blue');
    expect(after.stroke).toBe('red');
    // Only the colour keys moved (PRD shape.style).
    expect({ ...after, fill: before.fill, stroke: before.stroke }).toEqual({ ...before });
    expect(after.label).toBe('Review');
    expect(getSelection().selectedId).toBe(id);
  });

  // "No fill" is a choice as well, and it is named rather than coloured alone.
  it('offers no fill and marks the current colours as pressed', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const id = seedShape({ x: 0, y: 0, width: 100, height: 100, fill: 'grey' });
    dispatchPointer(shapeEl(), 'pointerdown', { clientX: 10, clientY: 10 });
    dispatchPointer(shapeEl(), 'pointerup', { clientX: 10, clientY: 10 });
    expect(getSelection().selectedId).toBe(id);

    const grey = screen.getByRole('button', { name: 'Grey fill' }) as HTMLButtonElement;
    const none = screen.getByRole('button', { name: 'No fill' }) as HTMLButtonElement;
    expect(grey.getAttribute('aria-pressed')).toBe('true');
    expect(none.getAttribute('aria-pressed')).toBe('false');

    none.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(getShapes()[0]!.fill).toBe('none');
  });

  // Story 10 adds its arrows below the things they point at, and drawing one is not
  // a way of moving what is already on the board (TC-28).
  it('TC-28 takes the gesture over an existing note instead of moving it', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    seedNotes([{ x: 100, y: 100, width: 200, height: 200, text: 'Hold' }]);
    const cam = camera();
    expect(getSelection().selectedId).toBeNull();

    // The pointer goes down inside the note's box, which is what a person who starts
    // dragging from an object does; the tool's own surface is what receives it.
    const layer = shapeLayer();
    const centre = worldToScreen(cam, { x: 200, y: 200 });
    dragOn(layer, centre, { x: centre.x + 120, y: centre.y + 60 });

    // The note has not moved, and only the shape was created.
    expect(noteEl().textContent).toBe('Hold');
    expect(getShapes()).toHaveLength(1);
    const shape = getShapes()[0]!;
    const start = screenToWorld(cam, centre);
    expect(shape.x).toBeCloseTo(start.x, 6);
    expect(shape.width).toBeCloseTo(120 / cam.zoom, 6);
    // A shape's own box is where the drawing lives, so the outline can be measured.
    const el = shapeEl();
    expect(el.style.width).toBe(`${shape.width}px`);
    expect(el.style.height).toBe(`${shape.height}px`);
    expect(worldToScreen(cam, { x: shape.x, y: shape.y }).x).toBeCloseTo(centre.x, 6);
    expect(connectorEls()).toHaveLength(0);
  });
});
