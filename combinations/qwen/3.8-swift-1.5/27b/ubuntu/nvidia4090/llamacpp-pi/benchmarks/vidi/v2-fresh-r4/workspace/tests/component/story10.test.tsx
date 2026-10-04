import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { render, fireEvent, renderHook, act } from '@testing-library/react';
import { initDoc, snapshot, LOCAL_ORIGIN, objectBounds } from '../../src/shared/board-model';
import {
  createShape,
  setShapeStyle,
  getShapeLabel,
  type ShapeKind,
} from '../../src/shared/objects/shape';
import { createConnector } from '../../src/shared/objects/connector';
import { applyTextDiff } from '../../src/shared/text-edit';
import { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_FILL_COLORS } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';
import type { ShapeSnapshot, ConnectorSnapshot, ObjectSnapshot } from '../../src/shared/board-model';
import { ShapeTool } from '../../src/client/tools/ShapeTool';
import { ConnectorTool } from '../../src/client/tools/ConnectorTool';
import { ShapeObject, type ShapeObjectProps } from '../../src/client/objects/ShapeObject';
import { ShapeToolbar } from '../../src/client/objects/ShapeToolbar';
import { ConnectorObject, type ConnectorObjectProps } from '../../src/client/objects/ConnectorObject';
import { useActiveTool } from '../../src/client/tools/useActiveTool';
import type { Camera } from '../../src/client/canvas/camera';

const IDENTITY: Camera = { x: 0, y: 0, zoom: 1 };
const ZOOM2: Camera = { x: 0, y: 0, zoom: 2 };

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function makeShape(doc: Y.Doc, x: number, y: number, w: number, h: number, label = ''): string {
  const id = createShape(doc, { kind: 'rect', rect: { x, y, width: w, height: h }, at: { x, y } }, 'g_test')!;
  if (label) {
    applyTextDiff(getShapeLabel(doc, id)!, label, LOCAL_ORIGIN);
  }
  return id;
}

function snapOf(doc: Y.Doc, id: string): ObjectSnapshot {
  return snapshot(doc).find((s) => s.id === id)!;
}

function rectsOf(doc: Y.Doc): Map<string, Rect> {
  const m = new Map<string, Rect>();
  for (const s of snapshot(doc)) m.set(s.id, objectBounds(s));
  return m;
}

// --- TC-15 / TC-16: ShapeTool ------------------------------------------------

