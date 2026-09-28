// Story 10, shape.ui (component): a shape is drawn by dragging on the board with
// the Shape tool open, labelled by double-clicking it, and recoloured from its own
// toolbar - all of it in the REAL board, through the real tool overlay, the real
// registry and the real selection bar, so what is asserted is what a person gets.
//
// The camera is the one the board opened with (jsdom gives the viewport no layout
// size, so the world-to-screen arithmetic here is done with the harness's
// toScreen/toWorld, which read the live camera off the world layer).
//
// TC-15 to TC-17 and TC-28 of the design. TC-28 is the one that matters most to a
// reviewer: the tool owns the pointer, so a drag that starts on somebody's shape
// draws a new shape THERE rather than moving that one.
import { describe, it, expect } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import type * as Y from 'yjs';
import { renderBoard7, seedSticky, settle } from './story7TestUtils.tsx';
import { objectsSnapshot } from '../../src/shared/board-model.ts';
import { createShape, getShapeLabel, setShapeStyle } from '../../src/shared/objects/shape.ts';
import type { ShapeSnapshot } from '../../src/shared/objects/shape.ts';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
  type ShapeKind,
} from '../../src/shared/config.ts';

const pressed = (el: HTMLElement): boolean => el.getAttribute('aria-pressed') === 'true';
const shapeButton = (): HTMLElement => screen.getByTestId('tool-shape');
const selectButton = (): HTMLElement => screen.getByTestId('tool-select');
const overlay = (): HTMLElement => screen.getByTestId('shape-tool');
const preview = (): HTMLElement => screen.getByTestId('shape-preview');

// Screen point of a WORLD point, spread into pointer event options.
function pos(h: ReturnType<typeof renderBoard7>, x: number, y: number): { clientX: number; clientY: number } {
  const p = h.toScreen({ x, y });
  return { clientX: p.x, clientY: p.y };
}

interface ShapeSeed {
  x: number;
  y: number;
  width?: number;
  height?: number;
  kind?: ShapeKind;
  fill?: string;
  stroke?: string;
  label?: string;
}

// Shapes are seeded through the model, in one act() turn, exactly as the board
// would have made them: the test is about the tool and the object, not about how
// the object got into the document.
function seedShape(doc: Y.Doc, seed: ShapeSeed): string {
  let id = '';
  act(() => {
    id = createShape(
      doc,
      {
        kind: seed.kind ?? 'rect',
        rect: { x: seed.x, y: seed.y, width: seed.width ?? 200, height: seed.height ?? 120 },
        at: { x: 0, y: 0 },
        square: false,
      },
      'tester',
    )!;
    if (seed.fill !== undefined || seed.stroke !== undefined) {
      setShapeStyle(doc, id, { fill: seed.fill as never, stroke: seed.stroke as never });
    }
    if (seed.label !== undefined) getShapeLabel(doc, id)?.insert(0, seed.label);
  });
  return id;
}

function shapeOf(doc: Y.Doc, id: string): ShapeSnapshot {
  const obj = objectsSnapshot(doc).find((o) => o.id === id);
  if (!obj) throw new Error(`shape ${id} is not on the board`);
  return obj as ShapeSnapshot;
}

function pressMoveRelease(from: { x: number; y: number }, to: { x: number; y: number }, opts: { shiftKey?: boolean; steps?: number; pointerId?: number } = {}): void {
  const el = overlay();
  fireEvent.pointerDown(el, { clientX: from.x, clientY: from.y, button: 0, pointerId: 21, bubbles: true, cancelable: true });
  const steps = opts.steps ?? 3;
  for (let i = 1; i <= steps; i++) {
    fireEvent.pointerMove(el, {
      clientX: from.x + ((to.x - from.x) * i) / steps,
      clientY: from.y + ((to.y - from.y) * i) / steps,
      button: 0,
      pointerId: 21,
      shiftKey: opts.shiftKey === true,
      bubbles: true,
      cancelable: true,
    });
  }
  fireEvent.pointerUp(el, {
    clientX: to.x,
    clientY: to.y,
    button: 0,
    pointerId: 21,
    shiftKey: opts.shiftKey === true,
    bubbles: true,
    cancelable: true,
  });
}

