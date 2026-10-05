/**
 * Component tests for the Shape tool, its label editor and its colour toolbar
 * (TC-15 to TC-17, TC-28, shape.create, shape.label, shape.style).
 *
 * The tool is a screen-space layer, so the tests press on that layer and read the
 * document. Sizes are asserted in world units at zoom 1, where a screen pixel and a
 * board unit are the same thing; where a position matters, it is compared with another
 * shape's rather than with a number, because the board's camera is not a test fixture.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import * as Y from 'yjs';
import App from '../../src/client/App';
import { stubViewportSize, seedSticky } from './boardHarness';
import { objectBounds } from '../../src/shared/board-model';
import {
  bodyOf,
  cameraOf,
  countUpdates,
  findObject,
  findShape,
  objectsOf,
  screenOf,
  seedShape,
  toScreen,
} from './flowHarness';
import { getShapeLabel } from '../../src/shared/objects/shape';
import { SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';

stubViewportSize();

describe('Shape tool (shape.create)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  afterEach(() => {
    doc.destroy();
  });

  const layerOf = (container: HTMLElement): HTMLElement => {
    const el = container.querySelector<HTMLElement>('[data-tool-layer="shape"]');
    if (!el) throw new Error('the Shape tool layer is not up');
    return el;
  };

  /** Press the layer and stop halfway, leaving the drag under way. */
  function beginDrag(
    container: HTMLElement,
    from: { x: number; y: number },
    to: { x: number; y: number },
    options: { shift?: boolean } = {},
  ): void {
    const layer = layerOf(container);
    fireEvent.pointerDown(layer, { clientX: from.x, clientY: from.y, button: 0, pointerId: 11 });
    fireEvent.pointerMove(window, {
      clientX: to.x,
      clientY: to.y,
      button: 0,
      pointerId: 11,
      shiftKey: options.shift === true,
    });
  }

  const release = (at: { x: number; y: number }, options: { shift?: boolean } = {}): void => {
    fireEvent.pointerUp(window, {
      clientX: at.x,
      clientY: at.y,
      button: 0,
      pointerId: 11,
      shiftKey: options.shift === true,
    });
  };

  const shapes = (): readonly string[] => objectsOf(doc).filter((o) => o.type === 'shape').map((o) => o.id);

  it('TC-15 a drag previews the box, makes one shape of that size, and selects it', () => {
    const { container } = render(<App doc={doc} />);
    fireEvent.keyDown(window, { key: 's' });

    beginDrag(container, { x: 300, y: 200 }, { x: 500, y: 320 });
    const preview = container.querySelector<HTMLElement>('[data-testid="shape-preview"]');
    if (!preview) throw new Error('the drag painted no preview');
    expect(preview.style.width).toBe('200px');
    expect(preview.style.height).toBe('120px');
    expect(preview.style.border).toContain('dashed');
    expect(shapes()).toHaveLength(0);

    let updates = 0;
    // The release itself is the thing under test: one command, one update.
    const before = objectsOf(doc).length;
    updates = countUpdates(doc, () => release({ x: 500, y: 320 }));
    expect(updates).toBe(1);

    const id = shapes()[0];
    if (!id) throw new Error('the drag created no shape');
    const shape = findShape(doc, id);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(120);
    expect(objectsOf(doc)).toHaveLength(before + 1);
    const selected = container.querySelectorAll<HTMLElement>('[data-object-type][data-selected="true"]');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.dataset.objectId).toBe(id);
  });

  it('TC-15 a click makes the default size, centred where it was clicked', () => {
    const { container } = render(<App doc={doc} />);
    fireEvent.keyDown(window, { key: 's' });
    const layer = layerOf(container);
    const at = { x: 400, y: 300 };
    fireEvent.pointerDown(layer, { clientX: at.x, clientY: at.y, button: 0, pointerId: 12 });
    fireEvent.pointerUp(window, { clientX: at.x, clientY: at.y, button: 0, pointerId: 12 });

    const id = shapes()[0];
    if (!id) throw new Error('the click created no shape');
    const shape = findShape(doc, id);
    expect(shape.width).toBe(160);
    expect(shape.height).toBe(160);
    // Centred on the click: the same screen point is its centre.
    const centre = toScreen(cameraOf(container), { x: shape.x + 80, y: shape.y + 80 });
    expect(Math.round(centre.x)).toBe(at.x);
    expect(Math.round(centre.y)).toBe(at.y);
  });

  it('TC-15 Shift makes a square from the longer side, anchored at where the drag began', () => {
    const { container } = render(<App doc={doc} />);
    fireEvent.keyDown(window, { key: 's' });
    beginDrag(container, { x: 300, y: 200 }, { x: 500, y: 320 }, { shift: true });
    release({ x: 500, y: 320 }, { shift: true });

    const id = shapes()[0];
    if (!id) throw new Error('no shape from the Shift drag');
    const shape = findShape(doc, id);
    // The drag is 200 wide and 120 tall, so the square takes the longer side.
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(200);
    // The first corner stayed put: the drag went down-right, so the box still starts
    // where the pointer went down.
    const start = toScreen(cameraOf(container), { x: shape.x, y: shape.y });
    expect(Math.round(start.x)).toBe(300);
    expect(Math.round(start.y)).toBe(200);
  });

  it('TC-15 a drag backwards gives the same box as the same drag forwards', () => {
    const { container } = render(<App doc={doc} />);
    fireEvent.keyDown(window, { key: 's' });
    beginDrag(container, { x: 500, y: 320 }, { x: 300, y: 200 });
    release({ x: 300, y: 200 });
    const shape = findShape(doc, shapes()[0]);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(120);
    const corner = toScreen(cameraOf(container), { x: shape.x, y: shape.y });
    expect(Math.round(corner.x)).toBe(300);
    expect(Math.round(corner.y)).toBe(200);
  });

  it('TC-15 a release under the drag threshold is a click, not a two pixel shape', () => {
    const { container } = render(<App doc={doc} />);
    fireEvent.keyDown(window, { key: 's' });
    beginDrag(container, { x: 300, y: 200 }, { x: 302, y: 201 });
    release({ x: 302, y: 201 });
    const shape = findShape(doc, shapes()[0]);
    expect(shape.width).toBe(160);
    expect(shape.height).toBe(160);
  });

  it('a cancelled gesture makes nothing, and the tool stays up (negative)', () => {
    const { container } = render(<App doc={doc} />);
    fireEvent.keyDown(window, { key: 's' });
    beginDrag(container, { x: 300, y: 200 }, { x: 500, y: 320 });
    fireEvent.pointerCancel(window, { pointerId: 11 });
    expect(shapes()).toHaveLength(0);
    // The release that follows the cancellation cannot create it after all.
    release({ x: 500, y: 320 });
    expect(shapes()).toHaveLength(0);
    expect(layerOf(container)).toBeTruthy();
  });

  it('TC-28 a shape dragged out over a sticky note leaves the sticky note alone (negative)', () => {
    const sticky = seedSticky(doc, { x: 0, y: 0 });
    const { container } = render(<App doc={doc} />);
    const before = findObject(doc, sticky)!;
    const bounds = objectBounds(before);
    const overSticky = screenOf(container, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });

    fireEvent.keyDown(window, { key: 's' });
    beginDrag(container, overSticky, { x: overSticky.x + 180, y: overSticky.y + 120 });
    release({ x: overSticky.x + 180, y: overSticky.y + 120 });

    const after = findObject(doc, sticky)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(shapes()).toHaveLength(1);
    // And the sticky note is not what is selected: the new shape is.
    const selected = container.querySelectorAll<HTMLElement>('[data-object-type][data-selected="true"]');
    expect(selected[0]?.dataset.objectType).toBe('shape');
  });

  it('while the tool is up a drag draws instead of panning the board', () => {
    const { container } = render(<App doc={doc} />);
    const camera0 = cameraOf(container);
    fireEvent.keyDown(window, { key: 's' });
    beginDrag(container, { x: 300, y: 200 }, { x: 600, y: 500 });
    // The layer sits above the viewport and stops the press, so the camera never moved.
    expect(cameraOf(container)).toEqual(camera0);
    release({ x: 600, y: 500 });
    expect(cameraOf(container)).toEqual(camera0);
  });
});

