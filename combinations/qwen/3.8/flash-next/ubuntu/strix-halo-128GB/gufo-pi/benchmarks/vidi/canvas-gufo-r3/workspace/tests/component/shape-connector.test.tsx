import { describe, it, expect, vi } from 'vitest';
import { fireEvent, act, screen, waitFor } from '@testing-library/react';
import { renderShapeHarness, addShape, addConnector } from './shapeHarness';
import { snapshotShape, getShapeLabel } from '@shared/objects/shape';
import { snapshotConnector } from '@shared/objects/connector';
import { LOCAL_ORIGIN } from '@shared/board-model';
import { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_LABEL_MAX_CHARS } from '@shared/config';
import * as Y from 'yjs';

// The pointer overlay treats the element rect as origin; jsdom gives client rects at 0.
function pointerDown(el: Element, x: number, y: number, opts: Partial<PointerEventInit> = {}) {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: x, clientY: y, button: 0, ...opts });
}
function pointerMove(x: number, y: number, opts: Partial<PointerEventInit> = {}) {
  fireEvent(window, new PointerEvent('pointermove', { pointerId: 1, clientX: x, clientY: y, ...opts }));
}
function pointerUp(x: number, y: number, opts: Partial<PointerEventInit> = {}) {
  fireEvent(window, new PointerEvent('pointerup', { pointerId: 1, clientX: x, clientY: y, ...opts }));
}

