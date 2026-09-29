// Story 10, tasks.md task 14 — the Connector tool and the arrow object
// (TC-18, TC-19, TC-20, TC-21), component.
//
// The board is a `Y.Doc` mounted straight into `BoardApp`, as in the other component
// suites. jsdom reports every element rectangle as zero-sized, so at the identity camera
// a screen point and the board point under it are the same numbers.
//
// The three fixtures are a row of two shapes and a third below the first:
//
//   A = {0, 0, 200, 200}      B = {300, 0, 200, 200}      C = {0, 300, 200, 200}
//
// A faces B at A's right anchor (200, 100) and B's left anchor (300, 100); A faces C at
// A's bottom anchor (100, 200) and C's top anchor (100, 300).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, screen, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import BoardApp from '../../src/client/board/BoardApp.tsx';
import { createUndo, type UndoController } from '../../src/client/board/undo.ts';
import { getObjectType } from '../../src/client/objects/registry.tsx';
import { initDoc, objectSnapshots, moveObjects } from '../../src/shared/board-model.ts';
import { createShape } from '../../src/shared/objects/shape.ts';
import {
  createConnector,
  connectorSnapshot,
  connectorsOf,
  objectRectsOf,
  type Endpoint,
} from '../../src/shared/objects/connector.ts';
import { CONNECTOR_MIN_LENGTH_WORLD } from '../../src/shared/config.ts';

let doc: Y.Doc;
let undo: UndoController;
/** A, B and C: the two shapes of the flow, and the third one an end moves onto. */
let A: string;
let B: string;
let C: string;

/** A shape written straight through the model, as a fixture. */
const mkShape = (x: number, y: number, w = 200, h = 200) =>
  createShape(doc, { kind: 'rect', rect: { x, y, width: w, height: h }, at: { x, y } }, 'me')!;
const onto = (id: string): Endpoint => ({ kind: 'attached', objectId: id, fallback: { x: 0, y: 0 } });
/** An arrow welded between two shapes. */
const mkConnector = (from: string, to: string) => createConnector(doc, onto(from), onto(to), 'me')!;

beforeEach(() => {
  vi.useFakeTimers();
  doc = new Y.Doc();
  initDoc(doc);
  A = mkShape(0, 0);
  B = mkShape(300, 0);
  C = mkShape(0, 300);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Mount the whole board, with the undo history a test can count steps on. */
function mount() {
  undo = createUndo(doc);
  render(<BoardApp doc={doc} undo={undo} />);
}

const viewport = () => screen.getByTestId('viewport') as HTMLElement;
const toolButton = (name: string) => screen.getByRole('button', { name }) as HTMLElement;
const pressed = (name: string) => toolButton(name).getAttribute('aria-pressed');

/** A pointer event carrying board coordinates; jsdom has no `PointerEvent`, so `MouseEvent`. */
function firePointer(target: EventTarget, type: string, x = 20, y = 20) {
  act(() => {
    target.dispatchEvent(
      new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0 }),
    );
  });
}
function fireKey(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}
/** A move with no press: what hovering is for these two tools. */
const hover = (x: number, y: number) => firePointer(window, 'pointermove', x, y);

const shapeEl = (id: string) => document.querySelector(`[data-shape-id="${id}"]`) as HTMLElement;
const arrows = () => connectorsOf(objectSnapshots(doc));
const arrowEl = (id: string) => document.querySelector(`[data-connector-id="${id}"]`) as SVGElement;
const dot = (side: string) => screen.getByTestId(`connector-dot-${side}`);
const dots = () => [...screen.queryAllByTestId(/^connector-dot-/)] as HTMLElement[];
const num = (el: Element, name: string) => Number(el.getAttribute(name));
/** The object an end is welded to, or null when it is a free end. */
const weldedTo = (e: Endpoint) => (e.kind === 'attached' ? e.objectId : null);
/** The board point an attached end is welded to. */
const weldedAt = (e: Endpoint) => (e.kind === 'attached' ? e.fallback : null);
/** The tip of the arrowhead: where the arrow is drawn to. */
const headTip = () => screen.getByTestId('connector-head').getAttribute('points')!.split(' ')[0]!;
/** Select an arrow by clicking its line. */
const selectArrow = (id: string) => {
  firePointer(screen.getByTestId('connector-hit'), 'pointerdown', 250, 100);
  firePointer(window, 'pointerup', 250, 100);
  expect(arrowEl(id).getAttribute('data-selected')).toBe('true');
};

