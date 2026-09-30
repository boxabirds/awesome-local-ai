// connector.ui (TC-18 to TC-21): Connector tool dots and creation, arrow hit test and end handles.
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECTOR_DOT_RADIUS_PX } from '../../src/shared/config';
import { dispatchKey, useFakeFrames } from './helpers';
import {
  addConnector,
  attachedTo,
  connectorsOf,
  docWithShapes,
  objectEl,
  pressedTool,
  resetCameraTracking,
  selectedIds,
  setCamera,
  toClient,
  toWorld,
} from './shapeHelpers';
import { renderApp } from './stickyHelpers';

beforeEach(() => {
  useFakeFrames();
  resetCameraTracking();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const connectorTool = () => screen.getByTestId('connector-tool');
const dots = () => screen.queryAllByTestId('connector-dot');
const dotCentre = (el: HTMLElement) => ({
  x: parseFloat(el.style.left) + CONNECTOR_DOT_RADIUS_PX,
  y: parseFloat(el.style.top) + CONNECTOR_DOT_RADIUS_PX,
});

/** A (0,0 100x100) and B (400,0 100x100), 300 apart; C below A. */
function threeShapes() {
  return docWithShapes([
    { x: 0, y: 0, width: 100, height: 100 },
    { x: 400, y: 0, width: 100, height: 100 },
    { x: 0, y: 400, width: 100, height: 100 },
  ]);
}

describe('connector.ui Connector tool', () => {
  it('TC-18 hovering a shape with L shows four dots at its side midpoints', () => {
    const { doc } = threeShapes();
    renderApp(doc);
    dispatchKey({ key: 'l' });
    expect(pressedTool()).toBe('Connector (L)');
    expect(dots()).toHaveLength(0);
    const over = toClient({ x: 50, y: 50 });
    fireEvent.pointerMove(connectorTool(), { clientX: over.x, clientY: over.y, pointerId: 1 });
    const found = dots();
    expect(found).toHaveLength(4);
    const bySide = Object.fromEntries(found.map((d) => [d.dataset.side, dotCentre(d)]));
    expect(bySide).toEqual({
      top: toClient({ x: 50, y: 0 }),
      right: toClient({ x: 100, y: 50 }),
      bottom: toClient({ x: 50, y: 100 }),
      left: toClient({ x: 0, y: 50 }),
    });
    expect(found.every((d) => d.dataset.highlighted === 'false')).toBe(true);
    // Off every object: no dots.
    const empty = toClient({ x: 250, y: 250 });
    fireEvent.pointerMove(connectorTool(), { clientX: empty.x, clientY: empty.y, pointerId: 1 });
    expect(dots()).toHaveLength(0);
  });

  it('TC-19 dragging from A over B highlights B\'s nearest dot; release creates an attached arrow', () => {
    const { doc, ids } = threeShapes();
    renderApp(doc);
    dispatchKey({ key: 'l' });
    const a = toClient({ x: 50, y: 50 });
    const b = toClient({ x: 450, y: 30 });
    fireEvent.pointerDown(connectorTool(), { clientX: a.x, clientY: a.y, button: 0, pointerId: 1 });
    fireEvent.pointerMove(connectorTool(), { clientX: b.x, clientY: b.y, pointerId: 1 });
    const highlighted = dots().filter((d) => d.dataset.highlighted === 'true');
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0].dataset.side).toBe('left');
    expect(dotCentre(highlighted[0])).toEqual(toClient({ x: 400, y: 50 }));
    expect(screen.getByTestId('connector-preview')).toBeTruthy();
    fireEvent.pointerUp(connectorTool(), { clientX: b.x, clientY: b.y, pointerId: 1 });

    const arrows = connectorsOf(doc);
    expect(arrows).toHaveLength(1);
    expect(arrows[0].from).toMatchObject({ kind: 'attached', objectId: ids[0] });
    expect(arrows[0].to).toMatchObject({ kind: 'attached', objectId: ids[1] });
    expect(arrows[0].ends).toEqual({ from: { x: 100, y: 50 }, to: { x: 400, y: 50 } });
    expect(pressedTool()).toBe('Select (V)');
    expect(selectedIds()).toEqual([arrows[0].id]);
  });

  it('releasing on empty space leaves a free end; on the start object or after a tiny drag, nothing', () => {
    const { doc, ids } = threeShapes();
    renderApp(doc);
    dispatchKey({ key: 'l' });
    const drag = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const p = toClient(from);
      const q = toClient(to);
      fireEvent.pointerDown(connectorTool(), { clientX: p.x, clientY: p.y, button: 0, pointerId: 1 });
      fireEvent.pointerMove(connectorTool(), { clientX: q.x, clientY: q.y, pointerId: 1 });
      fireEvent.pointerUp(connectorTool(), { clientX: q.x, clientY: q.y, pointerId: 1 });
    };
    drag({ x: 10, y: 10 }, { x: 90, y: 90 });
    drag({ x: 250, y: 250 }, { x: 255, y: 253 });
    expect(connectorsOf(doc)).toHaveLength(0);
    expect(pressedTool()).toBe('Connector (L)');

    drag({ x: 50, y: 50 }, { x: 250, y: 250 });
    const [arrow] = connectorsOf(doc);
    expect(arrow.from).toMatchObject({ kind: 'attached', objectId: ids[0] });
    expect(arrow.to).toEqual({ kind: 'free', x: 250, y: 250 });

    // Starting on empty space fixes the start there.
    dispatchKey({ key: 'l' });
    drag({ x: 250, y: -100 }, { x: 450, y: 50 });
    const second = connectorsOf(doc).find((c) => c.id !== arrow.id)!;
    expect(second.from).toEqual({ kind: 'free', x: 250, y: -100 });
    expect(second.to).toMatchObject({ kind: 'attached', objectId: ids[1] });
  });
});

