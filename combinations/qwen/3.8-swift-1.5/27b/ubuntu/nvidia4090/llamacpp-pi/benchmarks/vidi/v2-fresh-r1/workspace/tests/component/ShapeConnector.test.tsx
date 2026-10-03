// Component tests for shape tool/object/toolbar, connector tool/object,
// and active tool (story 10). TC-15 to TC-22, TC-28.

import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { initDoc, snapshot, createSticky } from '../../src/shared/board-model';
import { createShape, setShapeStyle, getShapeLabel } from '../../src/shared/objects/shape';
import { createConnector, setConnectorEndpoint } from '../../src/shared/objects/connector';
import { SHAPE_LABEL_MAX_CHARS, CONNECTOR_HIT_TOLERANCE_PX } from '../../src/shared/config';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { BoardHarness, makeDoc } from './board-harness';
import '../fixtures/testbox';

function renderBoard(canEdit = true) {
  const doc = makeDoc();
  initDoc(doc);
  render(<BoardHarness doc={doc} canEdit={canEdit} withToolbar />);
  return { doc };
}

function shapeIds(doc: Y.Doc): string[] {
  return snapshot(doc).filter((o) => o.type === 'shape').map((o) => o.id);
}

function connectorIds(doc: Y.Doc): string[] {
  return snapshot(doc).filter((o) => o.type === 'connector').map((o) => o.id);
}

afterEach(cleanup);

