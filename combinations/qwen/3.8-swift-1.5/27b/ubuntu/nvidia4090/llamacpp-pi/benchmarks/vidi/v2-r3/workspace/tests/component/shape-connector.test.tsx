import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, objects, objectBounds } from '../../src/shared/board-model';
import { createShape, type ShapeSnap } from '../../src/shared/objects/shape';
import { createConnector } from '../../src/shared/objects/connector';
import { ShapeObject } from '../../src/client/objects/ShapeObject';
import { ConnectorObject } from '../../src/client/objects/ConnectorObject';
import { ShapeTool } from '../../src/client/tools/ShapeTool';
import { ConnectorTool } from '../../src/client/tools/ConnectorTool';
import { ShapeToolbar } from '../../src/client/objects/ShapeToolbar';
import { Toolbar } from '../../src/client/board/Toolbar';
import { useActiveTool } from '../../src/client/tools/useActiveTool';
import { renderHook } from '@testing-library/react';
import type { Camera } from '../../src/client/canvas/camera';
import { SHAPE_DEFAULT_SIZE_WORLD } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';

// Setup jsdom mocks (same as other component tests)
beforeEach(() => {
  // Mock PointerEvent
  class MockPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    pressure: number;
    constructor(type: string, props: PointerEventInit = {}) {
      super(type, props);
      this.pointerId = props.pointerId ?? 1;
      this.pointerType = props.pointerType ?? 'mouse';
      this.pressure = props.pressure ?? 0.5;
    }
    pointerId_ = 1;
    get pointerIdValue() { return this.pointerId; }
  }
  (globalThis as any).PointerEvent = MockPointerEvent;

  // Mock setPointerCapture / releasePointerCapture
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};

  // Mock getBoundingClientRect
  if (!HTMLElement.prototype.getBoundingClientRect) {
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, toJSON: () => ({}) } as DOMRect);
  }
});

afterEach(() => {
  cleanup();
});

function makeCamera(cam: Partial<Camera> = {}): Camera {
  return { x: 0, y: 0, zoom: 1, ...cam };
}

function makeShapeObj(overrides: Partial<ShapeSnap> = {}): ShapeSnap {
  return {
    id: 'shape1',
    type: 'shape',
    x: 100,
    y: 100,
    width: 160,
    height: 160,
    z: 1,
    kind: 'rect',
    fill: 'white',
    stroke: 'dark',
    label: '',
    ...overrides,
  };
}

