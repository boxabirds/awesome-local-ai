/**
 * Story 10 component tests — shape.ui (TC-15, TC-16, TC-17) and the
 * tool-owns-the-gesture negative (TC-28), plus the shape colour toolbar
 * (shape.style) in the real board.
 *
 * jsdom assumptions (as in the other component tests): a 1024x768 window,
 * the initial camera is resetCamera(viewport), so world (0,0) sits at screen
 * (512,384) and world = screen - (512,384) at zoom 1.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { App } from 'src/client/App';
import { boardReady } from './ready';
import { allObjects } from 'src/shared/board-model';
import { getShapeLabel, getShapeStyle } from 'src/shared/objects/shape';
import { SHAPE_LABEL_MAX_CHARS, STICKY_SIZE_WORLD } from 'src/shared/config';

function getDoc(): Y.Doc {
  const w = window as unknown as { __vidi6: { doc: Y.Doc } };
  return w.__vidi6.doc;
}

function selectButton(): HTMLElement {
  return screen.getByTestId('select-tool-button');
}
function shapeButton(): HTMLElement {
  return screen.getByTestId('shape-tool-button');
}
function toolLayer(): HTMLElement {
  return screen.getByTestId('shape-tool-layer');
}

describe('shape.ui (component)', () => {
  beforeEach(async () => {
    render(<App />);
    await boardReady();
  });

  it('TC-15: S tool drag shows the preview, creates exactly one shape, and selects it (return to Select)', async () => {
    const doc = getDoc();

    // S activates the Shape tool; the full-viewport tool layer appears.
    const user = userEvent.setup();
    await user.keyboard('s');
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'true');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'false');

    // Drag screen (612,434) → (812,554): world (100,50) → (300,170),
    // i.e. a 200x120 rect at (100,50).
    const layer = toolLayer();
    fireEvent.pointerDown(layer, { button: 0, clientX: 612, clientY: 434 });
    fireEvent.pointerMove(layer, { clientX: 712, clientY: 494 });
    // The screen-space preview is visible while dragging.
    expect(screen.getByTestId('shape-preview')).toBeTruthy();
    fireEvent.pointerUp(layer, { button: 0, clientX: 812, clientY: 554 });

    // Exactly one object, with the dragged size and position.
    const objects = allObjects(doc);
    expect(objects).toHaveLength(1);
    const [shape] = objects;
    expect(shape.type).toBe('shape');
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(50);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(120);

    // The new shape is selected and the tool returned to Select.
    const el = screen.getByTestId('shape-object');
    expect(el).toHaveAttribute('data-selected');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it('TC-16: double-click opens the label editor; 600 typed characters clamp to SHAPE_LABEL_MAX_CHARS', async () => {
    const doc = getDoc();

    // Create a shape by drag (world (100,50), 200x120).
    const user = userEvent.setup();
    await user.keyboard('s');
    const layer = toolLayer();
    fireEvent.pointerDown(layer, { button: 0, clientX: 612, clientY: 434 });
    fireEvent.pointerUp(layer, { button: 0, clientX: 812, clientY: 554 });
    const [shape] = allObjects(doc);

    // Double-click the shape → the label editor opens.
    fireEvent.doubleClick(screen.getByTestId('shape-object'));
    const textarea = await screen.findByTestId('shape-label-textarea');
    expect(textarea).toHaveFocus();

    // Type 600 characters: the editor clamps at SHAPE_LABEL_MAX_CHARS (500).
    fireEvent.input(textarea, { target: { value: 'a'.repeat(600) } });

    const label = getShapeLabel(doc, shape.id)!;
    expect(label.toString()).toHaveLength(SHAPE_LABEL_MAX_CHARS);
  });

  it('TC-17: fill and outline swatches recolor the selected shape; label and selection are unchanged', async () => {
    const doc = getDoc();

    // Create and select a shape by drag.
    const user = userEvent.setup();
    await user.keyboard('s');
    const layer = toolLayer();
    fireEvent.pointerDown(layer, { button: 0, clientX: 612, clientY: 434 });
    fireEvent.pointerUp(layer, { button: 0, clientX: 812, clientY: 554 });
    const [shape] = allObjects(doc);

    // A single selected shape shows the colour toolbar.
    const toolbar = screen.getByTestId('shape-toolbar');

    // Click the blue fill and red outline swatches.
    fireEvent.click(screen.getByLabelText('blue fill'));
    fireEvent.click(screen.getByLabelText('red outline'));

    // Colours applied; exactly the style keys changed.
    const style = getShapeStyle(doc, shape.id)!;
    expect(style.fill).toBe('blue');
    expect(style.stroke).toBe('red');
    const after = allObjects(doc).find((o) => o.id === shape.id)!;
    expect(after.x).toBe(shape.x);
    expect(after.y).toBe(shape.y);
    expect(after.width).toBe(shape.width);
    expect(after.height).toBe(shape.height);

    // Label unchanged (empty) and the shape is still selected.
    expect(getShapeLabel(doc, shape.id)!.toString()).toBe('');
    expect(screen.getByTestId('shape-object')).toHaveAttribute('data-selected');
    expect(toolbar).toBeTruthy();
  });

  it('TC-28: a Shape-tool drag starting over an existing sticky creates a shape and never moves the sticky (negative)', async () => {
    const doc = getDoc();

    // N creates a sticky centred on world (0,0) and opens its editor: it
    // spans [-100,100]².
    const user = userEvent.setup();
    await user.keyboard('n');
    // End editing (otherwise keystrokes go into the note's textarea, not the
    // board keyboard).
    fireEvent.keyDown(screen.getByTestId('sticky-note-textarea'), { key: 'Escape' });
    const [note] = allObjects(doc);
    expect(note.type).toBe('sticky');
    expect(note.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(note.y).toBe(-STICKY_SIZE_WORLD / 2);
    const noteX = note.x;
    const noteY = note.y;

    // Shape tool: drag from the sticky's centre (screen 512,384 = world 0,0)
    // to world (100,80) (screen 612,464).
    await user.keyboard('s');
    const layer = toolLayer();
    fireEvent.pointerDown(layer, { button: 0, clientX: 512, clientY: 384 });
    fireEvent.pointerMove(layer, { clientX: 562, clientY: 424 });
    fireEvent.pointerUp(layer, { button: 0, clientX: 612, clientY: 464 });

    // A shape was created ...
    const objects = allObjects(doc);
    const created = objects.filter((o) => o.type === 'shape');
    expect(created).toHaveLength(1);
    expect(created[0].x).toBe(0);
    expect(created[0].y).toBe(0);
    expect(created[0].width).toBe(100);
    expect(created[0].height).toBe(80);
    // ... and the sticky did not move (the tool owns the gesture).
    const stickyAfter = objects.find((o) => o.id === note.id)!;
    expect(stickyAfter.x).toBe(noteX);
    expect(stickyAfter.y).toBe(noteY);
  });

  it('a click (no drag) with the Shape tool creates the default 160x160 shape centred on the point', async () => {
    const doc = getDoc();
    const user = userEvent.setup();
    await user.keyboard('s');
    const layer = toolLayer();
    // Click at screen (612,434) = world (100,50).
    fireEvent.pointerDown(layer, { button: 0, clientX: 612, clientY: 434 });
    fireEvent.pointerUp(layer, { button: 0, clientX: 612, clientY: 434 });

    const [shape] = allObjects(doc);
    expect(shape.type).toBe('shape');
    expect(shape.width).toBe(160);
    expect(shape.height).toBe(160);
    expect(shape.x).toBe(100 - 80);
    expect(shape.y).toBe(50 - 80);
  });

  it('Shift squares the drag: 200x120 becomes 200x200 anchored at the drag origin', async () => {
    const doc = getDoc();
    const user = userEvent.setup();
    await user.keyboard('s');
    const layer = toolLayer();
    fireEvent.pointerDown(layer, { button: 0, clientX: 612, clientY: 434 });
    // Shift held on the release.
    fireEvent.pointerUp(layer, { button: 0, clientX: 812, clientY: 554, shiftKey: true });

    const [shape] = allObjects(doc);
    expect(shape.width).toBe(200);
    expect(shape.height).toBe(200);
    expect(shape.x).toBe(100);
    expect(shape.y).toBe(50);
  });

  it('Escape with the Shape tool returns to Select and creates nothing (negative)', async () => {
    const doc = getDoc();
    const user = userEvent.setup();
    await user.keyboard('s');
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'false');
    expect(allObjects(doc)).toHaveLength(0);
  });
});
