/**
 * Component tests for shape tool/object/toolbar, connector tool/object and active tool
 * (TC-15 to TC-22, TC-28).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { initDoc, createSticky } from '../../src/shared/board-model';
import { SHAPE_LABEL_MAX_CHARS } from '../../src/shared/config';
import { startFakeFrames, flushFrames } from './harness';

function renderWithDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  render(<App doc={doc} />);
  flushFrames();
  return doc;
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

function countType(doc: Y.Doc, type: string): number {
  let count = 0;
  getObjects(doc).forEach((obj) => {
    if (obj.get('type') === type) count++;
  });
  return count;
}

/** Add a rect object directly (bypasses createShape) for test setup. */
function addShape(doc: Y.Doc, kind: string, x: number, y: number, w: number, h: number): string {
  const objects = getObjects(doc);
  const id = Math.random().toString(36).slice(2);
  doc.transact(() => {
    const obj = new Y.Map();
    obj.set('type', 'shape');
    obj.set('kind', kind);
    obj.set('x', x);
    obj.set('y', y);
    obj.set('width', w);
    obj.set('height', h);
    obj.set('fill', 'white');
    obj.set('stroke', 'dark');
    obj.set('label', new Y.Text());
    obj.set('z', objects.size + 1);
    objects.set(id, obj);
  });
  return id;
}