describe('TC-15: ShapeObject rendering', () => {
  it('renders a rect shape as an SVG rect element', () => {
    const obj = makeShapeObj({ kind: 'rect' });
    const doc = new Y.Doc();
    const { container } = render(
      <ShapeObject
        obj={obj}
        doc={doc}
        zoom={1}
        selected={false}
        editing={false}
        onObjectPointerDown={() => {}}
        onStartEdit={() => {}}
        onEndEdit={() => {}}
        undo={undefined}
      />,
    );
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    const rect = container.querySelector('rect');
    expect(rect).not.toBeNull();
    expect(rect?.getAttribute('width')).toBe('160');
    expect(rect?.getAttribute('height')).toBe('160');
  });

  it('renders an ellipse shape as an SVG ellipse element', () => {
    const obj = makeShapeObj({ kind: 'ellipse' });
    const doc = new Y.Doc();
    const { container } = render(
      <ShapeObject
        obj={obj}
        doc={doc}
        zoom={1}
        selected={false}
        editing={false}
        onObjectPointerDown={() => {}}
        onStartEdit={() => {}}
        onEndEdit={() => {}}
        undo={undefined}
      />,
    );
    const ellipse = container.querySelector('ellipse');
    expect(ellipse).not.toBeNull();
  });

  it('renders a diamond shape as an SVG polygon element', () => {
    const obj = makeShapeObj({ kind: 'diamond' });
    const doc = new Y.Doc();
    const { container } = render(
      <ShapeObject
        obj={obj}
        doc={doc}
        zoom={1}
        selected={false}
        editing={false}
        onObjectPointerDown={() => {}}
        onStartEdit={() => {}}
        onEndEdit={() => {}}
        undo={undefined}
      />,
    );
    const polygon = container.querySelector('polygon');
    expect(polygon).not.toBeNull();
    // Diamond has 4 points
    const points = polygon?.getAttribute('points') ?? '';
    expect(points.split(' ')).toHaveLength(4);
  });

  it('applies the correct fill and stroke colors', () => {
    const obj = makeShapeObj({ fill: 'yellow', stroke: 'blue' });
    const doc = new Y.Doc();
    const { container } = render(
      <ShapeObject
        obj={obj}
        doc={doc}
        zoom={1}
        selected={false}
        editing={false}
        onObjectPointerDown={() => {}}
        onStartEdit={() => {}}
        onEndEdit={() => {}}
        undo={undefined}
      />,
    );
    const rect = container.querySelector('rect');
    expect(rect?.getAttribute('fill')).toBe('#FFF9C4');
    expect(rect?.getAttribute('stroke')).toBe('#1E88E5');
  });

  it('shows the label text when present', () => {
    const obj = makeShapeObj({ label: 'Hello World' });
    const doc = new Y.Doc();
    const { container } = render(
      <ShapeObject
        obj={obj}
        doc={doc}
        zoom={1}
        selected={false}
        editing={false}
        onObjectPointerDown={() => {}}
        onStartEdit={() => {}}
        onEndEdit={() => {}}
        undo={undefined}
      />,
    );
    expect(container.textContent).toContain('Hello World');
  });

  it('has data-testid attribute', () => {
    const obj = makeShapeObj({ id: 'test-shape' });
    const doc = new Y.Doc();
    const { container } = render(
      <ShapeObject
        obj={obj}
        doc={doc}
        zoom={1}
        selected={false}
        editing={false}
        onObjectPointerDown={() => {}}
        onStartEdit={() => {}}
        onEndEdit={() => {}}
        undo={undefined}
      />,
    );
    expect(container.querySelector('[data-testid="shape-object-test-shape"]')).not.toBeNull();
  });
});

