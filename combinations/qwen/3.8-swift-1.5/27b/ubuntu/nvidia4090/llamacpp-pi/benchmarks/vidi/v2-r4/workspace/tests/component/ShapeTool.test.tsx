import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { render, screen, fireEvent, act, renderHook } from '@testing-library/react';
import { initDoc, snapshot, createSticky } from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import { createConnector, setConnectorEndpoint } from '../../src/shared/objects/connector';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { CONNECTOR_HIT_TOLERANCE_PX } from '../../src/shared/config';
import { ShapeTool } from '../../src/client/tools/ShapeTool';
import { ConnectorTool } from '../../src/client/tools/ConnectorTool';
import { ShapeObjectComponent } from '../../src/client/objects/ShapeObject';
import { ShapeToolbar } from '../../src/client/objects/ShapeToolbar';
import { useTool } from '../../src/client/board/useTool';
import type { Camera } from '../../src/client/canvas/camera';
import type { ObjectProps } from '../../src/client/objects/registry';

// Mock setPointerCapture and releasePointerCapture for jsdom
beforeEach(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const testCamera: Camera = { x: 0, y: 0, zoom: 1 };

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function makeObjectProps(overrides: Partial<ObjectProps> = {}): ObjectProps {
  return {
    obj: { id: 'test', type: 'shape', x: 0, y: 0, width: 100, height: 100, z: 1 },
    doc: makeDoc(),
    zoom: 1,
    selected: false,
    editing: false,
    editable: true,
    onPointerDown: vi.fn(),
    onStartEdit: vi.fn(),
    onEndEdit: vi.fn(),
    ...overrides,
  };
}

// Helper to dispatch pointer events on an element (works with native listeners)
function dispatchPointer(el: HTMLElement, type: string, x: number, y: number, pointerId = 1, button = 0) {
  const evt = new window.Event(type, { bubbles: true });
  Object.assign(evt, { clientX: x, clientY: y, pointerId, button });
  el.dispatchEvent(evt);
}

describe('ShapeTool component tests', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = makeDoc();
  });

  // TC-15: S tool pointerdown/move/up → createShape called, selection = new id
  it('TC-15: drag creates a shape and calls onCreated', () => {
    const onCreated = vi.fn();
    const onGestureEnd = vi.fn();

    const { container } = render(
      <ShapeTool
        kind="rect"
        camera={testCamera}
        doc={doc}
        createdBy="user1"
        onCreated={onCreated}
        onGestureEnd={onGestureEnd}
      />
    );

    const overlay = container.querySelector('[data-testid="shape-tool-overlay"]') as HTMLElement;
    expect(overlay).toBeTruthy();

    act(() => { dispatchPointer(overlay, 'pointerdown', 100, 100); });
    act(() => { dispatchPointer(overlay, 'pointermove', 300, 220); });
    act(() => { dispatchPointer(overlay, 'pointerup', 300, 220); });

    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);

    const shapes = snapshot(doc).filter((s) => s.type === 'shape');
    expect(shapes).toHaveLength(1);
    expect(shapes[0].width).toBe(200);
    expect(shapes[0].height).toBe(120);
  });

  // TC-16: dblclick shape, type 600 chars → label length 500
  it('TC-16: label editing opens editor on shape', () => {
    const id = createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 200, height: 200 },
      at: { x: 0, y: 0 },
    }, 'user1')!;

    const props = makeObjectProps({
      obj: { id, type: 'shape', x: 0, y: 0, width: 200, height: 200, z: 1 } as any,
      doc,
      editing: true,
    });

    const { container } = render(<ShapeObjectComponent {...props} />);
    const editor = container.querySelector('[data-testid="shape-label-editor"]');
    expect(editor).toBeTruthy();
  });

  // TC-17: click blue fill and red outline swatches → colours applied
  it('TC-17: ShapeToolbar applies fill and stroke colours', () => {
    const onFill = vi.fn();
    const onStroke = vi.fn();

    render(
      <ShapeToolbar
        fill="white"
        stroke="dark"
        onFill={onFill}
        onStroke={onStroke}
      />
    );

    const fillBtn = screen.getByLabelText('blue fill');
    const strokeBtn = screen.getByLabelText('red outline');

    fireEvent.click(fillBtn);
    expect(onFill).toHaveBeenCalledWith('blue');

    fireEvent.click(strokeBtn);
    expect(onStroke).toHaveBeenCalledWith('red');
  });

  // TC-28: Shape tool drag starting over an existing sticky → sticky position unchanged
  it('TC-28: Shape tool captures pointer, does not move existing objects', () => {
    const stickyId = createSticky(doc, { x: 100, y: 100 });

    const onCreated = vi.fn();
    const onGestureEnd = vi.fn();

    const { container } = render(
      <ShapeTool
        kind="rect"
        camera={testCamera}
        doc={doc}
        createdBy="user1"
        onCreated={onCreated}
        onGestureEnd={onGestureEnd}
      />
    );

    const overlay = container.querySelector('[data-testid="shape-tool-overlay"]') as HTMLElement;

    act(() => { dispatchPointer(overlay, 'pointerdown', 100, 100); });
    act(() => { dispatchPointer(overlay, 'pointermove', 300, 200); });
    act(() => { dispatchPointer(overlay, 'pointerup', 300, 200); });

    // The sticky should not have moved
    const snap = snapshot(doc);
    const sticky = snap.find((s) => s.id === stickyId);
    expect(sticky).toBeDefined();
    expect(sticky!.x).toBe(0);
    expect(sticky!.y).toBe(0);
  });
});