describe('shape.ui (component)', () => {
  // TC-15: the drag is shown while it happens and creates exactly one shape on
  // release, which is selected and hands the tool back to Select.
  it('TC-15 drags a shape into being, shows a dashed preview, creates it once and selects it', async () => {
    const h = renderBoard7();
    h.key('s');
    expect(pressed(shapeButton())).toBe(true);
    expect(pressed(selectButton())).toBe(false);

    const before = new Set(objectsSnapshot(h.doc()).map((o) => o.id));
    const from = { x: 100, y: 100 };
    const to = { x: 300, y: 220 };

    fireEvent.pointerDown(overlay(), { clientX: from.x, clientY: from.y, button: 0, pointerId: 21, bubbles: true, cancelable: true });
    // The outline follows the pointer: it exists while the press is held, in the
    // tool's own layer, and is dashed because it is not yet a shape.
    expect(preview().style.border).toContain('dashed');
    fireEvent.pointerMove(overlay(), { clientX: 200, clientY: 160, button: 0, pointerId: 21, bubbles: true, cancelable: true });
    fireEvent.pointerMove(overlay(), { clientX: to.x, clientY: to.y, button: 0, pointerId: 21, bubbles: true, cancelable: true });
    const box = preview();
    expect(Number(box.getAttribute('data-world-width'))).toBeCloseTo(200, 3);
    expect(Number(box.getAttribute('data-world-height'))).toBeCloseTo(120, 3);
    fireEvent.pointerUp(overlay(), { clientX: to.x, clientY: to.y, button: 0, pointerId: 21, bubbles: true, cancelable: true });
    await settle();

    const created = objectsSnapshot(h.doc()).filter((o) => !before.has(o.id));
    expect(created).toHaveLength(1); // one shape, not one per frame
    const shape = created[0] as ShapeSnapshot;
    expect(shape.type).toBe('shape');
    expect(shape.kind).toBe('rect');
    expect(shape.fill).toBe('white');
    expect(shape.stroke).toBe('dark');
    expect(shape.label).toBe('');
    expect(shape.width).toBeCloseTo(200, 3);
    expect(shape.height).toBeCloseTo(120, 3);
    expect(shape.x).toBeCloseTo(h.toWorld(from).x, 3);
    expect(shape.y).toBeCloseTo(h.toWorld(from).y, 3);

    // It is selected, and the tool is Select again (tools.return_to_select).
    expect(h.selectedIds()).toEqual([shape.id]);
    expect(pressed(shapeButton())).toBe(false);
    expect(pressed(selectButton())).toBe(true);
    // The preview is gone with the gesture that drew it.
    expect(screen.queryByTestId('shape-preview')).toBeNull();
  });

  // Shift during the drag squares the area before the model ever sees it.
  it('a drag held with Shift becomes a square', async () => {
    const h = renderBoard7();
    h.key('s');
    const before = new Set(objectsSnapshot(h.doc()).map((o) => o.id));
    pressMoveRelease(h.toScreen({ x: 0, y: 0 }), h.toScreen({ x: 200, y: 120 }), { shiftKey: true });
    await settle();

    const shape = objectsSnapshot(h.doc()).find((o) => !before.has(o.id)) as ShapeSnapshot;
    expect(shape.width).toBeCloseTo(200, 3);
    expect(shape.height).toBeCloseTo(200, 3);
  });

  // A drag too small to be a shape is a click, and a click lands the standard
  // size centred on the point that was pressed (shape.create_click).
  it('a tiny drag is a click and lands the standard size centred on the press', async () => {
    const h = renderBoard7();
    h.key('s');
    const before = new Set(objectsSnapshot(h.doc()).map((o) => o.id));
    const at = h.toScreen({ x: 500, y: 400 });
    pressMoveRelease(at, { x: at.x + 4, y: at.y + 4 });
    await settle();

    const shape = objectsSnapshot(h.doc()).find((o) => !before.has(o.id)) as ShapeSnapshot;
    expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape.x + (shape.width ?? 0) / 2).toBeCloseTo(500, 3);
    expect(shape.y + (shape.height ?? 0) / 2).toBeCloseTo(400, 3);
  });

  // TC-16: the label is written through the shared editor and the model's limit
  // is the limit of what the shape keeps.
  it('TC-16 opens the label editor on a double-click and stops accepting at 500 characters', async () => {
    const h = renderBoard7();
    const id = seedShape(h.doc(), { x: 40, y: 40 });

    fireEvent.doubleClick(h.object(id)!);
    await settle();

    const editor = screen.getByTestId('shape-editor') as HTMLTextAreaElement;
    expect(h.object(id)!.getAttribute('data-editing')).toBe('true');
    expect(h.object(id)!.getAttribute('data-selected')).toBe('true');

    editor.value = 'x'.repeat(600);
    fireEvent.input(editor);
    await settle();

    expect(shapeOf(h.doc(), id).label).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    expect(editor.value).toHaveLength(SHAPE_LABEL_MAX_CHARS);

    // Escape from the label keeps the words and leaves the shape selected.
    fireEvent.keyDown(editor, { key: 'Escape', bubbles: true, cancelable: true });
    await settle();
    expect(screen.queryByTestId('shape-editor')).toBeNull();
    expect(shapeOf(h.doc(), id).label).toHaveLength(SHAPE_LABEL_MAX_CHARS);
    expect(h.selectedIds()).toEqual([id]);
  });

  // An empty label is a shape with nothing written in it, and a shape whose label
  // was typed into and then left alone still exists: a shape is never thrown away
  // for being blank (unlike a text, which removes itself).
  it('keeps a shape whose label was opened and left empty', async () => {
    const h = renderBoard7();
    const id = seedShape(h.doc(), { x: 40, y: 40 });

    fireEvent.doubleClick(h.object(id)!);
    await settle();
    const editor = screen.getByTestId('shape-editor');
    fireEvent.keyDown(editor, { key: 'Escape', bubbles: true, cancelable: true });
    await settle();

    // The shape is still on the board, still selected, still blank.
    expect(shapeOf(h.doc(), id).label).toBe('');
    expect(objectsSnapshot(h.doc()).some((o) => o.id === id)).toBe(true);
    expect(h.selectedIds()).toEqual([id]);
  });

  // TC-17: a swatch paints the shape and touches nothing else about it; one click
  // is one undo step of its own.
  it('TC-17 paints the selected shape from its toolbar and leaves the rest alone', async () => {
    const h = renderBoard7();
    const id = seedShape(h.doc(), { x: 40, y: 40, label: 'Checkout' });
    const before = shapeOf(h.doc(), id);

    fireEvent.pointerDown(h.object(id)!, { ...pos(h, 140, 100), button: 0, pointerId: 22, bubbles: true, cancelable: true });
    await settle();
    expect(screen.getByTestId('shape-toolbar')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('blue fill'));
    fireEvent.click(screen.getByLabelText('red outline'));
    await settle();

    const after = shapeOf(h.doc(), id);
    expect(after.fill).toBe('blue');
    expect(after.stroke).toBe('red');
    // Nothing else about the shape moved, grew, rewrapped or deselected.
    expect(after.label).toBe(before.label);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(after.z).toBe(before.z);
    expect(h.selectedIds()).toEqual([id]);
    expect(h.object(id)!.getAttribute('data-fill')).toBe('blue');
    expect(h.object(id)!.getAttribute('data-stroke')).toBe('red');

    // One press of undo takes back the last swatch and only that one.
    h.key('z', { ctrlKey: true });
    await settle();
    const undone = shapeOf(h.doc(), id);
    expect(undone.stroke).toBe('dark');
    expect(undone.fill).toBe('blue');
  });

  // 'none' is a fill like any other: it paints nothing, and the shape is still
  // there, still hit-testable, still selected.
  it('offers no fill as a swatch and takes the paint off', async () => {
    const h = renderBoard7();
    const id = seedShape(h.doc(), { x: 40, y: 40, fill: 'blue' });
    fireEvent.pointerDown(h.object(id)!, { ...pos(h, 140, 100), button: 0, pointerId: 23, bubbles: true, cancelable: true });
    await settle();

    expect(screen.getByLabelText('none fill')).toBeTruthy();
    expect(screen.queryByLabelText('none outline')).toBeNull(); // six outlines, no 'none' among them
    fireEvent.click(screen.getByLabelText('none fill'));
    await settle();

    expect(shapeOf(h.doc(), id).fill).toBe('none');
    expect(h.selectedIds()).toEqual([id]);
  });

  // TC-28: the Shape tool is the board's surface - a drag that starts on an
  // existing object draws a NEW shape there and leaves that object, the camera and
  // the marquee exactly as they were.
  it('TC-28 drags across an existing shape and draws a new one instead of moving it', async () => {
    const h = renderBoard7();
    const note = seedSticky(h.doc(), { x: 0, y: 0 });
    const id = seedShape(h.doc(), { x: 40, y: 40, width: 300, height: 300 });
    const camBefore = h.cam();

    h.key('s');
    // The press lands in the middle of the shape - and on the shape's own element.
    const from = pos(h, 140, 140);
    const to = pos(h, 340, 260);
    fireEvent.pointerDown(overlay(), { ...from, button: 0, pointerId: 24, bubbles: true, cancelable: true });
    fireEvent.pointerMove(overlay(), { ...to, button: 0, pointerId: 24, bubbles: true, cancelable: true });
    fireEvent.pointerUp(overlay(), { ...to, button: 0, pointerId: 24, bubbles: true, cancelable: true });
    await settle();

    // Neither the shape nor the note under the drag moved a unit.
    expect(shapeOf(h.doc(), id)).toMatchObject({ x: 40, y: 40, width: 300, height: 300 });
    const sticky = objectsSnapshot(h.doc()).find((o) => o.id === note)!;
    expect(sticky.x).toBe(0);
    expect(sticky.y).toBe(0);
    // The camera never panned and no marquee was drawn.
    expect(h.cam()).toEqual(camBefore);
    expect(screen.queryByTestId('marquee')).toBeNull();
    // A second shape was drawn where the drag was.
    const drawn = objectsSnapshot(h.doc()).filter((o) => o.type === 'shape' && o.id !== id) as ShapeSnapshot[];
    expect(drawn).toHaveLength(1);
    expect(drawn[0].width).toBeCloseTo(200, 3);
    expect(drawn[0].height).toBeCloseTo(120, 3);
  });

  // The shape menu of the Shape button: three kinds, the chosen one checked, and
  // the choice is kept for the next shape.
  it('lets the Shape button menu choose the kind, and keeps the choice', async () => {
    const h = renderBoard7();
    h.key('s');
    await settle();

    const menu = screen.getByTestId('shape-kind-menu');
    expect(menu).toBeTruthy();
    expect(screen.getByTestId('shape-kind-rect').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('shape-kind-diamond').getAttribute('aria-checked')).toBe('false');

    fireEvent.click(screen.getByTestId('shape-kind-diamond'));
    await settle();
    // The menu answered and went away; the tool stayed on Shape.
    expect(screen.queryByTestId('shape-kind-menu')).toBeNull();
    expect(pressed(shapeButton())).toBe(true);

    const before = new Set(objectsSnapshot(h.doc()).map((o) => o.id));
    pressMoveRelease(h.toScreen({ x: 0, y: 0 }), h.toScreen({ x: 100, y: 100 }));
    await settle();
    const shape = objectsSnapshot(h.doc()).find((o) => !before.has(o.id)) as ShapeSnapshot;
    expect(shape.kind).toBe('diamond');

    // And the kind is remembered: another shape is a diamond too.
    const second = new Set(objectsSnapshot(h.doc()).map((o) => o.id));
    h.key('s');
    pressMoveRelease(h.toScreen({ x: 400, y: 0 }), h.toScreen({ x: 500, y: 100 }));
    await settle();
    expect((objectsSnapshot(h.doc()).find((o) => !second.has(o.id)) as ShapeSnapshot).kind).toBe('diamond');
  });

  // The minimum is the minimum: an area exactly SHAPE_MIN_SIZE_WORLD across is a
  // shape, not a click.
  it('a drag of exactly the minimum size is kept', async () => {
    const h = renderBoard7();
    h.key('s');
    const before = new Set(objectsSnapshot(h.doc()).map((o) => o.id));
    const from = h.toScreen({ x: 600, y: 600 });
    const to = { x: from.x + SHAPE_MIN_SIZE_WORLD, y: from.y + SHAPE_MIN_SIZE_WORLD };
    pressMoveRelease(from, to, { steps: 2 });
    await settle();

    const shape = objectsSnapshot(h.doc()).find((o) => !before.has(o.id)) as ShapeSnapshot;
    expect(shape.width).toBeGreaterThanOrEqual(SHAPE_MIN_SIZE_WORLD - 0.001);
    expect(shape.height).toBeGreaterThanOrEqual(SHAPE_MIN_SIZE_WORLD - 0.001);
  });
});