describe('story 10 connector tool (TC-18)', () => {
  it('hovering an object puts four dots on its four sides', () => {
    mount();
    fireKey('l');
    expect(pressed('Connector')).toBe('true');
    hover(100, 100); // over A
    // The four side midpoints of A, in screen coordinates at the identity camera.
    expect(dots().map((d) => [num(d, 'cx'), num(d, 'cy')])).toEqual([
      [100, 0],
      [200, 100],
      [100, 200],
      [0, 100],
    ]);
    expect(dot('top').getAttribute('data-highlighted')).toBe('false');
    // Hovering another object shows that one's dots, never two sets at once.
    hover(400, 100); // over B
    expect(dots().map((d) => [num(d, 'cx'), num(d, 'cy')])).toEqual([
      [400, 0],
      [500, 100],
      [400, 200],
      [300, 100],
    ]);
  });

  it('empty board, an arrow and a board that cannot be edited show no dots', () => {
    mount();
    fireKey('l');
    hover(700, 700); // empty board
    expect(dots().length).toBe(0);
    // An arrow is never something an end can attach to.
    hover(250, 100); // right on an arrow's line, once there is one
    expect(dots().length).toBe(0);
  });

  it('a board that could not be loaded has no connector tool and arms nothing', () => {
    const locked = new Y.Doc();
    initDoc(locked);
    createShape(locked, { kind: 'rect', rect: { x: 0, y: 0, width: 200, height: 200 }, at: { x: 0, y: 0 } }, 'me');
    render(<BoardApp doc={locked} connection="load_failed" />);
    // A read-only board offers no tools at all, so there is nothing to arm.
    expect(screen.queryByTestId('select-tool')).toBeNull();
    expect(screen.queryByTestId('connector-tool')).toBeNull();
    fireKey('l');
    hover(100, 100);
    expect(dots().length).toBe(0);
    expect(screen.queryByTestId('connector-tool-overlay')).toBeNull();
  });
});