describe('ShapeTool (story 10)', () => {
  function renderTool(doc: Y.Doc, kind: ShapeKind, camera: Camera = ZOOM2, onCreated = vi.fn()) {
    const utils = render(<ShapeTool kind={kind} camera={camera} doc={doc} onCreated={onCreated} />);
    const overlay = utils.container.querySelector('[data-vidi6="shape-tool"]')!;
    return { ...utils, overlay, onCreated };
  }

  // TC-15: drag creates a shape with the right world coords and kind
  it('TC-15: drag creates a shape in world coordinates and fires onCreated', () => {
    const doc = makeDoc();
    const onCreated = vi.fn();
    const { overlay } = renderTool(doc, 'ellipse', ZOOM2, onCreated);

    // screen (100, 50) -> world (50, 25) at zoom 2
    fireEvent.pointerDown(overlay, { clientX: 100, clientY: 50, button: 0 });
    // screen (200, 100) -> world (100, 50)
    fireEvent.pointerMove(overlay, { clientX: 200, clientY: 100 });
    // A preview should be visible while dragging
    expect(document.querySelector('[data-vidi6="shape-preview"]')).not.toBeNull();
    fireEvent.pointerUp(overlay, { clientX: 200, clientY: 100 });

    const snaps = snapshot(doc).filter((s) => s.type === 'shape');
    expect(snaps).toHaveLength(1);
    const shape = snaps[0] as ShapeSnapshot;
    expect(shape.kind).toBe('ellipse');
    expect(shape.x).toBe(50);
    expect(shape.y).toBe(25);
    expect(shape.width).toBe(50);
    expect(shape.height).toBe(25);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(shape.id);
    // Preview gone after release
    expect(document.querySelector('[data-vidi6="shape-preview"]')).toBeNull();
  });

  // TC-16: a tiny drag falls back to the standard size centred on the origin
  it('TC-16: a drag below the minimum size creates a standard-size shape at the drag origin', () => {
    const doc = makeDoc();
    const onCreated = vi.fn();
    const { overlay } = renderTool(doc, 'rect', ZOOM2, onCreated);

    fireEvent.pointerDown(overlay, { clientX: 100, clientY: 50, button: 0 });
    // 5 world px wide, 2.5 tall -> below the 20px minimum
    fireEvent.pointerMove(overlay, { clientX: 110, clientY: 55 });
    fireEvent.pointerUp(overlay, { clientX: 110, clientY: 55 });

    const snaps = snapshot(doc).filter((s) => s.type === 'shape');
    expect(snaps).toHaveLength(1);
    const shape = snaps[0] as ShapeSnapshot;
    // Standard 160x160 centred on the drag origin (50, 25)
    expect(shape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(shape.x).toBe(50 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(shape.y).toBe(25 - SHAPE_DEFAULT_SIZE_WORLD / 2);
    expect(onCreated).toHaveBeenCalledTimes(1);
  });
});

// --- TC-17 / TC-18: ShapeObject ---------------------------------------------

describe('ShapeObject (story 10)', () => {
  function renderShape(doc: Y.Doc, id: string, overrides: Record<string, unknown> = {}) {
    const shape = snapOf(doc, id) as ShapeSnapshot;
    const props = {
      shape,
      doc,
      selected: false,
      editing: false,
      onPointerDown: vi.fn(),
      onDoubleClick: vi.fn(),
      onEndEdit: vi.fn(),
      onBoundary: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      ...overrides,
    };
    return render(<ShapeObject {...(props as ShapeObjectProps)} />);
  }

  // TC-17
  it('TC-17: renders the shape at its position with fill, stroke and label', () => {
    const doc = makeDoc();
    const id = makeShape(doc, 10, 20, 120, 60, 'Alpha');
    setShapeStyle(doc, id, { fill: 'blue', stroke: 'grey' });
    const { container } = renderShape(doc, id);

    const el = container.querySelector('[data-vidi6="shape"]') as SVGElement;
    expect(el).not.toBeNull();
    expect(el.style.left).toBe('10px');
    expect(el.style.top).toBe('20px');
    expect(el.getAttribute('data-vidi6-kind')).toBe('rect');
    expect(el.getAttribute('aria-label')).toBe('Rectangle: Alpha');

    const body = container.querySelector('[data-vidi6="shape-body"]') as SVGElement;
    expect(body.getAttribute('fill')).toBe(SHAPE_FILL_COLORS.blue);

    const label = container.querySelector('[data-vidi6="shape-label"]') as HTMLDivElement;
    expect(label.textContent).toBe('Alpha');
  });

  it('ellipse and diamond render their own geometry', () => {
    const doc = makeDoc();
    const e = createShape(doc, { kind: 'ellipse', rect: { x: 0, y: 0, width: 100, height: 50 }, at: { x: 0, y: 0 } }, 'g_test')!;
    const d = createShape(doc, { kind: 'diamond', rect: { x: 0, y: 0, width: 100, height: 50 }, at: { x: 0, y: 0 } }, 'g_test')!;

    const re = renderShape(doc, e);
    expect(re.container.querySelector('ellipse[data-vidi6="shape-body"]')).not.toBeNull();

    const rd = renderShape(doc, d);
    expect(rd.container.querySelector('polygon[data-vidi6="shape-body"]')).not.toBeNull();
  });

  // TC-18
  it('TC-18: double-click opens the label editor; typing commits to the doc; Enter ends editing', () => {
    const doc = makeDoc();
    const id = makeShape(doc, 0, 0, 100, 50, 'Start');
    const onEndEdit = vi.fn();
    const onDoubleClick = vi.fn();
    const { container } = renderShape(doc, id, { onEndEdit, onDoubleClick });

    // Not editing: label visible, no textarea
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('[data-vidi6="shape-label"]')!.textContent).toBe('Start');

    // Double-click on the shape body
    fireEvent.doubleClick(container.querySelector('[data-vidi6="shape"]')!);
    expect(onDoubleClick).toHaveBeenCalledTimes(1);

    // Render in editing mode (BoardContent flips `editing` on double-click)
    const second = renderShape(doc, id, { editing: true, onEndEdit });
    const ta = second.container.querySelector('textarea[data-vidi6="shape-label-editor"]') as HTMLTextAreaElement;
    expect(ta).not.toBeNull();
    expect(ta.value).toBe('Start');

    fireEvent.input(ta, { target: { value: 'Updated' } });
    expect(getShapeLabel(doc, id)!.toString()).toBe('Updated');

    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onEndEdit).toHaveBeenCalledTimes(1);
  });
});

