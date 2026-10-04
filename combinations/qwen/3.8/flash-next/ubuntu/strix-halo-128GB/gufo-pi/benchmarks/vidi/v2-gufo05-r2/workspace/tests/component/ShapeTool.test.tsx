/**
 * Story 10, `shape.ui`: drawing a shape, labelling it, and colouring it.
 *
 * These run on the real board with the real tool layer over it, for the two things a
 * unit test cannot reach: a drag with the Shape tool must belong to the tool even when it
 * starts on top of a sticky note (TC-28), and a label must live inside the shape it
 * belongs to — centred, wrapped, and still centred after a resize.
 */

import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SHAPE_LABEL_MAX_CHARS, SHAPE_MIN_SIZE_WORLD } from '../../src/shared/config';
import { getShapeLabel } from '../../src/shared/objects/shape';
import { createSticky } from '../../src/shared/board-model';
import {
  boxOf,
  centre,
  countUpdates,
  dblClickObject,
  dragWorld,
  firePointer,
  flushFrames,
  labelEditor,
  labelOf,
  objectCount,
  objectEl,
  pickShapeTool,
  previewEl,
  readCamera,
  renderStory10,
  seedShape,
  selectionIds,
  shapeToolButton,
  shapesOf,
  toScreen,
  toolLayer,
  typeInto,
} from './story10Harness';

afterEach(() => cleanup());