describe('story 10 connector create (TC-19)', () => {
  it('dragging from one object to another welds both ends and returns to Select', () => {
    mount();
    fireKey('l');
    firePointer(viewport(), 'pointerdown', 100, 100); // on A
    firePointer(window, 'pointermove', 400, 100); // over B
    // The dot this end would land on is highlighted: B's left side faces A.
    expect(dot('left').getAttribute('data-highlighted')).toBe('true');
    expect(dot('right').getAttribute('data-highlighted')).toBe('false');
    // The end trails the pointer.
    expect(screen.getByTestId('connector-preview')).toBeTruthy();

    firePointer(window, 'pointerup', 400, 100);

    const [arrow] = arrows();
    expect(arrows().length).toBe(1); // exactly one arrow, from exactly one write
    expect(arrow!.from).toEqual({ kind: 'attached', objectId: A, fallback: { x: 200, y: 100 } });
    expect(arrow!.to).toEqual({ kind: 'attached', objectId: B, fallback: { x: 300, y: 100 } });
    // The gesture handed the board back to Select, with the new arrow selected.
    expect(pressed('Select')).toBe('true');
    expect(pressed('Connector')).toBe('false');
    expect(arrowEl(arrow!.id).getAttribute('data-selected')).toBe('true');
  });

  it('releasing over the object the drag started from creates nothing and stays armed', () => {
    mount();
    fireKey('l');
    firePointer(viewport(), 'pointerdown', 100, 100); // on A
    firePointer(window, 'pointermove', 150, 150); // still over A
    firePointer(window, 'pointerup', 150, 150);
    expect(arrows().length).toBe(0);
    expect(pressed('Connector')).toBe('true');
    // A drag that leaves A and comes back onto A is refused too, however long.
    firePointer(viewport(), 'pointerdown', 30, 30);
    firePointer(window, 'pointermove', 150, 150);
    firePointer(window, 'pointerup', 150, 150);
    expect(arrows().length).toBe(0);
    // The tool is still armed, and now draws the arrow it was asked for.
    firePointer(viewport(), 'pointerdown', 100, 100);
    firePointer(window, 'pointermove', 400, 100);
    firePointer(window, 'pointerup', 400, 100);
    expect(arrows().length).toBe(1);
  });

  it('an end released over empty board is pinned to that board point', () => {
    mount();
    fireKey('l');
    firePointer(viewport(), 'pointerdown', 100, 100); // on A
    firePointer(window, 'pointermove', 700, 500); // empty board
    firePointer(window, 'pointerup', 700, 500);
    const [arrow] = arrows();
    expect(weldedTo(arrow!.from)).toBe(A);
    expect(arrow!.to).toEqual({ kind: 'free', x: 700, y: 500 });
  });

  it('a drag too short to be an arrow, and a cancelled one, write nothing', () => {
    mount();
    fireKey('l');
    // Empty board to empty board, shorter than the minimum arrow length.
    const short = CONNECTOR_MIN_LENGTH_WORLD / 2;
    firePointer(viewport(), 'pointerdown', 800, 800);
    firePointer(window, 'pointermove', 800 + short, 800);
    firePointer(window, 'pointerup', 800 + short, 800);
    expect(arrows().length).toBe(0);
    expect(pressed('Connector')).toBe('true');
    // A pointer that is cancelled creates nothing.
    firePointer(viewport(), 'pointerdown', 800, 800);
    firePointer(window, 'pointermove', 950, 950);
    firePointer(window, 'pointercancel', 950, 950);
    expect(arrows().length).toBe(0);
  });

  it('an arrow follows a shape a colleague moved, with nothing written about the arrow', () => {
    const id = mkConnector(A, B);
    mount();
    expect(headTip()).toBe('300,100');
    const stored = { from: arrows()[0]!.from, to: arrows()[0]!.to };

    // A colleague moves B 300 to the right.
    act(() => {
      moveObjects(doc, new Map([[B, { x: 600, y: 0 }]]));
    });

    // The arrow was redrawn into B's new position; its own data never changed.
    expect(headTip()).toBe('600,100');
    const after = connectorSnapshot(doc, id)!;
    expect(after.from).toEqual(stored.from);
    expect(after.to).toEqual(stored.to);
  });
});

describe('story 10 connector select (TC-20)', () => {
  it('the click tolerance is screen pixels, not board units, at any zoom', () => {
    const id = mkConnector(A, B);
    mount();
    const objects = objectSnapshots(doc);
    const rects = objectRectsOf(objects);
    const arrow = objects.find((o) => o.id === id)!;
    const spec = getObjectType('connector')!;
    // The arrow is drawn from A's right anchor to B's left anchor: a horizontal line
    // along y = 100. The tolerance is 6 screen pixels, which is 12 board units at 50%
    // zoom and 3 board units at 200%.
    expect(num(screen.getByTestId('connector-line'), 'x1')).toBe(200);
    // 5 screen pixels from the line at 50% zoom is a hit; 7 screen pixels are not.
    expect(spec.hitTest(arrow, { x: 250, y: 110 }, 0.5, rects)).toBe(true);
    expect(spec.hitTest(arrow, { x: 250, y: 114 }, 0.5, rects)).toBe(false);
    // The same screen distances at 200% zoom are 2.5 and 3.5 board units.
    expect(spec.hitTest(arrow, { x: 250, y: 102.5 }, 2, rects)).toBe(true);
    expect(spec.hitTest(arrow, { x: 250, y: 103.5 }, 2, rects)).toBe(false);
    // At 100% zoom the tolerance is 6 board units.
    expect(spec.hitTest(arrow, { x: 250, y: 105 }, 1, rects)).toBe(true);
    expect(spec.hitTest(arrow, { x: 250, y: 107 }, 1, rects)).toBe(false);
  });

  it('a click inside the arrow box but far from the line selects nothing', () => {
    const id = mkConnector(A, B);
    mount();
    const objects = objectSnapshots(doc);
    const rects = objectRectsOf(objects);
    const arrow = objects.find((o) => o.id === id)!;
    const spec = getObjectType('connector')!;
    // The arrow's own bounding box covers this point; its line is nowhere near it.
    expect(spec.hitTest(arrow, { x: 250, y: 240 }, 1, rects)).toBe(false);
    // And the board agrees: that click selects nothing.
    firePointer(viewport(), 'pointerdown', 250, 240);
    firePointer(window, 'pointerup', 250, 240);
    expect(arrowEl(id).getAttribute('data-selected')).toBe('false');
    // A click on the line selects the arrow, and a selected arrow shows a handle at
    // each end.
    selectArrow(id);
    expect(screen.getByTestId('connector-handle-from')).toBeTruthy();
    expect(screen.getByTestId('connector-handle-to')).toBeTruthy();
  });
});