// --- TC-19: ShapeToolbar ------------------------------------------------------

describe('ShapeToolbar (story 10)', () => {
  // TC-19
  it('TC-19: fill and outline swatches call their handlers', () => {
    const onFill = vi.fn();
    const onStroke = vi.fn();
    const { container } = render(
      <ShapeToolbar fill="white" stroke="dark" onFill={onFill} onStroke={onStroke} />,
    );

    const fillSwatches = container.querySelectorAll('[data-vidi6^="shape-fill-"]');
    const strokeSwatches = container.querySelectorAll('[data-vidi6^="shape-stroke-"]');
    expect(fillSwatches.length).toBeGreaterThanOrEqual(6);
    expect(strokeSwatches.length).toBeGreaterThanOrEqual(6);

    fireEvent.click(container.querySelector('[data-vidi6="shape-fill-blue"]')!);
    expect(onFill).toHaveBeenCalledWith('blue');

    fireEvent.click(container.querySelector('[data-vidi6="shape-stroke-green"]')!);
    expect(onStroke).toHaveBeenCalledWith('green');

    // Active state
    const white = container.querySelector('[data-vidi6="shape-fill-white"]') as HTMLButtonElement;
    expect(white.getAttribute('aria-pressed')).toBe('true');
    const dark = container.querySelector('[data-vidi6="shape-stroke-dark"]') as HTMLButtonElement;
    expect(dark.getAttribute('aria-pressed')).toBe('true');
  });
});

// --- TC-20: ConnectorTool ------------------------------------------------------

describe('ConnectorTool (story 10)', () => {
  function renderTool(doc: Y.Doc, onCreated = vi.fn()) {
    const notes = snapshot(doc);
    const rects = rectsOf(doc);
    const utils = render(
      <ConnectorTool camera={IDENTITY} snapshot={notes} rects={rects} doc={doc} onCreated={onCreated} />,
    );
    const overlay = utils.container.querySelector('[data-vidi6="connector-tool"]')!;
    return { ...utils, overlay, onCreated, notes, rects };
  }

  // TC-20
  it('TC-20: hovering an object shows 4 anchor dots; dragging between objects creates a connector', () => {
    const doc = makeDoc();
    const a = makeShape(doc, 100, 100, 200, 100, 'A');
    const b = makeShape(doc, 500, 150, 100, 100, 'B');
    const onCreated = vi.fn();
    const { overlay } = renderTool(doc, onCreated);

    // Hover over A (its centre is 200,150)
    fireEvent.pointerMove(overlay, { clientX: 200, clientY: 150 });
    const dots = document.querySelectorAll('[data-vidi6="connector-dot"]');
    expect(dots.length).toBe(4);

    // Start a drag on A, move over B (centre 550,200), release
    fireEvent.pointerDown(overlay, { clientX: 200, clientY: 150, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 550, clientY: 200 });
    // B's facing side is highlighted while the pointer is over it
    const highlighted = document.querySelectorAll('[data-highlighted="true"]');
    expect(highlighted.length).toBe(1);
    // Preview line visible
    expect(document.querySelector('[data-vidi6="connector-preview"]')).not.toBeNull();

    fireEvent.pointerUp(overlay, { clientX: 550, clientY: 200 });

    const connectors = snapshot(doc).filter((s) => s.type === 'connector');
    expect(connectors).toHaveLength(1);
    const c = connectors[0] as ConnectorSnapshot;
    const from = c.from as { kind: 'attached'; objectId: string };
    const to = c.to as { kind: 'attached'; objectId: string };
    expect(from.kind).toBe('attached');
    expect(from.objectId).toBe(a);
    expect(to.kind).toBe('attached');
    expect(to.objectId).toBe(b);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(c.id);
  });

  it('a drag that ends on empty space creates a free end, not a shape', () => {
    const doc = makeDoc();
    const a = makeShape(doc, 100, 100, 200, 100, 'A');
    const onCreated = vi.fn();
    const { overlay } = renderTool(doc, onCreated);

    fireEvent.pointerDown(overlay, { clientX: 200, clientY: 150, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 900, clientY: 900 });
    fireEvent.pointerUp(overlay, { clientX: 900, clientY: 900 });

    const connectors = snapshot(doc).filter((s) => s.type === 'connector');
    expect(connectors).toHaveLength(1);
    const c = connectors[0] as ConnectorSnapshot;
    const from = c.from as { kind: 'attached'; objectId: string };
    const to = c.to as { kind: 'free'; x: number; y: number };
    expect(from.objectId).toBe(a);
    expect(to.kind).toBe('free');
    expect(to.x).toBe(900);
    expect(to.y).toBe(900);
  });

  it('a drag that starts and ends on the same object creates nothing', () => {
    const doc = makeDoc();
    makeShape(doc, 100, 100, 200, 100, 'A');
    const onCreated = vi.fn();
    const { overlay } = renderTool(doc, onCreated);

    fireEvent.pointerDown(overlay, { clientX: 200, clientY: 150, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 250, clientY: 150 });
    fireEvent.pointerUp(overlay, { clientX: 250, clientY: 150 });

    expect(snapshot(doc).filter((s) => s.type === 'connector')).toHaveLength(0);
    expect(onCreated).not.toHaveBeenCalled();
  });
});