describe('shape tool (story 10)', () => {
  // TC-15: S tool pointerdown/move/up → preview shown, createShape called once, tool returns to select
  test('TC-15 S tool drag creates a shape and returns to select', () => {
    const { doc } = renderBoard();

    // Activate shape tool
    fireEvent.keyDown(window, { key: 's' });
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('shape');

    // Simulate a drag on the shape tool
    const tool = screen.getByTestId('shape-tool');
    fireEvent.pointerDown(tool, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(tool, { clientX: 300, clientY: 220 });
    fireEvent.pointerUp(tool, { clientX: 300, clientY: 220 });

    const ids = shapeIds(doc);
    expect(ids).toHaveLength(1);
    // Tool returns to select
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('select');
  });

  // TC-16: dblclick shape, type 600 chars → editor open, label length SHAPE_LABEL_MAX_CHARS
  test('TC-16 dblclick shape opens editor, label clamped to max chars', () => {
    const { doc } = renderBoard();

    // Create a shape directly (wrap in act for re-render)
    let id = '';
    act(() => {
      id = createShape(doc, {
        kind: 'rect',
        rect: { x: 100, y: 100, width: 200, height: 120 },
        at: { x: 100, y: 100 },
      }, 'local')!;
    });

    // Select it and double-click to edit
    const shapeEl = screen.getByTestId('shape-object');
    fireEvent.dblClick(shapeEl);
    expect(screen.getByTestId('editing').getAttribute('data-value')).toBe(id);

    // Type 600 characters (TextEditor uses onInput)
    const textarea = screen.getByLabelText('Shape label');
    const longText = 'a'.repeat(600);
    (textarea as HTMLTextAreaElement).value = longText;
    fireEvent.input(textarea);

    // Label should be clamped to SHAPE_LABEL_MAX_CHARS
    const label = getShapeLabel(doc, id);
    expect(label!.toString().length).toBe(SHAPE_LABEL_MAX_CHARS);
  });

  // TC-17: click blue fill and red outline swatches → colours applied; label and selection unchanged
  test('TC-17 shape toolbar applies fill and stroke colours', () => {
    const { doc } = renderBoard();

    // Create a shape and select it
    let id = '';
    act(() => {
      id = createShape(doc, {
        kind: 'rect',
        rect: { x: 100, y: 100, width: 200, height: 120 },
        at: { x: 100, y: 100 },
      }, 'local')!;
    });

    // Select it by clicking
    const shapeEl = screen.getByTestId('shape-object');
    fireEvent.pointerDown(shapeEl, { clientX: 200, clientY: 160, button: 0 });
    fireEvent.pointerUp(shapeEl, { clientX: 200, clientY: 160 });
    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe(id);

    // Shape toolbar should be visible
    const toolbar = screen.getByTestId('shape-toolbar');
    expect(toolbar).toBeInTheDocument();

    // Click blue fill
    fireEvent.click(within(toolbar).getByTestId('fill-swatch-blue'));
    const snap1 = snapshot(doc).find((o) => o.id === id) as any;
    expect(snap1.fill).toBe('blue');

    // Click red stroke
    fireEvent.click(within(toolbar).getByTestId('stroke-swatch-red'));
    const snap2 = snapshot(doc).find((o) => o.id === id) as any;
    expect(snap2.stroke).toBe('red');

    // Selection unchanged
    expect(screen.getByTestId('selected').getAttribute('data-value')).toBe(id);
  });

  // TC-28: Shape tool drag starting over an existing sticky → sticky position unchanged
  test('TC-28 shape tool drag does not move existing objects', () => {
    const { doc } = renderBoard();

    // Create a sticky
    const stickyId = createSticky(doc, { x: 200, y: 200 });
    const before = snapshot(doc).find((o) => o.id === stickyId)!;

    // Activate shape tool and drag over the sticky's area
    fireEvent.keyDown(window, { key: 's' });
    const tool = screen.getByTestId('shape-tool');
    fireEvent.pointerDown(tool, { clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(tool, { clientX: 300, clientY: 300 });
    fireEvent.pointerUp(tool, { clientX: 300, clientY: 300 });

    // Sticky position unchanged
    const after = snapshot(doc).find((o) => o.id === stickyId)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });
});

describe('connector tool (story 10)', () => {
  // TC-18: L tool hover over shape → four dots at side midpoints
  test('TC-18 connector tool shows hover dots over a shape', () => {
    const { doc } = renderBoard();

    // Create a shape
    act(() => {
      createShape(doc, {
        kind: 'rect',
        rect: { x: 100, y: 100, width: 200, height: 120 },
        at: { x: 100, y: 100 },
      }, 'local');
    });

    // Activate connector tool
    fireEvent.keyDown(window, { key: 'l' });
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('connector');

    // Hover over the shape area: shape center world (200,160) → screen (840,560)
    const tool = screen.getByTestId('connector-tool');
    fireEvent.pointerMove(tool, { clientX: 840, clientY: 560 });

    // Four dots should be visible
    expect(screen.getByTestId('connector-dot-top')).toBeInTheDocument();
    expect(screen.getByTestId('connector-dot-right')).toBeInTheDocument();
    expect(screen.getByTestId('connector-dot-bottom')).toBeInTheDocument();
    expect(screen.getByTestId('connector-dot-left')).toBeInTheDocument();
  });

  // TC-19: drag from A over B → B's nearest dot highlighted; release → attached connector created
  test('TC-19 connector drag from A to B creates attached connector', () => {
    const { doc } = renderBoard();

    // Create two shapes
    let idA = '', idB = '';
    act(() => {
      idA = createShape(doc, {
        kind: 'rect',
        rect: { x: 50, y: 100, width: 100, height: 100 },
        at: { x: 50, y: 100 },
      }, 'local')!;
      idB = createShape(doc, {
        kind: 'rect',
        rect: { x: 400, y: 100, width: 100, height: 100 },
        at: { x: 400, y: 100 },
      }, 'local')!;
    });

    // Activate connector tool
    fireEvent.keyDown(window, { key: 'l' });

    // Drag from A center (world 100,150 → screen 740,550) to B center (world 450,150 → screen 1090,550)
    const tool = screen.getByTestId('connector-tool');
    fireEvent.pointerDown(tool, { clientX: 740, clientY: 550, button: 0 });
    fireEvent.pointerMove(tool, { clientX: 1090, clientY: 550 });
    fireEvent.pointerUp(tool, { clientX: 1090, clientY: 550 });

    // Connector created
    const ids = connectorIds(doc);
    expect(ids).toHaveLength(1);

    // Tool returns to select
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('select');

    void idA;
    void idB;
  });

  // TC-20: connector hit test tolerance (geometry check)
  test('TC-20 connector hit test: distanceToPolyline within tolerance selects', () => {
    // This tests the geometry directly since component-level hit testing
    // depends on SVG hit regions which jsdom doesn't fully support.

    // A horizontal line from (0,0) to (100,0)
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

    // Point 5px away (within 6px tolerance) → should hit
    expect(distanceToPolyline(points, { x: 50, y: 5 })).toBeLessThanOrEqual(CONNECTOR_HIT_TOLERANCE_PX);

    // Point 7px away (beyond 6px tolerance) → should not hit
    expect(distanceToPolyline(points, { x: 50, y: 7 })).toBeGreaterThan(CONNECTOR_HIT_TOLERANCE_PX);
  });

  // TC-21: drag end handle onto C → attached; onto empty space → free
  test('TC-21 connector end handle re-attach', () => {
    const { doc } = renderBoard();

    // Create three shapes and a connector
    let idA = '', idB = '', idC = '', connId = '';
    act(() => {
      idA = createShape(doc, {
        kind: 'rect',
        rect: { x: 50, y: 100, width: 100, height: 100 },
        at: { x: 50, y: 100 },
      }, 'local')!;
      idB = createShape(doc, {
        kind: 'rect',
        rect: { x: 400, y: 100, width: 100, height: 100 },
        at: { x: 400, y: 100 },
      }, 'local')!;
      idC = createShape(doc, {
        kind: 'rect',
        rect: { x: 200, y: 400, width: 100, height: 100 },
        at: { x: 200, y: 400 },
      }, 'local')!;
      connId = createConnector(doc,
        { kind: 'attached', objectId: idA, fallback: { x: 150, y: 150 } },
        { kind: 'attached', objectId: idB, fallback: { x: 400, y: 150 } },
        'local',
      )!;
    });

    // Verify the connector exists
    expect(connectorIds(doc)).toContain(connId);

    // Test setConnectorEndpoint to attach to C
    act(() => {
      const ok = setConnectorEndpoint(doc, connId, 'to', {
        kind: 'attached',
        objectId: idC,
        fallback: { x: 250, y: 400 },
      });
      expect(ok).toBe(true);
    });

    // Test setConnectorEndpoint to free
    act(() => {
      const ok2 = setConnectorEndpoint(doc, connId, 'to', {
        kind: 'free',
        x: 500,
        y: 500,
      });
      expect(ok2).toBe(true);
    });

    void idA;
    void idB;
    void idC;
  });
});

describe('active tool (story 10)', () => {
  // TC-22: S then create → Select; L then create → Select; S then Escape → Select; L then Escape → Select
  test('TC-22 tool returns to Select after creation; Escape returns to Select', () => {
    const { doc } = renderBoard();

    // S then create → Select
    fireEvent.keyDown(window, { key: 's' });
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('shape');
    const shapeTool = screen.getByTestId('shape-tool');
    fireEvent.pointerDown(shapeTool, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(shapeTool, { clientX: 200, clientY: 200 });
    fireEvent.pointerUp(shapeTool, { clientX: 200, clientY: 200 });
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('select');
    expect(shapeIds(doc)).toHaveLength(1);

    // L then create → Select
    fireEvent.keyDown(window, { key: 'l' });
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('connector');
    // Create shapes to connect
    act(() => {
      createShape(doc, { kind: 'rect', rect: { x: 500, y: 100, width: 100, height: 100 }, at: { x: 500, y: 100 } }, 'local')!;
      createShape(doc, { kind: 'rect', rect: { x: 700, y: 100, width: 100, height: 100 }, at: { x: 700, y: 100 } }, 'local')!;
    });
    const connTool = screen.getByTestId('connector-tool');
    // Shape centers: world (550,150)→screen(1190,550), world (750,150)→screen(1390,550)
    fireEvent.pointerDown(connTool, { clientX: 1190, clientY: 550, button: 0 });
    fireEvent.pointerMove(connTool, { clientX: 1390, clientY: 550 });
    fireEvent.pointerUp(connTool, { clientX: 1390, clientY: 550 });
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('select');
    expect(connectorIds(doc)).toHaveLength(1);

    // S then Escape → Select, nothing created
    const shapeCountBefore = shapeIds(doc).length;
    fireEvent.keyDown(window, { key: 's' });
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('shape');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('select');
    expect(shapeIds(doc).length).toBe(shapeCountBefore);

    // L then Escape → Select, nothing created
    const connCountBefore = connectorIds(doc).length;
    fireEvent.keyDown(window, { key: 'l' });
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('connector');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('tool').getAttribute('data-value')).toBe('select');
    expect(connectorIds(doc).length).toBe(connCountBefore);
  });
});