describe('story 10 connector reattach (TC-21)', () => {
  it('dragging an end onto a third object welds it there', () => {
    const id = mkConnector(A, B);
    mount();
    selectArrow(id);

    firePointer(screen.getByTestId('connector-handle-to'), 'pointerdown', 300, 100);
    firePointer(window, 'pointermove', 100, 300); // over C
    // Mid-drag the end trails the pointer and C shows the points an end welds to.
    expect(screen.getByTestId('connector-drag-preview')).toBeTruthy();
    expect(screen.queryAllByTestId(/^connector-endpoint-/)).toHaveLength(4);
    firePointer(window, 'pointerup', 100, 300);

    const after = connectorSnapshot(doc, id)!;
    expect(weldedTo(after.from)).toBe(A);
    expect(after.to.kind).toBe('attached');
    expect(weldedTo(after.to)).toBe(C);
    // Welded to the anchor it landed on: C's top anchor, facing A.
    expect(weldedAt(after.to)).toEqual({ x: 100, y: 300 });
    // The arrow is now drawn into C.
    expect(headTip()).toBe('100,300');
  });

  it('releasing an end on the object the other end is welded to snaps it back', () => {
    const id = mkConnector(A, B);
    mount();
    selectArrow(id);

    firePointer(screen.getByTestId('connector-handle-to'), 'pointerdown', 300, 100);
    firePointer(window, 'pointermove', 100, 100); // over A, the other end's object
    firePointer(window, 'pointerup', 100, 100);

    expect(weldedTo(connectorSnapshot(doc, id)!.to)).toBe(B); // unchanged: it snapped back
    expect(undo.canUndo()).toBe(false); // and nothing was written at all
  });

  it('releasing an end over empty board pins it to that board point', () => {
    const id = mkConnector(A, B);
    mount();
    selectArrow(id);

    firePointer(screen.getByTestId('connector-handle-to'), 'pointerdown', 300, 100);
    firePointer(window, 'pointermove', 700, 500);
    firePointer(window, 'pointerup', 700, 500);

    const after = connectorSnapshot(doc, id)!;
    expect(after.to).toEqual({ kind: 'free', x: 700, y: 500 });
    // The other end is still welded to A.
    expect(weldedTo(after.from)).toBe(A);
  });

  it('a cancelled end drag writes nothing', () => {
    const id = mkConnector(A, B);
    mount();
    selectArrow(id);
    firePointer(screen.getByTestId('connector-handle-to'), 'pointerdown', 300, 100);
    firePointer(window, 'pointermove', 100, 300);
    firePointer(window, 'pointercancel', 100, 300);
    expect(weldedTo(connectorSnapshot(doc, id)!.to)).toBe(B);
    expect(undo.canUndo()).toBe(false);
  });

  it('deleting a shape leaves the arrow, drawing its freed end where it was welded', () => {
    const id = mkConnector(A, B);
    mount();
    const before = headTip();
    expect(before).toBe('300,100');

    // Select B and delete it: the arrow end that was welded to it stays at that point.
    firePointer(shapeEl(B), 'pointerdown', 350, 100);
    firePointer(window, 'pointerup', 350, 100);
    fireKey('Delete');

    expect(connectorSnapshot(doc, id)!.to).toEqual({ kind: 'free', x: 300, y: 100 });
    expect(headTip()).toBe(before);
  });
});
