import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';
import {
  activeTool,
  boardElement,
  clickElement,
  connectorElements,
  createShapeObject,
  docConnectors,
  docShapes,
  doubleClickElement,
  flushFrame,
  pointerAt,
  pointerEvent,
  pressKey,
  renderBoard,
  shapeCentre,
  shapeEditorElement,
  shapeElement,
  shapeLabelElement,
  shapeOf,
  shapeSvgElement,
  shapeSwatch,
  shapeToolbarElement,
  selectionCount,
  toolButton,
  typeIntoShapeEditor,
  worldOf,
} from './harness';
import { getShapeLabel } from '../../src/shared/objects/shape';
import { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';

/**
 * Drawing a shape (`shape.ui`: TC-15, TC-16, TC-17, TC-28).
 *
 * Everything here goes through the rendered board - a key press, a pointer on the
 * board, a swatch clicked - and is checked against the Y.Doc the board wrote to,
 * because what the story promises is that a drag on the screen becomes one shape on
 * the board, in the right place, and that the tool then puts itself away.
 */

/** Put words on a shape through the model, and let the board re-render. */
function labelShape(doc: Y.Doc, id: string, text: string): void {
  act(() => {
    const label = getShapeLabel(doc, id);
    if (!label) {
      throw new Error(`shape ${id} has no label to write`);
    }
    label.insert(0, text);
  });
}

describe('shape tool (shape.ui)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  it('TC-15: an S drag previews a box, then creates one shape at that box and selects it', async () => {
    renderBoard({ doc });
    await flushFrame();

    pressKey('s');
    expect(activeTool()).toBe('shape');
    expect(toolButton('shape').getAttribute('aria-pressed')).toBe('true');

    const from = { x: 100, y: 120 };
    const to = { x: 300, y: 240 };

    pointerEvent('pointerdown', from.x, from.y);
    await flushFrame();
    // The preview is the box a tap would make, shown the moment the press lands.
    const preview = screen.getByTestId('shape-preview');
    expect(Number(preview.getAttribute('data-world-width'))).toBeCloseTo(
      SHAPE_DEFAULT_SIZE_WORLD,
      6,
    );

    pointerEvent('pointermove', 180, 160);
    await flushFrame();
    pointerEvent('pointermove', to.x, to.y);
    await flushFrame();

    const fromWorld = worldOf(from);
    const toWorld = worldOf(to);
    const dragged = screen.getByTestId('shape-preview');
    expect(Number(dragged.getAttribute('data-world-width'))).toBeCloseTo(
      Math.abs(toWorld.x - fromWorld.x),
      3,
    );
    expect(Number(dragged.getAttribute('data-world-height'))).toBeCloseTo(
      Math.abs(toWorld.y - fromWorld.y),
      3,
    );

    pointerEvent('pointerup', to.x, to.y);
    await flushFrame();

    const shapes = docShapes(doc);
    expect(shapes).toHaveLength(1);
    const shape = shapes[0]!;
    expect(shape.type).toBe('shape');
    expect(shape.x).toBeCloseTo(Math.min(fromWorld.x, toWorld.x), 2);
    expect(shape.y).toBeCloseTo(Math.min(fromWorld.y, toWorld.y), 2);
    expect(shape.width).toBeCloseTo(Math.abs(toWorld.x - fromWorld.x), 2);
    expect(shape.height).toBeCloseTo(Math.abs(toWorld.y - fromWorld.y), 2);

    // `tool.return_to_select`: the new shape is the selection, and the tool goes back.
    expect(selectionCount()).toBe(1);
    expect(shapeElement(shape.id).getAttribute('data-selected')).toBe('true');
    expect(activeTool()).toBe('select');
    // Nothing is being drawn any more.
    expect(screen.queryByTestId('shape-preview')).toBeNull();
  });

  it('TC-15b: a click with the Shape tool creates one default shape, centred on the click', async () => {
    renderBoard({ doc });
    await flushFrame();

    pressKey('s');
    const at = { x: 400, y: 300 };
    pointerEvent('pointerdown', at.x, at.y);
    await flushFrame();
    pointerEvent('pointerup', at.x, at.y);
    await flushFrame();

    const shapes = docShapes(doc);
    expect(shapes).toHaveLength(1);
    const centre = worldOf(at);
    const shape = shapes[0]!;
    expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape.x + shape.width / 2).toBeCloseTo(centre.x, 2);
    expect(shape.y + shape.height / 2).toBeCloseTo(centre.y, 2);
    expect(activeTool()).toBe('select');
  });

  it('a Shift drag makes a square anchored at the corner the drag started from (shape.size)', async () => {
    renderBoard({ doc });
    await flushFrame();

    pressKey('s');
    const from = { x: 100, y: 100 };
    const to = { x: 320, y: 140 };
    pointerAt(boardElement(), 'pointerdown', from.x, from.y, { shiftKey: true });
    await flushFrame();
    // The pointer goes much further right than down: the side is the wider of the
    // two, and the box still starts at the corner the press landed on.
    pointerAt(boardElement(), 'pointermove', to.x, to.y, { shiftKey: true });
    await flushFrame();
    pointerAt(boardElement(), 'pointerup', to.x, to.y, { shiftKey: true });
    await flushFrame();

    const anchor = worldOf(from);
    const shape = docShapes(doc)[0]!;
    expect(shape.width).toBeCloseTo(shape.height, 2);
    expect(shape.width).toBeGreaterThan(200);
    expect(shape.x).toBeCloseTo(anchor.x, 2);
    expect(shape.y).toBeCloseTo(anchor.y, 2);
  });

  it('TC-16: double-clicking a shape opens its label editor, and typing past the limit stops at it', async () => {
    const id = createShapeObject(doc, { at: { x: 300, y: 300 } });
    renderBoard({ doc });
    await flushFrame();

    doubleClickElement(shapeSvgElement(id));
    await flushFrame();

    expect(shapeEditorElement(id)).not.toBeNull();
    // One copy of the words, not a label and an editor showing the same text.
    expect(shapeLabelElement(id)).toBeNull();

    typeIntoShapeEditor(id, 'x'.repeat(SHAPE_LABEL_MAX_CHARS + 100));
    await flushFrame();
    expect(shapeOf(doc, id).label.length).toBe(SHAPE_LABEL_MAX_CHARS);

    // Escape ends editing, and the clamped label stays (`shape.label`).
    pressKey('Escape');
    await flushFrame();
    expect(shapeEditorElement(id)).toBeNull();
    expect(shapeLabelElement(id)?.textContent).toBe('x'.repeat(SHAPE_LABEL_MAX_CHARS));
    expect(shapeOf(doc, id).label.length).toBe(SHAPE_LABEL_MAX_CHARS);
    expect(docShapes(doc)).toHaveLength(1);
  });

  it('TC-17: the fill and outline swatches change only the colour of the selected shape', async () => {
    const id = createShapeObject(doc, { at: { x: 300, y: 300 } });
    labelShape(doc, id, 'keep me');
    renderBoard({ doc });
    await flushFrame();

    const centre = shapeCentre(id, doc);
    clickElement(shapeSvgElement(id), centre.x, centre.y);
    await flushFrame();

    expect(selectionCount()).toBe(1);
    expect(shapeToolbarElement()).not.toBeNull();

    fireEvent.click(shapeSwatch('blue fill'));
    await flushFrame();
    expect(shapeOf(doc, id).fill).toBe('blue');
    expect(shapeOf(doc, id).stroke).toBe('dark');

    fireEvent.click(shapeSwatch('red outline'));
    await flushFrame();
    expect(shapeOf(doc, id).stroke).toBe('red');

    // `shape.colours`: the label, the size, the position and the selection are the
    // ones the person had before the swatch was clicked.
    const shape = shapeOf(doc, id);
    expect(shape.label).toBe('keep me');
    expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(selectionCount()).toBe(1);
    expect(shapeElement(id).getAttribute('data-selected')).toBe('true');
    expect(shapeLabelElement(id)?.textContent).toBe('keep me');
    // The swatches are named, and they say which colour is current.
    expect(shapeSwatch('blue fill').getAttribute('aria-pressed')).toBe('true');
    expect(shapeSwatch('red outline').getAttribute('aria-pressed')).toBe('true');
    expect(shapeSwatch('no fill').getAttribute('aria-pressed')).toBe('false');
  });

  it('TC-28: dragging from a shape with the Shape tool draws a new shape and leaves that one where it was', async () => {
    const id = createShapeObject(doc, { at: { x: 400, y: 300 } });
    renderBoard({ doc });
    await flushFrame();

    const before = shapeOf(doc, id);
    pressKey('s');
    expect(activeTool()).toBe('shape');

    const from = shapeCentre(id, doc);
    const to = { x: from.x + 200, y: from.y + 160 };
    // The press lands on an existing shape. The tool owns the gesture, so the object
    // under it is neither moved nor selected (`shape.tool`, TC-28).
    pointerAt(shapeSvgElement(id), 'pointerdown', from.x, from.y);
    await flushFrame();
    pointerEvent('pointermove', from.x + 80, from.y + 60);
    await flushFrame();
    pointerEvent('pointerup', to.x, to.y);
    await flushFrame();

    const after = shapeOf(doc, id);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(shapeElement(id).getAttribute('data-dragging')).toBe('false');
    expect(shapeElement(id).getAttribute('data-selected')).toBe('false');

    // The shape the drag made exists, and it is the one that is selected.
    const shapes = docShapes(doc);
    expect(shapes).toHaveLength(2);
    const created = shapes.find((entry) => entry.id !== id);
    expect(created).toBeTruthy();
    expect(selectionCount()).toBe(1);
    expect(shapeElement(created!.id).getAttribute('data-selected')).toBe('true');
    expect(activeTool()).toBe('select');
  });

  it('the Shape button arms the tool, and its kind menu chooses what is drawn (shape.kind)', async () => {
    renderBoard({ doc });
    await flushFrame();

    expect(screen.queryByTestId('shape-kinds')).toBeNull();
    fireEvent.click(toolButton('shape'));
    await flushFrame();

    expect(activeTool()).toBe('shape');
    expect(toolButton('shape').getAttribute('aria-pressed')).toBe('true');
    // The kinds are offered only while the tool is in hand.
    expect(screen.getByTestId('shape-kinds')).not.toBeNull();

    fireEvent.click(screen.getByTestId('shape-kind-diamond'));
    await flushFrame();

    const at = { x: 300, y: 300 };
    pointerEvent('pointerdown', at.x, at.y);
    await flushFrame();
    pointerEvent('pointerup', at.x, at.y);
    await flushFrame();

    const shape = docShapes(doc)[0]!;
    expect(shape.kind).toBe('diamond');
    expect(shapeElement(shape.id).getAttribute('data-kind')).toBe('diamond');
    expect(activeTool()).toBe('select');
    // With the tool back on Select the kind menu is closed again.
    expect(screen.queryByTestId('shape-kinds')).toBeNull();
  });

  it('a shape is a thing a pointer can land on, in the CSS the browser is given', () => {
    // jsdom does not apply `pointer-events`, so a shape that the world layer makes
    // click-through would pass every interaction test in this project and be
    // undraggable in a browser. The rule the browser obeys is asserted where it is
    // written; the drag itself is proved in e2e (TC-23, TC-25).
    const css = readFileSync(resolve(process.cwd(), 'src/client/styles.css'), 'utf8');
    const rule = css
      .split('\n}\n')
      .find((block) => block.includes('.shape-object {'));
    if (!rule) {
      throw new Error('the shape card has no rule of its own');
    }
    expect(rule).toContain('pointer-events: auto');
    // The world layer it sits in is the one that ignores pointers.
    expect(css).toMatch(/\.board__world\s*\{[^}]*pointer-events: none/u);
  });

  it('every kind is drawn, and a shape keeps its label empty without being deleted', async () => {
    const rect = createShapeObject(doc, { at: { x: 200, y: 200 } });
    const ellipse = createShapeObject(doc, { kind: 'ellipse', at: { x: 600, y: 200 } });
    renderBoard({ doc });
    await flushFrame();

    expect(shapeElement(rect).getAttribute('data-kind')).toBe('rect');
    expect(shapeElement(ellipse).getAttribute('data-kind')).toBe('ellipse');
    expect(screen.getByTestId(`shape-${ellipse}`).querySelector('ellipse')).not.toBeNull();
    expect(screen.getByTestId(`shape-${rect}`).querySelector('rect')).not.toBeNull();
    expect(shapeLabelElement(rect)?.textContent).toBe('');
    expect(docConnectors(doc)).toHaveLength(0);
    expect(connectorElements()).toHaveLength(0);
  });
});
