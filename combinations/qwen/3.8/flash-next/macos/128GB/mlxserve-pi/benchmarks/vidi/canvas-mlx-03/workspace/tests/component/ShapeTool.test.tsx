// Story 10, tasks.md task 14 — the Shape tool, the shape object and its toolbar
// (TC-15, TC-16, TC-17, TC-28), component.
//
// These run against the real `BoardApp` in jsdom with no server: the board is a `Y.Doc`
// loaded directly, exactly as `useBoardDoc` does when the `?board` test hook is present.
// jsdom reports every rectangle as zero-sized, so at the identity camera a screen point
// and the board point under it are the same numbers — which is what lets a test press at
// (100, 100) and expect a shape whose x is 100.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, screen, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import BoardApp from '../../src/client/board/BoardApp.tsx';
import { createUndo, type UndoController } from '../../src/client/board/undo.ts';
import { initDoc, objectSnapshots, createSticky } from '../../src/shared/board-model.ts';
import {
  createShape,
  getShapeLabel,
  shapeSnapshot,
  type ShapeKind,
} from '../../src/shared/objects/shape.ts';
import { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config.ts';

let doc: Y.Doc;
/** The board's undo history, injected so a test can count the steps a gesture made. */
let undo: UndoController;

beforeEach(() => {
  vi.useFakeTimers();
  doc = new Y.Doc();
  initDoc(doc);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * Mount the whole board. Fixtures are written *before* this: an object that existed
 * before the board was opened is not my change, so it is never in the undo history
 * (TC-16 and TC-17 count undo steps). `sticky: true` puts one note on it first (TC-28).
 */
function mount(opts: { sticky?: boolean } = {}) {
  if (opts.sticky) createSticky(doc, { x: 400, y: 300 });
  undo = createUndo(doc);
  render(<BoardApp doc={doc} undo={undo} />);
}

const viewport = () => screen.getByTestId('viewport') as HTMLElement;
const world = () => screen.getByTestId('world-layer') as HTMLElement;
const toolButton = (name: string) => screen.getByRole('button', { name }) as HTMLElement;
const pressed = (name: string) => toolButton(name).getAttribute('aria-pressed');

/** A pointer event carrying board coordinates; jsdom has no `PointerEvent`, so `MouseEvent`. */
function firePointer(target: EventTarget, type: string, x = 20, y = 20, shift = false) {
  act(() => {
    target.dispatchEvent(
      new MouseEvent(type, {
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
        button: 0,
        shiftKey: shift,
      }),
    );
  });
}
function fireKey(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}
/** Press, move, release. The drawing tools listen for move and release on `window`. */
function drag(from: [number, number], to: [number, number], opts: { on?: Element; shift?: boolean } = {}) {
  const start = opts.on ?? viewport();
  firePointer(start, 'pointerdown', from[0], from[1]);
  firePointer(window, 'pointermove', to[0], to[1], !!opts.shift);
  firePointer(window, 'pointerup', to[0], to[1]);
}
/**
 * A write straight through the model, as a fixture. React's `act` returns a thenable and
 * not the callback's value, so the value a write produced is captured on the way out.
 */
function write<T>(fn: () => T): T {
  let out!: T;
  act(() => {
    out = fn();
  });
  return out;
}

const shapeEls = () => [...world().querySelectorAll('[data-shape-id]')] as HTMLElement[];
const shapeEl = (id: string) => world().querySelector(`[data-shape-id="${id}"]`) as HTMLElement;
const shapes = () => objectSnapshots(doc).filter((o) => o.type === 'shape');
const rectOf = (o: { x?: number; y?: number; width?: number; height?: number }) => ({
  x: o.x,
  y: o.y,
  width: o.width,
  height: o.height,
});
/**
 * A shape written straight through the model. Called before `mount`, it needs no `act`;
 * React's `act` returns a thenable and not the callback's value, so a value written
 * after the board is mounted is captured on the way out with `write`.
 */
const mkShape = (kind: ShapeKind, x: number, y: number, w = 200, h = 200, by = 'me') =>
  createShape(doc, { kind, rect: { x, y, width: w, height: h }, at: { x, y } }, by)!;
/** A label written through the model while the board is mounted. */
const typeLabel = (id: string, text: string) => {
  write(() => {
    getShapeLabel(doc, id)!.insert(0, text);
  });
};
/** Select a shape by pressing and releasing on it. */
const selectShape = (id: string, x = 10, y = 10) => {
  firePointer(shapeEl(id), 'pointerdown', x, y);
  firePointer(window, 'pointerup', x, y);
};

describe('story 10 shape tool (TC-15)', () => {
  it('press, drag and release draw a rectangle of exactly the dragged box', () => {
    mount();
    fireKey('s');
    expect(pressed('Shape')).toBe('true');

    firePointer(viewport(), 'pointerdown', 100, 100);
    // The box being dragged is on screen the whole time, and it is the dragged box.
    firePointer(window, 'pointermove', 300, 220);
    const preview = screen.getByTestId('shape-preview');
    expect({
      x: Number(preview.getAttribute('x')),
      y: Number(preview.getAttribute('y')),
      width: Number(preview.getAttribute('width')),
      height: Number(preview.getAttribute('height')),
    }).toEqual({ x: 100, y: 100, width: 200, height: 120 });
    // Nothing has been written to the board yet: the write happens on release.
    expect(shapes().length).toBe(0);

    firePointer(window, 'pointerup', 300, 220);

    expect(shapes().length).toBe(1); // exactly one object, from exactly one write
    const shape = shapes()[0]!;
    expect(shape.kind).toBe('rect');
    expect(rectOf(shape)).toEqual({ x: 100, y: 100, width: 200, height: 120 });
    // The gesture handed the board back to Select, with the new shape selected.
    expect(pressed('Select')).toBe('true');
    expect(pressed('Shape')).toBe('false');
    expect(shapeEl(shape.id).getAttribute('data-selected')).toBe('true');
  });

  it('a click, with no drag at all, creates a rectangle of the default size', () => {
    mount();
    fireKey('s');
    drag([400, 400], [400, 400]);
    expect(shapes().length).toBe(1);
    // `createShape` centres the default size on the click point.
    expect(rectOf(shapes()[0]!)).toEqual({
      x: 400 - SHAPE_DEFAULT_SIZE_WORLD / 2,
      y: 400 - SHAPE_DEFAULT_SIZE_WORLD / 2,
      width: SHAPE_DEFAULT_SIZE_WORLD,
      height: SHAPE_DEFAULT_SIZE_WORLD,
    });
  });

  it('Shift keeps the dragged box square, re-read on every move', () => {
    mount();
    fireKey('s');
    firePointer(viewport(), 'pointerdown', 0, 0);
    firePointer(window, 'pointermove', 300, 100, true);
    let preview = screen.getByTestId('shape-preview');
    expect(preview.getAttribute('width')).toBe('300');
    expect(preview.getAttribute('height')).toBe('300');
    // Dropping Shift mid-drag goes back to the plain box: the flag is not latched.
    firePointer(window, 'pointermove', 300, 100, false);
    preview = screen.getByTestId('shape-preview');
    expect(preview.getAttribute('width')).toBe('300');
    expect(preview.getAttribute('height')).toBe('100');
    firePointer(window, 'pointerup', 300, 100);
    expect(rectOf(shapes()[0]!)).toEqual({ x: 0, y: 0, width: 300, height: 100 });
  });

  it('a released pointer that never moved creates one shape; a cancelled one creates none', () => {
    mount();
    fireKey('s');
    // Released exactly where it went down: the click path, one shape.
    firePointer(viewport(), 'pointerdown', 500, 500);
    firePointer(window, 'pointerup', 500, 500);
    expect(shapes().length).toBe(1);
    // A pointer that is cancelled creates nothing at all.
    firePointer(viewport(), 'pointerdown', 700, 700);
    firePointer(window, 'pointercancel', 700, 700);
    expect(shapes().length).toBe(1);
  });

  it('the Ellipse and Diamond kinds create their type, and the kind survives the gesture', () => {
    mount();
    fireKey('s');
    // The shape kind menu is offered while the Shape tool is armed.
    expect(screen.getByTestId('shape-kind-menu')).toBeTruthy();
    firePointer(screen.getByTestId('shape-kind-diamond'), 'click');
    drag([0, 0], [100, 100]);
    expect(shapes()[0]!.kind).toBe('diamond');
    // Back to Select, and arming the tool again still asks for a diamond.
    expect(pressed('Select')).toBe('true');
    fireKey('s');
    drag([200, 0], [300, 100]);
    expect(shapes()[1]!.kind).toBe('diamond');
    expect(shapes()[1]!.id).not.toBe(shapes()[0]!.id);
    expect(shapeEls().length).toBe(2);
  });

  it('a tiny drag is not swallowed: the minimum-size rule of the model applies', () => {
    mount();
    fireKey('s');
    // A 2 x 2 box is below the minimum, so the model makes it a default-size box around
    // the point instead of an invisible speck.
    drag([400, 400], [402, 402]);
    expect(shapes().length).toBe(1);
    expect(shapes()[0]!.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
  });
});

describe('story 10 shape object (TC-16)', () => {
  it('double-click opens the label editor, and a label past the limit is truncated', () => {
    const id = mkShape('rect', 0, 0);
    mount();
    firePointer(shapeEl(id), 'dblclick');
    const ta = screen.getByTestId('shape-label-editor') as HTMLTextAreaElement;
    // 600 characters typed into the editor; the stored label is the limit.
    act(() => {
      ta.value = 'x'.repeat(600);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(getShapeLabel(doc, id)!.toString().length).toBe(SHAPE_LABEL_MAX_CHARS);
    // Still one shape, and it is still the shape it was.
    expect(shapes().length).toBe(1);
    expect(shapeSnapshot(doc, id)!.label!.length).toBe(SHAPE_LABEL_MAX_CHARS);
  });

  it('the label is centred in the shape and belongs to the shape object', () => {
    const id = mkShape('ellipse', 100, 100, 200, 120);
    typeLabel(id, 'Approval');
    mount();
    // Not editing: no editor, but the label itself is rendered as text.
    expect(shapeEl(id).querySelector('[data-testid="shape-label-editor"]')).toBeNull();
    // The label box is centred on both axes inside the shape, and its text is centred.
    const box = shapeEl(id).querySelector('[data-testid="shape-label"]') as HTMLElement;
    expect(box.style.justifyContent).toBe('center');
    expect(box.style.alignItems).toBe('center');
    const text = shapeEl(id).querySelector('[data-testid="shape-label-text"]') as HTMLElement;
    expect(text.textContent).toBe('Approval');
    expect(text.style.textAlign).toBe('center');
    expect(shapeSnapshot(doc, id)!.label).toBe('Approval');
    // The label lives on the shape object: no second object was created for it.
    expect(objectSnapshots(doc).length).toBe(1);
  });

  it('emptying a label keeps the shape, and the edit is one step of undo', () => {
    const id = mkShape('rect', 0, 0, 200, 200);
    typeLabel(id, 'kept');
    mount();
    firePointer(shapeEl(id), 'dblclick');
    const ta = screen.getByTestId('shape-label-editor') as HTMLTextAreaElement;
    act(() => {
      ta.value = '';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // A text object deletes itself when emptied; a shape is not a label.
    expect(getShapeLabel(doc, id)!.toString()).toBe('');
    expect(shapes().length).toBe(1);
    expect(shapeEl(id)).toBeTruthy();
    // The edit and its end are one step: undo brings the word back, and there is
    // nothing older to undo — opening the board is not my change.
    expect(undo.canUndo()).toBe(true);
    act(() => {
      undo.undo();
    });
    expect(shapeSnapshot(doc, id)!.label).toBe('kept');
    expect(undo.canUndo()).toBe(false);
  });
});

describe('story 10 shape toolbar (TC-17)', () => {
  it('the fill and outline swatches apply to the selected shape and touch nothing else', () => {
    const other = mkShape('rect', 800, 0);
    const id = mkShape('rect', 0, 0);
    typeLabel(id, 'hello');
    mount();
    selectShape(id, 50, 50);
    expect(shapeEl(id).getAttribute('data-selected')).toBe('true');

    firePointer(screen.getByTestId('shape-fill-blue'), 'click');
    firePointer(screen.getByTestId('shape-stroke-red'), 'click');

    const after = shapeSnapshot(doc, id)!;
    expect(after.fill).toBe('blue');
    expect(after.stroke).toBe('red');
    // A style change is not a rename and not a move.
    expect(after.label).toBe('hello');
    expect(rectOf(after)).toEqual({ x: 0, y: 0, width: 200, height: 200 });
    // The other shape on the board was not styled: the swatches hit the selection.
    expect(shapeSnapshot(doc, other)!.fill).not.toBe('blue');
    // Still the one selected object.
    expect(shapeEl(id).getAttribute('data-selected')).toBe('true');
    expect(shapeEl(other).getAttribute('data-selected')).toBe('false');
    // Every configured colour is offered as a named control.
    expect(screen.getAllByTestId(/^shape-fill-/).length).toBeGreaterThanOrEqual(6);
    expect(screen.getAllByTestId(/^shape-stroke-/).length).toBeGreaterThanOrEqual(6);
  });

  it('the toolbar is shown for the selected shape only', () => {
    const id = mkShape('rect', 0, 0);
    mount();
    // Nothing selected: no swatches.
    expect(screen.queryByTestId('shape-fill-blue')).toBeNull();
    selectShape(id);
    expect(screen.getByTestId('shape-fill-blue')).toBeTruthy();
    // A click on empty board deselects: the swatches go away.
    firePointer(viewport(), 'pointerdown', 900, 900);
    firePointer(window, 'pointerup', 900, 900);
    expect(screen.queryByTestId('shape-fill-blue')).toBeNull();
  });

  it('a shape can be deleted with Delete and with the toolbar button', () => {
    const a = mkShape('rect', 0, 0);
    const b = mkShape('rect', 400, 0);
    mount();
    selectShape(a);
    fireKey('Delete');
    expect(world().querySelector(`[data-shape-id="${a}"]`)).toBeNull();
    expect(shapes().length).toBe(1);
    selectShape(b);
    firePointer(screen.getByTestId('shape-delete'), 'click');
    expect(shapes().length).toBe(0);
  });

  it('one undo step restores a shape deleted with the toolbar button', () => {
    const id = mkShape('rect', 0, 0, 200, 200);
    mount();
    selectShape(id);
    firePointer(screen.getByTestId('shape-delete'), 'click');
    expect(shapes().length).toBe(0);
    expect(undo.canUndo()).toBe(true);
    act(() => {
      undo.undo();
    });
    expect(shapes().length).toBe(1);
    expect(undo.canUndo()).toBe(false);
  });

  it('each swatch click is its own undo step', () => {
    const id = mkShape('rect', 0, 0, 200, 200);
    mount();
    selectShape(id);
    firePointer(screen.getByTestId('shape-fill-blue'), 'click');
    firePointer(screen.getByTestId('shape-stroke-red'), 'click');
    expect(shapeSnapshot(doc, id)!.stroke).toBe('red');
    // One undo takes the outline back and leaves the fill the first click made.
    act(() => {
      undo.undo();
    });
    const back = shapeSnapshot(doc, id)!;
    expect(back.stroke).not.toBe('red');
    expect(back.fill).toBe('blue');
  });
});

describe('story 10 shape tool over an object (TC-28)', () => {
  it('a shape drag that starts on top of a sticky note does not move that note', () => {
    mount({ sticky: true });
    const before = objectSnapshots(doc).find((o) => o.type === 'sticky')!;
    const noteEl = world().querySelector(`[data-note-id="${before.id}"]`)!;

    fireKey('s');
    // The press lands on the note; the tool still owns the pointer.
    drag([420, 320], [620, 420], { on: noteEl });

    const after = objectSnapshots(doc).find((o) => o.id === before.id)!;
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
    // The note was not opened for editing either.
    expect(screen.queryByTestId('sticky-text-editor')).toBeNull();
    // And the shape the drag described is there.
    expect(shapes().length).toBe(1);
    expect(rectOf(shapes()[0]!)).toEqual({ x: 420, y: 320, width: 200, height: 100 });
  });

  it('a shape drag that starts on another shape does not drag that shape', () => {
    const under = mkShape('rect', 0, 0, 200, 200);
    mount();
    fireKey('s');
    drag([50, 50], [500, 300], { on: shapeEl(under) });
    expect(rectOf(shapeSnapshot(doc, under)!)).toEqual({ x: 0, y: 0, width: 200, height: 200 });
    expect(shapes().length).toBe(2);
  });
});