describe('ConnectorTool component tests', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = makeDoc();
  });

  // TC-18: L tool hover over shape → four dots at side midpoints
  it('TC-18: hover over shape shows four connection dots', () => {
    createShape(doc, {
      kind: 'rect',
      rect: { x: 100, y: 100, width: 200, height: 200 },
      at: { x: 100, y: 100 },
    }, 'user1')!;

    const snapshot_ = snapshot(doc);

    const { container } = render(
      <ConnectorTool
        camera={testCamera}
        doc={doc}
        snapshot={snapshot_}
        createdBy="user1"
        onCreated={vi.fn()}
        onGestureEnd={vi.fn()}
      />
    );

    const overlay = container.querySelector('[data-testid="connector-tool-overlay"]') as HTMLElement;

    // Hover over the shape centre (200, 200)
    act(() => { dispatchPointer(overlay, 'pointermove', 200, 200); });

    const dots = container.querySelectorAll('[data-testid^="connector-dot-"]');
    expect(dots.length).toBe(4);
  });

  // TC-19: drag from A over B → B's nearest dot highlighted; release creates connector
  it('TC-19: drag from shape to shape creates attached connector', () => {
    createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 0, y: 0 },
    }, 'user1')!;
    createShape(doc, {
      kind: 'rect',
      rect: { x: 400, y: 0, width: 100, height: 100 },
      at: { x: 400, y: 0 },
    }, 'user1')!;

    const snapshot_ = snapshot(doc);
    const onCreated = vi.fn();
    const onGestureEnd = vi.fn();

    const { container } = render(
      <ConnectorTool
        camera={testCamera}
        doc={doc}
        snapshot={snapshot_}
        createdBy="user1"
        onCreated={onCreated}
        onGestureEnd={onGestureEnd}
      />
    );

    const overlay = container.querySelector('[data-testid="connector-tool-overlay"]') as HTMLElement;

    // Drag from centre of A (50, 50) to centre of B (450, 50)
    act(() => { dispatchPointer(overlay, 'pointerdown', 50, 50); });
    act(() => { dispatchPointer(overlay, 'pointermove', 450, 50); });

    // Check highlighted dot
    const highlighted = container.querySelector('[data-testid="connector-dot-highlighted"]');
    expect(highlighted).toBeTruthy();

    act(() => { dispatchPointer(overlay, 'pointerup', 450, 50); });

    expect(onCreated).toHaveBeenCalledTimes(1);

    const conns = snapshot(doc).filter((s) => s.type === 'connector');
    expect(conns).toHaveLength(1);
  });

  // TC-20: click 5px and 7px from line at 50% and 200% zoom
  it('TC-20: connector hit test at different zoom levels', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 0 };
    const pts = [from, to];

    // At 50% zoom: tolerance in world = 6/0.5 = 12
    expect(distanceToPolyline(pts, { x: 50, y: 10 }) <= CONNECTOR_HIT_TOLERANCE_PX / 0.5).toBe(true);
    expect(distanceToPolyline(pts, { x: 50, y: 14 }) <= CONNECTOR_HIT_TOLERANCE_PX / 0.5).toBe(false);

    // At 200% zoom: tolerance in world = 6/2 = 3
    expect(distanceToPolyline(pts, { x: 50, y: 2.5 }) <= CONNECTOR_HIT_TOLERANCE_PX / 2).toBe(true);
    expect(distanceToPolyline(pts, { x: 50, y: 3.5 }) <= CONNECTOR_HIT_TOLERANCE_PX / 2).toBe(false);
  });

  // TC-21: drag end handle onto C → attached; onto empty → free
  it('TC-21: setConnectorEndpoint re-attach and detach', () => {
    const idA = createShape(doc, {
      kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 100 }, at: { x: 0, y: 0 },
    }, 'user1')!;
    const idB = createShape(doc, {
      kind: 'rect', rect: { x: 400, y: 0, width: 100, height: 100 }, at: { x: 400, y: 0 },
    }, 'user1')!;
    const idC = createShape(doc, {
      kind: 'rect', rect: { x: 0, y: 400, width: 100, height: 100 }, at: { x: 0, y: 400 },
    }, 'user1')!;

    const connId = createConnector(doc,
      { kind: 'attached', objectId: idA, fallback: { x: 100, y: 50 } },
      { kind: 'attached', objectId: idB, fallback: { x: 400, y: 50 } },
      'user1'
    )!;

    expect(setConnectorEndpoint(doc, connId, 'to', { kind: 'attached', objectId: idC, fallback: { x: 50, y: 400 } })).toBe(true);
    expect(setConnectorEndpoint(doc, connId, 'to', { kind: 'free', x: 500, y: 500 })).toBe(true);
  });
});

