import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { screenToWorld } from '../../src/client/canvas/camera';
import { getObjectType } from '../../src/client/objects/registry';
import { createSticky, initDoc, snapshot, snapshotAll } from '../../src/shared/board-model';
import { CONNECTOR_HIT_TOLERANCE_PX } from '../../src/shared/config';
import type { Rect } from '../../src/shared/geometry';
import { collectConnectorViews, createConnector } from '../../src/shared/objects/connector';
import { collectShapeSnapshots, createShape, getShapeLabel } from '../../src/shared/objects/shape';
import { initialCamera } from './helpers';

const holder = vi.hoisted(() => ({ status: 'connected' as string }));
vi.mock('../../src/client/sync/ConnectionStatus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/ConnectionStatus')>();
  return { ...actual, useConnectionStatus: () => holder.status as never };
});

const { BoardView } = await import('../../src/client/pages/BoardPage');

let doc: Y.Doc;

function mount(): Y.Doc {
  doc = new Y.Doc();
  initDoc(doc);
  render(<BoardView doc={doc} />);
  return doc;
}

const cam = initialCamera();

function toScreen(world: { x: number; y: number }) {
  return { x: world.x - cam.x, y: world.y - cam.y };
}

function centerOf(rect: Rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function addShape(kind: 'rect' | 'ellipse' | 'diamond', rect: Rect): string {
  let id = '';
  act(() => {
    const created = createShape(doc, { kind, rect, at: centerOf(rect) }, 'g_test');
    if (created !== null) id = created;
  });
  return id;
}

function shapeButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Shape (S)' });
}

function connectorButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Connector (L)' });
}

function selectButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Select (V)' });
}