describe('connector.ui arrow selection', () => {
  for (const zoom of [0.5, 2]) {
    it(`TC-20 at ${zoom * 100}% a click 5 px from the line selects the arrow; 7 px does not`, () => {
      const { doc } = docWithShapes([]);
      const id = addConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 200, y: 0 });
      renderApp(doc);
      setCamera({ x: -100, y: -100, zoom });
      const viewport = screen.getByTestId('board-viewport');
      const line = toClient({ x: 100, y: 0 });
      const clickAt = (dy: number) => {
        fireEvent.pointerDown(viewport, { clientX: line.x, clientY: line.y + dy, button: 0, pointerId: 1 });
        fireEvent.pointerUp(viewport, { clientX: line.x, clientY: line.y + dy, pointerId: 1 });
      };
      clickAt(7);
      expect(selectedIds()).toEqual([]);
      clickAt(-5);
      expect(selectedIds()).toEqual([id]);
      clickAt(-7);
      expect(selectedIds()).toEqual([]);
      clickAt(5);
      expect(selectedIds()).toEqual([id]);
    });
  }

  it('a click inside a diagonal arrow\'s bounding box but away from its line does not select it', () => {
    const { doc } = docWithShapes([]);
    const id = addConnector(doc, { kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 200, y: 200 });
    renderApp(doc);
    const viewport = screen.getByTestId('board-viewport');
    const far = toClient({ x: 150, y: 50 });
    fireEvent.pointerDown(viewport, { clientX: far.x, clientY: far.y, button: 0, pointerId: 1 });
    fireEvent.pointerUp(viewport, { clientX: far.x, clientY: far.y, pointerId: 1 });
    expect(selectedIds()).toEqual([]);
    const near = toClient({ x: 100, y: 104 });
    fireEvent.pointerDown(viewport, { clientX: near.x, clientY: near.y, button: 0, pointerId: 1 });
    fireEvent.pointerUp(viewport, { clientX: near.x, clientY: near.y, pointerId: 1 });
    expect(selectedIds()).toEqual([id]);
    // Selected alone: its own end handles, no selection box.
    expect(screen.getByRole('button', { name: 'Arrow start' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Arrow end' })).toBeTruthy();
    expect(screen.queryByTestId('selection-box')).toBeNull();
  });
});

describe('connector.ui re-attach', () => {
  it('TC-21 dragging the end handle onto C attaches it to C; onto empty space frees it there', () => {
    const { doc, ids } = threeShapes();
    const id = addConnector(doc, attachedTo(ids[0]), attachedTo(ids[1]));
    renderApp(doc);
    const viewport = screen.getByTestId('board-viewport');
    const onLine = toClient({ x: 250, y: 50 });
    fireEvent.pointerDown(viewport, { clientX: onLine.x, clientY: onLine.y, button: 0, pointerId: 1 });
    fireEvent.pointerUp(viewport, { clientX: onLine.x, clientY: onLine.y, pointerId: 1 });
    expect(selectedIds()).toEqual([id]);

    const dragHandle = (name: string, from: { x: number; y: number }, to: { x: number; y: number }) => {
      const handle = screen.getByRole('button', { name });
      const p = toClient(from);
      const q = toClient(to);
      fireEvent.pointerDown(handle, { clientX: p.x, clientY: p.y, button: 0, pointerId: 2 });
      fireEvent.pointerMove(handle, { clientX: q.x, clientY: q.y, pointerId: 2 });
      fireEvent.pointerUp(handle, { clientX: q.x, clientY: q.y, pointerId: 2 });
    };

    // End (at B's left side) onto C.
    dragHandle('Arrow end', { x: 400, y: 50 }, { x: 60, y: 450 });
    let arrow = connectorsOf(doc)[0];
    expect(arrow.to).toMatchObject({ kind: 'attached', objectId: ids[2] });
    expect(arrow.ends).toEqual({ from: { x: 50, y: 100 }, to: { x: 50, y: 400 } });

    // Onto A (the object at the other end): rejected, snaps back.
    dragHandle('Arrow end', { x: 50, y: 400 }, { x: 30, y: 30 });
    expect(connectorsOf(doc)[0].to).toMatchObject({ kind: 'attached', objectId: ids[2] });

    // Onto empty space: free at the release point.
    dragHandle('Arrow end', { x: 50, y: 400 }, { x: 300, y: 300 });
    arrow = connectorsOf(doc)[0];
    expect(arrow.to).toEqual({ kind: 'free', x: 300, y: 300 });
    expect(toWorld(toClient({ x: 300, y: 300 }))).toEqual({ x: 300, y: 300 });
    expect(selectedIds()).toEqual([id]);
  });

  it('moving an attached object redraws the arrow at its nearest side', () => {
    const { doc, ids } = threeShapes();
    addConnector(doc, attachedTo(ids[0]), attachedTo(ids[1]));
    renderApp(doc);
    const arrowEl = () => document.querySelector<HTMLElement>('[data-connector-id]')!;
    expect(arrowEl().dataset.to).toBe('400,50');
    // Drag B below A with the generic move gesture.
    const b = toClient({ x: 450, y: 50 });
    fireEvent.pointerDown(objectEl(ids[1]), { clientX: b.x, clientY: b.y, button: 0, pointerId: 1 });
    fireEvent.pointerMove(objectEl(ids[1]), { clientX: b.x - 400, clientY: b.y + 250, pointerId: 1 });
    fireEvent.pointerUp(objectEl(ids[1]), { clientX: b.x - 400, clientY: b.y + 250, pointerId: 1 });
    expect(arrowEl().dataset.from).toBe('50,100');
    expect(arrowEl().dataset.to).toBe('50,250');
  });
});