describe('TC-16: ShapeTool gesture', () => {
  function renderShapeTool(props: Partial<React.ComponentProps<typeof ShapeTool>> = {}) {
    const doc = new Y.Doc();
    initDoc(doc);
    const camera = makeCamera();
    const onCreated = vi.fn();
    const utils = render(
      <ShapeTool
        kind="rect"
        camera={camera}
        doc={doc}
        createdBy="user1"
        onCreated={onCreated}
        {...props}
      />,
    );
    return { doc, onCreated, ...utils };
  }

  it('creates a shape on click (standard size)', () => {
    const { container, onCreated, doc } = renderShapeTool();
    const overlay = container.querySelector('[data-testid="shape-tool-overlay"]')!;

    act(() => {
      fireEvent.pointerDown(overlay, { clientX: 200, clientY: 150, button: 0 });
      fireEvent.pointerUp(overlay, { clientX: 200, clientY: 150, button: 0 });
    });

    expect(onCreated).toHaveBeenCalledTimes(1);
    const notes = objects(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe('shape');
    expect(notes[0].width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(notes[0].height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
  });

  it('creates a shape on drag (custom size)', () => {
    const { container, onCreated, doc } = renderShapeTool();
    const overlay = container.querySelector('[data-testid="shape-tool-overlay"]')!;

    act(() => {
      fireEvent.pointerDown(overlay, { clientX: 100, clientY: 100, button: 0 });
      fireEvent.pointerMove(overlay, { clientX: 250, clientY: 200, button: 0 });
      fireEvent.pointerUp(overlay, { clientX: 250, clientY: 200, button: 0 });
    });

    expect(onCreated).toHaveBeenCalledTimes(1);
    const notes = objects(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0].width).toBe(150);
    expect(notes[0].height).toBe(100);
  });

  it('constrains to square with shift', () => {
    const { container, onCreated, doc } = renderShapeTool();
    const overlay = container.querySelector('[data-testid="shape-tool-overlay"]')!;

    act(() => {
      fireEvent.pointerDown(overlay, { clientX: 100, clientY: 100, button: 0 });
      fireEvent.pointerMove(overlay, { clientX: 250, clientY: 200, button: 0, shiftKey: true });
      fireEvent.pointerUp(overlay, { clientX: 250, clientY: 200, button: 0, shiftKey: true });
    });

    expect(onCreated).toHaveBeenCalledTimes(1);
    const notes = objects(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0].width).toBe(notes[0].height);
  });

  it('enforces minimum size on small drags', () => {
    const { container, doc } = renderShapeTool();
    const overlay = container.querySelector('[data-testid="shape-tool-overlay"]')!;

    act(() => {
      fireEvent.pointerDown(overlay, { clientX: 100, clientY: 100, button: 0 });
      fireEvent.pointerMove(overlay, { clientX: 105, clientY: 105, button: 0 });
      fireEvent.pointerUp(overlay, { clientX: 105, clientY: 105, button: 0 });
    });

    // Very small drag → standard size
    const notes = objects(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0].width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
  });
});

describe('TC-17: ConnectorObject rendering', () => {
  it('renders a line with arrowhead', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const shape1Id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'u');
    const shape2Id = createShape(doc, { kind: 'rect', rect: { x: 300, y: 0, width: 100, height: 100 }, at: { x: 300, y: 0 } }, 'u');
    const connId = createConnector(doc,
      { kind: 'attached', objectId: shape1Id!, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: shape2Id!, fallback: { x: 300, y: 50 } },
      'u',
    )!;

    const notes = objects(doc);
    const conn = notes.find((o) => o.id === connId)!;
    const actualRects = new Map<string, Rect>();
    for (const o of notes) {
      if (o.type === 'shape') {
        actualRects.set(o.id, objectBounds(o));
      }
    }

    const { container } = render(
      <ConnectorObject
        connector={conn as any}
        rects={actualRects}
        selected={false}
        zoom={1}
        onPointerDown={() => {}}
      />,
    );

    // Should have a line element
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBeGreaterThanOrEqual(1);
    // Should have a polygon (arrowhead)
    const polygon = container.querySelector('polygon');
    expect(polygon).not.toBeNull();
  });

  it('shows end handles when selected', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const shape1Id = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'u');
    const shape2Id = createShape(doc, { kind: 'rect', rect: { x: 300, y: 0, width: 100, height: 100 }, at: { x: 300, y: 0 } }, 'u');
    const connId = createConnector(doc,
      { kind: 'attached', objectId: shape1Id!, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: shape2Id!, fallback: { x: 300, y: 50 } },
      'u',
    )!;

    const notes = objects(doc);
    const conn = notes.find((o) => o.id === connId)!;
    const actualRects = new Map<string, Rect>();
    for (const o of notes) {
      if (o.type === 'shape') {
        actualRects.set(o.id, objectBounds(o));
      }
    }

    const { container } = render(
      <ConnectorObject
        connector={conn as any}
        rects={actualRects}
        selected={true}
        zoom={1}
        onPointerDown={() => {}}
      />,
    );

    // Should have two handle circles
    const handles = container.querySelectorAll('circle');
    expect(handles.length).toBe(2);
  });
});

