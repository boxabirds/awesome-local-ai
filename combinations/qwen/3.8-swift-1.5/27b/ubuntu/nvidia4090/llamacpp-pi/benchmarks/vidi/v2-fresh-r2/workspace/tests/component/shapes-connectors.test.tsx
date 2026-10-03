/**
 * Component tests for the story 10 board: shape tool/object/toolbar and
 * connector tool/object (TC-17 to TC-22). TC-15/TC-16/TC-28 are covered by
 * tool-hooks.test.tsx and Toolbars.test.tsx.
 *
 * The real `BoardView` renders against a local Y.Doc (fake provider). In
 * jsdom the camera is {0, 0, zoom 1}, so screen coordinates equal world
 * coordinates.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, screen, fireEvent } from '@testing-library/react';
import {
  objects,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import { createConnector, getConnectorEndpoints } from '../../src/shared/objects/connector';
import { SHAPE_DEFAULT_SIZE_WORLD } from '../../src/shared/config';
import { renderBoard, insertSticky, hook } from './harness';

function doc() {
  return hook().getDoc!();
}

function allObjects(): readonly ObjectSnapshot[] {
  return objects(doc());
}

function shapeEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-shape-id="${id}"]`);
  if (!el) throw new Error(`shape ${id} not found`);
  return el;
}

function shapeBox(id: string): { x: number; y: number; w: number; h: number } {
  const el = shapeEl(id);
  return {
    x: parseFloat(el.style.left),
    y: parseFloat(el.style.top),
    w: parseFloat(el.style.width),
    h: parseFloat(el.style.height),
  };
}

function noteEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!el) throw new Error(`note ${id} not found`);
  return el;
}

function connectorEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-connector-id="${id}"]`);
  if (!el) throw new Error(`connector ${id} not found`);
  return el;
}

function connectorLine(id: string): SVGLineElement {
  const el = connectorEl(id).querySelector<SVGLineElement>('line');
  if (!el) throw new Error('connector line not found');
  return el;
}

function viewport(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

/** Drag an object with the generic gesture (rAF-throttled → fake timers). */
function dragObject(id: string, from: { x: number; y: number }, to: { x: number; y: number }): void {
  act(() => {
    fireEvent.pointerDown(noteEl(id), { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: to.x, clientY: to.y });
    vi.advanceTimersByTime(32);
    fireEvent.pointerUp(window, { pointerId: 1 });
  });
}