function overlay(): HTMLElement {
  return screen.getByTestId(
    shapeButton().getAttribute('aria-pressed') === 'true'
      ? 'shape-tool-overlay'
      : 'connector-tool-overlay'
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  holder.status = 'connected';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('shape.tool', () => {
  it('TC-15 S then a drag previews and creates one shape, selected, tool back to Select', () => {
    mount();
    fireEvent.keyDown(window, { key: 'S' });
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'true');

    const ov = overlay();
    fireEvent.pointerDown(ov, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(ov, { clientX: 300, clientY: 220, pointerId: 1 });
    expect(screen.getByTestId('shape-preview')).toBeInTheDocument();
    fireEvent.pointerUp(ov, { clientX: 300, clientY: 220, pointerId: 1 });

    const shapes = collectShapeSnapshots(doc);
    expect(shapes).toHaveLength(1);
    const w0 = screenToWorld(cam, { x: 100, y: 100 });
    expect(shapes[0].x).toBeCloseTo(w0.x, 6);
    expect(shapes[0].y).toBeCloseTo(w0.y, 6);
    expect(shapes[0].width).toBeCloseTo(200, 6);
    expect(shapes[0].height).toBeCloseTo(120, 6);

    expect(screen.queryByTestId('shape-preview')).not.toBeInTheDocument();
    expect(screen.getByTestId('shape-object')).toHaveAttribute('data-selected', 'true');
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'false');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
  });

  it('TC-16 double-click opens the label editor; input clamps to 500 chars', () => {
    mount();
    const id = addShape('rect', { x: 0, y: 0, width: 200, height: 100 });
    const note = screen.getByTestId('shape-object');
    fireEvent.doubleClick(note);
    const editor = screen.getByTestId('shape-label-editor');
    fireEvent.input(editor, { target: { value: 'a'.repeat(600) } });
    fireEvent.keyDown(editor, { key: 'Escape' });

    const snap = collectShapeSnapshots(doc).find((s) => s.id === id);
    expect(snap?.label).toHaveLength(500);
  });

  it('TC-17 fill and outline swatches recolour without touching label, position or selection', () => {
    mount();
    const id = addShape('rect', { x: 0, y: 0, width: 200, height: 100 });
    act(() => {
      getShapeLabel(doc, id)?.insert(0, 'keep me');
    });
    const shapeEl = screen.getByTestId('shape-object');
    fireEvent.pointerDown(shapeEl, { clientX: 100, clientY: 50, pointerId: 1, button: 0 });
    fireEvent.pointerUp(shapeEl, { clientX: 100, clientY: 50, pointerId: 1 });

    const toolbar = screen.getByTestId('shape-toolbar');
    fireEvent.click(screen.getByRole('button', { name: 'blue fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'red outline' }));

    const snap = collectShapeSnapshots(doc).find((s) => s.id === id);
    expect(snap?.fill).toBe('blue');
    expect(snap?.stroke).toBe('red');
    expect(snap?.label).toBe('keep me');
    expect(snap?.x).toBeCloseTo(0, 6);
    expect(snap?.y).toBeCloseTo(0, 6);
    expect(toolbar).toBeInTheDocument();
    expect(screen.getByTestId('shape-object')).toHaveAttribute('data-selected', 'true');
  });

  it('TC-22 S/L create return to Select; Escape never creates', () => {
    mount();
    // S then create → Select again
    fireEvent.keyDown(window, { key: 'S' });
    let ov = overlay();
    fireEvent.pointerDown(ov, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerUp(ov, { clientX: 250, clientY: 250, pointerId: 1 });
    expect(collectShapeSnapshots(doc)).toHaveLength(1);
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'false');

    // L then create → Select again
    const a = addShape('rect', { x: 0, y: 0, width: 200, height: 100 });
    addShape('rect', { x: 400, y: 0, width: 200, height: 100 });
    fireEvent.keyDown(window, { key: 'L' });
    ov = overlay();
    const sa = toScreen(centerOf({ x: 0, y: 0, width: 200, height: 100 }));
    const sb = toScreen(centerOf({ x: 400, y: 0, width: 200, height: 100 }));
    fireEvent.pointerDown(ov, { clientX: sa.x, clientY: sa.y, pointerId: 1, button: 0 });
    fireEvent.pointerMove(ov, { clientX: sb.x, clientY: sb.y, pointerId: 1 });
    fireEvent.pointerUp(ov, { clientX: sb.x, clientY: sb.y, pointerId: 1 });
    expect(collectConnectorViews(doc)).toHaveLength(1);
    expect(connectorButton()).toHaveAttribute('aria-pressed', 'false');
    void a;

    // Escape with each tool active: active tool, nothing created
    fireEvent.keyDown(window, { key: 'S' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(shapeButton()).toHaveAttribute('aria-pressed', 'false');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(collectShapeSnapshots(doc)).toHaveLength(3);

    fireEvent.keyDown(window, { key: 'L' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(connectorButton()).toHaveAttribute('aria-pressed', 'false');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');
    expect(collectConnectorViews(doc)).toHaveLength(1);
  });

  it('TC-28 a Shape-tool drag over an object never moves that object', () => {
    mount();
    act(() => {
      createSticky(doc, { x: 0, y: 0 }, 'yellow');
    });
    const before = snapshot(doc)[0];
    fireEvent.keyDown(window, { key: 'S' });
    const ov = overlay();
    fireEvent.pointerDown(ov, { clientX: 50, clientY: 50, pointerId: 1, button: 0 });
    fireEvent.pointerMove(ov, { clientX: 250, clientY: 250, pointerId: 1 });
    fireEvent.pointerUp(ov, { clientX: 250, clientY: 250, pointerId: 1 });

    const after = snapshot(doc)[0];
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(collectShapeSnapshots(doc)).toHaveLength(1);
  });
});

describe('connector.tool', () => {
  it('TC-18 hovering an object with L shows four dots at the side midpoints', () => {
    mount();
    const id = addShape('rect', { x: 0, y: 0, width: 200, height: 100 });
    fireEvent.keyDown(window, { key: 'L' });
    const ov = overlay();
    const c = toScreen({ x: 100, y: 50 });
    fireEvent.pointerMove(ov, { clientX: c.x, clientY: c.y, pointerId: 1 });

    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const dot = screen.getByTestId(`connector-dot-${side}`);
      expect(dot).toHaveAttribute('data-object-id', id);
      expect(dot).toHaveAttribute('data-highlighted', 'false');
    }
  });

  it('TC-19 drag from A over B highlights the nearest dot and creates an attached arrow', () => {
    mount();
    const a = addShape('rect', { x: 0, y: 0, width: 200, height: 100 });
    const b = addShape('rect', { x: 400, y: 0, width: 200, height: 100 });
    fireEvent.keyDown(window, { key: 'L' });
    const ov = overlay();
    const sa = toScreen({ x: 100, y: 50 });
    const sb = toScreen({ x: 500, y: 50 });
    fireEvent.pointerDown(ov, { clientX: sa.x, clientY: sa.y, pointerId: 1, button: 0 });
    fireEvent.pointerMove(ov, { clientX: sb.x, clientY: sb.y, pointerId: 1 });

    // B is right of A, so the arrow will attach to B's left side.
    const highlighted = screen
      .getAllByTestId('connector-dot-left')
      .find((d) => d.getAttribute('data-highlighted') === 'true');
    expect(highlighted).toBeDefined();
    expect(highlighted).toHaveAttribute('data-object-id', b);

    fireEvent.pointerUp(ov, { clientX: sb.x, clientY: sb.y, pointerId: 1 });

    const views = collectConnectorViews(doc);
    expect(views).toHaveLength(1);
    expect(views[0].from).toMatchObject({ kind: 'attached', objectId: a });
    expect(views[0].to).toMatchObject({ kind: 'attached', objectId: b });
    // A and B remain untouched; the new arrow is selected, tool back to Select.
    expect(collectShapeSnapshots(doc)).toHaveLength(2);
    expect(screen.getByTestId('connector-object')).toHaveAttribute('data-selected', 'true');
    expect(connectorButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it('TC-19b same-object drag and a too-short drag create nothing', () => {
    mount();
    addShape('rect', { x: 0, y: 0, width: 200, height: 100 });
    fireEvent.keyDown(window, { key: 'L' });
    const ov = overlay();
    const c = toScreen({ x: 100, y: 50 });
    fireEvent.pointerDown(ov, { clientX: c.x, clientY: c.y, pointerId: 1, button: 0 });
    fireEvent.pointerMove(ov, { clientX: c.x + 40, clientY: c.y + 40, pointerId: 1 });
    fireEvent.pointerUp(ov, { clientX: c.x + 40, clientY: c.y + 40, pointerId: 1 });
    expect(collectConnectorViews(doc)).toHaveLength(0);
    expect(connectorButton()).toHaveAttribute('aria-pressed', 'true');

    // Tiny drag on empty space (below min length) also creates nothing.
    fireEvent.pointerDown(ov, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerUp(ov, { clientX: 12, clientY: 12, pointerId: 1 });
    expect(collectConnectorViews(doc)).toHaveLength(0);
  });

  it('TC-20 selection hit-testing uses line proximity, not the bbox, at 100% and 200%', () => {
    mount();
    const id = (() => {
      let created = '';
      act(() => {
        const c = createConnector(
          doc,
          { kind: 'free', x: 0, y: 0 },
          { kind: 'free', x: 100, y: 0 },
          'g_test'
        );
        if (c !== null) created = c;
      });
      return created;
    })();
    const spec = getObjectType('connector');
    expect(spec).toBeDefined();
    const obj = snapshotAll(doc).find((o) => o.id === id);
    expect(obj).toBeDefined();
    // A click on the bbox corner is far from the line; a click near the
    // line is within tolerance. 6 screen px = 6 / zoom world units.
    for (const zoom of [1, 2]) {
      expect(
        spec?.hitTest(obj as never, { x: 50, y: CONNECTOR_HIT_TOLERANCE_PX / zoom - 1 }, { doc, zoom })
      ).toBe(true);
      expect(
        spec?.hitTest(obj as never, { x: 50, y: CONNECTOR_HIT_TOLERANCE_PX / zoom + 1 }, { doc, zoom })
      ).toBe(false);
      expect(spec?.hitTest(obj as never, { x: 100, y: 100 }, { doc, zoom })).toBe(false);
    }
  });
});

describe('connector.handle', () => {
  function arrowBetweenShapes(): { a: string; b: string } {
    const a = addShape('rect', { x: 0, y: 0, width: 200, height: 100 });
    const b = addShape('rect', { x: 400, y: 0, width: 200, height: 100 });
    act(() => {
      createConnector(
        doc,
        { kind: 'attached', objectId: a, fallback: { x: 200, y: 50 } },
        { kind: 'attached', objectId: b, fallback: { x: 400, y: 50 } },
        'g_test'
      );
    });
    return { a, b };
  }

  function selectArrow(): void {
    const hit = screen.getByTestId('connector-hit');
    fireEvent.pointerDown(hit, { clientX: 400, clientY: 400, pointerId: 1, button: 0 });
    fireEvent.pointerUp(hit, { clientX: 400, clientY: 400, pointerId: 1 });
    expect(screen.getByTestId('connector-object')).toHaveAttribute('data-selected', 'true');
  }

  it('TC-21 dragging the end handle onto C re-attaches it, onto empty space frees it', () => {
    mount();
    arrowBetweenShapes();
    const c = addShape('rect', { x: 150, y: 300, width: 200, height: 100 });
    selectArrow();

    // Drag the 'to' handle onto C's centre.
    const handle = screen.getByTestId('connector-handle-to');
    fireEvent.pointerDown(handle, { clientX: 400, clientY: 400, pointerId: 1, button: 0 });
    const onC = toScreen({ x: 250, y: 350 });
    fireEvent.pointerMove(window, { clientX: onC.x, clientY: onC.y, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: onC.x, clientY: onC.y, pointerId: 1 });

    let view = collectConnectorViews(doc)[0];
    expect(view.to).toMatchObject({ kind: 'attached', objectId: c });
    expect(view.from).toMatchObject({ kind: 'attached' });

    // Drag it back to empty board space: free at the release point.
    fireEvent.pointerDown(screen.getByTestId('connector-handle-to'), {
      clientX: onC.x,
      clientY: onC.y,
      pointerId: 1,
      button: 0
    });
    const empty = { x: 40, y: 60 }; // screen coords over blank canvas
    fireEvent.pointerMove(window, { clientX: empty.x, clientY: empty.y, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: empty.x, clientY: empty.y, pointerId: 1 });

    view = collectConnectorViews(doc)[0];
    const world = screenToWorld(cam, empty);
    expect(view.to.kind).toBe('free');
    expect((view.to as { x: number }).x).toBeCloseTo(world.x, 6);
    expect((view.to as { y: number }).y).toBeCloseTo(world.y, 6);
  });

  it('TC-21b the handle cannot attach to the object at the other end', () => {
    mount();
    const { a, b } = arrowBetweenShapes();
    selectArrow();
    const handle = screen.getByTestId('connector-handle-to');
    fireEvent.pointerDown(handle, { clientX: 400, clientY: 400, pointerId: 1, button: 0 });
    const onA = toScreen({ x: 100, y: 50 }); // centre of A (the other end's object)
    fireEvent.pointerMove(window, { clientX: onA.x, clientY: onA.y, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: onA.x, clientY: onA.y, pointerId: 1 });

    // Snapped back: still attached to B (the release was over A).
    const view = collectConnectorViews(doc)[0];
    expect(view.to).toMatchObject({ kind: 'attached', objectId: b });
    expect(view.from).toMatchObject({ kind: 'attached', objectId: a });
  });

  it('TC-13b moving an attached object moves the arrow endpoint with it', () => {
    mount();
    const { a } = arrowBetweenShapes();
    const before = collectConnectorViews(doc)[0];
    act(() => {
      const obj = doc.getMap<Y.Map<unknown>>('objects').get(a);
      obj?.set('x', 0);
      obj?.set('y', 300);
    });
    const after = collectConnectorViews(doc)[0];
    expect(before.resolved.from.y).toBeCloseTo(50, 6);
    expect(after.resolved.from.y).toBeCloseTo(350, 6);
  });
});
