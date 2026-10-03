// shape.ui component tests (story 10, TC-15, TC-16, TC-17, TC-28).
//
// These drive the real board with the real pointer: the Shape tool is held with S, the
// gesture is a press on the tool's own layer plus moves and a release on the window, and
// the claim is always about what ends up in the shared document and on screen — not about
// any internal state of the tool. The layer is what a person's pointer is on while the tool
// is held (it covers the board), which is why the tests press it rather than the surface
// underneath: pressing the surface would be testing the Select tool.
//
// Where a number matters it is computed from the live camera rather than guessed, because
// the board starts with world 0,0 in the middle of the window and a test that hardcoded
// that would be a test of the viewport size.

import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { screenToWorld } from '../../src/client/canvas/camera';
import { getObjectType } from '../../src/client/objects/registry';
import { objectSnapshots } from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import type { ShapeSnap } from '../../src/shared/objects/shape';
import {
  CONNECTOR_MIN_LENGTH_WORLD,
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import {
  boardDoc,
  createNote,
  doubleClick,
  editorEl,
  noteBounds,
  objectEl,
  readCamera,
  renderBoard,
  selectedObjectIds,
  clickObject,
  toolClick,
  toolDrag,
  toolLayer,
  typeIntoEditor,
  windowKey,
} from './helpers';

/** Every shape on the board, newest last. */
function shapes(): ShapeSnap[] {
  return objectSnapshots(boardDoc()).filter(
    (o): o is ShapeSnap => o.type === 'shape',
  );
}

/** A shape by id, or a failure that says which id is missing. */
function shape(id: string): ShapeSnap {
  const found = shapes().find((o) => o.id === id);
  if (!found) throw new Error(`shape ${id} is not on the board`);
  return found;
}

/** The world point a screen point falls on, as the board itself computes it. */
function world(x: number, y: number) {
  return screenToWorld(readCamera(), { x, y });
}

/** Which tool the rail says is held. */
function heldTool(): string {
  for (const [name, el] of [
    ['select', screen.getByRole('button', { name: 'Select (V)' })],
    ['text', screen.getByRole('button', { name: 'Text (T)' })],
    ['shape', screen.getByRole('button', { name: 'Shape (S)' })],
    ['connector', screen.getByRole('button', { name: 'Connector (L)' })],
  ] as const) {
    if (el.getAttribute('aria-pressed') === 'true') return name;
  }
  return 'none';
}

/** Draw a shape through the model and let the board render it. */
function drawShape(x: number, y: number, kind?: 'rect' | 'ellipse' | 'diamond'): string {
  let id: string | null = null;
  act(() => {
    id = createShape(boardDoc(), { at: { x, y }, kind }, 'local-tab');
  });
  if (id === null) throw new Error('the model refused to create it');
  return id;
}

describe('shape.ui tool', () => {
  // TC-15: press, move, release with the Shape tool held. A preview is drawn while the
  // pointer is in the air, exactly one shape is written when it lands, that shape is what
  // is selected, and the board is back on Select — so the next press moves the shape that
  // was just drawn rather than starting a second one.
  it('TC-15 drags a box and gets one shape of that box, selected, with Select held again', () => {
    renderBoard();
    windowKey('s');
    expect(heldTool()).toBe('shape');
    const layer = toolLayer('shape-tool-layer');

    press(layer, 100, 100);
    pointerAt(window, 'pointermove', 200, 160);
    // The preview is on screen while the drag is in the air...
    expect(screen.getByTestId('shape-preview')).toBeTruthy();
    // ...and it is the shape, not a box: the kind the menu says.
    expect(screen.getByTestId('shape-preview').getAttribute('data-shape-kind')).toBe('rect');
    pointerAt(window, 'pointermove', 300, 220);
    pointerAt(window, 'pointerup', 300, 220);

    const created = shapes();
    expect(created).toHaveLength(1);
    const from = world(100, 100);
    const to = world(300, 220);
    expect(created[0].x).toBeCloseTo(from.x, 6);
    expect(created[0].y).toBeCloseTo(from.y, 6);
    expect(created[0].width).toBeCloseTo(to.x - from.x, 6);
    expect(created[0].height).toBeCloseTo(to.y - from.y, 6);
    expect(created[0].kind).toBe('rect');

    // Nothing is left of the preview, and the new shape is the selection.
    expect(screen.queryByTestId('shape-preview')).toBeNull();
    expect(selectedObjectIds()).toEqual([created[0].id]);
    expect(heldTool()).toBe('select');
  });

  // The same gesture with Shift held is a square (shape.square), and the square is the
  // longer side of what was dragged — Shift narrows a guess, it does not grow one.
  it('TC-15b Shift makes the shape a square on the longer side', () => {
    renderBoard();
    windowKey('s');
    const layer = toolLayer('shape-tool-layer');
    toolDrag(layer, [100, 100], [300, 220], { shift: true });

    const created = shapes();
    expect(created).toHaveLength(1);
    expect(created[0].width).toBeCloseTo(created[0].height, 6);
    expect(created[0].width).toBeCloseTo(world(300, 220).x - world(100, 100).x, 6);
  });

  // A drag smaller than the model's minimum, and a click, both draw a shape of the default
  // size with its centre where the pointer went down (shape.create_click) — a hand cannot
  // drag a box to a pixel, and the tool does not ask it to.
  it('TC-15c a click draws the default size centred on the point; a 10px drag counts as a click', () => {
    renderBoard();
    windowKey('s');
    const layer = toolLayer('shape-tool-layer');
    toolClick(layer, [400, 300]);
    expect(shapes()).toHaveLength(1);
    const click = shapes()[0];
    const at = world(400, 300);
    expect(click.x).toBeCloseTo(at.x - SHAPE_DEFAULT_SIZE_WORLD / 2, 6);
    expect(click.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(click.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);

    // The tool was put down when the shape was drawn (tools.return_to_select), so holding
    // it again is part of drawing a second one.
    windowKey('s');
    // A drag of 10 screen px is smaller than SHAPE_MIN_SIZE_WORLD: still a click.
    toolDrag(layer, [100, 500], [110, 510]);
    expect(shapes()).toHaveLength(2);
    expect(shapes()[1].width).toBe(SHAPE_DEFAULT_SIZE_WORLD);

    // And a drag of exactly the minimum is kept as drawn: that is the boundary.
    windowKey('s');
    const from = world(600, 500);
    toolDrag(
      toolLayer('shape-tool-layer'),
      [600, 500],
      [600 + SHAPE_MIN_SIZE_WORLD, 500 + SHAPE_MIN_SIZE_WORLD],
    );
    expect(shapes()[2].width).toBeCloseTo(SHAPE_MIN_SIZE_WORLD, 6);
    expect(shapes()[2].x).toBeCloseTo(from.x, 6);
  });

  // A pointer that is cancelled creates nothing at all (shape.behind, the negative case):
  // a gesture that never finished is not a request to draw.
  it('TC-15d a cancelled drag leaves nothing behind', () => {
    renderBoard();
    windowKey('s');
    toolDrag(toolLayer('shape-tool-layer'), [100, 100], [300, 220], { end: 'cancel' });
    expect(shapes()).toHaveLength(0);
    expect(screen.queryByTestId('shape-preview')).toBeNull();
  });

  // TC-16: a shape's label is edited in place with the story 2 editor, and the budget is
  // the shape's own. Six hundred characters offered to a 500 character field leaves 500
  // (boundary) — the limit is applied by the model on the way in and on the way out, so a
  // peer that writes more cannot make a label longer than the budget either.
  it('TC-16 opens the label editor on double-click and keeps the label inside its budget', () => {
    renderBoard();
    const id = drawShape(0, 0);
    doubleClick(objectEl(id));

    const editor = editorEl();
    expect(editor).toBeTruthy();
    const long = 'x'.repeat(SHAPE_LABEL_MAX_CHARS + 100);
    typeIntoEditor(long);

    expect(shape(id).label).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    // Editing a label is not a tool gesture: the tool was never left and the shape stays
    // selected while its words change.
    expect(selectedObjectIds()).toEqual([id]);

    // Escape leaves the editor and the shape is still there with its words.
    act(() => {
      fireEvent.keyDown(editor, { key: 'Escape' });
    });
    expect(shape(id).label).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    expect(screen.queryByTestId('text-editor')).toBeNull();
  });

  // TC-17: the shape's own toolbar paints it. Two clicks, two colours, and nothing else
  // about the shape changes — not its words, not the selection, not its size.
  it('TC-17 paints the fill and the outline from the shape toolbar and changes nothing else', () => {
    renderBoard();
    const id = drawShape(0, 0);
    const before = shape(id);
    // The shape is the only thing selected, which is when a shape shows its own toolbar.
    clickObject(id);
    expect(screen.getByTestId('shape-toolbar')).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Blue fill' }));
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Red outline' }));
    });

    const after = shape(id);
    expect(after.fill).toBe('blue');
    expect(after.stroke).toBe('red');
    expect(after.label).toBe(before.label);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(selectedObjectIds()).toEqual([id]);

    // The swatch that is on shows as pressed, so the colour a shape has is visible.
    expect(screen.getByRole('button', { name: 'Blue fill' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'White fill' }).getAttribute('aria-pressed')).toBe(
      'false',
    );

    // The colours are what the board drew too, not only what it stored.
    const paint = screen.getByTestId(`shape-paint-${id}`);
    expect(paint.getAttribute('fill')).not.toBe('none');
    expect(after.kind).toBe('rect');
  });

  // 'no fill' is one of the seven, and it means transparent: the board behind a shape shows
  // through it (shape.style).
  it('TC-17b no fill makes the shape see-through', () => {
    renderBoard();
    const id = drawShape(0, 0);
    clickObject(id);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'no fill' }));
    });
    expect(shape(id).fill).toBe('none');
    expect(screen.getByTestId(`shape-paint-${id}`).getAttribute('fill')).toBe('none');
  });

  // TC-28: a Shape drag that starts on top of something that is already there draws a
  // shape over it and does not so much as nudge the thing underneath. The tool owns the
  // press, so the object below never hears about it (shape.behind).
  it('TC-28 drags over an existing sticky note without moving it', () => {
    renderBoard();
    const note = createNote(100, 100);
    const before = noteBounds(note);

    windowKey('s');
    toolDrag(toolLayer('shape-tool-layer'), [120, 120], [360, 300]);

    expect(noteBounds(note)).toEqual(before);
    expect(shapes()).toHaveLength(1);
    // The new shape is what is selected, not the note it was drawn over.
    expect(selectedObjectIds()).toEqual([shapes()[0].id]);
  });

  // With the tool held, a press that lands on an object that is already there selects it
  // instead of drawing — the same rule the Text tool follows, and the reason the tool layer
  // has to answer "what is under this point" out of the document.
  it('TC-15e pressing an existing object while the tool is held selects it and draws nothing', () => {
    renderBoard();
    const note = createNote(100, 100);
    windowKey('s');
    // The note is at world 100,100: press the screen point that is over it.
    const cam = readCamera();
    const screenPoint: [number, number] = [100 - cam.x + 10, 100 - cam.y + 10];
    toolClick(toolLayer('shape-tool-layer'), screenPoint);
    expect(shapes()).toHaveLength(0);
    expect(selectedObjectIds()).toEqual([note]);
    expect(heldTool()).toBe('shape');
  });

  // The geometry the shape's hit-test and the board's resize rules share: a shape is a
  // rectangle for the purposes of stories 7 and 8, whatever it is drawn as.
  it('TC-15f a shape is a resizable object with a rectangular hit area', () => {
    const spec = getObjectType('shape');
    if (!spec) throw new Error('shape is not registered');
    expect(spec.resizable).toBe(true);
    expect(spec.editableText).toBe(true);
    expect(spec.minSize).toBe(SHAPE_MIN_SIZE_WORLD);

    const id = drawShape(0, 0, 'ellipse');
    const box = shape(id);
    const inside = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    expect(spec.hitTest(box, inside)).toBe(true);
    expect(spec.hitTest(box, { x: box.x + box.width + CONNECTOR_MIN_LENGTH_WORLD, y: box.y })).toBe(
      false,
    );
  });

  // An arrow is not resizable and has no label, which is why its minimum is its length
  // rather than a side.
  it('TC-15g a connector is not resizable and has no editable text', () => {
    const spec = getObjectType('connector');
    if (!spec) throw new Error('connector is not registered');
    expect(spec.resizable).toBe(false);
    expect(spec.editableText).toBe(false);
  });
});

/** Press the left button on an element at a screen point. */
function press(el: Element, x: number, y: number): void {
  pointerAt(el, 'pointerdown', x, y);
}

/** Fire a pointer event at a screen point, with the board rendering afterwards. */
function pointerAt(el: Element | Window, type: string, x: number, y: number): void {
  act(() => {
    fireEvent(
      el as Element,
      new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }),
    );
  });
}