/** Select an object with a click. */
function clickObject(el: HTMLElement, at: { x: number; y: number }): void {
  act(() => {
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: at.x, clientY: at.y });
    fireEvent.pointerUp(window, { pointerId: 1 });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('shape.tool (board)', () => {
  // TC-17: drag 100×60 → a 100×60 shape at the drag rect; a click → the
  // standard size centred on the point; Shift → a square.
  it('TC-17: drag creates the dragged size; click the standard size; Shift a square', () => {
    renderBoard();
    act(() => {
      fireEvent.keyDown(window, { key: 's' });
    });
    const tool = screen.getByTestId('shape-tool');

    // Drag a 100×60 rect from (100,100) to (200,160).
    // (Separate act() blocks: each discrete event must flush before the next,
    // matching real pointer timing.)
    act(() => {
      fireEvent.pointerDown(tool, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    });
    act(() => {
      fireEvent.pointerMove(tool, { pointerId: 1, clientX: 200, clientY: 160 });
    });
    act(() => {
      fireEvent.pointerUp(tool, { pointerId: 1 });
    });
    const dragged = allObjects().find((o) => o.type === 'shape')!;
    expect(dragged).toBeDefined();
    expect(shapeBox(dragged.id)).toEqual({ x: 100, y: 100, w: 100, h: 60 });

    // The tool returned to Select and the shape is selected.
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    expect(shapeEl(dragged.id).hasAttribute('data-selected')).toBe(true);

    // A click creates the standard size centred on the point.
    act(() => {
      fireEvent.keyDown(window, { key: 's' });
    });
    const tool2 = screen.getByTestId('shape-tool');
    act(() => {
      fireEvent.pointerDown(tool2, { button: 0, pointerId: 1, clientX: 500, clientY: 300 });
    });
    act(() => {
      fireEvent.pointerUp(tool2, { pointerId: 1 });
    });
    const clicked = allObjects()
      .filter((o) => o.type === 'shape')
      .find((o) => o.id !== dragged.id)!;
    const size = SHAPE_DEFAULT_SIZE_WORLD;
    expect(shapeBox(clicked.id)).toEqual({
      x: 500 - size / 2,
      y: 300 - size / 2,
      w: size,
      h: size,
    });

    // Shift+drag makes a square (the larger dimension) anchored at the origin.
    act(() => {
      fireEvent.keyDown(window, { key: 's' });
    });
    const tool3 = screen.getByTestId('shape-tool');
    act(() => {
      fireEvent.pointerDown(tool3, { button: 0, pointerId: 1, shiftKey: true, clientX: 100, clientY: 500 });
    });
    act(() => {
      fireEvent.pointerMove(tool3, { pointerId: 1, shiftKey: true, clientX: 200, clientY: 560 });
    });
    act(() => {
      fireEvent.pointerUp(tool3, { pointerId: 1, shiftKey: true });
    });
    const square = allObjects()
      .filter((o) => o.type === 'shape')
      .find((o) => o.id !== dragged.id && o.id !== clicked.id)!;
    expect(shapeBox(square.id)).toEqual({ x: 100, y: 500, w: 100, h: 100 });
  });
});

describe('shape.object (board)', () => {
  // TC-18: the shape toolbar's fill/stroke swatches change the style; the
  // trash bin deletes the shape.
  it('TC-18: toolbar swatches restyle the shape; the trash bin deletes it', () => {
    renderBoard();
    let id = '';
    act(() => {
      id = createShape(doc(), { kind: 'rect', rect: { x: 100, y: 100, width: 100, height: 60 }, at: { x: 100, y: 100 }, square: false }, 'test')!;
    });

    clickObject(shapeEl(id), { x: 150, y: 130 });
    const toolbar = screen.getByTestId('shape-toolbar');
    expect(toolbar).toBeInTheDocument();

    // Fill blue.
    act(() => {
      fireEvent.click(screen.getByTestId('shape-fill-blue'));
    });
    const g = shapeEl(id).querySelector('g')!;
    expect(g.getAttribute('fill')).toBe('#BBDEFB');
    expect(screen.getByTestId('shape-fill-blue')).toHaveAttribute('aria-pressed', 'true');

    // Stroke red.
    act(() => {
      fireEvent.click(screen.getByTestId('shape-stroke-red'));
    });
    expect(g.getAttribute('stroke')).toBe('#E53935');

    // Trash bin deletes.
    act(() => {
      fireEvent.click(screen.getByTestId('delete-shape-btn'));
    });
    expect(document.querySelector(`[data-shape-id="${id}"]`)).toBeNull();
    expect(allObjects().find((o) => o.id === id)).toBeUndefined();
  });

  // TC-19: double-click opens the label editor; typed text persists to the
  // label and displays centred.
  it('TC-19: double-click edits the label; the text persists and displays', () => {
    renderBoard();
    let id = '';
    act(() => {
      id = createShape(doc(), { kind: 'ellipse', rect: { x: 100, y: 100, width: 120, height: 80 }, at: { x: 100, y: 100 }, square: false }, 'test')!;
    });

    act(() => {
      fireEvent.doubleClick(shapeEl(id));
    });
    const editor = screen.getByTestId('shape-label-textarea');
    expect(editor).toBeInTheDocument();

    act(() => {
      fireEvent.input(editor, { target: { value: 'A' } });
    });

    // End editing → the label displays.
    act(() => {
      fireEvent.keyDown(editor, { key: 'Escape' });
    });
    const label = shapeEl(id).querySelector('[data-testid="shape-label"]')!;
    expect(label).not.toBeNull();
    expect(label.textContent).toBe('A');
    // Persisted in the snapshot (the Y.Text label).
    const snap = allObjects().find((o) => o.id === id) as unknown as { label?: string };
    expect(snap.label).toBe('A');
  });
});

describe('connector.tool (board)', () => {
  // TC-20: dragging from A to B creates the arrow; the arrowhead is at B's
  // edge pointing from A to B.
  it('TC-20: drag A→B creates the arrow with the arrowhead at B\'s edge', () => {
    renderBoard();
    const a = insertSticky(100, 100); // [0,0]-[200,200]
    const b = insertSticky(400, 100); // [300,0]-[500,200]
    void a;

    act(() => {
      fireEvent.keyDown(window, { key: 'l' });
    });
    const tool = screen.getByTestId('connector-tool');
    act(() => {
      fireEvent.pointerDown(tool, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    });
    act(() => {
      fireEvent.pointerMove(tool, { pointerId: 1, clientX: 400, clientY: 100 });
    });
    act(() => {
      fireEvent.pointerUp(tool, { pointerId: 1, clientX: 400, clientY: 100 });
    });

    const conn = allObjects().find((o) => o.type === 'connector')!;
    expect(conn).toBeDefined();
    // Returned to select and the arrow is selected.
    expect(screen.queryByTestId('connector-tool')).toBeNull();
    expect(connectorEl(conn.id).hasAttribute('data-selected')).toBe(true);

    // Endpoints: A's right edge (200,100) → B's left edge (300,100).
    const ends = getConnectorEndpoints(doc(), conn.id)!;
    expect(ends.from!.kind).toBe('attached');
    expect((ends.from as { objectId: string }).objectId).toBe(a);
    expect(ends.to!.kind).toBe('attached');
    expect((ends.to as { objectId: string }).objectId).toBe(b);

    // Geometry: the line runs (200,100) → (300,100) in world coordinates.
    const line = connectorLine(conn.id);
    const el = connectorEl(conn.id);
    const ox = parseFloat(el.style.left);
    const oy = parseFloat(el.style.top);
    expect({ x: ox + parseFloat(line.getAttribute('x1')!), y: oy + parseFloat(line.getAttribute('y1')!) }).toEqual({ x: 200, y: 100 });
    expect({ x: ox + parseFloat(line.getAttribute('x2')!), y: oy + parseFloat(line.getAttribute('y2')!) }).toEqual({ x: 300, y: 100 });

    // The arrowhead tip is at the target end (300,100) pointing A→B.
    const poly = connectorEl(conn.id).querySelector('polygon')!;
    const tip = poly.getAttribute('points')!.split(' ')[0].split(',');
    expect({ x: ox + parseFloat(tip[0]), y: oy + parseFloat(tip[1]) }).toEqual({ x: 300, y: 100 });
  });
});

describe('connector.object (board)', () => {
  /** Create a selected A→B arrow and return its id (A [0,0]-[200,200], B [300,0]-[500,200]). */
  function makeSelectedArrow(): { a: string; b: string; id: string } {
    const a = insertSticky(100, 100);
    const b = insertSticky(400, 100);
    let id = '';
    act(() => {
      id = createConnector(
        doc(),
        { kind: 'attached', objectId: a, fallback: { x: 200, y: 100 } },
        { kind: 'attached', objectId: b, fallback: { x: 300, y: 100 } },
        'test',
      )!;
    });
    // Select it with a click on the line (250,100) — within the 6px tolerance.
    act(() => {
      fireEvent.click(viewport(), { clientX: 250, clientY: 100 });
    });
    expect(connectorEl(id).hasAttribute('data-selected')).toBe(true);
    return { a, b, id };
  }

  // TC-21: the selected connector shows endpoint dots; dragging one to C
  // re-attaches it; dragging to empty space frees it.
  it('TC-21: endpoint dots re-attach to a hovered object or free in empty space', () => {
    renderBoard();
    const { a, b, id } = makeSelectedArrow();
    const c = insertSticky(400, 400); // [300,300]-[500,500]
    void a;

    // Both endpoint dots are present.
    const fromDot = screen.getByTestId('connector-dot-from');
    const toDot = screen.getByTestId('connector-dot-to');
    expect(fromDot).toBeInTheDocument();
    expect(toDot).toBeInTheDocument();

    // Drag the "to" dot (300,100) onto C (400,400).
    act(() => {
      fireEvent.pointerDown(toDot, { button: 0, pointerId: 1, clientX: 300, clientY: 100 });
    });
    act(() => {
      fireEvent.pointerMove(toDot, { pointerId: 1, clientX: 400, clientY: 400 });
    });
    act(() => {
      fireEvent.pointerUp(toDot, { pointerId: 1, clientX: 400, clientY: 400 });
    });
    let ends = getConnectorEndpoints(doc(), id)!;
    expect(ends.to!.kind).toBe('attached');
    expect((ends.to as { objectId: string }).objectId).toBe(c);

    // Drag the "from" dot (200,100) to empty space (700,600) → a free end.
    const fromDot2 = screen.getByTestId('connector-dot-from');
    act(() => {
      fireEvent.pointerDown(fromDot2, { button: 0, pointerId: 1, clientX: 200, clientY: 100 });
    });
    act(() => {
      fireEvent.pointerMove(fromDot2, { pointerId: 1, clientX: 700, clientY: 600 });
    });
    act(() => {
      fireEvent.pointerUp(fromDot2, { pointerId: 1, clientX: 700, clientY: 600 });
    });
    ends = getConnectorEndpoints(doc(), id)!;
    expect(ends.from).toEqual({ kind: 'free', x: 700, y: 600 });
    // The other end is untouched.
    expect(ends.to!.kind).toBe('attached');
    void b;
  });

  // TC-22: moving a connected object re-resolves the arrow's endpoint — the
  // arrow follows.
  it('TC-22: moving a connected object moves the arrow endpoint with it', () => {
    renderBoard();
    const { a, id } = makeSelectedArrow();

    // A's right edge is at x=200; the line starts there.
    let line = connectorLine(id);
    let el = connectorEl(id);
    const start = () => ({
      x: parseFloat(el.style.left) + parseFloat(line.getAttribute('x1')!),
      y: parseFloat(el.style.top) + parseFloat(line.getAttribute('y1')!),
    });
    expect(start()).toEqual({ x: 200, y: 100 });

    // Move A 50 to the right: its right edge is now at x=250.
    dragObject(a, { x: 100, y: 100 }, { x: 150, y: 100 });
    vi.advanceTimersByTime(32);

    line = connectorLine(id);
    el = connectorEl(id);
    expect(start()).toEqual({ x: 250, y: 100 });
  });
});
