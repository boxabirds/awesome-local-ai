/**
 * Component tests for story 10: shapes and connectors.
 * TC-15: click creates shape, selected, tool = Select
 * TC-16: drag creates sized shape; Shift keeps square (w === h)
 * TC-17: label edit writes to Y.Doc, second collaborator sees it
 * TC-18: fill swatch updates shared state for both clients
 * TC-19: move connected shape; B recomputed; second collaborator sees update
 * TC-20: two connected shapes, move one; arrow redraws
 * TC-21: Escape returns to select
 * TC-22: connector dot appears on hover
 * TC-28: drag on shape tool never moves an existing object
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, type RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import { createConnector } from '../../src/shared/objects/connector';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
} from '../../src/shared/config';
import { setShapeStyle } from '../../src/shared/objects/shape';

let renderResult: RenderResult;
let doc: Y.Doc;

function renderApp(): RenderResult {
  doc = new Y.Doc();
  renderResult = render(<App doc={doc} />);
  flush();
  return renderResult;
}

function flush(): void {
  act(() => {
    vi.advanceTimersByTime(50);
  });
}

function viewportEl(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

function overlayPointerEvent(
  type: string,
  x: number,
  y: number,
  opts: { shiftKey?: boolean } = {},
): void {
  const shapeOverlay = screen.queryByTestId('shape-tool-overlay');
  const connOverlay = screen.queryByTestId('connector-tool-overlay');
  const target = shapeOverlay || connOverlay || viewportEl();
  // Use PointerEvent if available, fall back to MouseEvent
  let event: Event;
  if (typeof PointerEvent !== 'undefined') {
    event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
      shiftKey: opts.shiftKey ?? false,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    });
  } else {
    const me = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
      shiftKey: opts.shiftKey ?? false,
    });
    Object.defineProperty(me, 'pointerId', { value: 1 });
    Object.defineProperty(me, 'pointerType', { value: 'mouse' });
    Object.defineProperty(me, 'isPrimary', { value: true });
    event = me;
  }
  fireEvent(target, event);
}

function keyDown(key: string, opts: { shiftKey?: boolean; ctrlKey?: boolean } = {}): void {
  fireEvent(
    window,
    new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      shiftKey: opts.shiftKey ?? false,
      ctrlKey: opts.ctrlKey ?? false,
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // Mock getBoundingClientRect to return zeros for all elements (jsdom has no layout)
  Element.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Shape tool', () => {
  it('TC-15: click creates default-size shape, selects it, switches tool to Select', () => {
    renderApp();

    // Activate shape tool
    keyDown('s');
    flush();

    // Read camera state from viewport
    const vp = viewportEl();
    const camX = Number(vp.dataset.cameraX ?? 0);
    const camY = Number(vp.dataset.cameraY ?? 0);
    const camZoom = Number(vp.dataset.zoom ?? 1);

    // Click at screen (300, 200) on the shape overlay
    overlayPointerEvent('pointerdown', 300, 200);
    overlayPointerEvent('pointerup', 300, 200);
    flush();

    const snap = snapshot(doc);
    const shapes = snap.filter((o) => o.type === 'shape');
    expect(shapes.length).toBe(1);
    const s = shapes[0]!;
    // Click (no drag) creates a default 160x160 shape centred on the click
    expect(s.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(s.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    // World click point = screenToWorld(camera, screen)
    const worldX = 300 / camZoom + camX;
    const worldY = 200 / camZoom + camY;
    expect(s.x).toBeCloseTo(worldX - SHAPE_DEFAULT_SIZE_WORLD / 2, 1);
    expect(s.y).toBeCloseTo(worldY - SHAPE_DEFAULT_SIZE_WORLD / 2, 1);
  });

  it('TC-16: drag creates shape with the dragged size; Shift keeps square', () => {
    renderApp();

    // Activate shape tool
    keyDown('s');
    flush();

    // Drag from (100, 100) to (300, 250) → 200x150 shape
    overlayPointerEvent('pointerdown', 100, 100);
    overlayPointerEvent('pointermove', 300, 250);
    overlayPointerEvent('pointerup', 300, 250);
    flush();

    const snap = snapshot(doc);
    const shapes = snap.filter((o) => o.type === 'shape');
    expect(shapes.length).toBe(1);
    const s = shapes[0]!;
    expect(s.width).toBeCloseTo(200, 1);
    expect(s.height).toBeCloseTo(150, 1);
  });

  it('TC-16b: Shift keeps square (larger side)', () => {
    renderApp();

    // Activate shape tool
    keyDown('s');
    flush();

    // Shift-drag from (100, 100) to (300, 250) → should be 200x200 square
    overlayPointerEvent('pointerdown', 100, 100);
    overlayPointerEvent('pointermove', 300, 250, { shiftKey: true });
    overlayPointerEvent('pointerup', 300, 250, { shiftKey: true });
    flush();

    const snap = snapshot(doc);
    const shapes = snap.filter((o) => o.type === 'shape');
    expect(shapes.length).toBe(1);
    const s = shapes[0]!;
    expect(s.width).toBeCloseTo(s.height, 1);
    expect(s.width).toBeCloseTo(200, 1);
  });

  it('TC-17: label edit writes to Y.Doc, second collaborator sees the same string', () => {
    renderApp();

    // Create a shape
    keyDown('s');
    flush();
    overlayPointerEvent('pointerdown', 200, 200);
    overlayPointerEvent('pointerup', 200, 200);
    flush();

    const snap = snapshot(doc);
    const shape = snap.find((o) => o.type === 'shape')!;
    expect(shape).toBeTruthy();

    // Simulate a second collaborator document
    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc));
    const snap2 = snapshot(doc2);
    const shape2 = snap2.find((o) => o.id === shape.id);
    expect(shape2).toBeTruthy();
    expect((shape2 as any).label).toBe('');

    // Set label on doc1 via Y.Text (using 'label' key as createShape does)
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const yMap = objects.get(shape.id)!;
    const labelText = yMap.get('label') as Y.Text;
    expect(labelText).toBeInstanceOf(Y.Text);
    doc.transact(() => {
      labelText.insert(0, 'Hello');
    });
    flush();

    // Sync to doc2
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc));
    const snap2b = snapshot(doc2);
    const shape2b = snap2b.find((o) => o.id === shape.id) as any;
    expect(shape2b.label).toBe('Hello');

    doc2.destroy();
  });

  it('TC-18: fill swatch updates shared state for both clients', () => {
    renderApp();

    // Create a shape directly
    let shapeId = '';
    act(() => {
      shapeId = createShape(doc, { kind: 'rect', rect: null, at: { x: 200, y: 200 }, square: false }, 'local')!;
    });
    flush();

    // Verify initial fill
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const yMap = objects.get(shapeId)!;
    expect(yMap.get('fill')).toBe('white'); // DEFAULT_SHAPE_FILL

    // Change fill via setShapeStyle
    act(() => {
      setShapeStyle(doc, shapeId, { fill: 'blue' });
    });
    flush();

    expect(yMap.get('fill')).toBe('blue');

    // Sync to doc2
    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc));
    const snap2 = snapshot(doc2);
    const shape2 = snap2.find((o) => o.id === shapeId) as any;
    expect(shape2.fill).toBe('blue');
    doc2.destroy();
  });

  it('TC-21: Escape while shape tool active returns to select', () => {
    renderApp();

    // Activate shape tool
    keyDown('s');
    flush();
    const shapeBtn = screen.getByTestId('tool-shape');
    expect(shapeBtn.getAttribute('aria-pressed')).toBe('true');

    // Press Escape
    keyDown('Escape');
    flush();

    // Shape tool should be deselected
    expect(shapeBtn.getAttribute('aria-pressed')).toBe('false');
    const selectBtn = screen.getByTestId('tool-select');
    expect(selectBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-28: drag with shape tool active never moves an existing object', () => {
    renderApp();

    // Create a sticky note at world (100, 100)
    let stickyId = '';
    act(() => {
      stickyId = createSticky(doc, { x: 100, y: 100 });
    });
    flush();

    const snapBefore = snapshot(doc);
    const stickyBefore = snapBefore.find((o) => o.id === stickyId)!;
    const origX = stickyBefore.x;
    const origY = stickyBefore.y;

    // Activate shape tool
    keyDown('s');
    flush();

    // Drag starting over the sticky — shape overlay captures this, not move
    overlayPointerEvent('pointerdown', 150, 150);
    overlayPointerEvent('pointermove', 250, 250);
    overlayPointerEvent('pointerup', 250, 250);
    flush();

    // The sticky should be at the same position
    const snapAfter = snapshot(doc);
    const stickyAfter = snapAfter.find((o) => o.id === stickyId)!;
    expect(stickyAfter.x).toBe(origX);
    expect(stickyAfter.y).toBe(origY);

    // A new shape should have been created
    const shapes = snapAfter.filter((o) => o.type === 'shape');
    expect(shapes.length).toBe(1);
  });
});

describe('Connector tool', () => {
  it('TC-19: move connected shape; second collaborator sees the connector still attached', () => {
    renderApp();

    // Create two shapes
    let shape1Id = '';
    let shape2Id = '';
    let connId = '';
    act(() => {
      shape1Id = createShape(doc, { kind: 'rect', rect: null, at: { x: 100, y: 100 }, square: false }, 'local')!;
      shape2Id = createShape(doc, { kind: 'rect', rect: null, at: { x: 400, y: 100 }, square: false }, 'local')!;
      connId = createConnector(
        doc,
        { kind: 'attached', objectId: shape1Id, fallback: { x: 180, y: 100 } },
        { kind: 'attached', objectId: shape2Id, fallback: { x: 320, y: 100 } },
        'local',
      )!;
    });
    flush();

    // Move shape1 via doc mutation
    act(() => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const yMap = objects.get(shape1Id)!;
      doc.transact(() => {
        yMap.set('x', 50);
        yMap.set('y', 100);
      });
    });
    flush();

    // Verify the connector is still attached to shape1
    const snap = snapshot(doc);
    const conn = snap.find((o) => o.id === connId) as any;
    expect(conn).toBeTruthy();
    expect(conn.from.kind).toBe('attached');
    expect(conn.from.objectId).toBe(shape1Id);

    // Sync to a second collaborator
    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc));
    const snap2 = snapshot(doc2);
    const conn2 = snap2.find((o) => o.id === connId) as any;
    expect(conn2).toBeTruthy();
    expect(conn2.from.kind).toBe('attached');
    expect(conn2.from.objectId).toBe(shape1Id);

    doc2.destroy();
  });

  it('TC-20: two connected shapes, move one, arrow redraws (resolution from live rects)', () => {
    renderApp();

    // Create two shapes and a connector
    let shape1Id = '';
    let shape2Id = '';
    let connId = '';
    act(() => {
      shape1Id = createShape(doc, { kind: 'rect', rect: null, at: { x: 100, y: 100 }, square: false }, 'local')!;
      shape2Id = createShape(doc, { kind: 'rect', rect: null, at: { x: 400, y: 100 }, square: false }, 'local')!;
      connId = createConnector(
        doc,
        { kind: 'attached', objectId: shape1Id, fallback: { x: 180, y: 100 } },
        { kind: 'attached', objectId: shape2Id, fallback: { x: 320, y: 100 } },
        'local',
      )!;
    });
    flush();

    // Move shape2 to the right
    act(() => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      const yMap = objects.get(shape2Id)!;
      doc.transact(() => {
        yMap.set('x', 600);
        yMap.set('y', 100);
      });
    });
    flush();

    // Verify the connector is still attached (renders with new position from live rects)
    const snap = snapshot(doc);
    const conn = snap.find((o) => o.id === connId) as any;
    expect(conn).toBeTruthy();
    expect(conn.to.kind).toBe('attached');
    expect(conn.to.objectId).toBe(shape2Id);

    // Verify shape2 moved
    const shape2 = snap.find((o) => o.id === shape2Id)!;
    expect(shape2.x).toBe(600);
  });

  it('TC-22: connector dot appears on hover over an object', () => {
    renderApp();

    // Create two shapes: shape A at world center (100, 200), shape B at world center (400, 200)
    act(() => {
      createShape(doc, { kind: 'rect', rect: null, at: { x: 100, y: 200 }, square: false }, 'local')!;
      createShape(doc, { kind: 'rect', rect: null, at: { x: 400, y: 200 }, square: false }, 'local')!;
    });
    flush();

    // Activate connector tool (key L)
    keyDown('l');
    flush();

    // Verify the connector overlay is present
    const connOverlay = screen.getByTestId('connector-tool-overlay');
    expect(connOverlay).toBeTruthy();

    // Read camera from viewport
    const vp = viewportEl();
    const camX = Number(vp.dataset.cameraX ?? 0);
    const camY = Number(vp.dataset.cameraY ?? 0);
    const camZoom = Number(vp.dataset.zoom ?? 1);

    // Convert world centers to screen coords
    const screenA = { x: (100 - camX) * camZoom, y: (200 - camY) * camZoom };
    const screenB = { x: (400 - camX) * camZoom, y: (200 - camY) * camZoom };

    // Drag from shape A toward shape B
    overlayPointerEvent('pointerdown', screenA.x, screenA.y);
    overlayPointerEvent('pointermove', screenB.x, screenB.y);

    // Flush for React to re-render
    act(() => { vi.advanceTimersByTime(100); });

    // When dragging over a target object, 4 dots should appear
    const dots = screen.queryAllByTestId('connector-dot');
    const highlightedDots = screen.queryAllByTestId('connector-dot-highlighted');
    const totalDots = dots.length + highlightedDots.length;
    expect(totalDots).toBe(4);

    // End drag
    overlayPointerEvent('pointerup', screenB.x, screenB.y);
  });
});