describe('TC-18: ConnectorTool gesture', () => {
  it('creates a connector on drag between two objects', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const camera = makeCamera();

    // Create two shapes
    createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'u');
    createShape(doc, { kind: 'rect', rect: { x: 300, y: 0, width: 100, height: 100 }, at: { x: 300, y: 0 } }, 'u');

    const snapshot = objects(doc);
    const onCreated = vi.fn();

    const { container } = render(
      <ConnectorTool
        camera={camera}
        snapshot={snapshot}
        doc={doc}
        createdBy="u"
        onCreated={onCreated}
      />,
    );

    const overlay = container.querySelector('[data-testid="connector-tool-overlay"]')!;

    // Drag from first shape to second shape
    act(() => {
      fireEvent.pointerDown(overlay, { clientX: 50, clientY: 50, button: 0 });
      fireEvent.pointerMove(overlay, { clientX: 200, clientY: 50, button: 0 });
      fireEvent.pointerUp(overlay, { clientX: 350, clientY: 50, button: 0 });
    });

    expect(onCreated).toHaveBeenCalledTimes(1);
    const notes = objects(doc);
    const connectors = notes.filter((o) => o.type === 'connector');
    expect(connectors).toHaveLength(1);
  });

  it('does not create a connector for a click (no drag)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const camera = makeCamera();

    createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'u');

    const snapshot = objects(doc);
    const onCreated = vi.fn();

    const { container } = render(
      <ConnectorTool
        camera={camera}
        snapshot={snapshot}
        doc={doc}
        createdBy="u"
        onCreated={onCreated}
      />,
    );

    const overlay = container.querySelector('[data-testid="connector-tool-overlay"]')!;

    act(() => {
      fireEvent.pointerDown(overlay, { clientX: 50, clientY: 50, button: 0 });
      fireEvent.pointerUp(overlay, { clientX: 50, clientY: 50, button: 0 });
    });

    expect(onCreated).not.toHaveBeenCalled();
  });
});

describe('TC-19: useActiveTool shortcut', () => {
  it('switches to shape tool on S key', () => {
    const { result } = renderHook(() =>
      useActiveTool({ canEdit: true, select: () => {} }),
    );

    expect(result.current.tool).toBe('select');

    act(() => {
      fireEvent.keyDown(document, { key: 's', code: 'KeyS' });
    });

    expect(result.current.tool).toBe('shape');
  });

  it('switches to connector tool on L key', () => {
    const { result } = renderHook(() =>
      useActiveTool({ canEdit: true, select: () => {} }),
    );

    act(() => {
      fireEvent.keyDown(document, { key: 'l', code: 'KeyL' });
    });

    expect(result.current.tool).toBe('connector');
  });

  it('returns to select on Escape', () => {
    const { result } = renderHook(() =>
      useActiveTool({ canEdit: true, select: () => {} }),
    );

    act(() => {
      fireEvent.keyDown(document, { key: 's', code: 'KeyS' });
    });
    expect(result.current.tool).toBe('shape');

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    });
    expect(result.current.tool).toBe('select');
  });

  it('does not switch when typing in an input', () => {
    const { result } = renderHook(() =>
      useActiveTool({ canEdit: true, select: () => {} }),
    );

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    act(() => {
      fireEvent.keyDown(input, { key: 's', code: 'KeyS' });
    });

    expect(result.current.tool).toBe('select');
    document.body.removeChild(input);
  });
});

describe('TC-20: ShapeToolbar swatches', () => {
  it('renders all fill swatches', () => {
    const { container } = render(
      <ShapeToolbar
        fill="white"
        stroke="dark"
        onFill={() => {}}
        onStroke={() => {}}
        onDelete={() => {}}
      />,
    );
    // 7 fill swatches (none, white, blue, green, yellow, pink, grey)
    const fillSwatches = container.querySelectorAll('[aria-label$="fill"]');
    expect(fillSwatches).toHaveLength(7);
  });

  it('renders all stroke swatches', () => {
    const { container } = render(
      <ShapeToolbar
        fill="white"
        stroke="dark"
        onFill={() => {}}
        onStroke={() => {}}
        onDelete={() => {}}
      />,
    );
    const strokeSwatches = container.querySelectorAll('[aria-label$="outline"]');
    expect(strokeSwatches).toHaveLength(6);
  });

  it('calls onFill when a fill swatch is clicked', () => {
    const onFill = vi.fn();
    const { container } = render(
      <ShapeToolbar
        fill="white"
        stroke="dark"
        onFill={onFill}
        onStroke={() => {}}
        onDelete={() => {}}
      />,
    );
    const yellowSwatch = container.querySelector('[aria-label="Yellow fill"]')!;
    act(() => {
      fireEvent.click(yellowSwatch);
    });
    expect(onFill).toHaveBeenCalledWith('yellow');
  });

  it('calls onDelete when delete is clicked', () => {
    const onDelete = vi.fn();
    const { container } = render(
      <ShapeToolbar
        fill="white"
        stroke="dark"
        onFill={() => {}}
        onStroke={() => {}}
        onDelete={onDelete}
      />,
    );
    const deleteBtn = container.querySelector('[aria-label="Delete shape"]')!;
    act(() => {
      fireEvent.click(deleteBtn);
    });
    expect(onDelete).toHaveBeenCalled();
  });
});