describe('shape label and shape style (TC-16, TC-17, shape.label, shape.style)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  afterEach(() => {
    doc.destroy();
  });

  const centreScreen = (container: HTMLElement, id: string): { x: number; y: number } => {
    const bounds = objectBounds(findShape(doc, id));
    return screenOf(container, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
  };

  /** Press on the shape and let go without moving: that selects it. */
  function selectShape(container: HTMLElement, id: string): void {
    const at = centreScreen(container, id);
    const body = bodyOf(container, id);
    fireEvent.pointerDown(body, { clientX: at.x, clientY: at.y, button: 0, pointerId: 21 });
    fireEvent.pointerUp(window, { clientX: at.x, clientY: at.y, button: 0, pointerId: 21 });
  }

  it('TC-16 double-click opens the label, and 600 characters become exactly the limit', () => {
    const id = seedShape(doc, 'rect', { x: 0, y: 0, width: 200, height: 120 }, { label: 'Draft' });
    const { container } = render(<App doc={doc} />);
    const at = centreScreen(container, id);

    fireEvent.doubleClick(bodyOf(container, id), { clientX: at.x, clientY: at.y });
    const editor = container.querySelector<HTMLTextAreaElement>('[aria-label="Shape label"]');
    if (!editor) throw new Error('double-click did not open the label editor');

    fireEvent.input(editor, { target: { value: 'a'.repeat(600) } });
    const label = getShapeLabel(doc, id);
    if (!label) throw new Error('the shape has no label to write to');
    expect(label.toString()).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    expect(editor.value).toHaveLength(SHAPE_LABEL_MAX_CHARS);
  });

  it('finishing a label leaves the shape selected and the text on the board', () => {
    const id = seedShape(doc, 'diamond', { x: 0, y: 0, width: 200, height: 160 });
    const { container } = render(<App doc={doc} />);
    fireEvent.doubleClick(bodyOf(container, id));
    const editor = container.querySelector<HTMLTextAreaElement>('[aria-label="Shape label"]')!;
    fireEvent.input(editor, { target: { value: 'Deploy?' } });
    fireEvent.keyDown(editor, { key: 'Escape' });

    expect(getShapeLabel(doc, id)?.toString()).toBe('Deploy?');
    expect(container.querySelector('[aria-label="Shape label"]')).toBeNull();
    const label = container.querySelector<HTMLElement>(`[data-testid="shape-label-${id}"]`);
    expect(label?.textContent).toBe('Deploy?');
  });

  it('TC-17 the fill and outline swatches restyle the shape, leaving label and selection alone', () => {
    const id = seedShape(doc, 'rect', { x: 0, y: 0, width: 200, height: 120 }, { label: 'Keep me' });
    const { container } = render(<App doc={doc} />);
    selectShape(container, id);

    const fill = container.querySelector<HTMLButtonElement>('[data-testid="fill-blue"]');
    const stroke = container.querySelector<HTMLButtonElement>('[data-testid="stroke-red"]');
    if (!fill || !stroke) throw new Error('the shape toolbar did not appear with its swatches');
    expect(fill.getAttribute('aria-label')).toBe('Blue fill');
    expect(stroke.getAttribute('aria-label')).toBe('Red outline');
    expect(fill.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(fill);
    expect(findShape(doc, id).fill).toBe('blue');
    fireEvent.click(stroke);
    expect(findShape(doc, id).stroke).toBe('red');

    // Neither click disturbed what the person was doing.
    expect(findShape(doc, id).label).toBe('Keep me');
    const selected = container.querySelectorAll<HTMLElement>('[data-object-type][data-selected="true"]');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.dataset.objectId).toBe(id);
    // And the swatch now reports the colour the shape has.
    expect(container.querySelector('[data-testid="fill-blue"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('the transparent fill is called No fill and is a colour like any other', () => {
    const id = seedShape(doc, 'rect', { x: 0, y: 0, width: 200, height: 120 });
    const { container } = render(<App doc={doc} />);
    selectShape(container, id);
    const none = container.querySelector<HTMLButtonElement>('[data-testid="fill-none"]');
    if (!none) throw new Error('the fill row has no No fill swatch');
    expect(none.getAttribute('aria-label')).toBe('No fill');
    expect(none.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(none);
    expect(findShape(doc, id).fill).toBe('none');
    // The board paints no fill as no fill, not as white: what is behind the shape
    // is somebody else's work.
    expect(container.querySelector(`[data-testid="shape-body-${id}"] > *`)?.getAttribute('fill')).toBe('transparent');
  });

});