// --- TC-21: ConnectorObject ------------------------------------------------------

describe('ConnectorObject (story 10)', () => {
  function setup() {
    const doc = makeDoc();
    // A: 100,100 -> 300,200 (centre 200,150). B: 400,150 -> 500,200 (centre 450,175)
    const a = makeShape(doc, 100, 100, 200, 100, 'A');
    const b = makeShape(doc, 400, 150, 100, 50, 'B');
    // C: 450,20 -> 550,70 (centre 500,45) — above B, for the re-attach test.
    const c3 = makeShape(doc, 450, 20, 100, 50, 'C');
    const c = createConnector(doc, { kind: 'attached', objectId: a, fallback: { x: 300, y: 150 } },
      { kind: 'attached', objectId: b, fallback: { x: 400, y: 175 } }, 'g_test')!;
    const notes = snapshot(doc);
    const rects = rectsOf(doc);
    return { doc, a, b, c3, c, notes, rects };
  }

  function renderConn(doc: Y.Doc, id: string, overrides: Record<string, unknown> = {}) {
    const connector = snapOf(doc, id) as ConnectorSnapshot;
    const notes = snapshot(doc);
    const rects = rectsOf(doc);
    const props = {
      connector,
      rects,
      snapshot: notes,
      doc,
      selected: true,
      zoom: 1,
      camera: IDENTITY,
      onPointerDown: vi.fn(),
      onBoundary: vi.fn(),
      ...overrides,
    };
    return render(<ConnectorObject {...(props as ConnectorObjectProps)} />);
  }

  // TC-21
  it('TC-21: renders the line between resolved side anchors with endpoint handles', () => {
    const { doc, c } = setup();
    const { container } = renderConn(doc, c);

    // A's right side (300,150) -> B's left side (400,175)
    const line = container.querySelector('[data-vidi6="connector-line"]') as SVGElement;
    expect(line.getAttribute('x1')).toBe('300');
    expect(line.getAttribute('y1')).toBe('150');
    expect(line.getAttribute('x2')).toBe('400');
    expect(line.getAttribute('y2')).toBe('175');

    // Endpoint handles at both resolved anchors
    const fromHandle = container.querySelector('[data-vidi6="connector-handle"][data-end="from"]') as SVGElement;
    expect(fromHandle.getAttribute('cx')).toBe('300');
    expect(fromHandle.getAttribute('cy')).toBe('150');
    const toHandle = container.querySelector('[data-vidi6="connector-handle"][data-end="to"]') as SVGElement;
    expect(toHandle.getAttribute('cx')).toBe('400');
    expect(toHandle.getAttribute('cy')).toBe('175');
  });

  it('TC-21b: dragging an endpoint handle onto another object re-attaches it in the model', () => {
    const { doc, c, c3 } = setup();
    const onBoundary = vi.fn();
    const { container } = renderConn(doc, c, { onBoundary });

    const toHandle = container.querySelector('[data-vidi6="connector-handle"][data-end="to"]') as SVGElement;
    // The "to" handle sits on B's left side (400,175). Drag it onto C (centre 500,45).
    fireEvent.pointerDown(toHandle, { clientX: 400, clientY: 175, button: 0 });
    fireEvent.pointerMove(window, { clientX: 500, clientY: 45 });
    // A world-space preview line follows the drag
    expect(document.querySelector('[data-vidi6="connector-preview"]')).not.toBeNull();
    fireEvent.pointerUp(window, { clientX: 500, clientY: 45 });

    const endpoint = (doc.getMap('objects').get(c) as Y.Map<unknown>).get('to') as {
      kind: string;
      objectId: string;
      fallback: { x: number; y: number };
    };
    // Re-attached to C; the anchor is C's side facing A (its left side: 450,45)
    expect(endpoint.kind).toBe('attached');
    expect(endpoint.objectId).toBe(c3);
    expect(endpoint.fallback).toEqual({ x: 450, y: 45 });
    expect(onBoundary).toHaveBeenCalled();
  });

  it('TC-21c: dragging an endpoint handle onto empty space drops it as a free point', () => {
    const { doc, c } = setup();
    const onBoundary = vi.fn();
    const { container } = renderConn(doc, c, { onBoundary });

    const fromHandle = container.querySelector('[data-vidi6="connector-handle"][data-end="from"]') as SVGElement;
    fireEvent.pointerDown(fromHandle, { clientX: 300, clientY: 150, button: 0 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 400 });
    fireEvent.pointerUp(window, { clientX: 50, clientY: 400 });

    const endpoint = (doc.getMap('objects').get(c) as Y.Map<unknown>).get('from') as {
      kind: string;
      x: number;
      y: number;
    };
    expect(endpoint).toEqual({ kind: 'free', x: 50, y: 400 });
    expect(onBoundary).toHaveBeenCalled();
  });
});