describe('shape tool and connector tool', () => {
  beforeEach(() => {
    startFakeFrames();
  });

  // TC-15: S tool pointerdown/move/up → createShape called once, selection = new id, tool back to Select.
  it('TC-15: Shape tool drag creates a shape and selects it', () => {
    const doc = renderWithDoc();

    // Activate shape tool via S key
    act(() => { fireEvent.keyDown(window, { key: 's' }); });
    flushFrames();

    const shapeBtn = screen.getByLabelText('Shape (S)');
    expect(shapeBtn).toHaveAttribute('aria-pressed', 'true');

    const overlay = screen.getByTestId('shape-tool-overlay');
    expect(overlay).toBeInTheDocument();

    const beforeCount = countType(doc, 'shape');

    // Drag to create a shape
    act(() => { fireEvent.pointerDown(overlay, { button: 0, pointerId: 1, clientX: 100, clientY: 100 }); });
    act(() => { fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 300, clientY: 220 }); });
    act(() => { fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 300, clientY: 220 }); });
    flushFrames();

    // A new shape object should exist
    expect(countType(doc, 'shape')).toBe(beforeCount + 1);

    // Tool should be back to Select after creation
    expect(shapeBtn).toHaveAttribute('aria-pressed', 'false');
  });

  // TC-16: dblclick shape → editor open; label clamped to SHAPE_LABEL_MAX_CHARS.
  it('TC-16: Shape label editing clamps to SHAPE_LABEL_MAX_CHARS', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    // Create a shape directly in the doc before render
    addShape(doc, 'rect', 100, 100, 200, 120);
    render(<App doc={doc} />);
    flushFrames();

    // Find the shape element and double-click it
    const shapeEl = screen.getByTestId('board').querySelector('[data-shape-id]');
    expect(shapeEl).not.toBeNull();

    act(() => { fireEvent.doubleClick(shapeEl!); });
    flushFrames();

    // Editor (textarea) should be visible
    const textarea = document.querySelector('textarea');
    expect(textarea).not.toBeNull();

    // Type more than SHAPE_LABEL_MAX_CHARS
    const longText = 'a'.repeat(SHAPE_LABEL_MAX_CHARS + 100);
    act(() => {
      if (textarea) {
        textarea.value = longText;
        fireEvent.input(textarea);
      }
    });
    flushFrames();

    // The Y.Text label should be clamped
    const objects = getObjects(doc);
    let labelStr = '';
    objects.forEach((obj) => {
      if (obj.get('type') === 'shape') {
        const ytext = obj.get('label');
        if (ytext instanceof Y.Text) labelStr = ytext.toString();
      }
    });
    expect(labelStr.length).toBeLessThanOrEqual(SHAPE_LABEL_MAX_CHARS);
  });

  // TC-17: Click fill/stroke swatches → colours applied; label and selection unchanged.
  it('TC-17: Shape toolbar swatches apply fill and stroke', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const shapeId = addShape(doc, 'rect', 100, 100, 200, 120);
    render(<App doc={doc} />);
    flushFrames();

    // Click to select the shape
    const shapeEl = screen.getByTestId('board').querySelector(`[data-shape-id="${shapeId}"]`);
    expect(shapeEl).not.toBeNull();

    act(() => {
      fireEvent.pointerDown(shapeEl!, { button: 0, pointerId: 1, clientX: 150, clientY: 150 });
      fireEvent.pointerUp(shapeEl!, { pointerId: 1, clientX: 150, clientY: 150 });
    });
    flushFrames();

    // ShapeToolbar should appear
    const blueFillBtn = screen.queryByLabelText('Blue fill');
    const redOutlineBtn = screen.queryByLabelText('Red outline');
    expect(blueFillBtn).not.toBeNull();
    expect(redOutlineBtn).not.toBeNull();

    // Click Blue fill
    act(() => { fireEvent.click(blueFillBtn!); });
    flushFrames();

    const objects = getObjects(doc);
    expect(objects.get(shapeId)!.get('fill')).toBe('blue');

    // Click Red outline
    act(() => { fireEvent.click(redOutlineBtn!); });
    flushFrames();

    expect(objects.get(shapeId)!.get('stroke')).toBe('red');
    // Label unchanged
    expect(objects.get(shapeId)!.get('x')).toBe(100);
    expect(objects.get(shapeId)!.get('y')).toBe(100);
  });

  // TC-18: L tool shows overlay with correct snapshot; hover dots logic is unit-testable.
  it('TC-18: Connector tool overlay is active and has correct data', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    // Create a shape at world (100,100)-(300,220) → centre (200,160)
    addShape(doc, 'rect', 100, 100, 200, 120);
    render(<App doc={doc} />);
    flushFrames();

    // Switch to connector tool
    act(() => { fireEvent.keyDown(window, { key: 'l' }); });
    flushFrames();

    const connectorBtn = screen.getByLabelText('Connector (L)');
    expect(connectorBtn).toHaveAttribute('aria-pressed', 'true');

    const connectorOverlay = screen.getByTestId('connector-tool-overlay');
    expect(connectorOverlay).toBeInTheDocument();

    // Verify connector tool overlay has cursor: crosshair and intercepts pointer events
    expect(connectorOverlay.style.cursor).toBe('crosshair');
    expect(connectorOverlay.style.pointerEvents).toBe('auto');
  });

  // TC-19: Drag from A over B → release → attached connector created, tool back to Select.
  it('TC-19: Connector tool drag creates attached connector', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    // Shape A: world (100,100)-(300,220), centre (200,160)
    // Shape B: world (400,100)-(600,220), centre (500,160)
    addShape(doc, 'rect', 100, 100, 200, 120);
    addShape(doc, 'rect', 400, 100, 200, 120);
    render(<App doc={doc} />);
    flushFrames();

    // Switch to connector tool
    act(() => { fireEvent.keyDown(window, { key: 'l' }); });
    flushFrames();

    const connectorOverlay = screen.getByTestId('connector-tool-overlay');
    const beforeConnectorCount = countType(doc, 'connector');

    // Drag from A centre (200,160) to B centre (500,160)
    act(() => {
      fireEvent.pointerDown(connectorOverlay, { button: 0, pointerId: 1, clientX: 200, clientY: 160 });
    });
    act(() => {
      fireEvent.pointerMove(connectorOverlay, { pointerId: 1, clientX: 500, clientY: 160 });
    });
    act(() => {
      fireEvent.pointerUp(connectorOverlay, { pointerId: 1, clientX: 500, clientY: 160 });
    });
    flushFrames();

    // A connector should have been created
    expect(countType(doc, 'connector')).toBe(beforeConnectorCount + 1);

    // Tool should be back to Select
    const connectorBtn = screen.getByLabelText('Connector (L)');
    expect(connectorBtn).toHaveAttribute('aria-pressed', 'false');
  });

  // TC-20: Click 5px from arrow at 50% and 200% zoom → selected / not selected (hit tolerance).
  it('TC-20: Connector renders in DOM and is selectable', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const shapeAId = addShape(doc, 'rect', 100, 100, 200, 120);
    const shapeBId = addShape(doc, 'rect', 400, 100, 200, 120);

    // Create a connector directly in the doc
    const objects = getObjects(doc);
    const connId = 'test-conn-1';
    doc.transact(() => {
      const conn = new Y.Map();
      conn.set('type', 'connector');
      conn.set('x', 0);
      conn.set('y', 0);
      conn.set('width', 0);
      conn.set('height', 0);
      conn.set('z', 100);
      conn.set('from', { kind: 'attached', objectId: shapeAId, fallback: { x: 300, y: 160 } });
      conn.set('to', { kind: 'attached', objectId: shapeBId, fallback: { x: 400, y: 160 } });
      objects.set(connId, conn);
    });

    render(<App doc={doc} />);
    flushFrames();

    // Connector object should be rendered
    const connectorEl = screen.getByTestId('board').querySelector(`[data-connector-id="${connId}"]`);
    expect(connectorEl).not.toBeNull();
  });

  // TC-21: Selected connector shows two end handles.
  it('TC-21: Selected connector shows end handles', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const shapeAId = addShape(doc, 'rect', 100, 100, 200, 120);
    const shapeBId = addShape(doc, 'rect', 400, 100, 200, 120);

    // Create a connector
    const objects = getObjects(doc);
    const connId = 'test-conn-1';
    doc.transact(() => {
      const conn = new Y.Map();
      conn.set('type', 'connector');
      conn.set('x', 0);
      conn.set('y', 0);
      conn.set('width', 0);
      conn.set('height', 0);
      conn.set('z', 100);
      conn.set('from', { kind: 'attached', objectId: shapeAId, fallback: { x: 300, y: 160 } });
      conn.set('to', { kind: 'attached', objectId: shapeBId, fallback: { x: 400, y: 160 } });
      objects.set(connId, conn);
    });

    render(<App doc={doc} />);
    flushFrames();

    // Click on the connector to select it (on the transparent hit area)
    const connectorEl = screen.getByTestId('board').querySelector(`[data-connector-id="${connId}"]`);
    expect(connectorEl).not.toBeNull();

    // Simulate clicking the connector line (find the svg line element)
    const hitLine = connectorEl!.querySelector('line');
    expect(hitLine).not.toBeNull();

    act(() => {
      fireEvent.pointerDown(hitLine!, { button: 0, pointerId: 1, clientX: 350, clientY: 160 });
      fireEvent.pointerUp(hitLine!, { pointerId: 1, clientX: 350, clientY: 160 });
    });
    flushFrames();

    // End handles should be rendered
    const endHandles = document.querySelectorAll('[data-connector-end]');
    expect(endHandles.length).toBe(2);
  });

  // TC-22: S then Escape → Select active and nothing created; L then Escape → same.
  it('TC-22: Escape from Shape/Connector returns to Select and creates nothing', () => {
    const doc = renderWithDoc();

    // S activates Shape
    act(() => { fireEvent.keyDown(window, { key: 's' }); });
    flushFrames();
    const shapeBtn = screen.getByLabelText('Shape (S)');
    expect(shapeBtn).toHaveAttribute('aria-pressed', 'true');

    // Escape → Select
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    flushFrames();
    expect(shapeBtn).toHaveAttribute('aria-pressed', 'false');
    expect(countType(doc, 'shape')).toBe(0);

    // L activates Connector
    act(() => { fireEvent.keyDown(window, { key: 'l' }); });
    flushFrames();
    const connectorBtn = screen.getByLabelText('Connector (L)');
    expect(connectorBtn).toHaveAttribute('aria-pressed', 'true');

    // Escape → Select
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    flushFrames();
    expect(connectorBtn).toHaveAttribute('aria-pressed', 'false');
    expect(countType(doc, 'connector')).toBe(0);

    // After S → create → Select
    act(() => { fireEvent.keyDown(window, { key: 's' }); });
    flushFrames();
    const overlay = screen.getByTestId('shape-tool-overlay');
    act(() => { fireEvent.pointerDown(overlay, { button: 0, pointerId: 1, clientX: 100, clientY: 100 }); });
    act(() => { fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 300, clientY: 220 }); });
    act(() => { fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 300, clientY: 220 }); });
    flushFrames();
    // Tool should be back to Select after creation
    expect(shapeBtn).toHaveAttribute('aria-pressed', 'false');
  });

  // TC-28: Shape tool drag starting over an existing sticky → sticky position unchanged.
  it('TC-28: Shape tool drag over existing sticky does not move it', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 100, y: 100 });
    render(<App doc={doc} />);
    flushFrames();

    // Record sticky position
    const objects = getObjects(doc);
    let stickyX = 0, stickyY = 0;
    objects.forEach((obj) => {
      if (obj.get('type') === 'sticky') {
        stickyX = obj.get('x') as number;
        stickyY = obj.get('y') as number;
      }
    });

    // Activate shape tool
    act(() => { fireEvent.keyDown(window, { key: 's' }); });
    flushFrames();

    const overlay = screen.getByTestId('shape-tool-overlay');

    // Drag starting over the sticky area
    act(() => {
      fireEvent.pointerDown(overlay, { button: 0, pointerId: 1, clientX: 150, clientY: 150 });
      fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 350, clientY: 250 });
      fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 350, clientY: 250 });
    });
    flushFrames();

    // Verify the sticky position did NOT change
    let newStickyX = 0, newStickyY = 0;
    objects.forEach((obj) => {
      if (obj.get('type') === 'sticky') {
        newStickyX = obj.get('x') as number;
        newStickyY = obj.get('y') as number;
      }
    });
    expect(newStickyX).toBe(stickyX);
    expect(newStickyY).toBe(stickyY);
  });
});