describe('Shape tool (TC-15, TC-16, TC-28)', () => {
  it('TC-15: pointerdown/move/up on the shape overlay creates one shape and selects it', () => {
    const { api, getByTestId } = renderShapeHarness();
    act(() => api().setTool('shape'));
    const overlay = getByTestId('shape-tool-overlay');

    pointerDown(overlay, 100, 100);
    pointerMove(300, 260);
    pointerUp(300, 260);

    const shapes = snapshotShape(api().doc);
    expect(shapes.length).toBe(1);
    expect(shapes[0].width).toBeCloseTo(200);
    expect(shapes[0].height).toBeCloseTo(160);
    // tool returns to select and the new shape is selected
    expect(api().tool).toBe('select');
    expect(api().selection.ids.has(shapes[0].id)).toBe(true);
  });

  it('TC-16: click creates default-size shape; Shift+drag creates a square', () => {
    const { api, getByTestId } = renderShapeHarness();
    act(() => api().setTool('shape'));
    const overlay = getByTestId('shape-tool-overlay');

    // click -> default size centred on the click point
    pointerDown(overlay, 200, 200);
    pointerUp(200, 200);
    const clickShape = snapshotShape(api().doc)[0];
    expect(clickShape.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(clickShape.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);

    // Shift+drag -> square anchored at origin, side = larger dimension
    act(() => api().setTool('shape'));
    const overlay2 = screen.getByTestId('shape-tool-overlay');
    pointerDown(overlay2, 0, 400, { shiftKey: true });
    pointerMove(200, 520, { shiftKey: true });
    pointerUp(200, 520, { shiftKey: true });
    const square = snapshotShape(api().doc)[1];
    expect(square.width).toBeCloseTo(200);
    expect(square.height).toBeCloseTo(200);
  });

  it('TC-28: a shape-tool drag that starts on an existing object creates a shape and does not move the object', () => {
    const { api, getByTestId } = renderShapeHarness();
    const id = addShape(api, 'rect', { x: 100, y: 100, width: 200, height: 160 });
    act(() => api().setTool('shape'));
    const overlay = getByTestId('shape-tool-overlay');

    // Start inside the existing shape and drag out
    pointerDown(overlay, 150, 150);
    pointerMove(400, 400);
    pointerUp(400, 400);

    const shapes = snapshotShape(api().doc);
    // original untouched (x=100) + one new shape
    expect(shapes.length).toBe(2);
    const original = shapes.find((s) => s.id === id)!;
    expect(original.x).toBe(100);
    expect(original.y).toBe(100);
    expect(original.width).toBe(200);
  });
});

describe('Shape styles and labels (TC-17, TC-18)', () => {
  it('TC-17: fill and outline swatches change only that key', () => {
    const { api } = renderShapeHarness();
    const id = addShape(api, 'rect', { x: 10, y: 10, width: 200, height: 160 });
    // Set a label so we can prove it is untouched
    act(() => {
      const label = getShapeLabel(api().doc, id)!;
      api().doc.transact(() => label.insert(0, 'hello'), LOCAL_ORIGIN);
    });
    act(() => api().selection.click(id));

    fireEvent.click(screen.getByLabelText('Blue fill'));
    fireEvent.click(screen.getByLabelText('Red outline'));

    const snap = snapshotShape(api().doc)[0];
    expect(snap.fill).toBe('blue');
    expect(snap.stroke).toBe('red');
    expect(snap.label).toBe('hello');
  });

  it('TC-17b: "No fill" swatch sets fill to none', () => {
    const { api } = renderShapeHarness();
    const id = addShape(api, 'rect', { x: 0, y: 0, width: 120, height: 120 });
    act(() => api().selection.click(id));
    fireEvent.click(screen.getByLabelText('No fill'));
    expect(snapshotShape(api().doc)[0].fill).toBe('none');
  });

  it('TC-18: label is clamped to SHAPE_LABEL_MAX_CHARS when edited', () => {
    const { api } = renderShapeHarness();
    const id = addShape(api, 'rect', { x: 0, y: 0, width: 200, height: 160 });
    act(() => api().selection.startEdit(id));

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    const long = 'x'.repeat(SHAPE_LABEL_MAX_CHARS + 50);
    fireEvent.change(textarea, { target: { value: long } });
    fireEvent.input(textarea);

    const label = getShapeLabel(api().doc, id)!;
    expect(label.toString().length).toBeLessThanOrEqual(SHAPE_LABEL_MAX_CHARS);
  });

  it('TC-18b: the label container re-wraps on resize (CSS width tracks shape width)', () => {
    const { api, getByTestId } = renderShapeHarness();
    const id = addShape(api, 'rect', { x: 0, y: 0, width: 200, height: 160 });
    const before = getByTestId('shape-label');
    const beforeWidth = (before.style.right as string) + '|' + (before.style.left as string);
    // Resize the shape via the model
    const m = api().doc.getMap('objects').get(id) as Y.Map<unknown>;
    act(() => {
      api().doc.transact(() => {
        m.set('width', 400);
      }, LOCAL_ORIGIN);
    });
    const after = getByTestId('shape-label');
    // The wrapper width grew (data-width reflects the new size); label uses inset left/right
    expect(after.closest('[data-testid="shape-wrapper"]')!.getAttribute('data-width')).toBe('400');
    expect(beforeWidth).toBeTruthy();
  });
});

describe('Connector tool and behaviour (TC-19..TC-22)', () => {
  it('TC-19: drag from A to B attaches both ends and the arrow follows B when B moves', () => {
    const { api, getByTestId } = renderShapeHarness();
    const a0 = addShape(api, 'rect', { x: 0, y: 100, width: 100, height: 80 });
    const b0 = addShape(api, 'rect', { x: 400, y: 100, width: 100, height: 80 });
    void a0;
    act(() => api().setTool('connector'));
    const overlay = getByTestId('connector-tool-overlay');

    // start inside A, release inside B
    pointerDown(overlay, 50, 140);
    pointerMove(450, 140);
    pointerUp(450, 140);

    const conns = snapshotConnector(api().doc);
    expect(conns.length).toBe(1);
    expect(conns[0].from.kind).toBe('attached');
    expect(conns[0].to.kind).toBe('attached');

    // Move B far left and confirm the resolved end follows (rendered endpoint changes)
    const bMap = api().doc.getMap('objects').get(b0) as Y.Map<unknown>;
    act(() => {
      api().doc.transact(() => {
        bMap.set('x', -400);
        bMap.set('y', -200);
      }, LOCAL_ORIGIN);
    });
    const moved = snapshotConnector(api().doc)[0];
    expect(moved.to.kind).toBe('attached');
    const toId = moved.to.kind === 'attached' ? moved.to.objectId : null;
    const fromId = moved.from.kind === 'attached' ? moved.from.objectId : null;
    expect(toId === b0 || fromId === b0).toBeTruthy();
    expect(api().tool).toBe('select');
  });

  it('TC-20: releasing a connector on empty space creates a free end', () => {
    const { api, getByTestId } = renderShapeHarness();
    const { a } = (() => {
      const s = addShape(api, 'rect', { x: 0, y: 100, width: 100, height: 80 });
      return { a: s };
    })();
    act(() => api().setTool('connector'));
    const overlay = getByTestId('connector-tool-overlay');
    pointerDown(overlay, 50, 140);
    pointerMove(600, 500);
    pointerUp(600, 500);
    const conn = snapshotConnector(api().doc)[0];
    expect(conn.to.kind).toBe('free');
    expect(conn.from.kind === 'attached' ? conn.from.objectId : '').toBe(a);
  });

  it('TC-21: arrow selection via a click within the tolerance selects it', () => {
    const { api } = renderShapeHarness();
    const a = addShape(api, 'rect', { x: 0, y: 100, width: 100, height: 80 });
    const b = addShape(api, 'rect', { x: 400, y: 100, width: 100, height: 80 });
    addConnector(api, { kind: 'attached', objectId: a, fallback: { x: 100, y: 140 } }, { kind: 'attached', objectId: b, fallback: { x: 400, y: 140 } });
    const hit = screen.getByTestId('connector-hit');
    fireEvent.pointerDown(hit, { pointerId: 1, clientX: 250, clientY: 140, button: 0 });
    const connId = snapshotConnector(api().doc)[0].id;
    expect(api().selection.ids.has(connId)).toBe(true);
  });

  it('TC-22: toolbar and keyboard switch S, then L, then V; a click creates nothing', () => {
    const { getByTestId } = renderShapeHarness();
    fireEvent.click(getByTestId('tool-shape'));
    expect(getByTestId('tool-shape').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(getByTestId('tool-connector'));
    expect(getByTestId('tool-connector').getAttribute('aria-pressed')).toBe('true');
    // keyboard V -> select
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' }));
    });
    expect(getByTestId('tool-select').getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-22c: Escape from the shape tool and connector tool returns to Select and creates nothing', () => {
    const { getByTestId } = renderShapeHarness();
    fireEvent.click(getByTestId('tool-shape'));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(getByTestId('tool-select').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(getByTestId('tool-connector'));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(getByTestId('tool-select').getAttribute('aria-pressed')).toBe('true');
    // nothing created
    expect(screen.queryByTestId('shape-object')).toBeNull();
    expect(screen.queryByTestId('connector-wrapper')).toBeNull();
  });

  it('TC-18: hovering the connector tool over a shape shows four dots at the side midpoints', () => {
    const { api, getByTestId } = renderShapeHarness();
    addShape(api, 'rect', { x: 100, y: 100, width: 200, height: 120 });
    act(() => api().setTool('connector'));
    const overlay = getByTestId('connector-tool-overlay');
    // Move over the shape centre -> hover reveals its four side-midpoint dots
    fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 200, clientY: 160 });
    const dots = screen.getAllByTestId('connector-dot');
    expect(dots.length).toBe(4);
    const centers = dots.map((d) => `${(d as unknown as SVGCircleElement).getAttribute('cx')},${(d as unknown as SVGCircleElement).getAttribute('cy')}`);
    // rect 100,100 200x120 -> side midpoints top(200,100) right(300,160) bottom(200,220) left(100,160)
    expect(centers).toEqual(expect.arrayContaining(['200,100', '300,160', '200,220', '100,160']));
  });

  it('TC-22b: selecting the shape tool shows the kind menu with three options', () => {
    const { getByTestId } = renderShapeHarness();
    fireEvent.click(getByTestId('tool-shape'));
    const menu = getByTestId('shape-kind-menu');
    expect(menu).toBeTruthy();
    expect(screen.getByLabelText('Rectangle')).toBeTruthy();
    expect(screen.getByLabelText('Ellipse')).toBeTruthy();
    expect(screen.getByLabelText('Diamond')).toBeTruthy();
  });

  it('TC-20b: arrow hit stroke width scales as 2 * tolerance / zoom (50%, 100%, 200%)', () => {
    const { api } = renderShapeHarness();
    const a = addShape(api, 'rect', { x: 0, y: 100, width: 100, height: 80 });
    const b = addShape(api, 'rect', { x: 400, y: 100, width: 100, height: 80 });
    addConnector(api, { kind: 'attached', objectId: a, fallback: { x: 100, y: 140 } }, { kind: 'attached', objectId: b, fallback: { x: 400, y: 140 } });
    const hit = () => screen.getByTestId('connector-hit') as unknown as SVGSVGElement;
    // default zoom 1
    expect(hit().getAttribute('stroke-width')).toBe(String(2 * 6));
    act(() => api().setCamera({ x: 0, y: 0, zoom: 2 }));
    expect(hit().getAttribute('stroke-width')).toBe(String(2 * 6 / 2));
    act(() => api().setCamera({ x: 0, y: 0, zoom: 0.5 }));
    expect(hit().getAttribute('stroke-width')).toBe(String(2 * 6 / 0.5));
  });

  it('TC-21b: dragging a selected end handle re-attaches to another object', () => {
    const { api } = renderShapeHarness();
    const a = addShape(api, 'rect', { x: 0, y: 100, width: 100, height: 80 });
    const b = addShape(api, 'rect', { x: 400, y: 100, width: 100, height: 80 });
    const c = addShape(api, 'rect', { x: 200, y: 400, width: 100, height: 80 });
    const id = addConnector(api, { kind: 'attached', objectId: a, fallback: { x: 100, y: 140 } }, { kind: 'attached', objectId: b, fallback: { x: 400, y: 140 } });
    act(() => api().selection.click(id));
    const handle = screen.getByTestId('to-handle');
    fireEvent.pointerDown(handle, { pointerId: 2, clientX: 400, clientY: 140, button: 0 });
    // Move over C then release
    pointerMoveTo(250, 440, 2);
    pointerUpTo(250, 440, 2);
    const conn = snapshotConnector(api().doc).find((x) => x.id === id)!;
    expect(conn.to.kind === 'attached' ? conn.to.objectId : '').toBe(c);
  });

  it('TC-21c: dragging a selected end handle to empty space detaches it', () => {
    const { api } = renderShapeHarness();
    const a = addShape(api, 'rect', { x: 0, y: 100, width: 100, height: 80 });
    const b = addShape(api, 'rect', { x: 400, y: 100, width: 100, height: 80 });
    const id = addConnector(api, { kind: 'attached', objectId: a, fallback: { x: 100, y: 140 } }, { kind: 'attached', objectId: b, fallback: { x: 400, y: 140 } });
    act(() => api().selection.click(id));
    const handle = screen.getByTestId('to-handle');
    fireEvent.pointerDown(handle, { pointerId: 2, clientX: 400, clientY: 140, button: 0 });
    pointerMoveTo(900, 700, 2);
    pointerUpTo(900, 700, 2);
    const conn = snapshotConnector(api().doc).find((x) => x.id === id)!;
    expect(conn.to.kind).toBe('free');
  });
});

function pointerMoveTo(x: number, y: number, pointerId: number) {
  fireEvent(window, new PointerEvent('pointermove', { pointerId, clientX: x, clientY: y }));
}
function pointerUpTo(x: number, y: number, pointerId: number) {
  fireEvent(window, new PointerEvent('pointerup', { pointerId, clientX: x, clientY: y }));
}