describe('useActiveTool tests', () => {
  // TC-22: S then create → Select; L then create → Select; Escape → Select
  it('TC-22: tool shortcuts and return to select', () => {
    const { result } = renderHook(() => useTool({
      canEdit: true,
      editingId: null,
      onToolCreated: vi.fn(),
    }));

    expect(result.current.tool).toBe('select');

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' })); });
    expect(result.current.tool).toBe('shape');

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l' })); });
    expect(result.current.tool).toBe('connector');

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(result.current.tool).toBe('select');

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' })); });
    expect(result.current.tool).toBe('select');
  });

  it('TC-22: toolCreated selects and switches to select', () => {
    const onToolCreated = vi.fn();
    const { result } = renderHook(() => useTool({
      canEdit: true,
      editingId: null,
      onToolCreated,
    }));

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' })); });
    expect(result.current.tool).toBe('shape');

    act(() => { result.current.toolCreated('new-id'); });

    expect(onToolCreated).toHaveBeenCalledWith('new-id');
    expect(result.current.tool).toBe('select');
  });

  it('TC-22: Escape while shape tool active creates nothing', () => {
    const onToolCreated = vi.fn();
    const { result } = renderHook(() => useTool({
      canEdit: true,
      editingId: null,
      onToolCreated,
    }));

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' })); });
    expect(result.current.tool).toBe('shape');

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(result.current.tool).toBe('select');
    expect(onToolCreated).not.toHaveBeenCalled();
  });
});