describe('TC-21: Toolbar tool buttons', () => {
  it('renders Shape and Connector buttons', () => {
    const { container } = render(
      <Toolbar
        tool="select"
        setTool={() => {}}
        activeTool="select"
        setActiveTool={() => {}}
        shapeKind="rect"
        setShapeKind={() => {}}
        onCreateSticky={() => {}}
      />,
    );
    expect(container.querySelector('[aria-label="Shape (S)"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Connector (L)"]')).not.toBeNull();
  });

  it('shows shape kind menu when shape tool is active', () => {
    const { container } = render(
      <Toolbar
        tool="select"
        setTool={() => {}}
        activeTool="shape"
        setActiveTool={() => {}}
        shapeKind="rect"
        setShapeKind={() => {}}
        onCreateSticky={() => {}}
      />,
    );
    const menu = container.querySelector('[data-testid="shape-kind-menu"]');
    expect(menu).not.toBeNull();
    expect(menu?.querySelector('[aria-label="Rectangle"]')).not.toBeNull();
    expect(menu?.querySelector('[aria-label="Ellipse"]')).not.toBeNull();
    expect(menu?.querySelector('[aria-label="Diamond"]')).not.toBeNull();
  });

  it('does not show shape kind menu when shape tool is not active', () => {
    const { container } = render(
      <Toolbar
        tool="select"
        setTool={() => {}}
        activeTool="select"
        setActiveTool={() => {}}
        shapeKind="rect"
        setShapeKind={() => {}}
        onCreateSticky={() => {}}
      />,
    );
    const menu = container.querySelector('[data-testid="shape-kind-menu"]');
    expect(menu).toBeNull();
  });
});

describe('TC-22: SelectionBar shows ShapeToolbar for shapes', () => {
  // This is tested indirectly through the SelectionBar component
  it('shows ShapeToolbar when a shape is selected', async () => {
    const { SelectionBar } = await import('../../src/client/board/SelectionBar');
    const shape = {
      id: 's1',
      type: 'shape' as const,
      x: 0, y: 0, width: 160, height: 160, z: 1,
      kind: 'rect' as const, fill: 'white' as const, stroke: 'dark' as const, label: '',
    };

    const { container } = render(
      <SelectionBar
        ids={new Set(['s1'])}
        snapshot={[shape]}
        onDelete={() => {}}
        onShapeFill={() => {}}
        onShapeStroke={() => {}}
      />,
    );

    // Should show the ShapeToolbar with fill swatches
    const fillSwatches = container.querySelectorAll('[aria-label$="fill"]');
    expect(fillSwatches.length).toBe(7);
  });
});

describe('TC-28: keyboard shortcuts do not fire while typing', () => {
  it('S key does not switch tool when focus is in a textarea', () => {
    const { result } = renderHook(() =>
      useActiveTool({ canEdit: true, select: () => {}}),
    );

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    act(() => {
      fireEvent.keyDown(textarea, { key: 's', code: 'KeyS' });
    });

    expect(result.current.tool).toBe('select');
    document.body.removeChild(textarea);
  });
});