describe('shape.ui — drawing a shape', () => {
  it('TC-15: a drag previews the shape and then creates it once, and it is selected', () => {
    const doc = renderStory10();
    pickShapeTool();
    const from = { x: 100, y: 100 };
    const to = { x: 300, y: 220 };

    const { updates } = countUpdates(doc, () => {
      // Down and along, but not released: the dashed preview is the whole promise.
      dragWorld(toolLayer(), from, to, { release: false });
      const preview = previewEl();
      expect(preview).not.toBeNull();
      const zoom = readCamera().zoom;
      expect(preview!.style.width).toBe(`${200 * zoom}px`);
      expect(preview!.style.height).toBe(`${120 * zoom}px`);
      // Letting go is what creates — and it happens exactly once.
      const at = toScreen(to);
      firePointer(toolLayer(), 'pointerup', at.x, at.y);
      flushFrames();
    });

    const shapes = shapesOf(doc);
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatchObject({
      kind: 'rect',
      x: 100,
      y: 100,
      width: 200,
      height: 120,
      fill: 'white',
      stroke: 'dark',
      label: '',
    });
    expect(updates).toBe(1);
    // The preview is gone, the new shape is the selection, and the tool is back to Select.
    expect(previewEl()).toBeNull();
    expect(selectionIds()).toEqual([shapes[0]!.id]);
    expect(shapeToolButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('TC-15b: a click without a drag drops a standard shape centred on the point', () => {
    const doc = renderStory10();
    pickShapeTool();
    const at = { x: 500, y: 300 };
    dragWorld(toolLayer(), at, at);

    const shapes = shapesOf(doc);
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatchObject({ width: 160, height: 160 });
    expect(centre(boxOf(doc, shapes[0]!.id))).toEqual(at);
  });

  it('TC-15c: Shift during the drag squares it, and the preview says so', () => {
    const doc = renderStory10();
    pickShapeTool();
    dragWorld(toolLayer(), { x: 0, y: 0 }, { x: 200, y: 120 }, { shift: true, release: false });
    const zoom = readCamera().zoom;
    expect(previewEl()!.style.width).toBe(`${200 * zoom}px`);
    expect(previewEl()!.style.height).toBe(`${200 * zoom}px`);
    const at = toScreen({ x: 200, y: 120 });
    firePointer(toolLayer(), 'pointerup', at.x, at.y, { shift: true });
    flushFrames();

    const shapes = shapesOf(doc);
    expect(shapes[0]).toMatchObject({ width: 200, height: 200, x: 0, y: 0 });
  });

  it('TC-15d: the kind picked in the menu is the kind drawn', () => {
    const doc = renderStory10();
    pickShapeTool('diamond');
    dragWorld(toolLayer(), { x: 40, y: 40 }, { x: 240, y: 240 });
    expect(shapesOf(doc)[0]).toMatchObject({ kind: 'diamond' });
    // The tool went back to Select after drawing; the menu keeps the kind choice, so
    // picking the tool again draws another diamond.
    pickShapeTool();
    dragWorld(toolLayer(), { x: 400, y: 40 }, { x: 600, y: 240 });
    expect(shapesOf(doc)).toHaveLength(2);
    expect(shapesOf(doc)[1]).toMatchObject({ kind: 'diamond' });
  });

  it('TC-28: a drag that starts on an object draws a shape and leaves the object alone', () => {
    const doc = renderStory10();
    let noteId = '';
    act(() => {
      noteId = createSticky(doc, { x: 300, y: 300 });
    });
    flushFrames();
    const before = boxOf(doc, noteId);

    pickShapeTool();
    // Straight across the middle of the note, where its own drag handler lives.
    dragWorld(toolLayer(), centre(before), { x: centre(before).x + 200, y: 600 });

    expect(boxOf(doc, noteId)).toEqual(before);
    expect(shapesOf(doc)).toHaveLength(1);
  });
});

describe('shape.ui — the label', () => {
  it('TC-16: double-click opens the label, and 600 characters become 500', () => {
    const doc = renderStory10();
    const id = seedShape(doc, 'rect', { x: 0, y: 0, width: 200, height: 120 });

    dblClickObject(id);
    const editor = labelEditor(id);
    if (!editor) throw new Error('double-clicking a shape did not open its label');

    typeInto(editor, 'x'.repeat(600));
    expect(getShapeLabel(doc, id)?.toString()).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    // The shape is still there, selected and being typed in; nothing else was created.
    expect(objectCount(doc)).toBe(1);
    expect(selectionIds()).toEqual([id]);

    // End of editing: what is drawn is the clamped label, still inside the shape.
    act(() => {
      editor.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    flushFrames();
    expect(labelEditor(id)).toBeNull();
    expect(labelOf(id)).toHaveLength(SHAPE_LABEL_MAX_CHARS);
  });

  it('TC-16b: the label is drawn inside the shape and centred by its own class', () => {
    const doc = renderStory10();
    const id = seedShape(doc, 'ellipse', { x: 0, y: 0, width: 300, height: 200 });
    act(() => {
      getShapeLabel(doc, id)?.insert(0, 'a very long label that has to wrap inside the shape');
    });
    flushFrames();

    const label = screen.getByTestId(`shape-label-${id}`);
    expect(label.textContent).toContain('very long label');
    // The label box is inset from the ellipse's outline, in the world layer, so it is
    // placed in board units: `left`/`top` are the inset the kind needs.
    const foreign = label.closest('foreignObject');
    expect(foreign).not.toBeNull();
    expect(Number(foreign!.getAttribute('x'))).toBeGreaterThan(0);
    expect(Number(foreign!.getAttribute('width'))).toBeLessThan(300);
  });

  it('TC-16c: Escape keeps the label and leaves the shape selected', () => {
    const doc = renderStory10();
    const id = seedShape(doc, 'rect', { x: 0, y: 0, width: 200, height: 120 });
    dblClickObject(id);
    const editor = labelEditor(id)!;
    typeInto(editor, 'kept');
    act(() => {
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    flushFrames();
    expect(labelEditor(id)).toBeNull();
    expect(getShapeLabel(doc, id)?.toString()).toBe('kept');
    expect(selectionIds()).toEqual([id]);
  });
});

describe('shape.ui — colouring a shape', () => {
  it('TC-17: the fill and outline swatches change only the colour', () => {
    const doc = renderStory10();
    const id = seedShape(doc, 'rect', { x: 0, y: 0, width: 200, height: 120 });
    act(() => {
      getShapeLabel(doc, id)?.insert(0, 'unchanged');
    });
    flushFrames();
    // Select it the way a person does: a click.
    const at = toScreen(centre(boxOf(doc, id)));
    firePointer(objectEl(id), 'pointerdown', at.x, at.y);
    firePointer(objectEl(id), 'pointerup', at.x, at.y);
    flushFrames();

    const toolbar = screen.getByTestId('shape-toolbar');
    expect(toolbar).not.toBeNull();
    expect(screen.getByRole('button', { name: 'blue fill' }).getAttribute('aria-pressed')).toBe('false');

    const before = boxOf(doc, id);
    act(() => {
      screen.getByRole('button', { name: 'blue fill' }).click();
    });
    flushFrames();
    act(() => {
      screen.getByRole('button', { name: 'red outline' }).click();
    });
    flushFrames();

    const shape = shapesOf(doc).find((entry) => entry.id === id)!;
    expect(shape.fill).toBe('blue');
    expect(shape.stroke).toBe('red');
    // Label, size, position and selection are exactly as they were (PRD shape.style).
    expect(shape.label).toBe('unchanged');
    expect(boxOf(doc, id)).toEqual(before);
    expect(selectionIds()).toEqual([id]);
    expect(screen.getByRole('button', { name: 'blue fill' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-17b: "no fill" is a colour too, and the pressed swatch is the shape’s own', () => {
    const doc = renderStory10();
    const id = seedShape(doc, 'diamond', { x: 0, y: 0, width: 200, height: 200 });
    const at = toScreen(centre(boxOf(doc, id)));
    firePointer(objectEl(id), 'pointerdown', at.x, at.y);
    firePointer(objectEl(id), 'pointerup', at.x, at.y);
    flushFrames();

    expect(screen.getByRole('button', { name: 'white fill' }).getAttribute('aria-pressed')).toBe('true');
    act(() => {
      screen.getByRole('button', { name: 'none fill' }).click();
    });
    flushFrames();
    expect(shapesOf(doc)[0]).toMatchObject({ fill: 'none', stroke: 'dark' });
    // A minimum-sized shape is still selectable and colourable.
    const small = seedShape(doc, 'rect', {
      x: 0,
      y: 0,
      width: SHAPE_MIN_SIZE_WORLD,
      height: SHAPE_MIN_SIZE_WORLD,
    });
    expect(boxOf(doc, small)).toMatchObject({ width: SHAPE_MIN_SIZE_WORLD });
  });
});