// --- TC-22: useActiveTool ------------------------------------------------------

describe('useActiveTool (story 10)', () => {
  // TC-22
  it('TC-22: S/L/T/V shortcuts switch tools, Escape selects, N creates a sticky, toolCreated selects the object', () => {
    const select = vi.fn();
    const onStickyNote = vi.fn();
    const { result } = renderHook(() => useActiveTool({ select, onStickyNote }));

    expect(result.current.tool).toBe('select');

    act(() => {
      fireEvent.keyDown(window, { key: 's' });
    });
    expect(result.current.tool).toBe('shape');

    act(() => {
      fireEvent.keyDown(window, { key: 'l' });
    });
    expect(result.current.tool).toBe('connector');

    act(() => {
      fireEvent.keyDown(window, { key: 't' });
    });
    expect(result.current.tool).toBe('text');

    act(() => {
      fireEvent.keyDown(window, { key: 'v' });
    });
    expect(result.current.tool).toBe('select');

    act(() => {
      fireEvent.keyDown(window, { key: 'n' });
    });
    expect(onStickyNote).toHaveBeenCalledTimes(1);
    expect(result.current.tool).toBe('select'); // N does not switch tools

    // toolCreated: select the object and return to the select tool
    act(() => {
      fireEvent.keyDown(window, { key: 's' });
    });
    expect(result.current.tool).toBe('shape');
    act(() => {
      result.current.toolCreated('obj-1');
    });
    expect(select).toHaveBeenCalledWith('obj-1');
    expect(result.current.tool).toBe('select');

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(result.current.tool).toBe('select');
  });

  it('shape kind defaults to rect and can be changed', () => {
    const { result } = renderHook(() => useActiveTool({ select: vi.fn(), onStickyNote: vi.fn() }));
    expect(result.current.shapeKind).toBe('rect');
    act(() => {
      result.current.setShapeKind('diamond');
    });
    expect(result.current.shapeKind).toBe('diamond');
  });
});
